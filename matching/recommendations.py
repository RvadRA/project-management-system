"""Top-three recommendations shared by saved tasks and unsaved drafts.

Deterministic scoring stays in ``scoring.py``.  The local model only extracts
requirements and writes explanations from supplied facts.  The draft path is
read-only: it never creates a task, assignment, workload entry or embedding.
"""
import datetime
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from types import SimpleNamespace

from django.conf import settings

from .ai import (
    OllamaUnavailable, analyse_task, cosine, explain_candidate,
    recommendation_embeddings, task_source_text,
)
from .models import Skill
from .scoring import RequiredSkill, rank_candidates, skills_from_text

logger = logging.getLogger('ai')

TOP_LIMIT = 3


def deterministic_explanation(candidate, semantic_similarity=None):
    """Factual fallback used when the local LLM cannot write an explanation."""
    if semantic_similarity is None:
        semantic = 'семантическое сходство не рассчитано'
    else:
        semantic = f'семантическое сходство {semantic_similarity:.0%}'
    competence = candidate.details.get('competence') or {}
    availability = candidate.details.get('availability') or {}
    if competence.get('required'):
        skills = f'навыки {candidate.competence_fit:.0%}'
    else:
        skills = 'обязательные навыки не извлечены, фильтр компетенций не применялся'
    if availability.get('workload_known'):
        availability_text = f'доступность {candidate.availability:.0%}'
    else:
        availability_text = 'фактическая загрузка по WorkloadEntry не подтверждена'
    task_estimate = (
        f'Открытых задач: {candidate.open_task_count}, '
        f'известная оценка трудозатрат: {candidate.active_task_hours:g} ч'
    )
    if candidate.unestimated_task_count:
        task_estimate += f', без оценки: {candidate.unestimated_task_count}'
    return (
        f'Балл {candidate.total_score:.0%}: {skills}, '
        f'{semantic}, {availability_text}, '
        f'результативность {candidate.past_performance:.0%}, '
        f'соответствие бюджету {candidate.cost_fit:.0%}. '
        f'{task_estimate}.'
    )


def semantic_status(candidates):
    if not candidates:
        return 'not_applicable'
    available = [bool(item.details.get('semantic_available')) for item in candidates]
    if all(available):
        return 'available'
    if any(available):
        return 'partial'
    return 'unavailable'


def _draft_task(draft):
    """Minimal task-like object accepted by ``analyse_task`` and ``explain_candidate``."""
    process_name = (draft.get('process_name') or '').strip()
    block_name = (draft.get('block_name') or '').strip()
    workflow = SimpleNamespace(name=process_name) if process_name else None
    block = SimpleNamespace(name=block_name, description='') if block_name else None
    return SimpleNamespace(
        name=(draft.get('title') or '').strip(),
        description=(draft.get('description') or '').strip(),
        task_type='TEXT_REPORT',
        workflow=workflow,
        workflow_id=1 if workflow else None,
        linked_wbs_task=block,
    )


def _draft_requirements(task, draft, warnings):
    """Extract draft requirements, degrading to catalog text matching on Ollama failure."""
    degraded = False
    try:
        requirements = analyse_task(task, timeout=getattr(settings, 'OLLAMA_ANALYSIS_TIMEOUT', 20))
        requirements.setdefault(
            'skills_source', 'llm' if requirements.get('skills') else 'none',
        )
    except OllamaUnavailable as exc:
        degraded = True
        warnings.append(
            'Локальная модель анализа задачи недоступна — показан детерминированный подбор.'
        )
        logger.warning('Draft task analysis is unavailable: %s', exc)
        fallback = skills_from_text(task_source_text(task))
        requirements = {
            'skills': [skill.name for skill in fallback],
            'skills_source': 'catalog_text_fallback' if fallback else 'none',
            'task_type': 'TEXT_REPORT',
            'complexity': 'medium',
            'summary': task.name,
        }

    selected_ids = []
    for value in draft.get('skill_ids') or []:
        try:
            selected_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    selected = list(Skill.objects.filter(id__in=selected_ids).values_list('name', flat=True))
    if selected:
        requirements['skills'] = list(dict.fromkeys([*requirements.get('skills', []), *selected]))
        if requirements.get('skills_source') in (None, 'none'):
            requirements['skills_source'] = 'draft_selection'
    return requirements, degraded


def _exclusion_reasons(candidate):
    details = candidate.details.get('competence') or {}
    reasons = []
    missing = list(details.get('missing') or [])
    below_minimum = list(details.get('below_minimum') or [])
    if missing:
        reasons.append({
            'code': 'missing_required_skills',
            'skills': missing,
            'message': 'Нет обязательных навыков: ' + ', '.join(missing),
        })
    if below_minimum:
        reasons.append({
            'code': 'below_minimum_skills',
            'skills': below_minimum,
            'message': 'Навыки ниже минимального уровня: ' + ', '.join(below_minimum),
        })
    if candidate.availability <= 0:
        reasons.append({
            'code': 'zero_availability',
            'message': 'Нет доступности в выбранном периоде.',
        })
    return reasons


def _excluded_row(candidate, reasons):
    return {
        'employee_id': candidate.employee.id,
        'full_name': candidate.employee.user.get_full_name() or candidate.employee.user.username,
        'position': candidate.employee.position,
        'reasons': reasons,
    }


def _period(project, draft):
    today = datetime.date.today()
    end = None
    try:
        end = datetime.date.fromisoformat(str(draft.get('due_date') or '')[:10])
    except (TypeError, ValueError):
        end = None
    if end is None or end < today:
        end = project.end_date or today + datetime.timedelta(days=14)
    if end < today:
        end = today + datetime.timedelta(days=14)
    return today, end


def _explain_top_candidates(top, task, requirements):
    """Fill explanations in parallel with a hard budget; never fail the request.

    The local model can spend tens of seconds on one explanation.  Draft
    recommendations are interactive, so the deterministic explanation stays in
    place when the model misses the shared deadline.
    """
    if not top:
        return
    timeout = getattr(settings, 'OLLAMA_EXPLANATION_TIMEOUT', 5)
    deadline = time.monotonic() + timeout + 1
    executor = ThreadPoolExecutor(max_workers=len(top), thread_name_prefix='candidate-explanation')

    def generate(candidate):
        return explain_candidate(
            task, requirements, candidate, candidate.details.get('semantic_similarity'), timeout=timeout,
        )

    try:
        futures = [(executor.submit(generate, candidate), candidate) for candidate in top]
        for future, candidate in futures:
            try:
                candidate.explanation = future.result(timeout=max(0, deadline - time.monotonic()))
                candidate.details['explanation_source'] = 'llm'
            except FutureTimeout:
                logger.warning(
                    'LLM explanation exceeded the %ss budget for profile %s; '
                    'using deterministic fallback.', timeout, candidate.employee.id,
                )
            except OllamaUnavailable as exc:
                logger.warning(
                    'LLM explanation is unavailable for profile %s; using deterministic fallback: %s',
                    candidate.employee.id, exc,
                )
            except Exception:
                logger.exception(
                    'Unexpected explanation error for profile %s; using deterministic fallback.',
                    candidate.employee.id,
                )
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def recommend_for_draft(project, draft):
    """
    Return up to three eligible employees for an unsaved task draft.

    This uses the same candidate pool and scoring as a saved task.  Project
    membership is a ranking signal (``already_member``), not a hard filter:
    a project may have no employee members while suitable employees exist.
    """
    warnings = []
    start, end = _period(project, draft)
    task = _draft_task(draft)
    requirements, degraded = _draft_requirements(task, draft, warnings)
    known_skills = Skill.objects.filter(name__in=requirements.get('skills') or [])
    required = [
        RequiredSkill(skill_id=item.id, min_level=2, preferred_level=3)
        for item in known_skills
    ]
    candidates = rank_candidates(
        project_start=start,
        project_end=end,
        required_skills=required,
        domain=project.domain,
        project=project,
        warn_about_membership=False,
    )
    if not candidates:
        warnings.append('В системе нет активных сотрудников с профилем — подбор невозможен.')

    eligible = []
    excluded = []
    for candidate in candidates:
        reasons = _exclusion_reasons(candidate)
        if reasons:
            excluded.append(_excluded_row(candidate, reasons))
            continue
        candidate.details['deterministic_score'] = round(candidate.total_score, 4)
        eligible.append(candidate)

    task_vector = None
    employee_vectors = {}
    if eligible:
        task_text = f'{task.name}\n{task.description}\n{requirements.get("summary") or ""}'
        try:
            task_vector, employee_vectors = recommendation_embeddings(
                task_text,
                [candidate.employee for candidate in eligible],
                persist=False,
                keep_alive=settings.OLLAMA_KEEP_ALIVE,
            )
        except OllamaUnavailable as exc:
            logger.warning(
                'Draft embeddings are unavailable; keeping deterministic ranking: %s', exc,
            )

    for candidate in eligible:
        semantic = None
        if task_vector is not None:
            vector = employee_vectors.get(candidate.employee.id)
            if vector:
                semantic = cosine(task_vector, vector)
        if semantic is None:
            candidate.details['semantic_similarity'] = None
            candidate.details['semantic_available'] = False
        else:
            candidate.details['semantic_similarity'] = round(semantic, 4)
            candidate.details['semantic_available'] = True
            candidate.total_score = round(candidate.total_score * .8 + semantic * .2, 4)
        candidate.explanation = deterministic_explanation(candidate, semantic)
        candidate.details['explanation_source'] = 'deterministic'

    eligible.sort(key=lambda item: item.total_score, reverse=True)
    top = eligible[:TOP_LIMIT]
    _explain_top_candidates(top, task, requirements)

    if not top and candidates:
        warnings.append('Среди сотрудников нет кандидатов, прошедших обязательные условия.')
    if degraded:
        warnings.append('Проверьте навыки и срок вручную: анализ задачи выполнен без модели.')

    return {
        'requirements': requirements,
        'scoring': {
            'formula': '0.80 × deterministic score + 0.20 × semantic similarity (when available)',
            'constraints': (
                'All extracted catalog skills at level 2+ and availability above zero.'
                if required else
                'Обязательные навыки не извлечены; фильтр компетенций не применялся.'
            ),
            'semantic_status': semantic_status(eligible),
            'competence_filter_applied': bool(required),
            'skills_source': requirements.get('skills_source'),
            'total_considered': len(candidates),
            'eligible_count': len(eligible),
            'excluded_count': len(excluded),
            'top_limit': TOP_LIMIT,
            'period_start': start.isoformat(),
            'period_end': end.isoformat(),
        },
        'excluded_candidates': excluded,
        'candidates': top,
        'warnings': warnings,
        'degraded': degraded,
    }

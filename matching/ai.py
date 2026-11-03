"""Local Ollama-backed analysis for task recommendations.

The model only extracts requirements and writes prose from supplied facts.  All
eligibility and ranking remain deterministic in this module / ``scoring.py``.
"""
import hashlib
import json
import math
import re
from dataclasses import dataclass
from difflib import SequenceMatcher

import requests
from django.conf import settings

from .models import EmployeeProfile, Skill


class OllamaUnavailable(Exception):
    """Raised for a local-runtime problem that callers can present safely."""


def _chat_options(**overrides):
    """Same context/memory policy as the assistant provider."""
    return {'temperature': 0, 'num_ctx': settings.OLLAMA_NUM_CTX, **overrides}


def _post(path, payload, timeout=None):
    request_timeout = settings.OLLAMA_TIMEOUT if timeout is None else timeout
    try:
        response = requests.post(
            f"{settings.OLLAMA_BASE_URL.rstrip('/')}{path}", json=payload,
            timeout=request_timeout,
        )
        response.raise_for_status()
        return response.json()
    except requests.Timeout as exc:
        raise OllamaUnavailable(
            f'Local Ollama did not respond within {request_timeout} seconds.'
        ) from exc
    except requests.HTTPError as exc:
        # Surface Ollama's safe local diagnostic (for example, a missing model)
        # instead of masking it as a generic outage.
        try:
            detail = exc.response.json().get('error', '')
        except (AttributeError, ValueError):
            detail = ''
        message = f'Ollama request failed: {detail}' if detail else 'Local Ollama returned an error.'
        raise OllamaUnavailable(message) from exc
    except (requests.RequestException, ValueError) as exc:
        raise OllamaUnavailable("Local Ollama is unavailable or returned an invalid response.") from exc


def embedding_batch(texts, keep_alive=None):
    """Embed several texts in one Ollama request.

    Batching matters with ``keep_alive=0``: one request loads the model, returns
    all vectors and lets Ollama unload it, instead of reloading per candidate.
    """
    inputs = [str(text) for text in texts]
    if not inputs:
        return []
    if keep_alive is None:
        keep_alive = settings.OLLAMA_KEEP_ALIVE
    data = _post('/api/embed', {
        'model': settings.OLLAMA_EMBED_MODEL,
        'input': inputs,
        'keep_alive': keep_alive,
    })
    values = data.get('embeddings')
    if not isinstance(values, list) or len(values) != len(inputs):
        raise OllamaUnavailable('Ollama returned an unexpected number of embeddings.')
    vectors = []
    for value in values:
        if not isinstance(value, list) or not value:
            raise OllamaUnavailable('Ollama returned no embedding.')
        vectors.append([float(item) for item in value])
    return vectors


def embedding(text, keep_alive=None):
    return embedding_batch([text], keep_alive=keep_alive)[0]


def cosine(left, right):
    if not left or not right or len(left) != len(right):
        return 0.0
    divisor = math.sqrt(sum(x * x for x in left)) * math.sqrt(sum(x * x for x in right))
    return max(0.0, sum(x * y for x, y in zip(left, right)) / divisor) if divisor else 0.0


def task_source_text(task):
    """All task context that may contain requirements, not only the mutable description."""
    wbs = getattr(task, 'linked_wbs_task', None)
    return '\n'.join(part for part in [
        task.name,
        task.description,
        task.workflow.name if task.workflow_id else '',
        wbs.name if wbs else '',
        wbs.description if wbs else '',
    ] if part and str(part).strip())


def _skill_mentioned(name, text):
    """Whether a catalog skill is explicitly present in the supplied task context."""
    if not name or not text:
        return False
    exact = r'(?<![\w+#])' + re.escape(name) + r'(?![\w+#])'
    if re.search(exact, text, flags=re.IGNORECASE):
        return True
    # Accept harmless separator variants such as "CI CD" or "CSS / SASS",
    # but only for catalog names that actually contain a separator.
    if not re.search(r'[/-]', name):
        return False
    normalized_name = re.sub(r'[^a-z0-9+#]+', ' ', name.lower()).strip()
    normalized_text = re.sub(r'[^a-z0-9+#]+', ' ', text.lower())
    pattern = r'(?<![a-z0-9+#])' + re.escape(normalized_name) + r'(?![a-z0-9+#])'
    return bool(re.search(pattern, normalized_text))


def employee_experience_text(profile):
    from workflows.models import WorkflowTask
    skills = ', '.join(
        f'{row.skill.name} (level {row.level}, {row.years_experience:g} years)'
        for row in profile.employee_skills.select_related('skill').all()
    )
    projects = ', '.join(
        f'{row.project.name}: {row.role}' for row in profile.participations.select_related('project').all()
    )
    completed_tasks = ', '.join(
        f'{row.name}: {row.description}' for row in WorkflowTask.objects.filter(
            assigned_to=profile.user, status='DONE'
        ).order_by('-completed_at')[:50]
    )
    return '\n'.join(part for part in [
        f'Position: {profile.position}', f'Domain: {profile.domain}', f'Bio: {profile.bio}',
        f'Skills: {skills}', f'Completed project experience: {projects}',
        f'Previously completed tasks: {completed_tasks}',
    ] if part)


def _employee_embedding_source(profile):
    source = employee_experience_text(profile)
    return source, hashlib.sha256(source.encode('utf-8')).hexdigest()


def _cached_employee_vectors(profiles, force=False):
    vectors = {}
    pending = []
    for profile in profiles:
        source, fingerprint = _employee_embedding_source(profile)
        record = getattr(profile, 'experience_embedding', None)
        if not force and record and record.source_hash == fingerprint and record.vector:
            vectors[profile.id] = record.vector
        else:
            pending.append((profile, source, fingerprint))
    return vectors, pending


def _store_employee_vectors(pending, vectors):
    # Imported lazily to keep migrations independent of the recommendation path.
    from .models import EmployeeExperienceEmbedding
    for (profile, _source, fingerprint), vector in zip(pending, vectors):
        EmployeeExperienceEmbedding.objects.update_or_create(
            employee=profile, defaults={'source_hash': fingerprint, 'vector': vector},
        )


def cached_employee_embeddings(profiles, force=False, keep_alive=None):
    profiles = list(profiles)
    vectors, pending = _cached_employee_vectors(profiles, force=force)
    if pending:
        new_vectors = embedding_batch(
            [source for _profile, source, _fingerprint in pending],
            keep_alive=keep_alive,
        )
        _store_employee_vectors(pending, new_vectors)
        for (profile, _source, _fingerprint), vector in zip(pending, new_vectors):
            vectors[profile.id] = vector
    return vectors


def cached_employee_embedding(profile, force=False, keep_alive=None):
    return cached_employee_embeddings(
        [profile], force=force, keep_alive=keep_alive,
    )[profile.id]


def recommendation_embeddings(task_text, profiles, persist=False, force=False, keep_alive=None):
    """Return the task vector and one vector per profile in one batch."""
    profiles = list(profiles)
    vectors, pending = _cached_employee_vectors(profiles, force=force)
    inputs = [str(task_text)] + [source for _profile, source, _fingerprint in pending]
    results = embedding_batch(inputs, keep_alive=keep_alive)
    task_vector = results[0]
    new_vectors = results[1:]
    if persist:
        _store_employee_vectors(pending, new_vectors)
    for (profile, _source, _fingerprint), vector in zip(pending, new_vectors):
        vectors[profile.id] = vector
    return task_vector, vectors


EXPLANATION_MIN_LENGTH = 20
EXPLANATION_MAX_LENGTH = 1600
EXPLANATION_SCHEMA = {
    'type': 'object',
    'properties': {
        'explanation': {'type': 'string'},
        'limitations': {'type': 'array', 'items': {'type': 'string'}},
    },
    'required': ['explanation', 'limitations'],
}
_NUMBER_RE = re.compile(r'\d+(?:[.,]\d+)?')


def _add_numbers(value, numbers):
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        numbers.add(str(value))
        if isinstance(value, float) and value.is_integer():
            numbers.add(str(int(value)))
        return
    if isinstance(value, str):
        numbers.update(token.replace(',', '.') for token in _NUMBER_RE.findall(value))
        return
    if isinstance(value, dict):
        for item in value.values():
            _add_numbers(item, numbers)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _add_numbers(item, numbers)


def _allowed_numbers(facts):
    numbers = set()
    _add_numbers(facts, numbers)
    # Допускаем проценты, записанные как целые, и десятичные формы тех же чисел.
    for token in list(numbers):
        try:
            number = float(token)
        except ValueError:
            continue
        if number.is_integer():
            numbers.add(str(int(number)))
        numbers.add(f'{number:g}')
    return numbers


def _facts_for_explanation(task, requirements, candidate, semantic_similarity):
    details = candidate.details or {}
    competence = details.get('competence') or {}
    experience = details.get('experience') or {}
    availability = details.get('availability') or {}
    performance = details.get('performance') or {}
    cost = details.get('cost') or {}
    semantic_percent = round(semantic_similarity * 100) if semantic_similarity is not None else None
    required_skills = list(requirements.get('skills') or [])
    workload_known = bool(availability.get('workload_known'))
    current_workload_known = bool(availability.get('current_workload_known'))
    projects_in_domain = experience.get('domain_projects', experience.get('projects', 0))
    completed_tasks_in_domain = experience.get('domain_done_tasks', experience.get('done_tasks', 0))
    return {
        'task': task.name,
        'required_skills': required_skills,
        'competence_filter_applied': bool(required_skills),
        'skills_source': requirements.get('skills_source'),
        'matched_skills': list(competence.get('matched') or []),
        'below_minimum_skills': list(competence.get('below_minimum') or []),
        'missing_skills': list(competence.get('missing') or []),
        'experience': {
            'profile_domain': experience.get('profile_domain'),
            'project_domain': experience.get('domain'),
            'profile_domain_matches': bool(experience.get('profile_match')),
            'projects_in_domain': projects_in_domain or 0,
            'completed_tasks_in_domain': completed_tasks_in_domain or 0,
            'domain_experience_confirmed': bool(projects_in_domain or completed_tasks_in_domain),
        },
        'semantic_similarity_percent': semantic_percent,
        'availability': {
            'workload_known': workload_known,
            'workload_source': availability.get('workload_source', 'none'),
            'free_percent': availability.get('free_percent') if workload_known else None,
            'average_load_percent': availability.get('avg_load_percent') if workload_known else None,
            'peak_load_percent': availability.get('peak_load_percent') if workload_known else None,
            'current_workload_percent': candidate.current_workload if current_workload_known else None,
            'open_task_hours': candidate.active_task_hours,
            'unestimated_open_tasks': candidate.unestimated_task_count,
            'task_estimate_complete': bool(
                availability.get('task_estimate_complete', candidate.unestimated_task_count == 0)
            ),
            'unavailable_days': availability.get('unavailable_days'),
            'working_days': availability.get('working_days'),
        },
        'open_tasks': candidate.open_task_count,
        'estimated_open_hours': candidate.active_task_hours,
        'performance': {
            'done_on_time': performance.get('done_on_time'),
            'done_late': performance.get('done_late'),
            'overdue_open': performance.get('overdue_open'),
            'manual_ratings': performance.get('manual_ratings'),
        },
        'budget': {
            'hourly_rate': cost.get('hourly_rate'),
            'rate_limit': cost.get('rate_limit'),
            'cost_fit_percent': round(candidate.cost_fit * 100),
        },
        'conflicts': list(candidate.conflicts),
        'data_gaps': list(candidate.data_gaps),
    }


def _facts_as_text(facts):
    """Plain-text facts avoid qwen echoing a JSON input instead of answering."""
    experience = facts['experience']
    availability = facts['availability']
    performance = facts['performance']
    budget = facts['budget']

    def joined(values, empty='нет'):
        return ', '.join(str(item) for item in values) or empty

    if facts['competence_filter_applied']:
        required_text = joined(facts['required_skills'])
    else:
        required_text = 'не извлечены (фильтр компетенций не применялся)'

    if availability['workload_known']:
        workload_text = (
            f'WorkloadEntry: свободно {availability["free_percent"]}%, '
            f'средняя загрузка {availability["average_load_percent"]}%, '
            f'пиковая загрузка {availability["peak_load_percent"]}%, '
            f'текущая загрузка '
            f'{availability["current_workload_percent"] if availability["current_workload_percent"] is not None else "неизвестна"}'
        )
    else:
        workload_text = (
            'WorkloadEntry: записей нет; фактическая текущая загрузка и свободное время неизвестны'
        )

    task_estimate = (
        f'Открытые задачи: {facts["open_tasks"]}; известная оценка трудозатрат: '
        f'{facts["estimated_open_hours"]} ч; задач без оценки: '
        f'{availability["unestimated_open_tasks"]}'
    )

    return '\n'.join([
        f'Задача: {facts["task"]}',
        f'Обязательные навыки: {required_text}',
        f'Подтверждённые навыки: {joined(facts["matched_skills"])}',
        f'Навыки ниже минимума: {joined(facts["below_minimum_skills"])}',
        f'Отсутствующие навыки: {joined(facts["missing_skills"])}',
        f'Опыт: домен профиля {experience["profile_domain"] or "не указан"}, '
        f'домен проекта {experience["project_domain"] or "не указан"}, '
        f'домен профиля совпадает с проектом: {"да" if experience["profile_domain_matches"] else "нет"}, '
        f'подтверждённый опыт в домене (проекты или задачи): '
        f'{"да" if experience["domain_experience_confirmed"] else "нет"}, '
        f'проектов в домене {experience["projects_in_domain"]}, '
        f'выполненных задач в домене {experience["completed_tasks_in_domain"]}',
        f'Семантическое сходство, %: {facts["semantic_similarity_percent"] if facts["semantic_similarity_percent"] is not None else "не рассчитано"}',
        workload_text,
        f'Недоступных дней: {availability["unavailable_days"]} из {availability["working_days"]}',
        task_estimate,
        f'Результативность: в срок {performance["done_on_time"]}, '
        f'с опозданием {performance["done_late"]}, '
        f'просрочено сейчас {performance["overdue_open"]}, '
        f'ручных оценок {performance["manual_ratings"]}',
        f'Бюджет: ставка {budget["hourly_rate"]}, допустимая ставка {budget["rate_limit"]}, '
        f'соответствие бюджету {budget["cost_fit_percent"]}%',
        f'Ограничения: {joined(facts["conflicts"])}',
        f'Пробелы в данных: {joined(facts["data_gaps"])}',
    ])


def _skill_name(value):
    return value.split(' (', 1)[0].strip() if isinstance(value, str) else ''


def _normalized_skill_token(value):
    return re.sub(r'[^a-z0-9+#]+', '', value.lower())


def _canonicalize_skill_names(text, catalog):
    """Fix only malformed mentions of known catalog skills.

    Arbitrary technical terms are left untouched; the normal skill validation
    below decides whether the model actually used a supplied skill.
    """
    if not text:
        return text

    # Exact names with a slash may be written with spaces or an accidental colon.
    for name in catalog:
        if '/' not in name:
            continue
        prefix, suffix = name.split('/', 1)
        if not prefix or not suffix:
            continue
        pattern = (
            r'(?<![A-Za-z0-9+#])' + re.escape(prefix)
            + r'\s*[/:]\s*:?\s*' + re.escape(suffix)
            + r'(?![A-Za-z0-9+#])'
        )
        text = re.sub(pattern, lambda _match, canonical=name: canonical, text, flags=re.IGNORECASE)

    token_pattern = r'[A-Za-z][A-Za-z0-9+#/.:_-]*[A-Za-z0-9+#]|[A-Za-z]'
    for token in sorted(set(re.findall(token_pattern, text)), key=len, reverse=True):
        token_norm = _normalized_skill_token(token)
        if len(token_norm) < 2:
            continue
        exact = next((name for name in catalog if name.lower() == token.lower()), None)
        replacement = exact
        if replacement is None:
            best_name = None
            best_ratio = 0.0
            for name in catalog:
                name_norm = _normalized_skill_token(name)
                if not name_norm:
                    continue
                if token_norm == name_norm:
                    best_name, best_ratio = name, 1.0
                    break
                ratio = SequenceMatcher(None, token_norm, name_norm).ratio()
                if ratio > best_ratio:
                    best_name, best_ratio = name, ratio
            if best_name is None:
                continue
            has_separator = bool(re.search(r'[/:+#._-]', token))
            threshold = 0.80 if has_separator else 0.90
            if best_ratio < threshold:
                continue
            if abs(len(token_norm) - len(_normalized_skill_token(best_name))) > 1:
                continue
            replacement = best_name

        pattern = r'(?<![A-Za-z0-9+#])' + re.escape(token) + r'(?![A-Za-z0-9+#])'
        text = re.sub(pattern, lambda _match, canonical=replacement: canonical, text, flags=re.IGNORECASE)
    return text


def _validate_explanation(result, facts):
    if not isinstance(result, dict):
        raise OllamaUnavailable('Ollama returned an invalid recommendation explanation.')
    text = result.get('explanation')
    limitations = result.get('limitations') or []
    if not isinstance(text, str):
        raise OllamaUnavailable('Ollama returned an empty or oversized recommendation explanation.')
    if not isinstance(limitations, list) or any(not isinstance(item, str) for item in limitations):
        raise OllamaUnavailable('Ollama returned invalid recommendation limitations.')

    catalog = list(Skill.objects.values_list('name', flat=True))
    text = _canonicalize_skill_names(text, catalog)
    limitations = [_canonicalize_skill_names(item, catalog) for item in limitations]

    if not (EXPLANATION_MIN_LENGTH <= len(text.strip()) <= EXPLANATION_MAX_LENGTH):
        raise OllamaUnavailable('Ollama returned an empty or oversized recommendation explanation.')
    stripped_text = text.strip()
    if stripped_text.endswith(('...', '…', '/', ',', ';', ':')) or not re.search(r'[.!?]', stripped_text):
        raise OllamaUnavailable(
            f'Ollama returned an incomplete recommendation explanation: {stripped_text[-80:]!r}'
        )
    combined = ' '.join([text, *limitations]).strip()

    # The model may only use numbers supplied in the facts.
    allowed = _allowed_numbers(facts)
    for token in _NUMBER_RE.findall(combined):
        normalized = token.replace(',', '.')
        if normalized not in allowed:
            raise OllamaUnavailable(
                f'Ollama invented a number in the recommendation explanation: {token}.'
            )

    # The model may only mention skills that were actually supplied in the facts.
    allowed_skills = {
        name.lower()
        for key in ('matched_skills', 'below_minimum_skills', 'missing_skills')
        for name in (_skill_name(item) for item in facts.get(key, []))
        if name
    }
    for skill in catalog:
        if skill.lower() in allowed_skills:
            continue
        pattern = r'(?<![\w+#])' + re.escape(skill) + r'(?![\w+#])'
        if re.search(pattern, combined, flags=re.IGNORECASE):
            raise OllamaUnavailable('Ollama mentioned a skill not supplied in the recommendation facts.')

    # Domain facts must not be upgraded into confirmed experience.
    experience = facts.get('experience') or {}
    if experience.get('profile_domain') and experience.get('project_domain'):
        window_match = re.search(
            r'(?:домен\w*\s+профил\w*|профил\w*\s+домен\w*)[^.;]{0,100}',
            combined, flags=re.IGNORECASE,
        )
        if window_match:
            window = window_match.group(0).lower()
            has_mismatch_claim = bool(re.search(
                r'не\s+(?:совпад|соответств)|отлича|друг\w*\s+домен', window,
            ))
            has_match_claim = bool(re.search(
                r'совпад|соответств|тот\s+же|одинаков', window,
            )) and not has_mismatch_claim
            if not experience.get('profile_domain_matches') and has_match_claim:
                raise OllamaUnavailable('Ollama contradicted the supplied profile-domain facts.')
            if experience.get('profile_domain_matches') and has_mismatch_claim:
                raise OllamaUnavailable('Ollama contradicted the supplied profile-domain facts.')
    if not experience.get('domain_experience_confirmed'):
        confirmation_patterns = (
            r'подтвержд\w*[^.;]{0,60}(?:опыт|проект\w*|задач\w*)',
            r'(?:опыт|проект\w*|задач\w*)[^.;]{0,60}подтвержд\w*',
        )
        if any(re.search(pattern, combined, flags=re.IGNORECASE) for pattern in confirmation_patterns):
            if not re.search(r'не\s+подтвержд', combined, flags=re.IGNORECASE):
                raise OllamaUnavailable('Ollama presented unconfirmed domain experience as proven.')

    availability = facts.get('availability') or {}
    if not availability.get('workload_known'):
        false_availability_patterns = (
            r'(?:полностью|совершенно)\s+свобод\w*',
            r'(?:доступность|свободное\s+время|свободно)[^.;]{0,30}\b100\s*%',
            r'(?:текущая\s+)?(?:загрузка|занятость)[^.;]{0,20}\b0\s*%',
            r'все\s+\d+(?:[.,]\d+)?\s*(?:час\w*|ч)\s+свобод\w*',
        )
        if any(re.search(pattern, combined, flags=re.IGNORECASE) for pattern in false_availability_patterns):
            raise OllamaUnavailable('Ollama presented unknown workload as confirmed availability.')
    elif not availability.get('current_workload_known') and re.search(
        r'текущ\w+\s+загрузк\w*[^.;]{0,20}\b0\s*%',
        combined, flags=re.IGNORECASE,
    ):
        raise OllamaUnavailable('Ollama presented unknown current workload as zero.')

    # A workload of 0% must not be turned into a claim that the person has no open tasks.
    if facts.get('open_tasks', 0) > 0 and re.search(
        r'(?:нет|отсутств\w*|не имеет)\s+(?:сейчас\s+|совсем\s+)?'
        r'(?:открытых\s+|текущих\s+)?задач',
        combined, flags=re.IGNORECASE,
    ):
        raise OllamaUnavailable('Ollama contradicted the supplied open-task facts.')

    cleaned = ' '.join(text.strip().split())
    cleaned_limits = [' '.join(item.strip().split()) for item in limitations if item.strip()]
    if cleaned_limits:
        cleaned += ' Ограничения: ' + '; '.join(cleaned_limits)
    return cleaned[:EXPLANATION_MAX_LENGTH]


def explain_candidate(task, requirements, candidate, semantic_similarity=None, timeout=None):
    """Write a factual explanation using only the candidate's verified score details."""
    facts = _facts_for_explanation(task, requirements, candidate, semantic_similarity)
    prompt = (
        'Ниже приведены проверенные факты о кандидате.\n'
        f'{_facts_as_text(facts)}\n\n'
        'Объясни по-русски в 2-4 предложениях, почему кандидат подходит и какие у него '
        'реальные ограничения. Используй только факты выше. Не придумывай и не вычисляй '
        'числа: не указывай проценты, баллы, ставки и часы, кроме уже данных фактов. '
        'Не придумывай навыки, задачи, проекты, даты или историю и не описывай '
        'отсутствующий навык как имеющийся. Названия навыков приводи точно так, как они '
        'указаны в фактах. Совпадение домена профиля не означает подтверждённый опыт '
        'в домене. Не делай выводов о задачах сверх полей «Открытые задачи» и '
        '«Оценка трудозатрат»: нулевая текущая загрузка не означает отсутствие задач. '
        'Если WorkloadEntry отсутствуют, не называй загрузку нулевой или стопроцентно '
        'свободной. Если семантическое сходство не рассчитано, прямо скажи об этом. '
        'Верни только JSON: {"explanation": "...", "limitations": ["..."]}.'
    )
    data = _post('/api/chat', {
        'model': settings.OLLAMA_CHAT_MODEL, 'stream': False, 'format': EXPLANATION_SCHEMA,
        'think': False, 'keep_alive': settings.OLLAMA_KEEP_ALIVE,
        'options': _chat_options(num_predict=600),
        'messages': [{'role': 'user', 'content': prompt}],
    }, timeout=timeout)
    try:
        result = json.loads(data['message']['content'])
    except (KeyError, TypeError, ValueError) as exc:
        raise OllamaUnavailable('Ollama returned invalid explanation JSON.') from exc
    return _validate_explanation(result, facts)


def analyse_task(task, timeout=None):
    """Return schema-validated task facts; ungrounded skills are discarded."""
    known = list(Skill.objects.values_list('name', flat=True))
    source_text = task_source_text(task)
    prompt = (
        'Extract task requirements. Return JSON only with keys skills (array of names), '
        'task_type, complexity (low|medium|high), and summary. Use only exact skill names '
        f'from this catalog: {json.dumps(known, ensure_ascii=False)}. Only include a skill '
        'when it is explicitly present in the task context below; do not infer skills from '
        'a generic task title.\nTask context:\n'
        f'{source_text or "(empty)"}'
    )
    data = _post('/api/chat', {
        'model': settings.OLLAMA_CHAT_MODEL, 'stream': False, 'format': 'json',
        # Qwen3's hidden reasoning is unnecessary for schema extraction and can
        # make a small local GPU miss the request deadline.
        'think': False, 'keep_alive': settings.OLLAMA_KEEP_ALIVE,
        'options': _chat_options(),
        'messages': [{'role': 'user', 'content': prompt}],
    }, timeout=timeout)
    try:
        result = json.loads(data['message']['content'])
    except (KeyError, TypeError, ValueError) as exc:
        raise OllamaUnavailable('Ollama returned invalid task-analysis JSON.') from exc
    catalog = {name.lower(): name for name in known}
    skills = [
        catalog[name.lower()]
        for name in result.get('skills', [])
        if isinstance(name, str) and name.lower() in catalog and _skill_mentioned(name, source_text)
    ]
    skills = list(dict.fromkeys(skills))
    skills_source = 'llm'
    if not skills:
        # Deterministic fallback uses the same full task/WBS context as score matching.
        from .scoring import skills_from_text
        fallback = skills_from_text(source_text)
        skills = [skill.name for skill in fallback]
        skills_source = 'catalog_text_fallback' if skills else 'none'

    return {
        'skills': skills,
        'skills_source': skills_source,
        'task_type': str(result.get('task_type') or task.task_type)[:80],
        'complexity': str(result.get('complexity') or 'medium').lower() if str(result.get('complexity') or '').lower() in ('low', 'medium', 'high') else 'medium',
        'summary': str(result.get('summary') or task.name)[:1000],
    }

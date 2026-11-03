"""
Matching views — /api/matching/

POST /api/matching/rank/
{
  "project_id": 7,                       // необязательно: бюджет, домен и состав команды берутся из проекта
  "required_skills": [                   // либо "required_skill_ids": [1, 2, 3]
    {"skill_id": 1, "min_level": 2, "preferred_level": 4}
  ],
  "domain": "FinTech",
  "date_from": "2026-05-01",
  "date_to": "2026-08-31",
  "max_hourly_rate": 4000,               // необязательно: явный предел ставки вместо расчёта по бюджету
  "weights": {
    "w1_competence": 0.35, "w2_experience": 0.20, "w3_availability": 0.25,
    "w4_performance": 0.15, "w5_cost": 0.05
  }
}
"""
import datetime
import logging

from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects import access
from projects.permissions import CanViewStaff
from .employee_views import CanManageStaffOrReadOnly
from .models import Skill
from .serializers import CandidateScoreSerializer, SkillSerializer
from .scoring import rank_candidates, rank_for_task, RequiredSkill
from .ai import (
    OllamaUnavailable, analyse_task, cosine, explain_candidate, recommendation_embeddings,
)
from .recommendations import deterministic_explanation, semantic_status

logger = logging.getLogger('ai')

WEIGHT_KEYS = {
    'w1_competence': 'w1',
    'w2_experience': 'w2',
    'w3_availability': 'w3',
    'w4_performance': 'w4',
    'w5_cost': 'w5',
    # Also accept short form directly
    'w1': 'w1', 'w2': 'w2', 'w3': 'w3', 'w4': 'w4', 'w5': 'w5',
}


def parse_weights(raw):
    """Веса из запроса (длинные или короткие ключи). Нормировку к сумме 1 делает движок."""
    if not isinstance(raw, dict) or not raw:
        return None
    weights = {}
    for key, value in raw.items():
        if key not in WEIGHT_KEYS:
            continue
        try:
            weights[WEIGHT_KEYS[key]] = float(value)
        except (TypeError, ValueError):
            raise ValidationError({'weights': f'Вес «{key}» должен быть числом.'})
        if weights[WEIGHT_KEYS[key]] < 0:
            raise ValidationError({'weights': f'Вес «{key}» не может быть отрицательным.'})
    return weights or None


def _level(value, default):
    try:
        return max(1, min(5, int(value)))
    except (TypeError, ValueError):
        return default


def parse_rank_params(request):
    """Общий разбор параметров для rank и compare."""
    data = request.data

    # Support both old format (project_start/project_end) and new format (date_from/date_to)
    try:
        start = datetime.date.fromisoformat(data.get('date_from') or data.get('project_start'))
        end = datetime.date.fromisoformat(data.get('date_to') or data.get('project_end'))
    except (TypeError, ValueError):
        raise ValidationError({'error': 'date_from and date_to (YYYY-MM-DD) are required'})
    if end < start:
        raise ValidationError({'error': 'Дата окончания не может быть раньше даты начала.'})

    # Support both required_skill_ids (simple list) and required_skills (detailed list)
    required = []
    details = data.get('required_skills') or []
    if isinstance(details, list) and details:
        for item in details:
            if not isinstance(item, dict) or not item.get('skill_id'):
                raise ValidationError({'required_skills': 'Каждый навык должен содержать skill_id.'})
            min_level = _level(item.get('min_level'), 1)
            try:
                skill_id = int(item['skill_id'])
            except (TypeError, ValueError):
                raise ValidationError({'required_skills': 'skill_id должен быть числом.'})
            required.append(RequiredSkill(
                skill_id=skill_id,
                min_level=min_level,
                preferred_level=max(min_level, _level(item.get('preferred_level'), 3)),
            ))
    else:
        for sid in data.get('required_skill_ids') or []:
            try:
                required.append(RequiredSkill(skill_id=int(sid), min_level=1, preferred_level=3))
            except (TypeError, ValueError):
                raise ValidationError({'required_skill_ids': 'Идентификаторы навыков должны быть числами.'})

    project = None
    if data.get('project_id'):
        from projects.models import Project
        try:
            project = access.filter_visible_projects(
                Project.objects.select_related('calendar').prefetch_related('members'), request.user,
            ).get(id=data.get('project_id'))
        except (Project.DoesNotExist, ValueError, TypeError):
            raise ValidationError({'project_id': 'Проект не найден или недоступен.'})

    max_rate = data.get('max_hourly_rate')
    if max_rate in ('', None):
        max_rate = None
    else:
        try:
            max_rate = float(max_rate)
        except (TypeError, ValueError):
            raise ValidationError({'max_hourly_rate': 'Предельная ставка должна быть числом.'})

    return dict(
        project_start=start,
        project_end=end,
        required_skills=required,
        domain=(data.get('domain') or '').strip() or None,
        max_hourly_rate=max_rate,
        weights=parse_weights(data.get('weights')),
        project=project,
    )


class MatchingViewSet(viewsets.ViewSet):
    # Подбор раскрывает ставки и загрузку сотрудников — только для менеджеров и выше
    permission_classes = [IsAuthenticated, CanViewStaff]

    @action(detail=False, methods=['get', 'post'], url_path='recommend/(?P<task_id>[^/.]+)')
    def recommend_for_task(self, request, task_id=None):
        """
        GET/POST /api/matching/recommend/{task_id}/ — подбор исполнителя на задачу процесса.
        POST принимает {"weights": {...}} в том же формате, что и rank.
        """
        from workflows.models import WorkflowTask
        weights = parse_weights(request.data.get('weights')) if request.method == 'POST' else None
        try:
            task = WorkflowTask.objects.select_related('workflow__project', 'linked_wbs_task').get(id=task_id)
        except (WorkflowTask.DoesNotExist, ValueError):
            return Response({'error': 'Задача не найдена.'}, status=status.HTTP_404_NOT_FOUND)
        # Подбирать исполнителя может тот, кто вправе назначать его в этом проекте
        project = task.workflow.project
        allowed = (
            access.has_project_perm(request.user, project, 'can_assign_tasks') if project
            else access.has_global_access(request.user) or task.workflow.created_by_id == request.user.id
        )
        if not allowed:
            return Response({'error': 'Задача не найдена.'}, status=status.HTTP_404_NOT_FOUND)
        results = rank_for_task(task, weights=weights)
        return Response(CandidateScoreSerializer(results, many=True).data)

    @action(detail=False, methods=['post'], url_path='ai-recommend/(?P<task_id>[^/.]+)')
    def ai_recommend_for_task(self, request, task_id=None):
        """Top-three eligible candidates using local LLM extraction and embeddings."""
        from workflows.models import WorkflowTask
        try:
            task = WorkflowTask.objects.select_related('workflow__project', 'linked_wbs_task').get(id=task_id)
        except (WorkflowTask.DoesNotExist, ValueError):
            return Response({'error': 'Task not found.'}, status=status.HTTP_404_NOT_FOUND)
        project = task.workflow.project
        allowed = access.has_project_perm(request.user, project, 'can_assign_tasks') if project else (
            access.has_global_access(request.user) or task.workflow.created_by_id == request.user.id
        )
        if not allowed:
            return Response({'error': 'Task not found.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            requirements = analyse_task(task)
            requirements.setdefault(
                'skills_source', 'llm' if requirements.get('skills') else 'none',
            )
            known_skills = Skill.objects.filter(name__in=requirements['skills'])
            required = [RequiredSkill(skill_id=item.id, min_level=2, preferred_level=3) for item in known_skills]
            candidates = rank_for_task(task, weights=parse_weights(request.data.get('weights')), required_skills=required)

            # A semantic failure must not hide the deterministic recommendation list.
            eligible = []
            excluded = []
            for candidate in candidates:
                details = candidate.details['competence']
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
                # Mandatory extracted skills and availability are constraints, not preferences.
                if reasons:
                    excluded.append({
                        'employee_id': candidate.employee.id,
                        'full_name': candidate.employee.user.get_full_name() or candidate.employee.user.username,
                        'position': candidate.employee.position,
                        'reasons': reasons,
                    })
                    continue
                candidate.details['deterministic_score'] = round(candidate.total_score, 4)
                eligible.append(candidate)

            task_vector = None
            employee_vectors = {}
            if eligible:
                task_text = f"{task.name}\n{task.description}\n{requirements['summary']}"
                try:
                    task_vector, employee_vectors = recommendation_embeddings(
                        task_text,
                        [candidate.employee for candidate in eligible],
                        persist=True,
                        keep_alive=settings.OLLAMA_KEEP_ALIVE,
                    )
                except OllamaUnavailable as exc:
                    logger.warning(
                        'Task or employee embeddings are unavailable; keeping deterministic ranking: %s',
                        exc,
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
            top = eligible[:3]
            for candidate in top:
                semantic = candidate.details.get('semantic_similarity')
                try:
                    candidate.explanation = explain_candidate(task, requirements, candidate, semantic)
                    candidate.details['explanation_source'] = 'llm'
                except OllamaUnavailable as exc:
                    # Explanation is an enhancement: failure must never break the response.
                    logger.warning(
                        'LLM explanation is unavailable for profile %s; using deterministic fallback: %s',
                        candidate.employee.id, exc,
                    )
                except Exception:
                    logger.exception(
                        'Unexpected explanation error for profile %s; using deterministic fallback.',
                        candidate.employee.id,
                    )

            return Response({
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
                    'skills_source': requirements['skills_source'],
                    'total_considered': len(candidates),
                    'eligible_count': len(eligible),
                    'excluded_count': len(excluded),
                    'top_limit': 3,
                },
                'excluded_candidates': excluded,
                'candidates': CandidateScoreSerializer(top, many=True).data,
            })
        except OllamaUnavailable as exc:
            return Response({'error': str(exc), 'code': 'ollama_unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    @action(detail=False, methods=['post'])
    def rank(self, request):
        results = rank_candidates(**parse_rank_params(request))
        return Response(CandidateScoreSerializer(results, many=True).data)

    @action(detail=False, methods=['post'])
    def compare(self, request):
        candidate_ids = request.data.get('candidate_ids') or []
        if not isinstance(candidate_ids, list) or not candidate_ids:
            return Response({'error': 'candidate_ids are required'}, status=status.HTTP_400_BAD_REQUEST)
        results = rank_candidates(employee_ids=candidate_ids, **parse_rank_params(request))
        return Response(CandidateScoreSerializer(results, many=True).data)


class SkillViewSet(viewsets.ModelViewSet):
    queryset = Skill.objects.all().order_by('category', 'name')
    serializer_class = SkillSerializer
    permission_classes = [IsAuthenticated, CanManageStaffOrReadOnly]

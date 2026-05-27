"""
Matching views — re-exposes rank endpoint at /api/matching/rank/
Body format matches the frontend spec:
{
  "required_skill_ids": [1, 2, 3],
  "domain": "IT",
  "date_from": "2026-05-01",
  "date_to": "2026-08-31",
  "weights": {
    "w1_competence": 0.35,
    "w2_experience": 0.20,
    "w3_availability": 0.25,
    "w4_performance": 0.15,
    "w5_cost": 0.05
  }
}
"""
import datetime
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from .models import Skill, EmployeeProfile, WorkloadEntry
from .serializers import CandidateScoreSerializer, SkillSerializer
from .scoring import rank_candidates, RequiredSkill


class MatchingViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'], url_path='recommend/(?P<task_id>[^/.]+)')
    def recommend_for_task(self, request, task_id=None):
        """GET /api/matching/recommend/{task_id}/"""
        from .services import RecommendationService
        try:
            results = RecommendationService.recommend_for_task(task_id)
            return Response(results)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def rank(self, request):
        data = request.data

        # Support both old format (project_start/project_end) and new format (date_from/date_to)
        try:
            start_str = data.get('date_from') or data.get('project_start')
            end_str = data.get('date_to') or data.get('project_end')
            project_start = datetime.date.fromisoformat(start_str)
            project_end = datetime.date.fromisoformat(end_str)
        except (TypeError, ValueError):
            return Response(
                {'error': 'date_from and date_to (YYYY-MM-DD) are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build required skills list
        # Support both required_skill_ids (simple list) and required_skills (detailed list)
        required_skill_ids = data.get('required_skill_ids', [])
        required_skills_detail = data.get('required_skills', [])

        if required_skill_ids:
            required = [
                RequiredSkill(skill_id=sid, min_level=1, preferred_level=3)
                for sid in required_skill_ids
            ]
        else:
            required = [
                RequiredSkill(
                    skill_id=s['skill_id'],
                    min_level=s.get('min_level', 1),
                    preferred_level=s.get('preferred_level', 3),
                )
                for s in required_skills_detail
            ]

        # Remap weight keys: w1_competence -> w1, etc.
        raw_weights = data.get('weights', {})
        weights = None
        if raw_weights:
            key_map = {
                'w1_competence': 'w1',
                'w2_experience': 'w2',
                'w3_availability': 'w3',
                'w4_performance': 'w4',
                'w5_cost': 'w5',
                # Also accept short form directly
                'w1': 'w1', 'w2': 'w2', 'w3': 'w3', 'w4': 'w4', 'w5': 'w5',
            }
            weights = {key_map[k]: v for k, v in raw_weights.items() if k in key_map}

        results = rank_candidates(
            project_start=project_start,
            project_end=project_end,
            required_skills=required,
            domain=data.get('domain'),
            max_hourly_rate=data.get('max_hourly_rate'),
            weights=weights,
        )

        serializer = CandidateScoreSerializer(results, many=True)
        return Response(serializer.data)


class SkillViewSet(viewsets.ModelViewSet):
    queryset = Skill.objects.all()
    serializer_class = SkillSerializer
    permission_classes = [IsAuthenticated]

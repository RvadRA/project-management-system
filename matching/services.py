from django.db.models import Avg, Sum
from .models import EmployeeProfile, EmployeeSkill, ProjectParticipation
from workflows.models import WorkflowTask
from django.contrib.auth import get_user_model
import datetime

User = get_user_model()

class RecommendationService:
    # Конфигурируемые веса
    WEIGHTS = {
        "competence": 0.3,
        "experience": 0.2,
        "availability": 0.2,
        "performance": 0.2,
        "cost": 0.1,
    }

    @classmethod
    def recommend_for_task(cls, task_id):
        """
        Возвращает список сотрудников с оценкой (score) и расшифровкой факторов.
        """
        task = WorkflowTask.objects.select_related('workflow__project').get(id=task_id)
        profiles = EmployeeProfile.objects.select_related('user').prefetch_related(
            'employee_skills__skill', 'participations', 'workload_entries'
        ).all()
        
        results = []
        for profile in profiles:
            score_data = cls._calculate_score(profile, task)
            results.append({
                'employee_id': profile.user.id,
                'full_name': profile.user.get_full_name() or profile.user.username,
                'total_score': round(score_data['total'], 2),
                'breakdown': score_data['breakdown']
            })
            
        # Сортируем по убыванию общего балла
        results.sort(key=lambda x: x['total_score'], reverse=True)
        return results

    @classmethod
    def _calculate_score(cls, profile, task):
        # 1. Competence Fit (0.0 - 1.0)
        competence = cls._calc_competence(profile, task)
        
        # 2. Experience Similarity (0.0 - 1.0)
        experience = cls._calc_experience(profile, task)
        
        # 3. Availability (0.0 - 1.0)
        availability = cls._calc_availability(profile)
        
        # 4. Past Performance (0.0 - 1.0)
        performance = cls._calc_performance(profile)
        
        # 5. Cost Fit (0.0 - 1.0)
        cost = cls._calc_cost_fit(profile, task)
        
        total = (
            competence * cls.WEIGHTS['competence'] +
            experience * cls.WEIGHTS['experience'] +
            availability * cls.WEIGHTS['availability'] +
            performance * cls.WEIGHTS['performance'] +
            cost * cls.WEIGHTS['cost']
        )
        
        return {
            'total': total,
            'breakdown': {
                'competence': round(competence, 2),
                'experience': round(experience, 2),
                'availability': round(availability, 2),
                'performance': round(performance, 2),
                'cost': round(cost, 2),
            }
        }

    @staticmethod
    def _calc_competence(profile, task):
        # Если у задачи нет шаблона, сложно определить требования. Пока возвращаем 0.5
        if not task.task_template:
            return 0.5
        
        # Здесь в идеале должны быть требуемые навыки в TaskTemplate
        # Для демонстрации: проверяем пересечение слов в названии задачи и названии навыков
        emp_skills = set(s.skill.name.lower() for s in profile.employee_skills.all())
        task_keywords = set(task.name.lower().split())
        
        matches = emp_skills.intersection(task_keywords)
        if not task_keywords: return 0.5
        return min(1.0, (len(matches) + 1) / (len(task_keywords) + 1))

    @staticmethod
    def _calc_experience(profile, task):
        # Опыт через профиль + история завершенных задач
        project = task.workflow.project
        domain = (project.domain if project else "").strip().lower()
        if not domain:
            return 0.5
        
        score = 0.0
        # 1. Профильный домен
        if profile.domain and profile.domain.strip().lower() == domain:
            score += 0.6
            
        # 2. История участия
        participations = profile.participations.filter(project__domain__iexact=domain).count()
        score += participations * 0.2
        
        return min(1.0, score)

    @staticmethod
    def _calc_availability(profile, task=None):
        """
        Calculates availability score (0.0 to 1.0).
        Now accounts for both workload and explicit unavailability (vacations).
        """
        # 1. Base availability from workload
        active_hours = profile.active_task_hours
        workload_score = max(0.0, (160.0 - active_hours) / 160.0)
        
        # 2. Check for overlapping unavailability periods if a task/date range is known
        unavailability_penalty = 0
        if task:
            project = task.workflow.project
            t_start = project.start_date
            t_end = project.end_date
            
            if t_start and t_end:
                from .models import EmployeeUnavailability
                # Check for any overlap
                overlaps = EmployeeUnavailability.objects.filter(
                    employee=profile,
                    start_date__lte=t_end,
                    end_date__gte=t_start
                ).exists()
                if overlaps:
                    unavailability_penalty = 0.5 # Significant penalty for conflict
        
        return max(0.0, workload_score - unavailability_penalty)

    @staticmethod
    def _calc_performance(profile):
        avg_score = profile.participations.aggregate(avg=Avg('performance_score'))['avg'] or 0.8
        return min(1.0, avg_score)

    @staticmethod
    def _calc_cost_fit(profile, task):
        # Если проект имеет бюджет, ищем оптимальную ставку
        budget = task.workflow.project.budget if task.workflow.project else 0
        if not budget or budget == 0:
            return 0.7  # Нейтрально
        
        rate = profile.hourly_rate
        if rate == 0: return 1.0
        
        # Упрощенно: чем ниже ставка, тем выше балл (до определенного предела)
        # В идеале: сравнение с выделенным бюджетом на задачу
        return min(1.0, 5000 / float(rate)) if rate > 0 else 1.0

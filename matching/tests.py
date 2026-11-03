import datetime
import json
from unittest import SkipTest, mock

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from projects.models import Project, ProjectMember
from workflows.models import TaskReport, WorkflowInstance, WorkflowTask

from .ai import OllamaUnavailable, analyse_task, embedding, embedding_batch, explain_candidate
from .models import (
    EmployeeExperienceEmbedding, EmployeeProfile, EmployeeSkill, EmployeeUnavailability,
    ProjectParticipation, Skill, WorkloadEntry,
)
from .scoring import RequiredSkill, normalize_weights, rank_candidates, rank_for_task, skills_from_text

User = get_user_model()


def fake_recommendation_embeddings(task_text, profiles, persist=False, force=False, keep_alive=None):
    profiles = list(profiles)
    return [1.0, 0.0], {profile.id: [1.0, 0.0] for profile in profiles}

# Ровно четыре недели с понедельника: 28 календарных и 20 рабочих дней
START = datetime.date(2030, 1, 7)
END = datetime.date(2030, 2, 3)


class ScoringTestCase(APITestCase):
    def make_employee(self, username, domain='', rate=0, **user_kwargs):
        user = User.objects.create_user(username=username, password='pass12345', role='EMPLOYEE', **user_kwargs)
        profile = user.profile                  # создаётся сигналом
        profile.domain = domain
        profile.hourly_rate = rate
        profile.save()
        return profile

    def score_of(self, profile, **kwargs):
        params = dict(project_start=START, project_end=END, required_skills=[])
        params.update(kwargs)
        return next(r for r in rank_candidates(**params) if r.employee.id == profile.id)


class WeightTests(ScoringTestCase):
    def test_weights_are_normalized(self):
        w = normalize_weights({'w1': 70, 'w2': 40, 'w3': 50, 'w4': 30, 'w5': 10})
        self.assertAlmostEqual(sum(w.values()), 1.0)
        self.assertAlmostEqual(w['w1'], 0.35)

    def test_invalid_weights_fall_back(self):
        w = normalize_weights({'w1': 'abc', 'w2': -5, 'w3': 0, 'w4': 0, 'w5': 0})
        self.assertAlmostEqual(sum(w.values()), 1.0)
        self.assertEqual(w['w2'], 0)

    def test_total_is_weighted_sum_within_unit_range(self):
        emp = self.make_employee('a', domain='FinTech', rate=1000)
        result = self.score_of(emp, domain='FinTech', weights={'w1': 1, 'w2': 1, 'w3': 1, 'w4': 1, 'w5': 1})
        # без требуемых навыков w1 исключается, остальные делят вес поровну
        expected = (result.experience_similarity + result.availability + result.past_performance + result.cost_fit) / 4
        self.assertAlmostEqual(result.total_score, expected, places=3)
        self.assertEqual(result.details['weights']['w1'], 0)
        self.assertTrue(0 <= result.total_score <= 1)


class CompetenceTests(ScoringTestCase):
    def test_levels_against_requirements(self):
        python = Skill.objects.create(name='Python')
        sql = Skill.objects.create(name='SQL')
        expert = self.make_employee('expert')
        junior = self.make_employee('junior')
        nobody = self.make_employee('nobody')
        EmployeeSkill.objects.create(employee=expert, skill=python, level=5)
        EmployeeSkill.objects.create(employee=expert, skill=sql, level=4)
        EmployeeSkill.objects.create(employee=junior, skill=python, level=1)

        required = [RequiredSkill(python.id, min_level=3, preferred_level=4), RequiredSkill(sql.id, 2, 4)]
        self.assertEqual(self.score_of(expert, required_skills=required).competence_fit, 1.0)
        # junior: Python 1 при минимуме 3 → 1/3*0.5; SQL отсутствует → 0
        junior_score = self.score_of(junior, required_skills=required)
        self.assertAlmostEqual(junior_score.competence_fit, (1 / 3 * 0.5) / 2, places=3)
        self.assertEqual(junior_score.details['competence']['missing'], ['SQL'])
        self.assertEqual(self.score_of(nobody, required_skills=required).competence_fit, 0.0)
        # результат отсортирован по убыванию
        ranked = rank_candidates(START, END, required)
        self.assertEqual(ranked[0].employee.id, expert.id)


class ExperienceTests(ScoringTestCase):
    def test_domain_experience_uses_real_projects_and_tasks(self):
        emp = self.make_employee('dev', domain='FinTech')
        other = self.make_employee('other', domain='GameDev')
        fintech = Project.objects.create(name='Bank', domain='FinTech')
        ProjectMember.objects.create(project=fintech, user=emp.user)
        wf = WorkflowInstance.objects.create(name='wf', project=fintech)
        for i in range(5):
            WorkflowTask.objects.create(workflow=wf, name=f't{i}', assigned_to=emp.user, status='DONE',
                                        completed_at=timezone.now(), due_date=timezone.now() + timezone.timedelta(days=1))

        result = self.score_of(emp, domain='fintech')   # регистр не важен
        # 0.5 (домен профиля) + 0.3 * 1/3 (один проект) + 0.2 * 5/10 (пять задач)
        self.assertAlmostEqual(result.experience_similarity, 0.5 + 0.1 + 0.1, places=3)
        self.assertEqual(self.score_of(other, domain='FinTech').experience_similarity, 0.0)

    def test_target_project_is_not_counted_as_experience(self):
        emp = self.make_employee('dev')
        target = Project.objects.create(name='Target', domain='FinTech')
        ProjectMember.objects.create(project=target, user=emp.user)
        result = self.score_of(emp, project=target)
        self.assertEqual(result.experience_similarity, 0.0)
        self.assertTrue(result.already_member)


class AvailabilityTests(ScoringTestCase):
    def test_average_load_is_counted_over_working_days(self):
        emp = self.make_employee('busy')
        project = Project.objects.create(name='P')
        # 60% на первые две недели периода (10 из 20 рабочих дней) → в среднем 30%
        WorkloadEntry.objects.create(employee=emp, project=project, start_date=datetime.date(2029, 12, 1),
                                     end_date=datetime.date(2030, 1, 18), load_percent=60)
        result = self.score_of(emp)
        details = result.details['availability']
        self.assertAlmostEqual(details['avg_load_percent'], 30.0)
        self.assertAlmostEqual(details['peak_load_percent'], 60.0)
        self.assertAlmostEqual(details['free_percent'], 40.0)    # гарантированно свободно на весь период
        self.assertEqual(details['working_days'], 20)
        self.assertEqual(details['available_hours'], 160.0)
        self.assertAlmostEqual(result.availability, 0.7, places=3)

    def test_load_outside_period_does_not_count(self):
        emp = self.make_employee('free')
        WorkloadEntry.objects.create(employee=emp, start_date=datetime.date(2031, 1, 1),
                                     end_date=datetime.date(2031, 6, 1), load_percent=100)
        result = self.score_of(emp)
        self.assertEqual(result.availability, 1.0)
        # Отсутствие записей в периоде нельзя выдавать за подтверждённые 100% свободного времени.
        self.assertFalse(result.details['availability']['workload_known'])
        self.assertIsNone(result.details['availability']['free_percent'])
        self.assertIn('Нет записей загрузки за период', result.data_gaps)

    def test_overload_is_clamped_to_zero(self):
        emp = self.make_employee('overloaded')
        for _ in range(2):
            WorkloadEntry.objects.create(employee=emp, start_date=START, end_date=END, load_percent=100)
        result = self.score_of(emp)
        self.assertEqual(result.availability, 0.0)
        self.assertTrue(any('Полностью занят' in c for c in result.conflicts))

    def test_vacation_reduces_availability_by_working_days(self):
        emp = self.make_employee('vacation')
        # пересекающиеся отпуска: 7–11 января и 9–16 января = 8 рабочих дней из 20 (выходные не в счёт)
        EmployeeUnavailability.objects.create(employee=emp, start_date=datetime.date(2030, 1, 7), end_date=datetime.date(2030, 1, 11))
        EmployeeUnavailability.objects.create(employee=emp, start_date=datetime.date(2030, 1, 9), end_date=datetime.date(2030, 1, 16))
        result = self.score_of(emp)
        self.assertEqual(result.details['availability']['unavailable_days'], 8)
        self.assertEqual(result.details['availability']['available_hours'], 96.0)
        self.assertAlmostEqual(result.availability, 12 / 20, places=3)

    def test_finished_projects_do_not_occupy_people(self):
        emp = self.make_employee('after')
        done = Project.objects.create(name='Done', status='COMPLETED')
        cancelled = Project.objects.create(name='Cancelled', status='CANCELLED')
        for project in (done, cancelled):
            WorkloadEntry.objects.create(employee=emp, project=project, start_date=START, end_date=END, load_percent=100)
        self.assertEqual(self.score_of(emp).availability, 1.0)
        self.assertEqual(emp.current_workload_percentage, 0)

    def test_calendar_holidays_are_not_working_days(self):
        from plans.models import CalendarHoliday, WorkCalendar
        calendar = WorkCalendar.objects.create(name='RF')
        CalendarHoliday.objects.create(calendar=calendar, date=datetime.date(2030, 1, 8), name='Праздник')
        project = Project.objects.create(name='P', calendar=calendar)
        emp = self.make_employee('holiday')
        details = self.score_of(emp, project=project).details['availability']
        self.assertEqual(details['working_days'], 19)
        self.assertEqual(details['available_hours'], 152.0)


class CapacityModelTests(ScoringTestCase):
    def entry(self, start, end, load):
        return mock.Mock(start_date=start, end_date=end, load_percent=load, project_id=None)

    def test_peak_is_the_busiest_day_not_the_average(self):
        from .capacity import period_capacity
        entries = [self.entry(START, datetime.date(2030, 1, 11), 70), self.entry(datetime.date(2030, 1, 9), END, 20)]
        cap = period_capacity(entries, [], START, END)
        self.assertEqual(cap['peak_load_percent'], 90)      # 9–11 января оба проекта
        self.assertEqual(cap['free_percent'], 10)
        self.assertLess(cap['avg_load_percent'], 50)

    def test_hours_and_percent_conversion(self):
        from .capacity import hours_to_percent, percent_to_hours
        self.assertEqual(percent_to_hours(25, 160), 40.0)
        self.assertEqual(hours_to_percent(40, 160), 25.0)
        self.assertIsNone(hours_to_percent(10, 0))

    def test_period_of_weekend_only_has_no_hours(self):
        from .capacity import period_capacity
        cap = period_capacity([], [], datetime.date(2030, 1, 12), datetime.date(2030, 1, 13))
        self.assertEqual(cap['working_days'], 0)
        self.assertEqual(cap['available_hours'], 0.0)

    def test_workday_length_is_configurable(self):
        from projects.models import GlobalSetting
        from .capacity import workday_hours
        self.assertEqual(workday_hours(), 8.0)
        GlobalSetting.objects.update_or_create(key='WORKDAY_HOURS', defaults={'value': '6'})
        self.assertEqual(workday_hours(), 6.0)
        GlobalSetting.objects.filter(key='WORKDAY_HOURS').update(value='abc')
        self.assertEqual(workday_hours(), 8.0)


class TaskHoursTests(ScoringTestCase):
    def test_task_load_uses_estimates_not_sla(self):
        emp = self.make_employee('worker')
        project = Project.objects.create(name='P')
        wf = WorkflowInstance.objects.create(name='wf', project=project)
        WorkflowTask.objects.create(workflow=wf, name='a', assigned_to=emp.user, status='IN_PROGRESS', sla_hours=48, estimated_hours=6)
        WorkflowTask.objects.create(workflow=wf, name='b', assigned_to=emp.user, status='TODO', sla_hours=72)
        WorkflowTask.objects.create(workflow=wf, name='c', assigned_to=emp.user, status='DONE', estimated_hours=40)
        self.assertEqual(emp.active_task_hours, 6.0)      # срок SLA в трудозатраты не входит
        self.assertEqual(emp.open_task_count, 2)
        self.assertEqual(emp.unestimated_task_count, 1)
        result = self.score_of(emp)
        self.assertEqual((result.active_task_hours, result.open_task_count, result.unestimated_task_count), (6.0, 2, 1))
        self.assertIn('Трудозатраты не указаны у 1 открытых задач', result.data_gaps)
        self.assertTrue(any('Трудозатраты не указаны' in item for item in result.conflicts))
        details = result.details['availability']
        self.assertFalse(details['workload_known'])
        self.assertIsNone(details['free_percent'])
        self.assertEqual(details['open_task_hours'], 6.0)
        self.assertEqual(details['unestimated_open_tasks'], 1)
        self.assertFalse(details['task_estimate_complete'])


class PerformanceTests(ScoringTestCase):
    def setUp(self):
        self.project = Project.objects.create(name='P')
        self.wf = WorkflowInstance.objects.create(name='wf', project=self.project)
        self.now = timezone.now()

    def task(self, user, status, due_in_days, completed_in_days=None):
        task = WorkflowTask.objects.create(workflow=self.wf, name='t', assigned_to=user, status=status,
                                           due_date=self.now + timezone.timedelta(days=due_in_days))
        if completed_in_days is not None:
            WorkflowTask.objects.filter(id=task.id).update(
                completed_at=self.now + timezone.timedelta(days=completed_in_days))
        return task

    def test_no_history_is_neutral_and_flagged(self):
        emp = self.make_employee('new')
        result = self.score_of(emp)
        self.assertEqual(result.past_performance, 0.5)
        self.assertIn('Нет истории задач', result.data_gaps)

    def test_on_time_late_and_overdue_tasks(self):
        emp = self.make_employee('worker')
        self.task(emp.user, 'DONE', due_in_days=5, completed_in_days=1)    # в срок
        self.task(emp.user, 'DONE', due_in_days=5, completed_in_days=2)    # в срок
        self.task(emp.user, 'DONE', due_in_days=1, completed_in_days=3)    # с опозданием
        self.task(emp.user, 'ESCALATED', due_in_days=-2)                   # просрочена
        result = self.score_of(emp)
        # (2*0.5 сглаживание + 2*1 + 1*0.5 + 0) / (2 + 4)
        self.assertAlmostEqual(result.past_performance, 3.5 / 6, places=3)
        self.assertEqual(result.details['performance'],
                         {'done_on_time': 2, 'done_late': 1, 'overdue_open': 1, 'manual_ratings': 0})

    def test_report_time_counts_not_approval_time(self):
        emp = self.make_employee('reporter')
        task = self.task(emp.user, 'DONE', due_in_days=1, completed_in_days=5)   # утвердили поздно
        report = TaskReport.objects.create(task=task, text_content='done')
        TaskReport.objects.filter(id=report.id).update(submitted_at=self.now)     # но сдали вовремя
        self.assertEqual(self.score_of(emp).details['performance']['done_on_time'], 1)

    def test_manual_rating_counts_as_several_tasks(self):
        emp = self.make_employee('rated')
        done = Project.objects.create(name='Old', status='COMPLETED')
        ProjectParticipation.objects.create(employee=emp, project=done, role='Dev', performance_score=0.9)
        # одна оценка = 5 задач: (2*0.5 + 0.9*5) / (2 + 5)
        self.assertAlmostEqual(self.score_of(emp).past_performance, 5.5 / 7, places=3)

        # одна хорошая оценка не перекрывает много свежих просрочек
        for _ in range(10):
            self.task(emp.user, 'ESCALATED', due_in_days=-1)
        self.assertLess(self.score_of(emp).past_performance, 0.4)


class CostTests(ScoringTestCase):
    def test_rate_against_explicit_limit(self):
        cheap = self.make_employee('cheap', rate=1000)
        pricey = self.make_employee('pricey', rate=4000)
        self.assertEqual(self.score_of(cheap, max_hourly_rate=2000).cost_fit, 1.0)
        self.assertAlmostEqual(self.score_of(pricey, max_hourly_rate=2000).cost_fit, 0.5)

    def test_limit_from_project_budget(self):
        emp = self.make_employee('dev', rate=2000)
        # 5 рабочих дней * 8 ч = 40 ч; команда 1 FTE + кандидат = 2 → 80 000 / (2 * 40) = 1000 ₽/ч
        project = Project.objects.create(name='P', budget=80000, start_date=datetime.date(2030, 1, 7),
                                         end_date=datetime.date(2030, 1, 11))
        manager = User.objects.create_user(username='pm', password='x')
        ProjectMember.objects.create(project=project, user=manager, allocation_percentage=100)
        result = self.score_of(emp, project=project)
        self.assertAlmostEqual(result.details['cost']['rate_limit'], 1000.0)
        self.assertAlmostEqual(result.cost_fit, 0.5)

    def test_without_budget_cheaper_is_better(self):
        cheap = self.make_employee('cheap', rate=1000)
        pricey = self.make_employee('pricey', rate=4000)
        self.assertEqual(self.score_of(cheap).cost_fit, 1.0)
        self.assertAlmostEqual(self.score_of(pricey).cost_fit, 0.25)

    def test_missing_rate_gives_no_advantage(self):
        self.make_employee('a', rate=1000)
        self.make_employee('b', rate=3000)
        unknown = self.make_employee('unknown', rate=0)
        result = self.score_of(unknown)
        # берётся медианная ставка (2000), а не «идеальные» 100%
        self.assertAlmostEqual(result.cost_fit, 0.5)
        self.assertIn('Ставка не указана', result.data_gaps)


class PoolAndApiTests(ScoringTestCase):
    def test_inactive_users_and_admins_are_excluded(self):
        self.make_employee('active')
        self.make_employee('fired', is_active=False)
        admin = User.objects.create_user(username='root', password='x', role='ADMIN')
        EmployeeProfile.objects.create(user=admin)   # у администратора профиль мог появиться из настроек уведомлений
        usernames = [r.employee.user.username for r in rank_candidates(START, END, [])]
        self.assertEqual(usernames, ['active'])

    def test_new_user_gets_profile_and_completed_project_history(self):
        user = User.objects.create_user(username='fresh', password='x', role='EMPLOYEE')
        self.assertTrue(EmployeeProfile.objects.filter(user=user).exists())
        project = Project.objects.create(name='P')
        ProjectMember.objects.create(project=project, user=user)
        project.status = 'COMPLETED'
        project.save()
        self.assertTrue(ProjectParticipation.objects.filter(employee__user=user, project=project).exists())

    def test_skills_are_detected_in_task_text(self):
        for name in ('Python', 'CI/CD', 'React', 'SQL'):
            Skill.objects.create(name=name)
        found = {s.name for s in skills_from_text('Настроить CI/CD для python-сервиса', 'PostgreSQL бэкап')}
        self.assertEqual(found, {'Python', 'CI/CD'})   # SQL внутри «PostgreSQL» не считается

    def test_task_matching_uses_same_engine(self):
        python = Skill.objects.create(name='Python')
        good = self.make_employee('good', domain='FinTech')
        self.make_employee('bad')
        EmployeeSkill.objects.create(employee=good, skill=python, level=4)
        project = Project.objects.create(name='Bank', domain='FinTech')
        wf = WorkflowInstance.objects.create(name='wf', project=project)
        task = WorkflowTask.objects.create(workflow=wf, name='Написать сервис на Python')
        ranked = rank_for_task(task)
        self.assertEqual(ranked[0].employee.id, good.id)
        self.assertEqual(ranked[0].competence_fit, 1.0)

    def test_rank_endpoint(self):
        python = Skill.objects.create(name='Python')
        emp = self.make_employee('dev', domain='FinTech', rate=1500)
        EmployeeSkill.objects.create(employee=emp, skill=python, level=3)
        manager = User.objects.create_user(username='pm', password='x', role='MANAGER')
        project = Project.objects.create(name='Mine', domain='FinTech', budget=100000, manager=manager)
        foreign = Project.objects.create(name='Foreign')
        self.client.force_authenticate(user=manager)

        payload = {
            'project_id': project.id, 'date_from': '2030-01-01', 'date_to': '2030-01-30',
            'required_skills': [{'skill_id': python.id, 'min_level': 2, 'preferred_level': 3}],
            'weights': {'w1_competence': 35, 'w2_experience': 20, 'w3_availability': 25, 'w4_performance': 15, 'w5_cost': 5},
        }
        res = self.client.post('/api/matching/rank/', payload, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        row = next(r for r in res.data if r['employee_id'] == emp.id)
        self.assertEqual(row['user_id'], emp.user_id)
        self.assertEqual(row['competence_fit'], 1.0)
        self.assertEqual(row['details']['experience']['domain'], 'FinTech')   # домен взят из проекта
        self.assertTrue(0 <= row['total_score'] <= 1)

        # чужой проект, кривые даты и веса дают 400, а не 500
        self.assertEqual(self.client.post('/api/matching/rank/', {**payload, 'project_id': foreign.id}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/matching/rank/', {**payload, 'date_to': '2029-01-01'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/matching/rank/', {**payload, 'weights': {'w1': 'x'}}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/matching/rank/', {**payload, 'required_skills': [{}]}, format='json').status_code, 400)

    def test_task_recommendation_endpoint_returns_profile_ids(self):
        emp = self.make_employee('dev')
        manager = User.objects.create_user(username='pm', password='x', role='MANAGER')
        project = Project.objects.create(name='Mine', manager=manager)
        wf = WorkflowInstance.objects.create(name='wf', project=project)
        task = WorkflowTask.objects.create(workflow=wf, name='Задача')
        self.client.force_authenticate(user=manager)
        res = self.client.post(f'/api/matching/recommend/{task.id}/', {'weights': {'w3': 1}}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        row = next(r for r in res.data if r['user_id'] == emp.user_id)
        self.assertEqual(row['employee_id'], emp.id)

        other = User.objects.create_user(username='pm2', password='x', role='MANAGER')
        self.client.force_authenticate(user=other)
        self.assertEqual(self.client.get(f'/api/matching/recommend/{task.id}/').status_code, 404)

    def test_team_page_can_create_profile_for_existing_user(self):
        admin = User.objects.create_user(username='root', password='x', role='ADMIN')
        user = User.objects.create_user(username='hired', password='x', role='EMPLOYEE')
        self.client.force_authenticate(user=admin)
        res = self.client.post('/api/employees/profiles/', {'user': user.id, 'position': 'QA', 'hourly_rate': 1200}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(EmployeeProfile.objects.get(user=user).position, 'QA')
        self.assertEqual(EmployeeProfile.objects.filter(user=user).count(), 1)


class LocalAIRecommendationTests(ScoringTestCase):
    @mock.patch('matching.views.explain_candidate', return_value='Кандидат подходит: все обязательные навыки подтверждены.')
    @mock.patch('matching.views.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.views.analyse_task')
    def test_ai_recommendation_returns_only_three_eligible_candidates(self, analyse, recommend_embeddings, explain):
        python = Skill.objects.create(name='Python')
        manager = User.objects.create_user(username='ai-pm', password='x', role='MANAGER')
        project = Project.objects.create(name='AI project', manager=manager)
        workflow = WorkflowInstance.objects.create(name='Delivery', project=project)
        task = WorkflowTask.objects.create(workflow=workflow, name='Python API', description='Build it')
        for index in range(4):
            profile = self.make_employee(f'ai-dev-{index}')
            EmployeeSkill.objects.create(employee=profile, skill=python, level=3)
        unavailable = self.make_employee('ai-unavailable')
        EmployeeSkill.objects.create(employee=unavailable, skill=python, level=3)
        EmployeeUnavailability.objects.create(employee=unavailable, start_date=datetime.date.today(), end_date=datetime.date.today() + datetime.timedelta(days=3))
        analyse.return_value = {'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 3)
        self.assertEqual(response.data['requirements']['skills'], ['Python'])
        self.assertIn('semantic_similarity', response.data['candidates'][0]['details'])

    @mock.patch('matching.views.analyse_task', side_effect=__import__('matching.ai', fromlist=['OllamaUnavailable']).OllamaUnavailable('offline'))
    def test_ai_recommendation_handles_ollama_failure(self, analyse):
        manager = User.objects.create_user(username='offline-pm', password='x', role='MANAGER')
        project = Project.objects.create(name='Offline', manager=manager)
        task = WorkflowTask.objects.create(workflow=WorkflowInstance.objects.create(name='wf', project=project), name='Task')
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data['code'], 'ollama_unavailable')

    def _ai_task_with_skills(self, username, skills, task_name='Python API'):
        manager = User.objects.create_user(username=username, password='x', role='MANAGER')
        project = Project.objects.create(name=f'{username}-project', manager=manager)
        workflow = WorkflowInstance.objects.create(name=f'{username}-wf', project=project)
        task = WorkflowTask.objects.create(workflow=workflow, name=task_name, description='Build it')
        profile = self.make_employee(f'{username}-dev')
        for skill in skills:
            EmployeeSkill.objects.create(employee=profile, skill=skill, level=3)
        return manager, profile, task

    @mock.patch('matching.views.explain_candidate', return_value='Кандидат подходит: обязательные навыки подтверждены.')
    @mock.patch('matching.views.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.views.analyse_task')
    def test_ai_explanation_and_semantic_fields_are_returned(self, analyse, recommend_embeddings, explain):
        python = Skill.objects.create(name='Python')
        manager, profile, task = self._ai_task_with_skills('llm-explanation', [python])
        analyse.return_value = {'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        row = response.data['candidates'][0]
        self.assertEqual(row['explanation'], 'Кандидат подходит: обязательные навыки подтверждены.')
        self.assertEqual(row['details']['explanation_source'], 'llm')
        self.assertTrue(row['details']['semantic_available'])
        self.assertAlmostEqual(row['details']['semantic_similarity'], 1.0)
        self.assertEqual(response.data['scoring']['semantic_status'], 'available')

    @mock.patch('matching.views.explain_candidate', side_effect=OllamaUnavailable('explanation offline'))
    @mock.patch('matching.views.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.views.analyse_task')
    def test_explanation_failure_uses_deterministic_fallback(self, analyse, recommend_embeddings, explain):
        python = Skill.objects.create(name='Python')
        manager, profile, task = self._ai_task_with_skills('fallback-explanation', [python])
        analyse.return_value = {'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        row = response.data['candidates'][0]
        self.assertEqual(row['details']['explanation_source'], 'deterministic')
        self.assertIn('Балл', row['explanation'])
        self.assertIn('навыки', row['explanation'])

    @mock.patch('matching.views.explain_candidate', return_value='Краткое объяснение кандидата.')
    @mock.patch('matching.views.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.views.analyse_task')
    def test_embeddings_are_batched_for_all_eligible_candidates(self, analyse, recommend_embeddings, explain):
        python = Skill.objects.create(name='Python')
        manager = User.objects.create_user(username='batch-ai', password='x', role='MANAGER')
        project = Project.objects.create(name='Batch AI', manager=manager)
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='batch-wf', project=project), name='Python API',
        )
        profiles = []
        for index in range(2):
            profile = self.make_employee(f'batch-dev-{index}')
            EmployeeSkill.objects.create(employee=profile, skill=python, level=3)
            profiles.append(profile)
        analyse.return_value = {'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)

        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 2)
        recommend_embeddings.assert_called_once()
        batched = {profile.id for profile in recommend_embeddings.call_args.args[1]}
        self.assertEqual(batched, {profile.id for profile in profiles})
        self.assertTrue(all(row['details']['semantic_available'] for row in response.data['candidates']))
        self.assertEqual(response.data['scoring']['semantic_status'], 'available')

    @mock.patch('matching.views.explain_candidate', return_value='Краткое объяснение кандидата.')
    @mock.patch('matching.views.recommendation_embeddings', side_effect=OllamaUnavailable('embedding offline'))
    @mock.patch('matching.views.analyse_task')
    def test_task_embedding_failure_keeps_deterministic_results(self, analyse, recommend_embeddings, explain):
        python = Skill.objects.create(name='Python')
        manager, profile, task = self._ai_task_with_skills('task-embed-fail', [python])
        analyse.return_value = {'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        row = response.data['candidates'][0]
        self.assertFalse(row['details']['semantic_available'])
        self.assertIsNone(row['details']['semantic_similarity'])
        self.assertAlmostEqual(row['total_score'], row['details']['deterministic_score'])
        self.assertEqual(response.data['scoring']['semantic_status'], 'unavailable')

    @mock.patch('matching.views.explain_candidate', return_value='Краткое объяснение кандидата.')
    @mock.patch('matching.views.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.views.analyse_task')
    def test_required_skills_still_exclude_candidates_without_them(self, analyse, recommend_embeddings, explain):
        python = Skill.objects.create(name='Python')
        react = Skill.objects.create(name='React')
        manager = User.objects.create_user(username='filters-pm', password='x', role='MANAGER')
        project = Project.objects.create(name='Filters', manager=manager)
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='filters-wf', project=project), name='Python API',
        )
        good = self.make_employee('filter-good')
        bad = self.make_employee('filter-bad')
        EmployeeSkill.objects.create(employee=good, skill=python, level=3)
        EmployeeSkill.objects.create(employee=bad, skill=react, level=5)
        analyse.return_value = {'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        ids = [row['employee_id'] for row in response.data['candidates']]
        self.assertIn(good.id, ids)
        self.assertNotIn(bad.id, ids)
        excluded = next(item for item in response.data['excluded_candidates'] if item['employee_id'] == bad.id)
        self.assertEqual(excluded['reasons'][0]['code'], 'missing_required_skills')
        self.assertEqual(excluded['reasons'][0]['skills'], ['Python'])
        self.assertTrue(response.data['scoring']['competence_filter_applied'])
        self.assertEqual(response.data['scoring']['total_considered'], 3)  # + профиль менеджера
        self.assertEqual(response.data['scoring']['excluded_count'], 2)
        self.assertEqual(response.data['scoring']['eligible_count'], 1)

    @mock.patch('matching.views.explain_candidate', side_effect=OllamaUnavailable('explanation offline'))
    @mock.patch('matching.views.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.views.analyse_task')
    def test_ai_recommendation_reports_when_skills_are_not_extracted(self, analyse, recommend_embeddings, explain):
        manager, profile, task = self._ai_task_with_skills('no-required-skills', [])
        analyse.return_value = {'skills': [], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API'}
        self.client.force_authenticate(manager)
        response = self.client.post(f'/api/matching/ai-recommend/{task.id}/', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['scoring']['competence_filter_applied'])
        self.assertEqual(response.data['scoring']['skills_source'], 'none')
        self.assertEqual(response.data['scoring']['total_considered'], 2)  # + профиль менеджера
        self.assertEqual(response.data['scoring']['eligible_count'], 2)
        self.assertEqual(response.data['excluded_candidates'], [])
        row = next(item for item in response.data['candidates'] if item['employee_id'] == profile.id)
        self.assertEqual(row['details']['competence']['required'], 0)
        self.assertIn('навыки не извлечены', row['explanation'])

    @mock.patch('matching.ai._post')
    def test_analyse_task_discards_skills_not_present_in_task_text(self, post):
        Skill.objects.create(name='Python')
        project = Project.objects.create(name='Grounding')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='grounding-wf', project=project),
            name='Build API', description='Create an endpoint.',
        )
        post.return_value = {'message': {'content': json.dumps({
            'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API',
        })}}
        result = analyse_task(task)
        self.assertEqual(result['skills'], [])
        self.assertEqual(result['skills_source'], 'none')

    @mock.patch('matching.ai._post')
    def test_analyse_task_falls_back_to_catalog_text(self, post):
        Skill.objects.create(name='Python')
        project = Project.objects.create(name='Fallback')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='fallback-wf', project=project),
            name='Python API', description='Build it.',
        )
        post.return_value = {'message': {'content': json.dumps({
            'skills': [], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API',
        })}}
        result = analyse_task(task)
        self.assertEqual(result['skills'], ['Python'])
        self.assertEqual(result['skills_source'], 'catalog_text_fallback')

    @override_settings(OLLAMA_KEEP_ALIVE=0, OLLAMA_NUM_CTX=4096)
    @mock.patch('matching.ai._post')
    def test_analyse_task_uses_shared_memory_policy(self, post):
        Skill.objects.create(name='Python')
        project = Project.objects.create(name='Memory policy')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='memory-wf', project=project),
            name='Python API', description='Build it.',
        )
        post.return_value = {'message': {'content': json.dumps({
            'skills': ['Python'], 'task_type': 'backend', 'complexity': 'medium', 'summary': 'Build API',
        })}}
        analyse_task(task)
        payload = post.call_args.args[1]
        self.assertEqual(payload['keep_alive'], 0)
        self.assertEqual(payload['options']['num_ctx'], 4096)

    @override_settings(OLLAMA_KEEP_ALIVE=0)
    @mock.patch('matching.ai._post')
    def test_embedding_batch_sends_keep_alive_and_returns_all_vectors(self, post):
        post.return_value = {'embeddings': [[1.0, 0.0], [0.0, 1.0]]}

        result = embedding_batch(['first', 'second'])

        self.assertEqual(result, [[1.0, 0.0], [0.0, 1.0]])
        payload = post.call_args.args[1]
        self.assertEqual(payload['model'], settings.OLLAMA_EMBED_MODEL)
        self.assertEqual(payload['input'], ['first', 'second'])
        self.assertEqual(payload['keep_alive'], 0)

    @override_settings(OLLAMA_KEEP_ALIVE=0, OLLAMA_NUM_CTX=4096)
    @mock.patch('matching.ai._post')
    def test_explanation_canonicalizes_known_cicd_variant(self, post):
        cicd = Skill.objects.create(name='CI/CD')
        profile = self.make_employee('cicd-dev')
        EmployeeSkill.objects.create(employee=profile, skill=cicd, level=4)
        project = Project.objects.create(name='CI project')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='ci-wf', project=project), name='Pipeline',
        )
        candidate = next(
            item for item in rank_for_task(task, required_skills=[RequiredSkill(cicd.id, 2, 3)])
            if item.employee.id == profile.id
        )
        post.return_value = {'message': {'content': json.dumps({
            'explanation': 'Кандидат уверенно владеет CI/:D в проекте.',
            'limitations': [],
        })}}
        explanation = explain_candidate(task, {'skills': ['CI/CD']}, candidate, None)
        self.assertIn('CI/CD', explanation)
        self.assertNotIn('CI/:D', explanation)
        payload = post.call_args.args[1]
        self.assertEqual(payload['keep_alive'], 0)
        self.assertEqual(payload['options']['num_ctx'], 4096)

    @mock.patch('matching.ai._post')
    def test_explanation_rejects_profile_domain_contradiction(self, post):
        profile = self.make_employee('domain-contradiction', domain='Backend')
        project = Project.objects.create(name='Domain project', domain='DevOps')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='domain-wf', project=project), name='Deploy',
        )
        candidate = next(item for item in rank_for_task(task) if item.employee.id == profile.id)
        post.return_value = {'message': {'content': json.dumps({
            'explanation': 'Домен профиля совпадает с доменом проекта.',
            'limitations': [],
        })}}
        with self.assertRaises(OllamaUnavailable):
            explain_candidate(task, {'skills': []}, candidate, None)

    @mock.patch('matching.ai._post')
    def test_explanation_rejects_unknown_workload_as_free_time(self, post):
        profile = self.make_employee('unknown-load')
        project = Project.objects.create(name='Load project')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='load-wf', project=project), name='Workload',
        )
        candidate = next(item for item in rank_for_task(task) if item.employee.id == profile.id)
        post.return_value = {'message': {'content': json.dumps({
            'explanation': 'Кандидат полностью свободен и готов взять проект.',
            'limitations': [],
        })}}
        with self.assertRaises(OllamaUnavailable):
            explain_candidate(task, {'skills': []}, candidate, None)

    @mock.patch('matching.ai._post')
    def test_explanation_validation_rejects_invented_numbers(self, post):
        skill = Skill.objects.create(name='Python')
        profile = self.make_employee('validation-dev')
        EmployeeSkill.objects.create(employee=profile, skill=skill, level=3)
        project = Project.objects.create(name='Validation')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='validation-wf', project=project), name='Python API',
        )
        candidate = next(
            item for item in rank_for_task(task, required_skills=[RequiredSkill(skill.id, 2, 3)])
            if item.employee.id == profile.id
        )
        post.return_value = {'message': {'content': json.dumps({
            'explanation': 'Кандидат имеет 999 лет опыта и точно подходит.',
            'limitations': [],
        })}}
        with self.assertRaises(OllamaUnavailable):
            explain_candidate(task, {'skills': ['Python']}, candidate, 0.5)


class RealOllamaIntegrationTests(ScoringTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        try:
            response = requests.get(
                f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/tags", timeout=5,
            )
            response.raise_for_status()
            installed = {item.get('name') for item in response.json().get('models', [])}
        except Exception as exc:
            raise SkipTest(f'Ollama is unavailable: {exc}') from exc
        missing = {settings.OLLAMA_CHAT_MODEL, settings.OLLAMA_EMBED_MODEL} - installed
        if missing:
            raise SkipTest(f'Ollama models are missing: {", ".join(sorted(missing))}')

    def test_real_models_extract_embed_and_explain(self):
        docker = Skill.objects.create(name='Docker')
        kubernetes = Skill.objects.create(name='Kubernetes')
        cicd = Skill.objects.create(name='CI/CD')
        profile = self.make_employee('real-ollama-dev')
        for skill in (docker, kubernetes, cicd):
            EmployeeSkill.objects.create(employee=profile, skill=skill, level=4)
        project = Project.objects.create(name='Real Ollama', domain='DevOps')
        task = WorkflowTask.objects.create(
            workflow=WorkflowInstance.objects.create(name='real-ollama-wf', project=project),
            name='Deploy Kubernetes service',
            description='Required skills: Docker, Kubernetes, CI/CD.',
        )
        requirements = analyse_task(task)
        self.assertIsInstance(requirements['skills'], list)
        self.assertIn('Docker', requirements['skills'])
        self.assertTrue(requirements['summary'])

        vector = embedding('Docker Kubernetes CI/CD deployment')
        self.assertGreater(len(vector), 0)

        candidate = next(
            item for item in rank_for_task(
                task, required_skills=[RequiredSkill(skill.id, 2, 3) for skill in (docker, kubernetes, cicd)],
            ) if item.employee.id == profile.id
        )
        candidate.details['semantic_similarity'] = 0.5
        candidate.details['semantic_available'] = True
        try:
            explanation = explain_candidate(task, requirements, candidate, 0.5)
        except OllamaUnavailable as exc:
            # qwen3:4b can return an incomplete sentence or overstate unconfirmed
            # domain experience. The production path intentionally falls back.
            self.assertRegex(
                str(exc),
                r'(?:recommendation explanation|contradicted|unconfirmed domain experience)',
            )
        else:
            self.assertGreater(len(explanation), 20)

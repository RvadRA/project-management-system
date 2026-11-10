"""Вклад сотрудника в проект, видимость оценок и настройка длины рабочего дня."""
from django.utils import timezone as dj_timezone

from matching.models import ProjectParticipation
from workflows.models import WorkflowTask

from .models import GlobalSetting, ProjectMember
from .tests import RBACTestCase


class ContributionTests(RBACTestCase):
    def url(self, user, project=None):
        return f'/api/employees/profiles/{user.profile.id}/contribution/?project={(project or self.project_a).id}'

    def make_task(self, name, status, due_shift_hours=None, finished_shift_hours=None, hours=0):
        """Задача emp1 в проекте A; сдвиги — относительно текущего момента."""
        now = dj_timezone.now()
        task = WorkflowTask.objects.create(
            workflow=self.workflow_a, name=name, assigned_to=self.emp1, status=status, estimated_hours=hours)
        WorkflowTask.objects.filter(id=task.id).update(
            due_date=now + dj_timezone.timedelta(hours=due_shift_hours) if due_shift_hours is not None else None,
            completed_at=now + dj_timezone.timedelta(hours=finished_shift_hours) if finished_shift_hours is not None else None,
        )
        return task

    def test_tasks_are_classified_like_matching_performance(self):
        self.make_task('в срок', 'DONE', due_shift_hours=-10, finished_shift_hours=-20, hours=4)
        self.make_task('опоздал', 'DONE', due_shift_hours=-50, finished_shift_hours=-2, hours=6)
        self.make_task('просрочена', 'IN_PROGRESS', due_shift_hours=-5)
        self.make_task('на проверке', 'REVIEW', due_shift_hours=-5)
        self.login(self.pm1)
        data = self.client.get(self.url(self.emp1)).data

        by_name = {t['name']: t for t in data['tasks']}
        self.assertEqual(by_name['в срок']['timeliness'], 'on_time')
        self.assertEqual(by_name['опоздал']['timeliness'], 'late')
        self.assertEqual(by_name['опоздал']['late_hours'], 48.0)
        self.assertEqual(by_name['просрочена']['timeliness'], 'overdue')
        # сданная на проверку задача просрочкой не считается, даже если срок уже вышел
        self.assertEqual(by_name['на проверке']['timeliness'], 'review')

        summary = data['summary']
        self.assertEqual((summary['on_time'], summary['late'], summary['overdue'], summary['review']), (1, 1, 1, 1))
        self.assertEqual(summary['on_time_rate'], 33)
        self.assertEqual(summary['done_hours'], 10.0)
        self.assertEqual(data['position'], 'Разработчик')
        # задача плана и задача процесса из базового набора тоже на месте, чужих задач нет
        self.assertIn('Задача emp1', by_name)
        self.assertEqual(by_name['Задача emp1']['source'], 'plan')
        self.assertNotIn('WF emp2', by_name)
        self.assertNotIn('Задача emp2', by_name)

    def test_rating_is_part_of_the_contribution(self):
        ProjectParticipation.objects.create(
            employee=self.emp1.profile, project=self.project_a, role='Developer',
            performance_score=0.8, comment='Надёжно', rated_by=self.pm1, rated_at=dj_timezone.now())
        self.login(self.pm1)
        rating = self.client.get(self.url(self.emp1)).data['rating']
        self.assertEqual(rating['stars'], 4.0)
        self.assertEqual(rating['comment'], 'Надёжно')

    def test_access(self):
        # сам сотрудник
        self.login(self.emp1)
        self.assertEqual(self.client.get(self.url(self.emp1)).status_code, 200)
        # коллега не видит чужой профиль вовсе
        self.assertEqual(self.client.get(self.url(self.emp2)).status_code, 404)
        # менеджер своего проекта видит; менеджер другого проекта — нет
        self.login(self.pm1)
        self.assertEqual(self.client.get(self.url(self.emp1)).status_code, 200)
        self.login(self.pm2)
        self.assertEqual(self.client.get(self.url(self.emp1)).status_code, 403)
        # …пока его не добавят в проект с правом «Все задачи»
        guest = ProjectMember.objects.create(project=self.project_a, user=self.pm2, role='ANALYST')
        self.assertEqual(self.client.get(self.url(self.emp1)).status_code, 403)
        self.grant(guest, can_view_all_tasks=True)
        self.assertEqual(self.client.get(self.url(self.emp1)).status_code, 200)
        self.login(self.gm)
        self.assertEqual(self.client.get(self.url(self.emp1)).status_code, 200)
        self.assertEqual(self.client.get(f'/api/employees/profiles/{self.emp1.profile.id}/contribution/').status_code, 404)

    def test_employee_sees_own_rating_comment_in_profile(self):
        ProjectParticipation.objects.create(
            employee=self.emp1.profile, project=self.project_a, role='Developer',
            performance_score=1.0, comment='Отлично', rated_by=self.pm1, rated_at=dj_timezone.now())
        self.login(self.emp1)
        own = self.client.get(f'/api/employees/profiles/{self.emp1.profile.id}/').data['participations'][0]
        self.assertEqual((own['stars'], own['comment'], own['rated_by_name']), (5.0, 'Отлично', 'pm1'))


class WorkdaySettingTests(RBACTestCase):
    def test_workday_hours_must_be_a_sane_number(self):
        setting, _ = GlobalSetting.objects.update_or_create(key='WORKDAY_HOURS', defaults={'value': '8'})
        self.login(self.admin)
        url = f'/api/projects/settings/{setting.id}/'
        for bad in ('abc', '0', '30'):
            self.assertEqual(self.client.patch(url, {'value': bad}, format='json').status_code, 400, bad)
        self.assertEqual(self.client.patch(url, {'value': '7,5'}, format='json').status_code, 200)
        setting.refresh_from_db()
        self.assertEqual(setting.value, '7.5')

"""Загрузка сотрудников, оценки команды, аналитика и каталог пакетов планирования."""
import datetime

from django.utils import timezone as dj_timezone

from matching.models import EmployeeProfile, ProjectParticipation, WorkloadEntry
from matching.scoring import rank_candidates
from plans.models import ProjectRole, TaskRequiredRole
from workflows.models import WorkflowTask

from .models import AuditLog, PlanningBlock, Project, Task, TaskDependency
from .tests import RBACTestCase


class AllocationTests(RBACTestCase):
    PERIOD = {'start_date': '2030-01-07', 'end_date': '2030-01-31'}

    def add(self, user, **payload):
        return self.client.post(f'/api/projects/list/{self.project_a.id}/members/add/', {'user_id': user.id, **payload}, format='json')

    def busy_elsewhere(self, user, load=70):
        other = Project.objects.create(name='Другой проект', status='ACTIVE')
        WorkloadEntry.objects.create(
            employee=user.profile, project=other, load_percent=load,
            start_date=datetime.date(2030, 1, 7), end_date=datetime.date(2030, 1, 18))

    def test_peak_load_over_the_whole_period_is_checked(self):
        self.busy_elsewhere(self.outsider, 70)
        self.login(self.pm1)
        # раньше проверялась только занятость «на сегодня» и такое назначение проходило
        res = self.add(self.outsider, allocation_percentage=40, **self.PERIOD)
        self.assertEqual(res.status_code, 400)
        self.assertIn('свободно 30%', res.data['error'])
        res = self.add(self.outsider, allocation_percentage=30, **self.PERIOD)
        self.assertEqual(res.status_code, 201, res.data)
        entry = WorkloadEntry.objects.get(employee=self.outsider.profile, project=self.project_a)
        self.assertEqual((entry.start_date, entry.end_date, entry.load_percent),
                         (datetime.date(2030, 1, 7), datetime.date(2030, 1, 31), 30))

    def test_period_after_the_busy_window_is_free(self):
        self.busy_elsewhere(self.outsider, 70)
        self.login(self.pm1)
        res = self.add(self.outsider, allocation_percentage=100, start_date='2030-01-21', end_date='2030-02-28')
        self.assertEqual(res.status_code, 201, res.data)

    def test_role_change_keeps_the_agreed_period(self):
        self.login(self.pm1)
        self.add(self.outsider, allocation_percentage=50, **self.PERIOD)
        res = self.add(self.outsider, role='QA')
        self.assertEqual(res.status_code, 201, res.data)
        entry = WorkloadEntry.objects.get(employee=self.outsider.profile, project=self.project_a)
        # период не сброшен на сроки проекта
        self.assertEqual((entry.start_date, entry.load_percent), (datetime.date(2030, 1, 7), 50))

    def test_invalid_period_is_rejected(self):
        self.login(self.pm1)
        self.assertEqual(self.add(self.outsider, start_date='2030-02-01', end_date='2030-01-01').status_code, 400)
        self.assertEqual(self.add(self.outsider, start_date='01.02.2030').status_code, 400)
        self.assertEqual(self.add(self.outsider, allocation_percentage=0).status_code, 400)

    def test_capacity_endpoint_recommends_from_assigned_tasks(self):
        self.busy_elsewhere(self.outsider, 50)
        block = PlanningBlock.objects.create(name='B', project=self.project_a)
        Task.objects.create(block=block, name='Работа', assigned_to=self.outsider, estimated_hours=40)
        Task.objects.create(block=block, name='Без оценки', assigned_to=self.outsider)
        url = (f'/api/projects/list/{self.project_a.id}/capacity/?user_id={self.outsider.id}'
               '&start=2030-01-07&end=2030-02-03')
        self.login(self.emp1)
        self.assertEqual(self.client.get(url).status_code, 403)
        self.login(self.pm1)
        res = self.client.get(url)
        self.assertEqual(res.status_code, 200, res.data)
        data = res.data
        self.assertEqual(data['working_days'], 20)
        self.assertEqual(data['available_hours'], 160.0)
        self.assertEqual(data['peak_load_percent'], 50.0)
        self.assertEqual(data['free_percent'], 50.0)
        self.assertEqual(data['free_hours'], 80.0)
        self.assertEqual(data['assigned_hours'], 40.0)
        self.assertEqual(data['unestimated_tasks'], 1)
        self.assertEqual(data['from_tasks_percent'], 25.0)
        self.assertEqual(data['recommended_percent'], 25.0)

    def test_recommendation_is_capped_by_free_time(self):
        self.busy_elsewhere(self.outsider, 80)
        block = PlanningBlock.objects.create(name='B', project=self.project_a)
        Task.objects.create(block=block, name='Много работы', assigned_to=self.outsider, estimated_hours=120)
        self.login(self.pm1)
        res = self.client.get(
            f'/api/projects/list/{self.project_a.id}/capacity/?user_id={self.outsider.id}&start=2030-01-07&end=2030-02-03')
        self.assertEqual(res.data['from_tasks_percent'], 75.0)
        self.assertEqual(res.data['recommended_percent'], 20.0)          # свободно только 20%

    def test_completing_a_project_releases_people_and_records_history(self):
        today = datetime.date.today()
        WorkloadEntry.objects.create(
            employee=self.emp1.profile, project=self.project_a, load_percent=100,
            start_date=today - datetime.timedelta(days=30), end_date=today + datetime.timedelta(days=60))
        self.assertEqual(self.emp1.profile.current_workload_percentage, 100)
        self.project_a.status = 'COMPLETED'
        self.project_a.save()
        self.assertEqual(self.emp1.profile.current_workload_percentage, 0)
        self.assertEqual(WorkloadEntry.objects.get(employee=self.emp1.profile, project=self.project_a).end_date, today)
        self.assertTrue(ProjectParticipation.objects.filter(employee=self.emp1.profile, project=self.project_a).exists())


class TeamRatingTests(RBACTestCase):
    def complete(self):
        self.project_a.status = 'COMPLETED'
        self.project_a.save()

    def url(self):
        return f'/api/projects/list/{self.project_a.id}/ratings/'

    def test_only_project_manager_can_see_and_set_ratings(self):
        self.complete()
        self.login(self.emp1)
        self.assertEqual(self.client.get(self.url()).status_code, 403)
        res = self.client.post(self.url(), {'ratings': [{'user_id': self.emp2.id, 'stars': 5}]}, format='json')
        self.assertEqual(res.status_code, 403)
        self.login(self.pm2)   # менеджер чужого проекта проекта не видит
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_rating_requires_a_completed_project(self):
        self.login(self.pm1)
        self.assertEqual(self.client.get(self.url()).status_code, 200)
        # просмотр незавершённого проекта ничего не создаёт и ни у кого не закрывает загрузку
        self.assertFalse(ProjectParticipation.objects.filter(project=self.project_a).exists())
        res = self.client.post(self.url(), {'ratings': [{'user_id': self.emp1.id, 'stars': 5}]}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_ratings_are_saved_and_shown(self):
        self.complete()
        self.login(self.pm1)
        rows = {r['user_id']: r for r in self.client.get(self.url()).data['ratings']}
        self.assertEqual(set(rows), {self.pm1.id, self.emp1.id, self.emp2.id})
        self.assertIsNone(rows[self.emp1.id]['stars'])

        res = self.client.post(self.url(), {'ratings': [
            {'user_id': self.emp1.id, 'stars': 5, 'comment': 'Отлично'},
            {'user_id': self.emp2.id, 'stars': 2},
        ]}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['saved'], 2)
        part = ProjectParticipation.objects.get(employee=self.emp1.profile, project=self.project_a)
        self.assertEqual((part.performance_score, part.comment, part.rated_by), (1.0, 'Отлично', self.pm1))
        rows = {r['user_id']: r for r in res.data['ratings']}
        self.assertEqual((rows[self.emp1.id]['stars'], rows[self.emp2.id]['stars']), (5, 2))
        self.assertTrue(AuditLog.objects.filter(project=self.project_a, action='TEAM_RATED').exists())

    def test_validation(self):
        self.complete()
        self.login(self.pm1)

        def post(item):
            return self.client.post(self.url(), {'ratings': [item]}, format='json')

        self.assertEqual(post({'user_id': self.emp1.id, 'stars': 6}).status_code, 400)
        self.assertEqual(post({'user_id': self.emp1.id, 'stars': 0}).status_code, 400)
        self.assertEqual(post({'user_id': self.emp1.id}).status_code, 400)
        self.assertEqual(post({'user_id': self.pm1.id, 'stars': 5}).status_code, 400)        # себя оценивать нельзя
        self.assertEqual(post({'user_id': self.outsider.id, 'stars': 5}).status_code, 400)   # не участвовал в проекте
        self.assertEqual(self.client.post(self.url(), {'ratings': []}, format='json').status_code, 400)

    def test_ratings_feed_the_matching_score(self):
        self.complete()
        self.login(self.pm1)
        self.client.post(self.url(), {'ratings': [
            {'user_id': self.emp1.id, 'stars': 5}, {'user_id': self.emp2.id, 'stars': 2},
        ]}, format='json')
        ranked = {
            r.employee.user_id: r
            for r in rank_candidates(datetime.date(2030, 1, 7), datetime.date(2030, 2, 3), [])
        }
        self.assertGreater(ranked[self.emp1.id].past_performance, 0.8)
        self.assertLess(ranked[self.emp2.id].past_performance, 0.5)
        self.assertEqual(ranked[self.emp1.id].details['performance']['manual_ratings'], 1)


class AnalyticsApiTests(RBACTestCase):
    def get(self, user, days=None):
        self.login(user)
        return self.client.get('/api/projects/dashboard/' + (f'?days={days}' if days else ''))

    def test_period_is_applied(self):
        res = self.get(self.gm, 30)
        self.assertEqual(
            (res.data['period']['days'], res.data['period']['bucket'], len(res.data['performance_trend'])),
            (30, 'day', 30))
        res = self.get(self.gm, 180)
        self.assertEqual(res.data['period']['bucket'], 'week')
        self.assertTrue(20 <= len(res.data['performance_trend']) <= 27)
        self.assertEqual(self.get(self.gm, 7).data['period']['days'], 30)       # недопустимое значение заменяется
        self.assertEqual(self.get(self.gm, 'abc').data['period']['days'], 30)

    def test_trend_counts_planned_and_completed_tasks(self):
        now = dj_timezone.now()
        done = WorkflowTask.objects.create(workflow=self.workflow_a, name='done', assigned_to=self.emp1, status='DONE')
        WorkflowTask.objects.filter(id=done.id).update(completed_at=now, due_date=now)
        old_date = now - dj_timezone.timedelta(days=100)
        old = WorkflowTask.objects.create(workflow=self.workflow_a, name='old', assigned_to=self.emp1, status='DONE')
        WorkflowTask.objects.filter(id=old.id).update(completed_at=old_date, due_date=old_date)
        trend = self.get(self.gm, 30).data['performance_trend']
        self.assertEqual(sum(p['actual'] for p in trend), 1)       # задача 100-дневной давности в 30 днях не видна
        self.assertGreaterEqual(trend[-1]['planned'], 1)
        year = self.get(self.gm, 365).data['performance_trend']
        self.assertEqual(sum(p['actual'] for p in year), 2)

    def test_domain_load_includes_free_employees(self):
        today = datetime.date.today()
        for user in (self.emp1, self.emp2):
            EmployeeProfile.objects.filter(user=user).update(domain='Backend')
        WorkloadEntry.objects.create(
            employee=self.emp1.profile, project=self.project_a, load_percent=100,
            start_date=today - datetime.timedelta(days=5), end_date=today + datetime.timedelta(days=5))
        stats = {d['domain']: d for d in self.get(self.gm).data['domain_stats']}
        self.assertEqual(stats['Backend']['emp_count'], 2)
        self.assertEqual(stats['Backend']['avg_load'], 50.0)      # второй сотрудник свободен и тоже учтён
        self.assertEqual((stats['Backend']['overloaded'], stats['Backend']['free']), (1, 1))

    def test_finished_projects_do_not_count_as_load(self):
        today = datetime.date.today()
        done = Project.objects.create(name='Done', status='COMPLETED')
        WorkloadEntry.objects.create(
            employee=self.emp1.profile, project=done, load_percent=100,
            start_date=today - datetime.timedelta(days=5), end_date=today + datetime.timedelta(days=5))
        EmployeeProfile.objects.filter(user=self.emp1).update(domain='Backend')
        stats = {d['domain']: d for d in self.get(self.gm).data['domain_stats']}
        self.assertEqual(stats['Backend']['avg_load'], 0.0)

    def test_scope_by_role(self):
        self.assertEqual(self.get(self.gm).data['kpis']['total_projects'], 2)
        self.assertEqual(self.get(self.pm2).data['kpis']['total_projects'], 1)
        res = self.get(self.emp1)
        self.assertEqual((res.data['kpis']['total_projects'], res.data['performance_trend']), (0, []))

    def test_progress_matches_project_weighting(self):
        WorkflowTask.objects.filter(workflow=self.workflow_a).update(status='TODO', weight=1)
        WorkflowTask.objects.filter(id=self.wtask_emp1.id).update(status='DONE')
        WorkflowTask.objects.filter(id=self.wtask_emp2.id).update(status='REVIEW')
        # (1.0 + 0.8) / 2 задачи
        self.assertEqual(self.get(self.gm).data['kpis']['avg_progress'], 90)


class PlanningCatalogTests(RBACTestCase):
    def make_template(self):
        template = PlanningBlock.objects.create(name='Пакет', domain='Backend', is_template=True, complexity='HIGH')
        root = Task.objects.create(block=template, name='Этап A', duration_days=4, start_offset_days=0, estimated_hours=16, order=1)
        sub = Task.objects.create(block=template, parent=root, name='Подзадача A1', duration_days=2, start_offset_days=0, estimated_hours=8, order=2)
        other = Task.objects.create(block=template, name='Этап B', duration_days=3, start_offset_days=4, estimated_hours=12, order=3)
        TaskDependency.objects.create(from_task=root, to_task=other)
        role = ProjectRole.objects.create(name='Backend Developer')
        TaskRequiredRole.objects.create(task=root, role=role)
        return template, root, sub, other

    def transfer(self, template, **extra):
        self.login(self.pm1)
        return self.client.post(f'/api/projects/blocks/{template.id}/transfer/', {
            'project_id': self.project_a.id, 'start_date': '2030-01-07', **extra}, format='json')

    def catalog_row(self, template):
        listing = self.client.get('/api/projects/blocks/').data['results']
        return next(b for b in listing if b['id'] == template.id)

    def test_import_keeps_hierarchy_roles_dependencies_and_scales(self):
        template, root, sub, other = self.make_template()
        res = self.transfer(template, scaling_factor=2)
        self.assertEqual(res.status_code, 201, res.data)
        block = PlanningBlock.objects.get(id=res.data['id'])
        self.assertEqual(block.source_template, template)
        tasks = {t.name: t for t in block.tasks.all()}
        self.assertEqual(tasks['Подзадача A1'].parent, tasks['Этап A'])        # раньше подзадачи терялись
        self.assertEqual(tasks['Этап A'].duration_days, 8)                     # масштаб ×2
        self.assertEqual(tasks['Этап A'].estimated_hours, 32)
        self.assertEqual(tasks['Этап A'].required_roles.count(), 1)
        self.assertTrue(TaskDependency.objects.filter(from_task=tasks['Этап A'], to_task=tasks['Этап B']).exists())
        self.assertEqual(tasks['Этап A'].start_date, datetime.date(2030, 1, 7))

    def test_selecting_a_task_brings_its_subtasks(self):
        template, root, sub, other = self.make_template()
        res = self.transfer(template, task_ids=[root.id])
        block = PlanningBlock.objects.get(id=res.data['id'])
        self.assertEqual(sorted(block.tasks.values_list('name', flat=True)), ['Подзадача A1', 'Этап A'])
        # зависимость ведёт на невыбранную задачу — не переносится
        self.assertFalse(TaskDependency.objects.filter(from_task__block=block).exists())

    def test_usage_statistics_come_from_real_blocks(self):
        template, *_ = self.make_template()
        self.login(self.pm1)
        self.assertEqual(self.catalog_row(template)['analytics']['usage_count'], 0)
        self.assertIsNone(self.catalog_row(template)['analytics']['success_rate'])

        for _ in range(2):
            self.transfer(template)
        data = self.catalog_row(template)['analytics']
        self.assertEqual((data['usage_count'], data['completed_count'], data['success_rate']), (2, 0, 0.0))
        derived = PlanningBlock.objects.filter(source_template=template).first()
        Task.objects.filter(block=derived).update(status='DONE')
        data = self.catalog_row(template)['analytics']
        self.assertEqual((data['completed_count'], data['success_rate']), (1, 0.5))
        self.assertIsNotNone(data['avg_actual_duration'])

    def test_package_stats(self):
        template, *_ = self.make_template()
        self.login(self.pm1)
        data = self.catalog_row(template)['stats']
        self.assertEqual(data['task_count'], 3)                    # с подзадачей
        self.assertEqual(data['estimated_hours'], 36.0)
        self.assertEqual(data['span_days'], 7)                     # Этап B: смещение 4 + 3 дня
        self.assertEqual(data['roles'], ['Backend Developer'])
        self.assertEqual(data['dependency_count'], 1)

    def test_saving_a_block_as_template_keeps_everything(self):
        parent_task = Task.objects.create(
            block=self.block_a, name='Родитель', duration_days=5,
            start_date=datetime.date(2030, 1, 7), end_date=datetime.date(2030, 1, 12))
        Task.objects.create(
            block=self.block_a, parent=parent_task, name='Ребёнок', duration_days=2,
            start_date=datetime.date(2030, 1, 7), end_date=datetime.date(2030, 1, 9))
        child_block = PlanningBlock.objects.create(name='Вложенный этап', project=self.project_a, parent=self.block_a)
        Task.objects.create(block=child_block, name='Во вложенном', duration_days=3)

        self.login(self.pm1)
        res = self.client.post(f'/api/projects/blocks/{self.block_a.id}/make-template/', {'name': 'Мой пакет'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        template = PlanningBlock.objects.get(id=res.data['id'])
        self.assertTrue(template.is_template and template.project is None)
        self.assertIsNotNone(template.avg_duration)
        tasks = {t.name: t for t in template.tasks.all()}
        self.assertEqual(tasks['Ребёнок'].parent, tasks['Родитель'])
        self.assertEqual(template.children.count(), 1)
        self.assertEqual(template.children.first().tasks.get().name, 'Во вложенном')
        self.assertIsNone(tasks['Родитель'].start_date)           # у шаблона только смещения, без дат

    def test_templates_are_managed_by_library_roles_only(self):
        template, *_ = self.make_template()
        self.login(self.emp1)
        # исполнитель каталога не видит вовсе, поэтому даже удалить не может
        self.assertFalse(any(b['is_template'] for b in self.client.get('/api/projects/blocks/').data['results']))
        self.assertIn(self.client.delete(f'/api/projects/blocks/{template.id}/').status_code, (403, 404))
        self.assertTrue(PlanningBlock.objects.filter(id=template.id).exists())
        self.login(self.pm1)
        self.assertEqual(self.client.delete(f'/api/projects/blocks/{template.id}/').status_code, 204)

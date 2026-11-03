from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from notifications.models import Notification
from notifications.tasks import send_rich_task_notification
from plans.models import ProjectRole
from projects.models import PlanningBlock, Project, ProjectMember, Task

from .models import TaskReport, WorkflowInstance, WorkflowTask, WorkflowTaskTemplate, WorkflowTemplate
from .services import WorkflowService

User = get_user_model()


def make_template(*steps, name='T'):
    """steps: (name, is_parallel) либо (name, is_parallel, extra_fields)"""
    template = WorkflowTemplate.objects.create(name=name, is_published=True)
    for order, step in enumerate(steps):
        extra = step[2] if len(step) > 2 else {}
        WorkflowTaskTemplate.objects.create(
            template=template, name=step[0], order=order, is_parallel=step[1], sla_hours=8, **extra)
    return template


class WorkflowServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.manager = User.objects.create_user(username='pm', password='x', role='MANAGER')
        cls.project = Project.objects.create(name='P', manager=cls.manager)

    def statuses(self, instance):
        return dict(instance.tasks.values_list('name', 'status'))

    def test_template_without_dependencies_runs_sequentially(self):
        template = make_template(('one', False), ('two', False), ('three', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        self.assertEqual(self.statuses(instance), {'one': 'IN_PROGRESS', 'two': 'TODO', 'three': 'TODO'})

        WorkflowService.complete_task(instance.tasks.get(name='one'))
        self.assertEqual(self.statuses(instance), {'one': 'DONE', 'two': 'IN_PROGRESS', 'three': 'TODO'})

    def test_parallel_steps_start_together(self):
        template = make_template(('one', False), ('two', True), ('three', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        self.assertEqual(self.statuses(instance), {'one': 'IN_PROGRESS', 'two': 'IN_PROGRESS', 'three': 'TODO'})

        # третья задача ждёт обе параллельные
        WorkflowService.complete_task(instance.tasks.get(name='one'))
        self.assertEqual(self.statuses(instance)['three'], 'TODO')
        WorkflowService.complete_task(instance.tasks.get(name='two'))
        self.assertEqual(self.statuses(instance)['three'], 'IN_PROGRESS')

    def test_explicit_dependencies_are_respected(self):
        template = WorkflowTemplate.objects.create(name='Graph')
        a = WorkflowTaskTemplate.objects.create(template=template, name='a', order=0)
        WorkflowTaskTemplate.objects.create(template=template, name='b', order=1)
        c = WorkflowTaskTemplate.objects.create(template=template, name='c', order=2)
        c.depends_on.add(a)
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        # b не связана ни с чем — стартует сразу, c ждёт a
        self.assertEqual(self.statuses(instance), {'a': 'IN_PROGRESS', 'b': 'IN_PROGRESS', 'c': 'TODO'})

    def test_sla_clock_starts_on_activation_not_on_process_creation(self):
        template = make_template(('one', False), ('two', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        first, second = instance.tasks.get(name='one'), instance.tasks.get(name='two')
        self.assertIsNotNone(first.due_date)
        # задача в очереди не имеет срока и не считается просроченной
        self.assertIsNone(second.due_date)
        self.assertFalse(second.is_overdue)

        before = timezone.now()
        WorkflowService.complete_task(first)
        second.refresh_from_db()
        self.assertEqual(second.status, 'IN_PROGRESS')
        self.assertGreaterEqual(second.due_date, before + timezone.timedelta(hours=8))
        self.assertIsNotNone(second.started_at)

    def test_queued_task_keeps_no_deadline_when_edited(self):
        template = make_template(('one', False), ('two', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        second = instance.tasks.get(name='two')
        second.description = 'уточнили постановку'
        second.save()
        second.refresh_from_db()
        self.assertIsNone(second.due_date)

    def test_process_completes_and_reopens(self):
        template = make_template(('one', False), ('two', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        WorkflowService.complete_task(instance.tasks.get(name='one'))
        instance.refresh_from_db()
        self.assertEqual(instance.status, 'IN_PROGRESS')

        WorkflowService.complete_task(instance.tasks.get(name='two'))
        instance.refresh_from_db()
        self.assertEqual(instance.status, 'COMPLETED')
        self.assertIsNotNone(instance.completed_at)

        # новая задача в завершённом процессе возвращает его в работу
        extra = WorkflowTask.objects.create(workflow=instance, name='доработка')
        instance.refresh_from_db()
        self.assertEqual(instance.status, 'IN_PROGRESS')
        self.assertIsNone(instance.completed_at)
        # а её удаление — снова завершает
        extra.delete()
        instance.refresh_from_db()
        self.assertEqual(instance.status, 'COMPLETED')

    def test_activation_notifies_assignee_once_per_task(self):
        dev = User.objects.create_user(username='dev', password='x')
        ProjectMember.objects.create(project=self.project, user=dev)
        template = make_template(('one', False), ('two', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        ready = Notification.objects.filter(recipient=dev, title='Задача готова к выполнению')
        self.assertEqual(ready.count(), 1)          # только по активной задаче, а не по всей очереди
        WorkflowService.complete_task(instance.tasks.get(name='one'))
        self.assertEqual(ready.count(), 2)

    def test_auto_assignment_balances_and_respects_roles(self):
        qa_role = ProjectRole.objects.create(name='QA Engineer')
        dev1 = User.objects.create_user(username='dev1', password='x')
        dev2 = User.objects.create_user(username='dev2', password='x')
        qa = User.objects.create_user(username='qa', password='x')
        ProjectMember.objects.create(project=self.project, user=self.manager, role='MANAGER')
        ProjectMember.objects.create(project=self.project, user=dev1)
        ProjectMember.objects.create(project=self.project, user=dev2)
        ProjectMember.objects.create(project=self.project, user=qa, role='QA Engineer', role_ref=qa_role)

        template = make_template(
            ('Подготовить отчёт', False), ('Собрать данные', False), ('Оформить документ', False),
            ('Тестирование сборки', False), ('Согласование', False, {'assigned_role': 'MANAGER'}),
        )
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        assignee = {t.name: t.assigned_to.username for t in instance.tasks.select_related('assigned_to')}
        self.assertEqual(assignee['Тестирование сборки'], 'qa')        # по ключевому слову и должности
        self.assertEqual(assignee['Согласование'], 'pm')               # роль из шаблона
        generic = [assignee[n] for n in ('Подготовить отчёт', 'Собрать данные', 'Оформить документ')]
        # обычные задачи распределены между участниками, а не свалены на первого
        self.assertGreater(len(set(generic)), 1)
        self.assertNotIn('pm', generic)

    def test_wbs_status_is_aggregate_of_process(self):
        block = PlanningBlock.objects.create(name='B', project=self.project)
        wbs_task = Task.objects.create(block=block, name='WBS')
        template = make_template(('one', False), ('two', False))
        instance = WorkflowService.create_process_from_template(template, self.project, wbs_task=wbs_task, creator=self.manager)

        WorkflowService.complete_task(instance.tasks.get(name='one'))
        wbs_task.refresh_from_db()
        # Раньше WBS-задача закрывалась после первого же шага процесса
        self.assertEqual(wbs_task.status, 'IN_PROGRESS')

        WorkflowService.complete_task(instance.tasks.get(name='two'))
        wbs_task.refresh_from_db()
        self.assertEqual(wbs_task.status, 'DONE')

    def test_urgent_deadline_is_not_pushed_on_every_save(self):
        instance = WorkflowInstance.objects.create(name='W', project=self.project)
        task = WorkflowTask.objects.create(workflow=instance, name='Срочно починить', status='IN_PROGRESS')
        self.assertEqual(task.priority, 'URGENT')
        overdue = timezone.now() - timezone.timedelta(hours=5)
        WorkflowTask.objects.filter(id=task.id).update(due_date=overdue)
        task.refresh_from_db()

        task.description = 'уточнение'
        task.save()
        task.refresh_from_db()
        self.assertEqual(task.due_date, overdue)
        self.assertTrue(task.check_sla())
        self.assertEqual(task.status, 'ESCALATED')

    def test_sla_command_escalates_only_tasks_in_progress(self):
        instance = WorkflowInstance.objects.create(name='W', project=self.project)
        past = timezone.now() - timezone.timedelta(hours=1)
        working = WorkflowTask.objects.create(workflow=instance, name='в работе', status='IN_PROGRESS')
        review = WorkflowTask.objects.create(workflow=instance, name='на проверке', status='REVIEW')
        WorkflowTask.objects.filter(id__in=[working.id, review.id]).update(due_date=past)

        call_command('check_sla', '--dry-run', verbosity=0, stdout=mock.MagicMock())
        working.refresh_from_db()
        self.assertEqual(working.status, 'IN_PROGRESS')

        call_command('check_sla', verbosity=0, stdout=mock.MagicMock())
        working.refresh_from_db()
        review.refresh_from_db()
        self.assertEqual(working.status, 'ESCALATED')
        self.assertEqual(review.status, 'REVIEW')     # ждёт менеджера — не вина исполнителя
        self.assertFalse(review.is_overdue)

    def test_rich_notification_title(self):
        instance = WorkflowInstance.objects.create(name='W', project=self.project)
        task = WorkflowTask.objects.create(workflow=instance, name='Задача', assigned_to=self.manager)
        send_rich_task_notification(self.manager.id, task.id, 'ASSIGNED')
        notification = Notification.objects.get(recipient=self.manager)
        self.assertEqual(notification.title, 'Новая задача назначена')
        self.assertEqual(notification.type, 'TASK_ASSIGNED')


class IntegrationTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.project = Project.objects.create(name='P')

    def setUp(self):
        # Проверка адреса вебхука не должна ходить в DNS во время тестов
        resolver = mock.patch(
            'config.netguard.socket.getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))])
        resolver.start()
        self.addCleanup(resolver.stop)

    def webhook(self, status_code=200):
        response = mock.Mock(status_code=status_code, text='ok')
        return mock.patch('requests.post', return_value=response)

    def test_integration_first_step_does_not_stall_the_process(self):
        template = make_template(
            ('webhook', False, {'task_type': 'INTEGRATION', 'integration_url': 'https://example.com/hook'}),
            ('after', False),
        )
        with self.webhook() as post:
            instance = WorkflowService.create_process_from_template(template, self.project)
        self.assertEqual(post.call_count, 1)
        statuses = dict(instance.tasks.values_list('name', 'status'))
        # раньше следующая задача оставалась в очереди навсегда
        self.assertEqual(statuses, {'webhook': 'DONE', 'after': 'IN_PROGRESS'})

    def test_webhook_is_called_once_not_on_every_save(self):
        instance = WorkflowInstance.objects.create(name='W', project=self.project)
        with self.webhook(status_code=500) as post:
            task = WorkflowTask.objects.create(
                workflow=instance, name='hook', task_type='INTEGRATION', status='IN_PROGRESS',
                integration_url='https://example.com/hook')
            self.assertEqual(post.call_count, 1)
            task.refresh_from_db()
            self.assertEqual(task.status, 'ESCALATED')      # сбой вебхука требует вмешательства

            task.description = 'правка'
            task.save()
            self.assertEqual(post.call_count, 1)

    def test_integration_without_url_waits_for_manual_result(self):
        instance = WorkflowInstance.objects.create(name='W', project=self.project)
        with self.webhook() as post:
            task = WorkflowTask.objects.create(
                workflow=instance, name='hook', task_type='INTEGRATION', status='IN_PROGRESS')
        self.assertEqual(post.call_count, 0)
        task.refresh_from_db()
        self.assertEqual(task.status, 'IN_PROGRESS')


class TaskLifecycleApiTests(APITestCase):
    """Полный путь задачи через API: очередь → работа → отчёт → проверка → следующий этап."""

    @classmethod
    def setUpTestData(cls):
        cls.manager = User.objects.create_user(username='pm', password='x', role='MANAGER')
        cls.dev = User.objects.create_user(username='dev', password='x', role='EMPLOYEE')
        cls.project = Project.objects.create(name='P', manager=cls.manager)
        ProjectMember.objects.create(project=cls.project, user=cls.manager, role='MANAGER')
        ProjectMember.objects.create(project=cls.project, user=cls.dev)

    def setUp(self):
        template = make_template(('one', False), ('two', False))
        self.instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        self.first = self.instance.tasks.get(name='one')
        self.second = self.instance.tasks.get(name='two')

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def url(self, task, action=''):
        return f'/api/workflows/tasks/{task.id}/{action}'

    def test_happy_path(self):
        self.assertEqual(self.first.assigned_to, self.dev)
        self.as_user(self.dev)
        res = self.client.post(self.url(self.first, 'report/'), {'text_content': 'Сделано'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'REVIEW')

        self.as_user(self.manager)
        res = self.client.post(self.url(self.first, 'approve/'))
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'DONE')
        self.assertIsNotNone(res.data['completed_at'])

        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'IN_PROGRESS')

        self.as_user(self.dev)
        self.client.post(self.url(self.second, 'report/'), {'text_content': 'Готово'}, format='json')
        self.as_user(self.manager)
        self.client.post(self.url(self.second, 'approve/'))
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.status, 'COMPLETED')

        res = self.client.get(f'/api/workflows/processes/{self.instance.id}/')
        self.assertEqual(res.data['progress_percent'], 100)

    def test_blocked_task_cannot_be_started_reported_or_approved(self):
        self.as_user(self.dev)
        res = self.client.get(self.url(self.second))
        self.assertTrue(res.data['is_blocked'])
        self.assertIsNone(res.data['due_date'])
        self.assertEqual(self.client.patch(self.url(self.second, 'status/'), {'status': 'IN_PROGRESS'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url(self.second, 'report/'), {'text_content': 'x'}, format='json').status_code, 400)

        self.as_user(self.manager)
        self.assertEqual(self.client.patch(self.url(self.second, 'status/'), {'status': 'DONE'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url(self.second, 'approve/')).status_code, 400)
        self.assertEqual(self.client.patch(self.url(self.second), {'status': 'IN_PROGRESS'}, format='json').status_code, 400)
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'TODO')

    def test_executor_cannot_close_task_bypassing_review(self):
        self.as_user(self.dev)
        self.assertEqual(self.client.patch(self.url(self.first, 'status/'), {'status': 'DONE'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(self.url(self.first, 'status/'), {'status': 'BOGUS'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.url(self.first, 'approve/')).status_code, 403)
        # отозвать свою задачу с проверки можно
        self.client.post(self.url(self.first, 'report/'), {'text_content': 'x'}, format='json')
        res = self.client.patch(self.url(self.first, 'status/'), {'status': 'IN_PROGRESS'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)

    def test_manager_can_approve_only_submitted_work(self):
        self.as_user(self.manager)
        res = self.client.post(self.url(self.first, 'approve/'))
        self.assertEqual(res.status_code, 400)          # отчёта ещё нет
        # но может закрыть задачу вручную, и следующая запустится
        res = self.client.patch(self.url(self.first, 'status/'), {'status': 'DONE'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'IN_PROGRESS')
        self.assertIsNotNone(self.second.due_date)

    def test_return_for_rework_with_comment(self):
        self.as_user(self.dev)
        self.client.post(self.url(self.first, 'report/'), {'text_content': 'Сделано'}, format='json')
        self.assertEqual(self.client.post(self.url(self.first, 'reject/'), {'reason': 'x'}, format='json').status_code, 403)

        self.as_user(self.manager)
        self.assertEqual(self.client.post(self.url(self.first, 'reject/'), {}, format='json').status_code, 400)
        due_before = WorkflowTask.objects.get(id=self.first.id).due_date
        res = self.client.post(self.url(self.first, 'reject/'), {'reason': 'Нет тестов'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'IN_PROGRESS')
        self.assertEqual(res.data['review_comment'], 'Нет тестов')
        self.assertEqual(WorkflowTask.objects.get(id=self.first.id).due_date, due_before)   # срок не обнуляется
        self.assertTrue(Notification.objects.filter(recipient=self.dev, title='Задача возвращена на доработку').exists())
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'TODO')

    def test_escalated_task_can_still_be_submitted(self):
        WorkflowTask.objects.filter(id=self.first.id).update(due_date=timezone.now() - timezone.timedelta(hours=1))
        self.first.refresh_from_db()
        self.assertTrue(self.first.check_sla())
        self.as_user(self.dev)
        res = self.client.post(self.url(self.first, 'report/'), {'text_content': 'С опозданием, но готово'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'REVIEW')
        # снять эскалацию без отчёта исполнитель не может
        WorkflowTask.objects.filter(id=self.first.id).update(status='ESCALATED')
        self.assertEqual(self.client.patch(self.url(self.first, 'status/'), {'status': 'IN_PROGRESS'}, format='json').status_code, 403)

    def test_auto_approve_task_closes_on_report(self):
        WorkflowTask.objects.filter(id=self.first.id).update(auto_approve=True)
        self.as_user(self.dev)
        res = self.client.post(self.url(self.first, 'report/'), {'text_content': 'Готово'}, format='json')
        self.assertEqual(res.data['status'], 'DONE')
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'IN_PROGRESS')

    def test_approval_task_decided_by_its_assignee(self):
        approver = User.objects.create_user(username='boss', password='x', role='EMPLOYEE')
        ProjectMember.objects.create(project=self.project, user=approver)
        WorkflowTask.objects.filter(id=self.first.id).update(task_type='APPROVAL', assigned_to=approver)

        # отказ останавливает процесс и зовёт менеджера
        self.as_user(approver)
        res = self.client.post(self.url(self.first, 'reject/'), {'reason': 'Бюджет превышен'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'ESCALATED')
        self.assertIn('Бюджет превышен', TaskReport.objects.get(task=self.first).text_content)
        self.assertTrue(Notification.objects.filter(recipient=self.manager, title='Согласование отклонено').exists())
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'TODO')

        # повторное рассмотрение: согласующий утверждает — процесс идёт дальше
        res = self.client.post(self.url(self.first, 'approve/'))
        self.assertEqual(res.status_code, 200, res.data)
        self.second.refresh_from_db()
        self.assertEqual(self.second.status, 'IN_PROGRESS')

    def test_reopening_done_task_reopens_process(self):
        self.as_user(self.manager)
        for task in (self.first, self.second):
            self.client.patch(self.url(task, 'status/'), {'status': 'DONE'}, format='json')
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.status, 'COMPLETED')

        res = self.client.patch(self.url(self.second, 'status/'), {'status': 'IN_PROGRESS'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIsNone(res.data['completed_at'])
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.status, 'IN_PROGRESS')

    def test_process_created_through_api_from_template(self):
        template = make_template(('a', False), ('b', False), name='API')
        self.as_user(self.manager)
        res = self.client.post('/api/workflows/processes/', {
            'name': 'Новый процесс', 'project': self.project.id, 'template_id': template.id,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        process = WorkflowInstance.objects.get(id=res.data['id'])
        self.assertEqual(dict(process.tasks.values_list('name', 'status')), {'a': 'IN_PROGRESS', 'b': 'TODO'})
        self.assertEqual(process.status, 'IN_PROGRESS')

    def test_manual_task_in_empty_process(self):
        self.as_user(self.manager)
        process = WorkflowInstance.objects.create(name='Ручной', project=self.project, created_by=self.manager)
        res = self.client.post('/api/workflows/tasks/', {
            'workflow': process.id, 'name': 'Задача', 'status': 'TODO', 'sla_hours': 4, 'assigned_to': self.dev.id,
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertFalse(res.data['is_blocked'])
        # исполнитель сам берёт её в работу
        self.as_user(self.dev)
        res = self.client.patch(f'/api/workflows/tasks/{res.data["id"]}/status/', {'status': 'IN_PROGRESS'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIsNotNone(res.data['started_at'])

    def test_explicit_due_date_is_kept_separate_from_sla(self):
        self.as_user(self.manager)
        process = WorkflowInstance.objects.create(name='Дедлайн', project=self.project, created_by=self.manager)
        due = timezone.now().replace(year=2027, month=3, day=22, hour=23, minute=59, second=59, microsecond=0)
        res = self.client.post('/api/workflows/tasks/', {
            'workflow': process.id, 'name': 'Задача', 'status': 'TODO',
            'sla_hours': 24, 'due_date': due.isoformat(),
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        task = WorkflowTask.objects.get(id=res.data['id'])
        self.assertEqual(task.sla_hours, 24)
        self.assertEqual(task.due_date, due)

    def test_urgent_keyword_does_not_replace_explicit_due_date(self):
        self.as_user(self.manager)
        process = WorkflowInstance.objects.create(name='Срочный дедлайн', project=self.project, created_by=self.manager)
        due = (timezone.now() + timezone.timedelta(days=30)).replace(microsecond=0)
        res = self.client.post('/api/workflows/tasks/', {
            'workflow': process.id, 'name': 'Срочно починить', 'status': 'TODO',
            'sla_hours': 24, 'due_date': due.isoformat(),
        }, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        task = WorkflowTask.objects.get(id=res.data['id'])
        self.assertEqual(task.priority, 'URGENT')
        self.assertEqual(task.sla_hours, 2)
        self.assertEqual(task.due_date, due)

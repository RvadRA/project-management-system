from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from notifications.models import Notification
from notifications.tasks import send_rich_task_notification
from projects.models import PlanningBlock, Project, Task

from .models import WorkflowInstance, WorkflowTask, WorkflowTaskTemplate, WorkflowTemplate
from .services import WorkflowService

User = get_user_model()


class WorkflowServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.manager = User.objects.create_user(username='pm', password='x', role='MANAGER')
        cls.project = Project.objects.create(name='P', manager=cls.manager)

    def make_template(self, *steps):
        """steps: (name, is_parallel)"""
        template = WorkflowTemplate.objects.create(name='T')
        for order, (name, is_parallel) in enumerate(steps):
            WorkflowTaskTemplate.objects.create(template=template, name=name, order=order, is_parallel=is_parallel)
        return template

    def statuses(self, instance):
        return dict(instance.tasks.values_list('name', 'status'))

    def test_template_without_dependencies_runs_sequentially(self):
        template = self.make_template(('one', False), ('two', False), ('three', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        self.assertEqual(self.statuses(instance), {'one': 'IN_PROGRESS', 'two': 'TODO', 'three': 'TODO'})

        first = instance.tasks.get(name='one')
        first.complete()
        WorkflowService.activate_next_tasks(first)
        self.assertEqual(self.statuses(instance), {'one': 'DONE', 'two': 'IN_PROGRESS', 'three': 'TODO'})

    def test_parallel_steps_start_together(self):
        template = self.make_template(('one', False), ('two', True), ('three', False))
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        self.assertEqual(self.statuses(instance), {'one': 'IN_PROGRESS', 'two': 'IN_PROGRESS', 'three': 'TODO'})

        # третья задача ждёт обе параллельные
        one = instance.tasks.get(name='one')
        one.complete()
        WorkflowService.activate_next_tasks(one)
        self.assertEqual(self.statuses(instance)['three'], 'TODO')
        two = instance.tasks.get(name='two')
        two.complete()
        WorkflowService.activate_next_tasks(two)
        self.assertEqual(self.statuses(instance)['three'], 'IN_PROGRESS')

    def test_explicit_dependencies_are_respected(self):
        template = WorkflowTemplate.objects.create(name='Graph')
        a = WorkflowTaskTemplate.objects.create(template=template, name='a', order=0)
        b = WorkflowTaskTemplate.objects.create(template=template, name='b', order=1)
        c = WorkflowTaskTemplate.objects.create(template=template, name='c', order=2)
        c.depends_on.add(a)
        instance = WorkflowService.create_process_from_template(template, self.project, creator=self.manager)
        # b не связана ни с чем — стартует сразу, c ждёт a
        self.assertEqual(self.statuses(instance), {'a': 'IN_PROGRESS', 'b': 'IN_PROGRESS', 'c': 'TODO'})

    def test_wbs_status_is_aggregate_of_process(self):
        block = PlanningBlock.objects.create(name='B', project=self.project)
        wbs_task = Task.objects.create(block=block, name='WBS')
        template = self.make_template(('one', False), ('two', False))
        instance = WorkflowService.create_process_from_template(template, self.project, wbs_task=wbs_task, creator=self.manager)

        first = instance.tasks.get(name='one')
        first.complete()
        WorkflowService.activate_next_tasks(first)
        wbs_task.refresh_from_db()
        # Раньше WBS-задача закрывалась после первого же шага процесса
        self.assertEqual(wbs_task.status, 'IN_PROGRESS')

        second = instance.tasks.get(name='two')
        second.complete()
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

    def test_rich_notification_title(self):
        instance = WorkflowInstance.objects.create(name='W', project=self.project)
        task = WorkflowTask.objects.create(workflow=instance, name='Задача', assigned_to=self.manager)
        send_rich_task_notification(self.manager.id, task.id, 'ASSIGNED')
        notification = Notification.objects.get(recipient=self.manager)
        self.assertEqual(notification.title, 'Новая задача назначена')
        self.assertEqual(notification.type, 'TASK_ASSIGNED')

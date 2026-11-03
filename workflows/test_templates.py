"""Шаблоны процессов: сохранение из редактора, правка шагов списком, запуск."""
from projects.tests import RBACTestCase

from .models import WorkflowInstance, WorkflowTask, WorkflowTaskTemplate, WorkflowTemplate

TEMPLATES = '/api/workflows/templates/'
STEPS = '/api/workflows/task-templates/'
PROCESSES = '/api/workflows/processes/'


def step(fid, name, deps=(), **extra):
    return {'frontend_id': fid, 'name': name, 'depends_on_fids': list(deps), **extra}


class TemplateEditorTests(RBACTestCase):
    """То, что отправляет визуальный редактор: шаги с временными идентификаторами и связями."""

    def save_new(self, steps, **extra):
        payload = {'name': 'Согласование', 'is_published': True, 'task_templates': steps, **extra}
        return self.client.post(TEMPLATES, payload, format='json')

    def chain(self):
        self.login(self.pm1)
        res = self.save_new(
            [step('1', 'Подготовка'), step('2', 'Проверка', ['1']), step('node_9', 'Утверждение', ['2'])],
            ui_config={'positions': {'1': {'x': 10, 'y': 10}, '2': {'x': 10, 'y': 200}, 'node_9': {'x': 10, 'y': 400}}},
        )
        self.assertEqual(res.status_code, 201, res.data)
        return WorkflowTemplate.objects.get(id=res.data['id'])

    def steps_of(self, template):
        return {s.name: s for s in template.task_templates.prefetch_related('depends_on')}

    def test_links_and_layout_survive_saving(self):
        template = self.chain()
        steps = self.steps_of(template)
        self.assertEqual([d.name for d in steps['Проверка'].depends_on.all()], ['Подготовка'])
        self.assertEqual([d.name for d in steps['Утверждение'].depends_on.all()], ['Проверка'])
        self.assertEqual(template.created_by, self.pm1)
        # раскладка схемы привязана к настоящим идентификаторам шагов, а не к временным
        self.assertEqual(set(template.ui_config['positions']), {str(s.id) for s in steps.values()})
        self.assertEqual(template.ui_config['positions'][str(steps['Утверждение'].id)], {'x': 10, 'y': 400})

    def test_resaving_keeps_ids_and_fields_the_editor_does_not_know(self):
        template = self.chain()
        steps = self.steps_of(template)
        # трудозатраты и автоутверждение заданы через список шагов — редактор о них не знает
        WorkflowTaskTemplate.objects.filter(id=steps['Проверка'].id).update(estimated_hours=6, auto_approve=True, weight=3)
        ids = {name: s.id for name, s in steps.items()}

        res = self.client.patch(f'{TEMPLATES}{template.id}/', {
            'name': 'Согласование 2',
            'ui_config': {'positions': {str(ids['Подготовка']): {'x': 1, 'y': 1}, 'node_new': {'x': 5, 'y': 5}}},
            'task_templates': [
                step(str(ids['Подготовка']), 'Подготовка документов'),
                step(str(ids['Проверка']), 'Проверка', [str(ids['Подготовка'])]),
                step('node_new', 'Архив', [str(ids['Проверка'])]),
            ],
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        template.refresh_from_db()
        after = self.steps_of(template)
        self.assertEqual(set(after), {'Подготовка документов', 'Проверка', 'Архив'})       # «Утверждение» удалено
        self.assertEqual(after['Подготовка документов'].id, ids['Подготовка'])              # тот же шаг, не новый
        check = after['Проверка']
        self.assertEqual((check.id, check.estimated_hours, check.auto_approve, check.weight), (ids['Проверка'], 6, True, 3))
        self.assertEqual([d.name for d in after['Архив'].depends_on.all()], ['Проверка'])
        self.assertEqual(template.ui_config['positions'][str(after['Архив'].id)], {'x': 5, 'y': 5})
        # описание и статус публикации, которых не было в запросе, не затёрты
        self.assertTrue(template.is_published)

    def test_running_tasks_keep_their_template_step(self):
        template = self.chain()
        started = self.client.post(PROCESSES, {'name': 'P', 'project': self.project_a.id, 'template_id': template.id}, format='json')
        self.assertEqual(started.status_code, 201, started.data)
        steps = self.steps_of(template)
        self.client.patch(f'{TEMPLATES}{template.id}/', {'task_templates': [
            step(str(s.id), s.name, [str(d.id) for d in s.depends_on.all()]) for s in steps.values()
        ]}, format='json')
        linked = WorkflowTask.objects.filter(workflow_id=started.data['id'], task_template__isnull=False).count()
        self.assertEqual(linked, 3)

    def test_circular_links_are_rejected(self):
        self.login(self.pm1)
        res = self.save_new([step('a', 'A', ['c']), step('b', 'B', ['a']), step('c', 'C', ['b'])])
        self.assertEqual(res.status_code, 400)
        self.assertIn('по кругу', str(res.data))
        self.assertFalse(WorkflowTemplate.objects.filter(name='Согласование').exists())   # ничего не сохранилось
        self.assertEqual(self.save_new([step('a', 'A', ['a'])]).status_code, 400)
        self.assertEqual(self.save_new([step('a', 'A', ['нет такого'])]).status_code, 400)
        self.assertEqual(self.save_new([step('a', 'A'), step('a', 'B')]).status_code, 400)

    def test_bad_input_does_not_crash(self):
        self.login(self.pm1)
        other = self.chain()
        res = self.save_new([{'frontend_id': 'x', 'name': 'Шаг', 'template': other.id, 'id': 999, 'depends_on': [1]}])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(other.task_templates.count(), 3)                    # чужой шаблон не затронут
        self.assertEqual(self.save_new([step('x', '   ')]).status_code, 400)
        self.assertEqual(self.save_new([step('x', 'Шаг', sla_hours=0)]).status_code, 400)
        self.assertEqual(self.client.post(TEMPLATES, {'name': '  '}, format='json').status_code, 400)

    def test_author_cannot_be_forged_and_executor_cannot_edit(self):
        self.login(self.pm1)
        res = self.client.post(TEMPLATES, {'name': 'T', 'created_by': self.admin.id}, format='json')
        self.assertEqual(WorkflowTemplate.objects.get(id=res.data['id']).created_by, self.pm1)
        self.login(self.emp1)
        self.assertEqual(self.client.get(TEMPLATES).status_code, 200)
        self.assertEqual(self.client.post(TEMPLATES, {'name': 'X'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'{TEMPLATES}{res.data["id"]}/', {'name': 'X'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'{TEMPLATES}{res.data["id"]}/').status_code, 403)


class TemplateStepListTests(RBACTestCase):
    """Правка шагов списком на вкладке «Шаблоны» (без визуального редактора)."""

    def setUp(self):
        self.login(self.pm1)

    def linked_template(self):
        res = self.client.post(TEMPLATES, {'name': 'Цепочка', 'is_published': True, 'task_templates': [
            step('1', 'Первый'), step('2', 'Второй', ['1']), step('3', 'Третий', ['2']),
        ]}, format='json')
        return WorkflowTemplate.objects.get(id=res.data['id'])

    def start(self, template):
        res = self.client.post(PROCESSES, {'name': 'P', 'project': self.project_a.id, 'template_id': template.id}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        instance = WorkflowInstance.objects.get(id=res.data['id'])
        return {t.name: t for t in instance.tasks.prefetch_related('depends_on')}

    def test_step_added_to_linked_template_waits_for_the_last_step(self):
        template = self.linked_template()
        res = self.client.post(STEPS, {'template': template.id, 'name': 'Четвёртый', 'order': 3}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        tasks = self.start(template)
        # раньше новый шаг не имел связей и стартовал одновременно с первым
        self.assertEqual(tasks['Первый'].status, 'IN_PROGRESS')
        self.assertEqual(tasks['Четвёртый'].status, 'TODO')
        self.assertEqual([d.name for d in tasks['Четвёртый'].depends_on.all()], ['Третий'])

    def test_plain_list_template_stays_sequential(self):
        template = WorkflowTemplate.objects.create(name='Список', is_published=True)
        for order, name in enumerate(['A', 'B', 'C']):
            self.assertEqual(self.client.post(
                STEPS, {'template': template.id, 'name': name, 'order': order}, format='json').status_code, 201)
        self.assertFalse(WorkflowTaskTemplate.objects.filter(template=template, depends_on__isnull=False).exists())
        tasks = self.start(template)
        self.assertEqual([tasks[n].status for n in 'ABC'], ['IN_PROGRESS', 'TODO', 'TODO'])

    def test_removing_a_middle_step_keeps_the_chain(self):
        template = self.linked_template()
        middle = template.task_templates.get(name='Второй')
        self.assertEqual(self.client.delete(f'{STEPS}{middle.id}/').status_code, 204)
        third = template.task_templates.get(name='Третий')
        self.assertEqual([d.name for d in third.depends_on.all()], ['Первый'])
        tasks = self.start(template)
        self.assertEqual((tasks['Первый'].status, tasks['Третий'].status), ('IN_PROGRESS', 'TODO'))

    def test_step_cannot_depend_on_itself_other_template_or_in_circle(self):
        template = self.linked_template()
        first, third = template.task_templates.get(name='Первый'), template.task_templates.get(name='Третий')
        other = self.linked_template().task_templates.first()
        for bad in ([first.id], [other.id], [third.id]):
            res = self.client.patch(f'{STEPS}{first.id}/', {'depends_on': bad}, format='json')
            self.assertEqual(res.status_code, 400, bad)
        first.refresh_from_db()
        self.assertEqual(first.depends_on.count(), 0)          # отклонённая правка не сохранилась

    def test_step_editing_keeps_other_fields(self):
        template = self.linked_template()
        second = template.task_templates.get(name='Второй')
        res = self.client.patch(f'{STEPS}{second.id}/', {
            'name': 'Второй (правка)', 'estimated_hours': 4, 'checklist': ['один', ' ', 'два'], 'integration_url': '',
        }, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        second.refresh_from_db()
        self.assertEqual((second.estimated_hours, second.checklist), (4, ['один', 'два']))
        self.assertEqual([d.name for d in second.depends_on.all()], ['Первый'])


class TemplateLaunchTests(RBACTestCase):
    def setUp(self):
        self.login(self.pm1)

    def template(self, published=True, steps=True):
        payload = {'name': 'T', 'is_published': published}
        if steps:
            payload['task_templates'] = [step('1', 'Шаг', estimated_hours=5, checklist=['пункт'], task_type='CHECKLIST')]
        return self.client.post(TEMPLATES, payload, format='json').data['id']

    def start(self, template_id):
        return self.client.post(PROCESSES, {'name': 'P', 'project': self.project_a.id, 'template_id': template_id}, format='json')

    def test_draft_or_empty_template_cannot_be_launched(self):
        self.assertEqual(self.start(self.template(published=False)).status_code, 400)
        self.assertEqual(self.start(self.template(steps=False)).status_code, 400)
        self.assertEqual(self.start(999999).status_code, 400)
        self.assertFalse(WorkflowInstance.objects.filter(name='P').exists())   # пустых процессов не осталось

    def test_launched_task_copies_step_settings(self):
        res = self.start(self.template())
        self.assertEqual(res.status_code, 201, res.data)
        task = WorkflowTask.objects.get(workflow_id=res.data['id'])
        self.assertEqual((task.task_type, task.estimated_hours, task.status), ('CHECKLIST', 5, 'IN_PROGRESS'))
        self.assertEqual(task.checklist, [{'text': 'пункт', 'is_done': False}])
        self.assertIsNotNone(task.due_date)

    def test_deleting_template_keeps_running_processes(self):
        template_id = self.template()
        process_id = self.start(template_id).data['id']
        self.assertEqual(self.client.delete(f'{TEMPLATES}{template_id}/').status_code, 204)
        self.assertEqual(WorkflowTask.objects.filter(workflow_id=process_id).count(), 1)

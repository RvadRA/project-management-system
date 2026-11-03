import datetime

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from matching.models import EmployeeCertificate, EmployeeProfile
from plans.models import ProjectRole
from workflows.models import WorkflowInstance, WorkflowTask

from .models import AuditLog, KnowledgeMaterial, PlanningBlock, Project, ProjectMember, Task, TaskDependency
from .services import PlanningImportService

User = get_user_model()


def rows(response):
    """Список объектов из ответа с пагинацией или без неё."""
    data = response.data
    return data['results'] if isinstance(data, dict) and 'results' in data else data


class RBACTestCase(APITestCase):
    """
    Базовый набор: проект A (менеджер pm1, участники emp1 и emp2) и проект B (менеджер pm2).
    """

    @classmethod
    def setUpTestData(cls):
        def make(username, role):
            return User.objects.create_user(username=username, password='pass12345', role=role, email=f'{username}@t.local')

        cls.admin = make('admin', 'ADMIN')
        cls.gm = make('gm', 'GENERAL_MANAGER')
        cls.pm1 = make('pm1', 'MANAGER')
        cls.pm2 = make('pm2', 'MANAGER')
        cls.emp1 = make('emp1', 'EMPLOYEE')
        cls.emp2 = make('emp2', 'EMPLOYEE')
        cls.outsider = make('outsider', 'EMPLOYEE')

        cls.project_a = Project.objects.create(name='A', manager=cls.pm1, start_date=datetime.date(2026, 1, 12))
        cls.project_b = Project.objects.create(name='B', manager=cls.pm2)
        ProjectMember.objects.create(project=cls.project_a, user=cls.pm1, role='MANAGER')
        ProjectMember.objects.create(project=cls.project_b, user=cls.pm2, role='MANAGER')
        cls.member1 = ProjectMember.objects.create(project=cls.project_a, user=cls.emp1, role='DEVELOPER')
        cls.member2 = ProjectMember.objects.create(project=cls.project_a, user=cls.emp2, role='QA')

        cls.block_a = PlanningBlock.objects.create(name='Этап 1', project=cls.project_a)
        cls.task_emp1 = Task.objects.create(block=cls.block_a, name='Задача emp1', assigned_to=cls.emp1)
        cls.task_emp2 = Task.objects.create(block=cls.block_a, name='Задача emp2', assigned_to=cls.emp2)

        cls.workflow_a = WorkflowInstance.objects.create(name='Процесс A', project=cls.project_a, created_by=cls.pm1)
        cls.wtask_emp1 = WorkflowTask.objects.create(
            workflow=cls.workflow_a, name='WF emp1', assigned_to=cls.emp1, status='IN_PROGRESS')
        cls.wtask_emp2 = WorkflowTask.objects.create(
            workflow=cls.workflow_a, name='WF emp2', assigned_to=cls.emp2, status='IN_PROGRESS')

    def login(self, user):
        self.client.force_authenticate(user=user)

    def grant(self, member, **perms):
        for key, value in perms.items():
            setattr(member, key, value)
        member.save()


class UserAccountSecurityTests(RBACTestCase):
    def test_employee_cannot_promote_self_to_admin(self):
        self.login(self.emp1)
        res = self.client.patch('/api/users/me/', {'role': 'ADMIN', 'is_active': False, 'phone': '123'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.emp1.refresh_from_db()
        self.assertEqual(self.emp1.role, 'EMPLOYEE')
        self.assertTrue(self.emp1.is_active)
        self.assertEqual(self.emp1.phone, '123')

        res = self.client.patch(f'/api/users/{self.emp1.id}/', {'role': 'ADMIN'}, format='json')
        self.emp1.refresh_from_db()
        self.assertEqual(self.emp1.role, 'EMPLOYEE')

    def test_only_admin_manages_accounts(self):
        payload = {'username': 'new', 'password': 'Str0ng!pass99', 'role': 'ADMIN'}
        for user in (self.emp1, self.pm1, self.gm):
            self.login(user)
            self.assertEqual(self.client.post('/api/users/', payload, format='json').status_code, 403, user.username)
            self.assertIn(self.client.delete(f'/api/users/{self.emp2.id}/').status_code, (403, 404), user.username)
        # Менеджер видит коллег, но менять их не может
        self.login(self.pm1)
        self.assertEqual(self.client.patch(f'/api/users/{self.emp2.id}/', {'role': 'ADMIN'}, format='json').status_code, 403)

        self.login(self.admin)
        self.assertEqual(self.client.post('/api/users/', payload, format='json').status_code, 201)
        res = self.client.patch(f'/api/users/{self.emp2.id}/', {'role': 'GENERAL_MANAGER'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.emp2.refresh_from_db()
        self.assertEqual(self.emp2.role, 'GENERAL_MANAGER')
        self.assertEqual(self.client.delete(f'/api/users/{self.admin.id}/').status_code, 403)

    def test_employee_sees_only_own_account_and_profile(self):
        # профили создаются автоматически вместе с пользователями
        EmployeeProfile.objects.filter(user=self.emp2).update(hourly_rate=999)
        self.login(self.emp1)
        self.assertEqual([u['id'] for u in rows(self.client.get('/api/users/'))], [self.emp1.id])
        profiles = rows(self.client.get('/api/employees/profiles/'))
        self.assertEqual([p['user']['id'] for p in profiles], [self.emp1.id])
        # и не может менять профили
        res = self.client.patch(f'/api/employees/profiles/{profiles[0]["id"]}/', {'hourly_rate': 5}, format='json')
        self.assertEqual(res.status_code, 403)

        self.login(self.pm1)
        self.assertEqual(len(rows(self.client.get('/api/employees/profiles/'))), EmployeeProfile.objects.count())
        self.assertGreater(EmployeeProfile.objects.count(), 1)

    def test_superuser_gets_admin_role(self):
        root = User.objects.create_superuser(username='root', password='pass12345')
        self.assertEqual(root.role, 'ADMIN')

    def test_profile_with_certificate_is_serialized(self):
        profile = self.emp1.profile
        EmployeeCertificate.objects.create(
            employee=profile, name='PMP', expiry_date=datetime.date(2020, 1, 1))
        self.login(self.admin)
        res = self.client.get(f'/api/employees/profiles/{profile.id}/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['certificates'][0]['is_expired'])


class AdminPanelTests(RBACTestCase):
    def test_general_manager_has_no_admin_panel(self):
        self.login(self.gm)
        self.assertEqual(self.client.post('/api/projects/settings/', {'key': 'K', 'value': '1'}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/planning/risks/', {'name': 'R'}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/planning/roles/', {'name': 'R'}, format='json').status_code, 403)
        # но справочники читает
        self.assertEqual(self.client.get('/api/planning/risks/').status_code, 200)

    def test_admin_manages_settings(self):
        self.login(self.admin)
        res = self.client.post('/api/projects/settings/', {'key': 'K', 'value': '1'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.client.delete(f'/api/projects/settings/{res.data["id"]}/').status_code, 204)
        self.assertEqual(self.client.post('/api/planning/risks/', {'name': 'R'}, format='json').status_code, 201)

    def test_employee_cannot_use_matching(self):
        self.login(self.emp1)
        res = self.client.post('/api/matching/rank/', {'date_from': '2026-01-01', 'date_to': '2026-02-01'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.login(self.pm1)
        res = self.client.post('/api/matching/rank/', {'date_from': '2026-01-01', 'date_to': '2026-02-01'}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_risk_profile_endpoint(self):
        self.login(self.emp1)
        self.assertEqual(self.client.get(f'/api/planning/project-risk-profile/{self.project_a.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/planning/project-risk-profile/{self.project_b.id}/').status_code, 404)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(f'/api/planning/project-risk-profile/{self.project_a.id}/').status_code, 401)


class ProjectAccessTests(RBACTestCase):
    def visible_names(self, user):
        self.login(user)
        return sorted(p['name'] for p in rows(self.client.get('/api/projects/list/')))

    def test_project_visibility_by_role(self):
        self.assertEqual(self.visible_names(self.admin), ['A', 'B'])
        self.assertEqual(self.visible_names(self.gm), ['A', 'B'])
        self.assertEqual(self.visible_names(self.pm1), ['A'])
        self.assertEqual(self.visible_names(self.pm2), ['B'])
        self.assertEqual(self.visible_names(self.emp1), ['A'])
        self.assertEqual(self.visible_names(self.outsider), [])

    def test_manager_edits_only_own_project(self):
        self.login(self.pm1)
        self.assertEqual(self.client.patch(f'/api/projects/list/{self.project_a.id}/', {'status': 'ACTIVE'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/projects/list/{self.project_b.id}/', {'status': 'ACTIVE'}, format='json').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/projects/list/{self.project_b.id}/').status_code, 404)

        self.login(self.emp1)
        self.assertEqual(self.client.patch(f'/api/projects/list/{self.project_a.id}/', {'status': 'DRAFT'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/projects/list/{self.project_a.id}/').status_code, 403)

        self.login(self.gm)
        self.assertEqual(self.client.patch(f'/api/projects/list/{self.project_b.id}/', {'status': 'ACTIVE'}, format='json').status_code, 200)

    def test_project_creation(self):
        self.login(self.emp1)
        self.assertEqual(self.client.post('/api/projects/list/', {'name': 'X'}, format='json').status_code, 403)

        # Менеджер, создавший проект, остаётся его менеджером и участником
        self.login(self.pm1)
        res = self.client.post('/api/projects/list/', {'name': 'New'}, format='json')
        self.assertEqual(res.status_code, 201)
        project = Project.objects.get(id=res.data['id'])
        self.assertEqual(project.manager, self.pm1)
        self.assertTrue(ProjectMember.objects.filter(project=project, user=self.pm1, role='MANAGER').exists())
        self.assertTrue(res.data['my_permissions']['is_manager'])

    def test_status_update_keeps_manager_allocation(self):
        ProjectMember.objects.filter(project=self.project_a, user=self.pm1).update(allocation_percentage=40)
        self.login(self.pm1)
        self.client.patch(f'/api/projects/list/{self.project_a.id}/', {'status': 'ACTIVE'}, format='json')
        self.assertEqual(ProjectMember.objects.get(project=self.project_a, user=self.pm1).allocation_percentage, 40)

    def test_several_managers_per_project(self):
        self.login(self.pm1)
        res = self.client.post(f'/api/projects/list/{self.project_a.id}/members/add/',
                               {'user_id': self.pm2.id, 'role': 'MANAGER', 'allocation_percentage': 50}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ProjectMember.objects.filter(project=self.project_a, role='MANAGER').count(), 2)
        self.assertEqual(self.visible_names(self.pm2), ['A', 'B'])
        # второй менеджер получает полные права в проекте
        self.assertEqual(self.client.patch(f'/api/projects/list/{self.project_a.id}/', {'status': 'ACTIVE'}, format='json').status_code, 200)

    def test_global_pm_role_ref_makes_manager(self):
        role = ProjectRole.objects.create(name='Project Manager')
        self.login(self.pm1)
        res = self.client.post(f'/api/projects/list/{self.project_a.id}/members/add/',
                               {'user_id': self.pm2.id, 'role': 'Project Manager', 'role_ref_id': role.id}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data['is_manager'])

    def test_removing_primary_manager_hands_over(self):
        ProjectMember.objects.create(project=self.project_a, user=self.pm2, role='MANAGER')
        self.login(self.pm2)
        res = self.client.post(f'/api/projects/list/{self.project_a.id}/members/remove/', {'user_id': self.pm1.id}, format='json')
        self.assertEqual(res.status_code, 204)
        self.project_a.refresh_from_db()
        self.assertEqual(self.project_a.manager, self.pm2)
        self.assertEqual(self.visible_names(self.pm1), [])

    def test_member_management_rights(self):
        url_add = f'/api/projects/list/{self.project_a.id}/members/add/'
        self.login(self.emp1)
        self.assertEqual(self.client.post(url_add, {'user_id': self.outsider.id}, format='json').status_code, 403)

        self.grant(self.member1, can_manage_members=True)
        self.assertEqual(self.client.post(url_add, {'user_id': self.outsider.id}, format='json').status_code, 201)
        # ...но назначить менеджера или исключить его — нельзя
        self.assertEqual(self.client.post(url_add, {'user_id': self.outsider.id, 'role': 'MANAGER'}, format='json').status_code, 403)
        res = self.client.post(f'/api/projects/list/{self.project_a.id}/members/remove/', {'user_id': self.pm1.id}, format='json')
        self.assertEqual(res.status_code, 403)
        # и выдавать права флажками — тоже
        res = self.client.post(f'/api/projects/list/{self.project_a.id}/members/permissions/',
                               {'user_id': self.emp1.id, 'permissions': {'can_edit_tasks': True}}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_manager_sets_member_permissions(self):
        url = f'/api/projects/list/{self.project_a.id}/members/permissions/'
        self.login(self.pm1)
        res = self.client.post(url, {'user_id': self.emp1.id, 'permissions': {'can_edit_tasks': True, 'can_view_files': False}}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.member1.refresh_from_db()
        self.assertTrue(self.member1.can_edit_tasks)
        self.assertFalse(self.member1.can_view_files)
        self.assertTrue(AuditLog.objects.filter(project=self.project_a, action='MEMBER_PERMISSIONS_UPDATED').exists())

        self.assertEqual(self.client.post(url, {'user_id': self.emp1.id, 'permissions': {'is_superuser': True}}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'user_id': self.outsider.id, 'permissions': {}}, format='json').status_code, 404)
        # чужой менеджер не может настраивать права в проекте A
        self.login(self.pm2)
        self.assertEqual(self.client.post(url, {'user_id': self.emp1.id, 'permissions': {}}, format='json').status_code, 404)

    def test_audit_log_scope(self):
        AuditLog.objects.create(project=self.project_a, user=self.pm1, action='X')
        AuditLog.objects.create(project=self.project_b, user=self.pm2, action='Y')
        self.login(self.emp1)
        self.assertEqual(len(rows(self.client.get('/api/projects/audit-logs/'))), 0)
        self.login(self.pm1)
        self.assertEqual([l['action'] for l in rows(self.client.get('/api/projects/audit-logs/'))], ['X'])
        self.login(self.gm)
        self.assertEqual(len(rows(self.client.get('/api/projects/audit-logs/'))), 2)


class TaskAccessTests(RBACTestCase):
    def test_executor_sees_only_own_wbs_tasks(self):
        self.login(self.emp1)
        names = [t['name'] for t in rows(self.client.get('/api/projects/tasks/'))]
        self.assertEqual(names, ['Задача emp1'])

        res = self.client.get(f'/api/projects/blocks/by-project/?project_id={self.project_a.id}')
        self.assertEqual([t['name'] for t in res.data[0]['tasks']], ['Задача emp1'])
        self.assertEqual(self.client.get(f'/api/projects/blocks/by-project/?project_id={self.project_b.id}').status_code, 404)

        self.grant(self.member1, can_view_all_tasks=True)
        res = self.client.get(f'/api/projects/blocks/by-project/?project_id={self.project_a.id}')
        self.assertEqual(len(res.data[0]['tasks']), 2)

        self.login(self.pm1)
        self.assertEqual(len(rows(self.client.get('/api/projects/tasks/'))), 2)

    def test_executor_cannot_edit_foreign_or_own_task_fields(self):
        self.login(self.emp1)
        # чужая задача невидима
        self.assertEqual(self.client.patch(f'/api/projects/tasks/{self.task_emp2.id}/', {'name': 'x'}, format='json').status_code, 404)
        # в своей можно менять только статус
        self.assertEqual(self.client.patch(f'/api/projects/tasks/{self.task_emp1.id}/', {'name': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.patch(f'/api/projects/tasks/{self.task_emp1.id}/', {'status': 'IN_PROGRESS'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/projects/tasks/{self.task_emp1.id}/').status_code, 403)
        self.assertEqual(self.client.post('/api/projects/tasks/', {'block': self.block_a.id, 'name': 'n'}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/projects/blocks/', {'project': self.project_a.id, 'name': 'b'}, format='json').status_code, 403)

    def test_edit_and_assign_are_separate_checkboxes(self):
        self.grant(self.member1, can_edit_tasks=True, can_view_all_tasks=True)
        self.login(self.emp1)
        res = self.client.post('/api/projects/tasks/', {'block': self.block_a.id, 'name': 'Новая'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        task_id = res.data['id']
        self.assertEqual(Task.objects.get(id=task_id).start_date, self.project_a.start_date)
        self.assertEqual(self.client.patch(f'/api/projects/tasks/{task_id}/', {'name': 'Переименована'}, format='json').status_code, 200)
        # назначать исполнителей без отдельного права нельзя
        self.assertEqual(self.client.patch(f'/api/projects/tasks/{task_id}/', {'assigned_to': self.emp2.id}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/projects/tasks/{task_id}/assign_user/', {'user_id': self.emp2.id}, format='json').status_code, 403)

        self.grant(self.member1, can_assign_tasks=True)
        res = self.client.post(f'/api/projects/tasks/{task_id}/assign_user/', {'user_id': self.emp2.id}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(Task.objects.get(id=task_id).assigned_to, self.emp2)
        # автодобавление постороннего в команду требует права управления командой
        res = self.client.post(f'/api/projects/tasks/{task_id}/assign_user/',
                               {'user_id': self.outsider.id, 'allow_auto_add': True}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_templates_are_managed_by_library_roles(self):
        self.login(self.emp1)
        self.assertEqual(self.client.post('/api/projects/blocks/', {'name': 'T', 'is_template': True}, format='json').status_code, 403)
        self.login(self.pm1)
        res = self.client.post('/api/projects/blocks/', {'name': 'T', 'is_template': True}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        res = self.client.post('/api/projects/tasks/', {'block': res.data['id'], 'name': 'Шаблонная'}, format='json')
        self.assertEqual(res.status_code, 201, res.data)

    def test_executor_sees_only_own_workflow_tasks(self):
        self.login(self.emp1)
        self.assertEqual([t['name'] for t in rows(self.client.get('/api/workflows/tasks/'))], ['WF emp1'])
        processes = rows(self.client.get('/api/workflows/processes/'))
        self.assertEqual(len(processes), 1)
        self.assertEqual([t['name'] for t in processes[0]['tasks']], ['WF emp1'])

        self.login(self.outsider)
        self.assertEqual(len(rows(self.client.get('/api/workflows/processes/'))), 0)
        self.login(self.pm1)
        self.assertEqual(len(rows(self.client.get('/api/workflows/processes/'))[0]['tasks']), 2)

    def test_workflow_task_actions(self):
        self.login(self.emp1)
        own, foreign = self.wtask_emp1.id, self.wtask_emp2.id
        self.assertEqual(self.client.patch(f'/api/workflows/tasks/{foreign}/status/', {'status': 'DONE'}, format='json').status_code, 404)
        self.assertEqual(self.client.patch(f'/api/workflows/tasks/{own}/status/', {'status': 'BOGUS'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/workflows/tasks/{own}/', {'name': 'x', 'assigned_to': self.emp2.id}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/workflows/tasks/{own}/').status_code, 403)
        self.assertEqual(self.client.post('/api/workflows/tasks/', {'workflow': self.workflow_a.id, 'name': 'n'}, format='json').status_code, 403)

        res = self.client.post(f'/api/workflows/tasks/{own}/report/', {'text_content': 'Готово'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'REVIEW')
        # исполнитель не утверждает собственный отчёт
        self.assertEqual(self.client.post(f'/api/workflows/tasks/{own}/approve/').status_code, 403)

        self.login(self.pm1)
        res = self.client.post(f'/api/workflows/tasks/{own}/approve/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['status'], 'DONE')

    def test_process_creation_rights(self):
        payload = {'name': 'P', 'project': self.project_a.id}
        self.login(self.emp1)
        self.assertEqual(self.client.post('/api/workflows/processes/', payload, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/workflows/processes/', {'name': 'Standalone'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/workflows/processes/{self.workflow_a.id}/').status_code, 403)
        self.assertEqual(self.client.post('/api/workflows/templates/', {'name': 'T'}, format='json').status_code, 403)
        self.login(self.pm2)  # менеджер другого проекта
        self.assertEqual(self.client.post('/api/workflows/processes/', payload, format='json').status_code, 403)
        self.login(self.pm1)
        self.assertEqual(self.client.post('/api/workflows/processes/', payload, format='json').status_code, 201)
        self.assertEqual(self.client.post('/api/workflows/templates/', {'name': 'T'}, format='json').status_code, 201)


class KnowledgeBaseAccessTests(RBACTestCase):
    def setUp(self):
        import tempfile
        self._media = tempfile.TemporaryDirectory()
        self._override = override_settings(MEDIA_ROOT=self._media.name)
        self._override.enable()
        self.addCleanup(self._override.disable)
        self.addCleanup(self._media.cleanup)

        self.global_doc = KnowledgeMaterial.objects.create(title='Регламент', created_by=self.admin)
        self.doc_a = KnowledgeMaterial.objects.create(
            title='ТЗ проекта A', project=self.project_a, category='SPEC', created_by=self.pm1,
            file=SimpleUploadedFile('tz.txt', b'spec'))
        self.doc_b = KnowledgeMaterial.objects.create(title='ТЗ проекта B', project=self.project_b, created_by=self.pm2)

    def titles(self, user, query=''):
        self.login(user)
        return sorted(m['title'] for m in rows(self.client.get(f'/api/projects/knowledge-materials/{query}')))

    def test_visibility(self):
        self.assertEqual(self.titles(self.gm), ['Регламент', 'ТЗ проекта A', 'ТЗ проекта B'])
        self.assertEqual(self.titles(self.emp1), ['Регламент', 'ТЗ проекта A'])
        self.assertEqual(self.titles(self.outsider), ['Регламент'])
        self.assertEqual(self.titles(self.pm2), ['Регламент', 'ТЗ проекта B'])
        # фильтры по проекту и поиск по ключевым словам
        self.assertEqual(self.titles(self.gm, f'?project={self.project_a.id}'), ['ТЗ проекта A'])
        self.assertEqual(self.titles(self.gm, '?search=регламент'), ['Регламент'])
        self.assertEqual(self.titles(self.gm, '?scope=global'), ['Регламент'])

        # менеджер может закрыть участнику доступ к файлам проекта
        self.grant(self.member1, can_view_files=False)
        self.assertEqual(self.titles(self.emp1), ['Регламент'])

    def test_download_respects_access(self):
        url = f'/api/projects/knowledge-materials/{self.doc_a.id}/download/'
        self.login(self.emp1)
        res = self.client.get(url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(b''.join(res.streaming_content), b'spec')
        self.login(self.outsider)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_upload_rights(self):
        def upload(project=None):
            data = {'title': 'Файл', 'tags': '["a"]', 'file': SimpleUploadedFile('f.txt', b'x')}
            if project:
                data['project'] = project.id
            return self.client.post('/api/projects/knowledge-materials/', data, format='multipart')

        self.login(self.emp1)
        self.assertEqual(upload(self.project_a).status_code, 403)
        self.assertEqual(upload().status_code, 403)
        self.assertEqual(self.client.delete(f'/api/projects/knowledge-materials/{self.doc_a.id}/').status_code, 403)

        self.grant(self.member1, can_edit_files=True)
        res = upload(self.project_a)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['created_by'], self.emp1.id)
        self.assertEqual(res.data['tags'], ['a'])
        self.assertTrue(res.data['can_edit'])
        self.assertEqual(upload(self.project_b).status_code, 403)
        # перенос файла в чужой проект запрещён
        res = self.client.patch(f'/api/projects/knowledge-materials/{res.data["id"]}/', {'project': self.project_b.id}, format='json')
        self.assertEqual(res.status_code, 403)

        self.login(self.pm1)
        self.assertEqual(upload().status_code, 201)  # общая база знаний
        self.assertEqual(self.client.patch(f'/api/projects/knowledge-materials/{self.global_doc.id}/', {'title': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/projects/knowledge-materials/{self.doc_a.id}/').status_code, 204)


class PlanningServiceTests(RBACTestCase):
    def test_critical_path_with_dependencies(self):
        block = PlanningBlock.objects.create(name='CP', project=self.project_a)
        a = Task.objects.create(block=block, name='a', duration_days=3)
        b = Task.objects.create(block=block, name='b', duration_days=2)
        c = Task.objects.create(block=block, name='c', duration_days=1)  # вне цепочки, с запасом
        TaskDependency.objects.create(from_task=a, to_task=b, type='FS')

        PlanningImportService.calculate_critical_path(block)
        critical = set(Task.objects.filter(block=block, is_critical=True).values_list('name', flat=True))
        self.assertEqual(critical, {'a', 'b'})
        self.assertFalse(Task.objects.get(id=c.id).is_critical)

    def test_shift_propagates_to_dependents(self):
        block = PlanningBlock.objects.create(name='S', project=self.project_a)
        monday = datetime.date(2026, 1, 12)
        a = Task.objects.create(block=block, name='a', duration_days=2, start_date=monday, end_date=monday + datetime.timedelta(days=2))
        b = Task.objects.create(block=block, name='b', duration_days=1, start_date=monday + datetime.timedelta(days=2),
                                end_date=monday + datetime.timedelta(days=3), start_offset_days=2)
        TaskDependency.objects.create(from_task=a, to_task=b, type='FS')
        self.login(self.pm1)
        res = self.client.post(f'/api/projects/tasks/{a.id}/shift/', {'start_date': '2026-01-13'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        b.refresh_from_db()
        self.assertEqual(b.start_date, datetime.date(2026, 1, 15))

    def test_recalculate_is_idempotent(self):
        block = PlanningBlock.objects.create(name='R', project=self.project_a)
        monday = datetime.date(2026, 1, 12)
        first = Task.objects.create(block=block, name='a', duration_days=1, start_offset_days=2,
                                    start_date=monday + datetime.timedelta(days=2))
        PlanningImportService.recalculate_block_schedule(block)
        PlanningImportService.recalculate_block_schedule(block)
        first.refresh_from_db()
        self.assertEqual(first.start_date, monday + datetime.timedelta(days=2))

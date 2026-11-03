"""Проверки безопасности: вход, токены, файлы, внешние запросы, заголовки."""
import shutil
import tempfile
from io import StringIO
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import override_settings

from config.netguard import UnsafeURL, assert_public_url
from projects.tests import RBACTestCase
from workflows.models import TaskAttachment

MEDIA = tempfile.mkdtemp(prefix='pms_test_media_')


def tearDownModule():
    shutil.rmtree(MEDIA, ignore_errors=True)


class SecurityTestCase(RBACTestCase):
    PASSWORD = 'pass12345'

    def setUp(self):
        cache.clear()   # счётчики ограничения попыток входа живут в кэше

    def token_login(self, user, password=None):
        return self.client.post(
            '/api/auth/token/', {'username': user.username, 'password': password or self.PASSWORD}, format='json')


class AnonymousAccessTests(SecurityTestCase):
    ENDPOINTS = [
        '/api/users/', '/api/users/me/', '/api/employees/profiles/', '/api/employees/skills/',
        '/api/projects/list/', '/api/projects/blocks/', '/api/projects/tasks/', '/api/projects/settings/',
        '/api/projects/audit-logs/', '/api/projects/dashboard/', '/api/projects/knowledge-materials/',
        '/api/workflows/processes/', '/api/workflows/tasks/', '/api/workflows/templates/',
        '/api/notifications/', '/api/planning/roles/', '/api/planning/calendars/', '/api/ai/status/',
    ]

    def test_every_endpoint_requires_login(self):
        for url in self.ENDPOINTS:
            self.assertEqual(self.client.get(url).status_code, 401, url)

    def test_forged_token_is_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxfQ.forged')
        self.assertEqual(self.client.get('/api/users/me/').status_code, 401)


class LoginProtectionTests(SecurityTestCase):
    @override_settings(LOGIN_THROTTLE_PER_USER='3/min', LOGIN_THROTTLE_PER_IP='100/min')
    def test_password_guessing_is_throttled_per_account(self):
        for _ in range(3):
            self.assertEqual(self.token_login(self.emp1, 'wrong-password').status_code, 401)
        # лимит исчерпан: даже верный пароль не принимается, пока не пройдёт время
        self.assertEqual(self.token_login(self.emp1).status_code, 429)
        # другая учётная запись с того же адреса не блокируется
        self.assertEqual(self.token_login(self.emp2).status_code, 200)

    @override_settings(LOGIN_THROTTLE_PER_USER='100/min', LOGIN_THROTTLE_PER_IP='3/min')
    def test_password_spraying_is_throttled_per_address(self):
        for user in (self.emp1, self.emp2, self.pm1):
            self.token_login(user, 'wrong-password')
        self.assertEqual(self.token_login(self.outsider).status_code, 429)

    def test_inactive_account_cannot_log_in(self):
        self.emp1.is_active = False
        self.emp1.save()
        self.assertEqual(self.token_login(self.emp1).status_code, 401)


class TokenLifecycleTests(SecurityTestCase):
    def refresh(self, token):
        return self.client.post('/api/auth/token/refresh/', {'refresh': token}, format='json')

    def test_refresh_token_cannot_be_reused(self):
        tokens = self.token_login(self.emp1).data
        self.assertEqual(self.refresh(tokens['refresh']).status_code, 200)
        self.assertEqual(self.refresh(tokens['refresh']).status_code, 401)

    def test_logout_revokes_refresh_token(self):
        tokens = self.token_login(self.emp1).data
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.post('/api/auth/logout/', {'refresh': tokens['refresh']}, format='json').status_code, 205)
        self.client.credentials()
        self.assertEqual(self.refresh(tokens['refresh']).status_code, 401)

    def test_logout_cannot_revoke_someone_elses_token(self):
        victim = self.token_login(self.emp2).data
        mine = self.token_login(self.emp1).data
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mine['access']}")
        self.client.post('/api/auth/logout/', {'refresh': victim['refresh']}, format='json')
        self.client.credentials()
        self.assertEqual(self.refresh(victim['refresh']).status_code, 200)

    def test_password_change_ends_other_sessions(self):
        stolen = self.token_login(self.emp1).data
        self.login(self.emp1)
        res = self.client.post(
            '/api/users/change-password/',
            {'old_password': self.PASSWORD, 'new_password': 'Nov4y-Dlinnyi-Parol'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.refresh(stolen['refresh']).status_code, 401)   # старая сессия завершена
        self.assertEqual(self.refresh(res.data['refresh']).status_code, 200)  # текущая продолжает работать


class AccountTests(SecurityTestCase):
    def test_user_cannot_promote_himself(self):
        self.login(self.emp1)
        self.client.patch('/api/users/me/', {
            'role': 'ADMIN', 'is_superuser': True, 'is_staff': True, 'is_active': True, 'username': 'admin2',
        }, format='json')
        self.emp1.refresh_from_db()
        self.assertEqual((self.emp1.role, self.emp1.is_superuser, self.emp1.is_staff, self.emp1.username),
                         ('EMPLOYEE', False, False, 'emp1'))

    def test_weak_passwords_are_rejected(self):
        self.login(self.admin)
        for weak in ('short1A', '12345678901', 'password123'):
            res = self.client.post('/api/users/', {'username': 'newbie', 'password': weak, 'role': 'EMPLOYEE'}, format='json')
            self.assertEqual(res.status_code, 400, weak)

    def test_audit_command_finds_default_passwords(self):
        self.emp1.set_password('admin123')
        self.emp1.save()
        self.emp2.set_password('Kq7-Zx2-Lm9-Wv4-Tr8')
        self.emp2.save()
        out = StringIO()
        call_command('audit_accounts', '--only', 'emp1,emp2', stdout=out)
        self.assertIn('emp1', out.getvalue())
        self.assertNotIn('emp2', out.getvalue())

        call_command('audit_accounts', '--only', 'emp1', '--fix', stdout=StringIO())
        self.emp1.refresh_from_db()
        self.assertFalse(self.emp1.check_password('admin123'))


@override_settings(MEDIA_ROOT=MEDIA)
class FileSecurityTests(SecurityTestCase):
    def upload(self, name, content=b'data', **extra):
        return self.client.post('/api/projects/knowledge-materials/', {
            'title': 'Файл', 'category': 'DOC', 'project': self.project_a.id,
            'file': SimpleUploadedFile(name, content), **extra,
        }, format='multipart')

    def test_dangerous_file_types_are_rejected(self):
        self.login(self.pm1)
        for name in ('page.html', 'logo.svg', 'run.exe', 'отчёт.pdf.exe', 'script.JS', 'shell.php'):
            self.assertEqual(self.upload(name).status_code, 400, name)
        self.assertEqual(self.upload('отчёт.pdf').status_code, 201)

    @override_settings(MAX_UPLOAD_MB=1)
    def test_oversized_file_is_rejected(self):
        self.login(self.pm1)
        self.assertEqual(self.upload('big.pdf', b'x' * (1024 * 1024 + 1)).status_code, 400)

    def test_files_are_not_served_by_direct_link(self):
        self.login(self.pm1)
        created = self.upload('secret.pdf', b'top secret')
        self.assertEqual(created.status_code, 201)
        path = created.data['file']
        self.client.force_authenticate(user=None)
        # прямая ссылка не работает ни для гостя, ни для вошедшего пользователя
        self.assertEqual(self.client.get(path if path.startswith('/') else f'/media/{path}').status_code, 404)
        self.assertEqual(self.client.get('/media/knowledge_base/secret.pdf').status_code, 404)

    def test_download_is_always_an_attachment(self):
        self.login(self.pm1)
        material_id = self.upload('plan.pdf', b'%PDF-1.4').data['id']
        res = self.client.get(f'/api/projects/knowledge-materials/{material_id}/download/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('attachment', res['Content-Disposition'])
        self.assertEqual(res['X-Content-Type-Options'], 'nosniff')
        # участник без права «Файлы: просмотр» файл не получит
        self.grant(self.member1, can_view_files=False)
        self.login(self.emp1)
        self.assertEqual(self.client.get(f'/api/projects/knowledge-materials/{material_id}/download/').status_code, 404)

    def test_task_attachment_is_visible_only_with_the_task(self):
        self.login(self.emp1)
        res = self.client.post(
            f'/api/workflows/tasks/{self.wtask_emp1.id}/attach/',
            {'file': SimpleUploadedFile('result.txt', b'done')}, format='multipart')
        self.assertEqual(res.status_code, 201)
        self.assertNotIn('file', res.data)   # путь к файлу наружу не отдаётся
        url = '/api' + res.data['download_url']
        self.assertEqual(self.client.get(url).status_code, 200)
        self.login(self.pm1)
        self.assertEqual(self.client.get(url).status_code, 200)
        for stranger in (self.emp2, self.outsider, self.pm2):
            self.login(stranger)
            self.assertEqual(self.client.get(url).status_code, 404, stranger.username)
        # вложение нельзя получить, подставив номер чужой задачи
        attachment = TaskAttachment.objects.get(task=self.wtask_emp1)
        self.login(self.emp2)
        forged = f'/api/workflows/tasks/{self.wtask_emp2.id}/attachments/{attachment.id}/download/'
        self.assertEqual(self.client.get(forged).status_code, 404)

    def test_task_attachment_type_is_checked(self):
        self.login(self.emp1)
        res = self.client.post(
            f'/api/workflows/tasks/{self.wtask_emp1.id}/attach/',
            {'file': SimpleUploadedFile('evil.html', b'<script>alert(1)</script>')}, format='multipart')
        self.assertEqual(res.status_code, 400)


class OutboundRequestTests(SecurityTestCase):
    def resolve_to(self, ip):
        return mock.patch('config.netguard.socket.getaddrinfo', return_value=[(2, 1, 6, '', (ip, 80))])

    def test_internal_addresses_are_blocked(self):
        for ip in ('127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1'):
            with self.resolve_to(ip), self.assertRaises(UnsafeURL, msg=ip):
                assert_public_url('http://internal.example/hook')

    def test_only_plain_http_urls_are_allowed(self):
        for url in ('file:///etc/passwd', 'gopher://x/', 'ftp://example.com/', 'http://user:pass@example.com/', 'http:///nohost'):
            with self.resolve_to('93.184.216.34'), self.assertRaises(UnsafeURL, msg=url):
                assert_public_url(url)

    def test_public_address_passes_and_allowlist_works(self):
        with self.resolve_to('93.184.216.34'):
            self.assertEqual(assert_public_url('https://example.com/hook'), 'https://example.com/hook')
        with self.resolve_to('10.0.0.5'), override_settings(INTEGRATION_ALLOWED_HOSTS=['erp.local']):
            assert_public_url('http://erp.local/hook')

    def test_webhook_to_internal_address_is_not_sent(self):
        self.wtask_emp1.task_type = 'INTEGRATION'
        self.wtask_emp1.integration_url = 'http://169.254.169.254/latest/meta-data/'
        with mock.patch('requests.post') as post:
            ok, message = self.wtask_emp1.execute_integration()
        self.assertFalse(ok)
        post.assert_not_called()


class HeaderTests(SecurityTestCase):
    def test_foreign_site_gets_no_cors_permission(self):
        self.login(self.emp1)
        res = self.client.get('/api/users/me/', HTTP_ORIGIN='https://evil.example')
        self.assertNotIn('Access-Control-Allow-Origin', res)

    def test_security_headers_are_set(self):
        res = self.client.get('/api/users/me/')
        self.assertEqual(res['X-Frame-Options'], 'DENY')
        self.assertEqual(res['X-Content-Type-Options'], 'nosniff')

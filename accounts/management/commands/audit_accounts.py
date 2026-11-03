import secrets
import string

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

# Пароли из документации, демо-данных и самые частые — по ним входят в первую очередь
KNOWN_WEAK = [
    'admin123', 'password123', 'pass12345', 'admin', 'password', 'qwerty', 'qwerty123',
    '123456', '1234567', '12345678', '123456789', '1234567890', '111111', '000000',
    'postgres', 'root', 'test', 'test123', 'demo', 'demo123', 'user', 'user123', 'welcome', 'changeme',
]


def weak_candidates(user):
    name = user.username
    local = name.split('.')[0]
    variants = {name, name + '123', name + '1', name + '2024', name + '2025', name + '2026', local, local + '123'}
    if user.first_name:
        variants |= {user.first_name.lower(), user.first_name.lower() + '123'}
    return KNOWN_WEAK + sorted(v for v in variants if v)


def strong_password(length=16):
    alphabet = string.ascii_letters + string.digits
    while True:
        value = ''.join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in value) and any(c.isupper() for c in value) and any(c.isdigit() for c in value):
            return value


class Command(BaseCommand):
    help = (
        'Проверяет учётные записи на стандартные и простые пароли (admin123 и т. п.). '
        'С --fix задаёт таким записям новые случайные пароли и один раз выводит их на экран.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--fix', action='store_true', help='Заменить слабые пароли случайными')
        parser.add_argument('--only', default='', help='Логины через запятую — обработать только их')
        parser.add_argument('--skip', default='', help='Логины через запятую — не трогать')

    def handle(self, *args, **options):
        User = get_user_model()
        only = {x.strip() for x in options['only'].split(',') if x.strip()}
        skip = {x.strip() for x in options['skip'].split(',') if x.strip()}
        users = User.objects.filter(is_active=True).order_by('username')
        if only:
            users = users.filter(username__in=only)

        weak = [u for u in users if u.username not in skip and any(u.check_password(p) for p in weak_candidates(u))]
        if not weak:
            self.stdout.write(self.style.SUCCESS('Стандартных и простых паролей не найдено.'))
            return

        self.stdout.write(self.style.WARNING(f'Учётных записей со слабым паролем: {len(weak)}'))
        for user in weak:
            flag = ' (суперпользователь)' if user.is_superuser else ''
            self.stdout.write(f'  {user.username:<24} {user.get_role_display()}{flag}')

        if not options['fix']:
            self.stdout.write('\nЧтобы заменить пароли: python manage.py audit_accounts --fix')
            return

        from accounts.auth_views import revoke_all_tokens
        self.stdout.write('\nНовые пароли (показываются один раз — передайте их владельцам):')
        for user in weak:
            password = strong_password()
            user.set_password(password)
            user.save(update_fields=['password'])
            revoke_all_tokens(user)
            self.stdout.write(f'  {user.username:<24} {password}')
        self.stdout.write(self.style.SUCCESS('Готово. Прежние сессии этих пользователей завершены.'))

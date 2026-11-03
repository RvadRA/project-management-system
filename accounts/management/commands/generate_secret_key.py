from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.core.management.utils import get_random_secret_key


class Command(BaseCommand):
    help = 'Генерирует DJANGO_SECRET_KEY. С --write записывает его в .env (существующий ключ не трогает).'

    def add_arguments(self, parser):
        parser.add_argument('--write', action='store_true', help='Записать ключ в .env, а не выводить на экран')
        parser.add_argument('--force', action='store_true', help='Заменить ключ, даже если он уже задан')

    def handle(self, *args, **options):
        key = get_random_secret_key()
        if not options['write']:
            self.stdout.write(key)
            return

        path = Path(settings.BASE_DIR) / '.env'
        lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
        index = next((i for i, line in enumerate(lines) if line.strip().startswith('DJANGO_SECRET_KEY=')), None)
        has_value = index is not None and lines[index].split('=', 1)[1].strip()
        if has_value and not options['force']:
            self.stdout.write('DJANGO_SECRET_KEY уже задан в .env — оставлен без изменений (--force, чтобы заменить).')
            return
        entry = f'DJANGO_SECRET_KEY={key}'
        if index is None:
            lines.append(entry)
        else:
            lines[index] = entry
        path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        # Смена ключа делает недействительными все выданные токены — пользователям нужно войти заново
        self.stdout.write(self.style.SUCCESS('Новый DJANGO_SECRET_KEY записан в .env. Все пользователи должны войти заново.'))

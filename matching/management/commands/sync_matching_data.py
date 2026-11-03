"""
python manage.py sync_matching_data

Достраивает данные, на которые опирается подбор команды:
  - создаёт профили сотрудников пользователям, у которых их нет (кроме администраторов);
  - записывает участие команд в уже завершённых проектах в историю сотрудников.

Команду можно запускать повторно — существующие записи не изменяются.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from matching.services import ensure_profile, sync_project_participations
from projects.models import Project


class Command(BaseCommand):
    help = 'Создаёт недостающие профили сотрудников и историю участия в завершённых проектах'

    def handle(self, *args, **options):
        User = get_user_model()
        users = list(User.objects.filter(is_active=True, profile__isnull=True).exclude(role='ADMIN'))
        for user in users:
            ensure_profile(user)
            self.stdout.write(f'  Профиль создан: {user.username}')

        participations = 0
        for project in Project.objects.filter(status='COMPLETED'):
            participations += sync_project_participations(project)

        self.stdout.write(self.style.SUCCESS(
            f'Готово: профилей создано — {len(users)}, '
            f'записей об участии добавлено — {participations}'
        ))

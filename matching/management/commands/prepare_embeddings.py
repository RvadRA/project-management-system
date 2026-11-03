"""
python manage.py prepare_embeddings

Подготавливает локальные эмбеддинги опыта активных сотрудников.

Команда ничего не создаёт в профилях и не меняет рабочие данные: она только
заполняет/обновляет EmployeeExperienceEmbedding. Повторный запуск безопасен —
если исходные данные не изменились, эмбеддинг берётся из кеша, а при изменении
навыков, проектов или выполненных задач пересчитывается по хешу источника.

По умолчанию команда не запускается автоматически и не вызывается из запросов.
"""
from django.core.management.base import BaseCommand
from django.db import DatabaseError

from matching.ai import OllamaUnavailable, cached_employee_embedding
from matching.models import EmployeeProfile


class Command(BaseCommand):
    help = 'Подготавливает эмбеддинги активных сотрудников (без изменения профилей)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--employee-id', type=int, action='append', dest='employee_ids',
            help='Подготовить только указанный профиль (можно повторить несколько раз).',
        )
        parser.add_argument(
            '--force', action='store_true',
            help='Пересчитать эмбеддинги даже при совпадении хеша исходных данных.',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Показать список сотрудников, но не обращаться к Ollama и не записывать эмбеддинги.',
        )

    def handle(self, *args, **options):
        profiles = EmployeeProfile.objects.select_related('user').filter(
            user__is_active=True,
        ).exclude(user__role='ADMIN').order_by('id')
        if options['employee_ids']:
            profiles = profiles.filter(id__in=options['employee_ids'])

        profiles = list(profiles)
        if not profiles:
            self.stdout.write(self.style.WARNING('Активные сотрудники не найдены.'))
            return

        if options['dry_run']:
            self.stdout.write(f'Будет обработано профилей: {len(profiles)}')
            for profile in profiles:
                self.stdout.write(f'  #{profile.id} {profile.user.get_full_name() or profile.user.username}')
            self.stdout.write(self.style.WARNING('Dry-run: эмбеддинги не записаны.'))
            return

        prepared = 0
        skipped = 0
        failed = 0
        for profile in profiles:
            name = profile.user.get_full_name() or profile.user.username
            try:
                vector = cached_employee_embedding(profile, force=options['force'])
                if not vector:
                    raise OllamaUnavailable('Ollama returned an empty embedding.')
                prepared += 1
                self.stdout.write(f'  OK  #{profile.id} {name} ({len(vector)} измерений)')
            except OllamaUnavailable as exc:
                skipped += 1
                self.stderr.write(f'  FAIL #{profile.id} {name}: {exc}')
            except DatabaseError as exc:
                failed += 1
                self.stderr.write(f'  FAIL #{profile.id} {name}: {exc}')

        self.stdout.write(self.style.SUCCESS(
            f'Готово: подготовлено — {prepared}, пропущено из-за Ollama — {skipped}, '
            f'ошибок базы данных — {failed}.'
        ))
        if skipped or failed:
            self.stdout.write(self.style.WARNING(
                'Часть сотрудников не обработана; существующие профили и эмбеддинги не изменялись.'
            ))

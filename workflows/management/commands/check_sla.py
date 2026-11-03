"""
Management command: check_sla
Эскалирует задачи процессов, у которых истёк срок (SLA), пока они в работе.

Использует ту же логику, что и периодическая задача Celery (WorkflowTask.check_sla),
поэтому команду можно запускать по расписанию (cron / планировщик Windows), если Celery Beat не используется:

    python manage.py check_sla
    python manage.py check_sla --dry-run      # только показать, без изменений
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from workflows.models import WorkflowTask


class Command(BaseCommand):
    help = 'Проверяет сроки (SLA) задач в работе и эскалирует просроченные'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Показать задачи, которые были бы эскалированы, без изменений',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        now = timezone.now()

        self.stdout.write(self.style.MIGRATE_HEADING(
            f'\n[check_sla] {now.strftime("%Y-%m-%d %H:%M:%S UTC")}'
        ))

        # Эскалируются только задачи в работе: задача на проверке ждёт менеджера,
        # а задача в очереди ещё не начата и срока не имеет
        overdue_tasks = WorkflowTask.objects.filter(
            status='IN_PROGRESS', due_date__lt=now,
        ).select_related('workflow__project__manager', 'workflow__created_by', 'assigned_to')

        escalated = 0
        for task in overdue_tasks:
            overdue_hours = round((now - task.due_date).total_seconds() / 3600, 1)
            self.stdout.write(
                f'  -> #{task.id} «{task.name}» | процесс: {task.workflow.name} | просрочка: {overdue_hours} ч'
            )
            # check_sla() меняет статус и рассылает уведомления исполнителю и менеджеру
            if dry_run or task.check_sla():
                escalated += 1

        if not escalated:
            self.stdout.write(self.style.SUCCESS('  Просроченных задач нет.\n'))
        elif dry_run:
            self.stdout.write(self.style.WARNING(f'[check_sla] Без изменений: было бы эскалировано {escalated}\n'))
        else:
            self.stdout.write(self.style.SUCCESS(f'[check_sla] Эскалировано задач: {escalated}\n'))

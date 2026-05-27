"""
Management command: check_sla
Scans all active WorkflowTasks with exceeded SLA and escalates them.

Usage:
    python manage.py check_sla
    python manage.py check_sla --dry-run      # Preview without changes
    python manage.py check_sla --notify       # Also send email notifications
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from workflows.models import WorkflowTask


class Command(BaseCommand):
    help = 'Check SLA deadlines for all active workflow tasks and escalate overdue ones'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Preview tasks that would be escalated without making changes',
        )
        parser.add_argument(
            '--notify',
            action='store_true',
            default=True,
            help='Send email notifications to assignees and managers (default: True)',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        send_notify = options.get('notify', True)
        now = timezone.now()

        self.stdout.write(self.style.MIGRATE_HEADING(
            f'\n[check_sla] Running at {now.strftime("%Y-%m-%d %H:%M:%S UTC")}'
        ))
        if dry_run:
            self.stdout.write(self.style.WARNING('  [DRY RUN] No changes will be made\n'))

        # Find all active tasks that have a due_date and are overdue
        overdue_tasks = WorkflowTask.objects.filter(
            status__in=['IN_PROGRESS', 'REVIEW'],
            due_date__lt=now,
        ).select_related('workflow', 'workflow__created_by', 'assigned_to')

        if not overdue_tasks.exists():
            self.stdout.write(self.style.SUCCESS('  ✓ No overdue tasks found. All SLAs are met.\n'))
            return

        escalated = 0
        already_escalated = 0

        for task in overdue_tasks:
            overdue_hours = round((now - task.due_date).total_seconds() / 3600, 1)
            self.stdout.write(
                f'  -> Task #{task.id}: "{task.name}" | '
                f'Process: {task.workflow.name} | '
                f'Overdue: {overdue_hours}h'
            )

            if not dry_run:
                old_status = task.status
                task.status = 'ESCALATED'
                task.save(update_fields=['status', 'updated_at'])
                escalated += 1

                if send_notify:
                    self._send_escalation_notifications(task, overdue_hours)

                self.stdout.write(self.style.WARNING(
                    f'     Escalated: {old_status} -> ESCALATED'
                ))
            else:
                self.stdout.write(self.style.WARNING(
                    f'     [DRY RUN] Would escalate: {task.status} -> ESCALATED'
                ))
                escalated += 1

        # Summary
        self.stdout.write('')
        if dry_run:
            self.stdout.write(self.style.SUCCESS(
                f'[check_sla] DRY RUN complete: {escalated} tasks would be escalated'
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f'[check_sla] Done: {escalated} tasks escalated'
            ))

    def _send_escalation_notifications(self, task, overdue_hours):
        """Send escalation notifications to assignee and process creator."""
        try:
            from notifications.utils import notify
            body = (
                f'Task "{task.name}" has breached its SLA deadline by {overdue_hours} hours. '
                f'It has been automatically escalated.'
            )
            # Notify assignee
            if task.assigned_to:
                notify(
                    recipient=task.assigned_to,
                    title=f'⚡ SLA Breach: {task.name}',
                    body=body,
                    notif_type='ESCALATION',
                    task_id=task.id,
                )
            # Notify process creator / manager
            if task.workflow.created_by and task.workflow.created_by != task.assigned_to:
                notify(
                    recipient=task.workflow.created_by,
                    title=f'⚡ SLA Breach Alert: {task.name}',
                    body=body,
                    notif_type='ESCALATION',
                    task_id=task.id,
                )
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'     Notification error: {e}'))

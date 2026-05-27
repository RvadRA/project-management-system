from django.db import models
from django.conf import settings
from django.utils import timezone


class WorkflowTemplate(models.Model):
    """Шаблон бизнес-процесса (версионированный)."""
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)
    is_published = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    ui_config = models.JSONField(default=dict, blank=True, help_text="Данные для UI (позиции узлов и т.д.)")

    class Meta:
        ordering = ['-version']

    def __str__(self):
        return f"{self.name} v{self.version}"


class WorkflowTaskTemplate(models.Model):
    """Шаблон задачи внутри шаблона процесса."""
    TASK_TYPES = [
        ('TEXT_REPORT', 'Текстовый отчёт'),
        ('FILE_UPLOAD', 'Загрузка файлов'),
        ('CHECKLIST', 'Чек-лист'),
        ('APPROVAL', 'Утверждение'),
        ('INTEGRATION', 'Интеграционная задача'),
    ]
    template = models.ForeignKey(WorkflowTemplate, on_delete=models.CASCADE, related_name='task_templates')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=20, choices=TASK_TYPES, default='TEXT_REPORT')
    order = models.PositiveIntegerField(default=0)
    sla_hours = models.PositiveIntegerField(default=24, help_text='SLA в часах')
    is_parallel = models.BooleanField(default=False, help_text='Выполняется параллельно с предыдущей задачей')
    assigned_role = models.CharField(max_length=50, blank=True, null=True, help_text="Роль для назначения (например, MANAGER)")
    weight = models.PositiveIntegerField(default=1, help_text="Вес задачи для расчета прогресса")
    priority = models.CharField(max_length=20, default='MEDIUM', choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High'), ('URGENT', 'Urgent')
    ])
    estimated_hours = models.FloatField(default=0.0)
    risk_level = models.CharField(max_length=20, default='LOW', choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High')
    ])
    # Условие перехода (простое JSON-условие)
    transition_condition = models.JSONField(default=dict, blank=True)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependent_templates')
    auto_approve = models.BooleanField(default=False)
    
    # Integration settings
    integration_url = models.URLField(blank=True, null=True, help_text="URL для вызова вебхука (для INTEGRATION задач)")
    integration_config = models.JSONField(default=dict, blank=True, help_text="Конфигурация payload/headers для вебхука")
    checklist = models.JSONField(default=list, blank=True, help_text="Список пунктов (строки)")

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.template.name} → {self.name}"


class WorkflowInstance(models.Model):
    """Запущенный экземпляр процесса по шаблону."""
    STATUS_CHOICES = [
        ('PENDING', 'Ожидает'),
        ('IN_PROGRESS', 'В процессе'),
        ('COMPLETED', 'Завершён'),
        ('CANCELLED', 'Отменён'),
    ]
    template = models.ForeignKey(WorkflowTemplate, on_delete=models.SET_NULL, null=True)
    project = models.ForeignKey('projects.Project', on_delete=models.SET_NULL, null=True, blank=True, related_name='workflows')
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='created_workflows')

    def __str__(self):
        return f"{self.name} [{self.status}]"


class WorkflowTask(models.Model):
    """Конкретная задача в запущенном процессе."""
    STATUS_CHOICES = [
        ('TODO', 'К выполнению'),
        ('IN_PROGRESS', 'В работе'),
        ('REVIEW', 'На проверке'),
        ('DONE', 'Выполнено'), 
        ('ESCALATED', 'Эскалировано'),
    ] 
    workflow = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name='tasks')
    task_template = models.ForeignKey(WorkflowTaskTemplate, on_delete=models.SET_NULL, null=True, blank=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=20, default='TEXT_REPORT')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='TODO')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='workflow_tasks')
    due_date = models.DateTimeField(null=True, blank=True)
    sla_hours = models.PositiveIntegerField(default=24)
    order = models.PositiveIntegerField(default=0)
    weight = models.PositiveIntegerField(default=1, help_text="Вес задачи для расчета прогресса")
    priority = models.CharField(max_length=20, default='MEDIUM', choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High'), ('URGENT', 'Urgent')
    ])
    estimated_hours = models.FloatField(default=0.0)
    risk_level = models.CharField(max_length=20, default='LOW', choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High')
    ])
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependent_tasks')
    auto_approve = models.BooleanField(default=False)
    checklist = models.JSONField(default=list, blank=True)  # Копия из шаблона [{text, is_done}]

    # Integration execution
    integration_url = models.URLField(blank=True, null=True)
    integration_config = models.JSONField(default=dict, blank=True)

    # WBS Context
    linked_wbs_task = models.ForeignKey(
        'projects.Task',
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='execution_tasks'
    )
    wbs_block = models.ForeignKey(
        'projects.PlanningBlock',
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='execution_tasks'
    )
    
    # Process Logic
    transition_condition = models.JSONField(
        default=dict, blank=True, 
        help_text="e.g. {'type': 'approval_required', 'role': 'MANAGER'}"
    )

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.workflow.name} → {self.name} [{self.status}]"

    def save(self, *args, **kwargs):
        # Если due_date не задан, вычисляем его на основе sla_hours
        if not self.due_date and self.sla_hours:
            self.due_date = timezone.now() + timezone.timedelta(hours=self.sla_hours)
        super().save(*args, **kwargs)

    def complete(self, user=None):
        self.status = 'DONE'
        self.completed_at = timezone.now()
        self.save()

    def execute_integration(self):
        """Выполняет внешний вебхук для интеграционных задач."""
        if not self.integration_url:
            return True, "No URL provided"

        import requests
        import json
        
        payload = {
            'task_id': self.id,
            'task_name': self.name,
            'project': self.workflow.project.name if self.workflow.project else None,
            'config': self.integration_config
        }
        
        try:
            headers = self.integration_config.get('headers', {'Content-Type': 'application/json'})
            timeout = self.integration_config.get('timeout', 10)
            
            response = requests.post(
                self.integration_url, 
                json=payload, 
                headers=headers,
                timeout=timeout
            )
            
            if response.status_code < 400:
                self.complete()
                return True, f"Success: {response.status_code}"
            else:
                return False, f"Failed: {response.status_code} - {response.text[:200]}"
        except Exception as e:
            return False, f"Error: {str(e)}"

    @property
    def is_overdue(self):
        if self.status in ['DONE', 'CANCELLED']:
            return False
        if not self.due_date:
            return False
        return timezone.now() > self.due_date

    def check_sla(self):
        if self.is_overdue and self.status == 'IN_PROGRESS':
            self.status = 'ESCALATED'
            self.save(update_fields=['status'])
            # Create rich notification for escalation
            try:
                from notifications.tasks import send_rich_task_notification
                recipients = set()
                if self.workflow.project and self.workflow.project.manager:
                    recipients.add(self.workflow.project.manager.id)
                if self.workflow.created_by:
                    recipients.add(self.workflow.created_by.id)
                if self.assigned_to:
                    recipients.add(self.assigned_to.id)
                
                for uid in recipients:
                    send_rich_task_notification.delay(
                        user_id=uid,
                        task_id=self.id,
                        event_type='ESCALATED'
                    )
            except Exception:
                pass
            return True
        return False

class TaskReport(models.Model):
    """Отчёт сотрудника по задаче."""
    task = models.OneToOneField(WorkflowTask, on_delete=models.CASCADE, related_name='report')
    text_content = models.TextField(blank=True)
    checklist = models.JSONField(default=list, blank=True)  # [{label, checked}]
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Report for {self.task.name}"


class TaskAttachment(models.Model):
    """Прикреплённый файл к задаче."""
    task = models.ForeignKey(WorkflowTask, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='task_attachments/%Y/%m/')
    original_name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.original_name


from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender=WorkflowTask)
def update_workflow_status(sender, instance, **kwargs):
    workflow = instance.workflow
    if workflow.status != 'COMPLETED':
        all_done = not workflow.tasks.exclude(status='DONE').exists()
        if all_done and workflow.tasks.exists():
            workflow.status = 'COMPLETED'
            workflow.completed_at = timezone.now()
            workflow.save(update_fields=['status', 'completed_at'])

@receiver(post_save, sender=WorkflowTask)
def auto_execute_integration_task(sender, instance, created, **kwargs):
    """
    Trigger async integration task when an integration task moves to IN_PROGRESS.
    Uses a local flag to prevent recursion in EAGER mode.
    """
    if instance.task_type == 'INTEGRATION' and instance.status == 'IN_PROGRESS':
        # Prevent recursion if this save is already inside an integration execution
        if getattr(instance, '_integration_running', False):
            return
            
        # We only want to trigger this if it's a fresh transition to IN_PROGRESS
        # or if it was just created as IN_PROGRESS.
        # Since we don't have old_state here easily, we use a custom flag 
        # that we check and then clear.
        
        from .tasks import execute_integration_task
        # We use a slight delay or check to ensure we don't loop
        execute_integration_task.delay(instance.id)



@receiver(post_save, sender=WorkflowTask)
def sync_wbs_status_signal(sender, instance, **kwargs):
    """
    Синхронизирует статус WBS задачи при изменении статуса Workflow задачи.
    """
    from .services import WorkflowService
    WorkflowService.sync_wbs_status(instance)

# Logging signals removed from models to avoid incorrect attribution. 
# Logging is now handled in views.py where request.user is available.

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
    ui_config = models.JSONField(default=dict, blank=True, help_text="Данные интерфейса (например, позиции узлов)")

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
        ('LOW', 'Низкий'), ('MEDIUM', 'Средний'), ('HIGH', 'Высокий'), ('URGENT', 'Срочный')
    ])
    estimated_hours = models.FloatField(default=0.0)
    risk_level = models.CharField(max_length=20, default='LOW', choices=[
        ('LOW', 'Низкий'), ('MEDIUM', 'Средний'), ('HIGH', 'Высокий')
    ])
    # Условие перехода (простое JSON-условие)
    transition_condition = models.JSONField(default=dict, blank=True)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependent_templates')
    auto_approve = models.BooleanField(default=False)
    
    # Integration settings
    integration_url = models.URLField(blank=True, null=True, help_text="Адрес для вызова вебхука (для интеграционных задач)")
    integration_config = models.JSONField(default=dict, blank=True, help_text="Настройки вебхука: полезная нагрузка и заголовки")
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
        ('LOW', 'Низкий'), ('MEDIUM', 'Средний'), ('HIGH', 'Высокий'), ('URGENT', 'Срочный')
    ])
    estimated_hours = models.FloatField(default=0.0)
    risk_level = models.CharField(max_length=20, default='LOW', choices=[
        ('LOW', 'Низкий'), ('MEDIUM', 'Средний'), ('HIGH', 'Высокий')
    ])
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependent_tasks')
    auto_approve = models.BooleanField(default=False)
    checklist = models.JSONField(default=list, blank=True)  # Копия из шаблона [{text, is_done}]
    review_comment = models.TextField(
        blank=True, help_text="Комментарий проверяющего при возврате на доработку или отказе в согласовании"
    )

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
        help_text="Например: {'type': 'approval_required', 'role': 'MANAGER'}"
    )

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f"{self.workflow.name} → {self.name} [{self.status}]"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        # Статус на момент загрузки — чтобы отличать переход в работу от повторного сохранения
        instance._loaded_status = instance.__dict__.get('status')
        return instance

    def save(self, *args, **kwargs):
        # Auto-prioritization check
        keywords = ["срочно", "критично", "горит", "в первую очередь", "авария", "срочно сделать", "asap"]
        text = f"{self.name or ''} {self.description or ''}".lower()
        is_urgent = any(kw in text for kw in keywords)
        
        # Срочность применяем один раз — когда задача становится срочной. Иначе каждый
        # save() (смена статуса, правка описания) сдвигал бы дедлайн ещё на 2 часа
        # и срочная задача никогда не становилась бы просроченной.
        if is_urgent and (self._state.adding or self.priority != 'URGENT'):
            self.priority = 'URGENT'
            self.sla_hours = 2
            self.order = 0
            if not self.due_date and self.status != 'DONE':
                self.due_date = timezone.now() + timezone.timedelta(hours=2)

        # Срок считаем от SLA при создании и при взятии в работу. Задача, ждущая своей очереди
        # (TODO без срока), остаётся без срока — он появится при активации.
        if not self.due_date and self.sla_hours and (self._state.adding or self.status != 'TODO'):
            self.due_date = timezone.now() + timezone.timedelta(hours=self.sla_hours)

        # Признак «только что перешла в работу» — по нему один раз запускается интеграция
        self._became_in_progress = self.status == 'IN_PROGRESS' and (
            self._state.adding or getattr(self, '_loaded_status', None) != 'IN_PROGRESS'
        )
        super().save(*args, **kwargs)
        self._loaded_status = self.status

    def complete(self, user=None):
        self.status = 'DONE'
        self.completed_at = timezone.now()
        self.save()

    def execute_integration(self):
        """Выполняет внешний вебхук для интеграционных задач."""
        if not self.integration_url:
            return True, "No URL provided"

        import requests
        from config.netguard import UnsafeURL, assert_public_url

        # Адрес задаёт пользователь, поэтому запрос не должен попасть во внутреннюю сеть сервера
        try:
            assert_public_url(self.integration_url)
        except UnsafeURL as exc:
            return False, f"Адрес вебхука отклонён: {exc}"

        config = self.integration_config if isinstance(self.integration_config, dict) else {}
        payload = {
            'task_id': self.id,
            'task_name': self.name,
            'project': self.workflow.project.name if self.workflow.project else None,
            'config': config,
        }
        raw_headers = config.get('headers')
        headers = {'Content-Type': 'application/json'}
        if isinstance(raw_headers, dict):
            # Только простые строковые заголовки; Host и длину запроса формирует сама библиотека
            headers.update({
                str(k): str(v) for k, v in raw_headers.items()
                if str(k).lower() not in ('host', 'content-length', 'transfer-encoding') and '\n' not in str(v) and '\r' not in str(v)
            })
        try:
            timeout = min(max(float(config.get('timeout', 10)), 1), 30)
        except (TypeError, ValueError):
            timeout = 10

        try:
            response = requests.post(
                self.integration_url,
                json=payload,
                headers=headers,
                timeout=timeout,
                # Перенаправление могло бы увести запрос на внутренний адрес в обход проверки
                allow_redirects=False,
            )
            if response.status_code < 300:
                self.complete()
                return True, f"Success: {response.status_code}"
            # Тело ответа наружу не отдаём: через него можно было бы читать внутренние сервисы
            return False, f"Failed: {response.status_code}"
        except requests.RequestException as e:
            return False, f"Error: {type(e).__name__}"

    @property
    def is_overdue(self):
        # Сданная на проверку задача ждёт менеджера — исполнителю просрочку не засчитываем
        if self.status in ['DONE', 'REVIEW', 'CANCELLED']:
            return False
        if not self.due_date:
            return False
        return timezone.now() > self.due_date

    def check_sla(self):
        """Эскалирует задачу, если срок истёк, а она всё ещё в работе. Возвращает True при эскалации."""
        if self.is_overdue and self.status == 'IN_PROGRESS':
            self.status = 'ESCALATED'
            self.save(update_fields=['status', 'updated_at'])
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


from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

@receiver(post_save, sender=WorkflowTask)
def update_workflow_status(sender, instance, **kwargs):
    # Процесс завершается, когда выполнены все задачи, и возвращается в работу,
    # если задачу переоткрыли или добавили новую (раньше оставался «Завершён» навсегда)
    from .services import WorkflowService
    WorkflowService.refresh_instance_status(instance.workflow)

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

        # Вебхук вызывается один раз — в момент перехода в работу, а не при каждом
        # сохранении задачи (правка описания раньше вызывала внешний сервис повторно)
        if not getattr(instance, '_became_in_progress', False):
            return
        # Задача без адреса вебхука выполняется вручную через форму сдачи результата
        if not instance.integration_url:
            return

        from .tasks import execute_integration_task
        execute_integration_task.delay(instance.id)



@receiver(post_delete, sender=WorkflowTask)
def update_workflow_status_on_delete(sender, instance, **kwargs):
    from .services import WorkflowService
    try:
        WorkflowService.refresh_instance_status(instance.workflow)
    except WorkflowInstance.DoesNotExist:
        pass  # процесс удаляется вместе с задачами


@receiver(post_save, sender=WorkflowTask)
def sync_wbs_status_signal(sender, instance, **kwargs):
    """
    Синхронизирует статус WBS задачи при изменении статуса Workflow задачи.
    """
    from .services import WorkflowService
    WorkflowService.sync_wbs_status(instance)

# Logging signals removed from models to avoid incorrect attribution. 
# Logging is now handled in views.py where request.user is available.

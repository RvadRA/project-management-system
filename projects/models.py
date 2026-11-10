from django.db import models
from django.conf import settings


class GlobalSetting(models.Model):
    """
    Key-Value store for system-wide settings manageable by Admins.
    """
    key = models.CharField(max_length=100, unique=True)
    value = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.key}: {self.value}"

    @classmethod
    def get_value(cls, key, default=None):
        try:
            return cls.objects.get(key=key).value
        except cls.DoesNotExist:
            return default


class Project(models.Model):
    STATUS_CHOICES = [
        ('DRAFT', 'Черновик'),
        ('ACTIVE', 'Активен'),
        ('AT_RISK', 'Под угрозой'),
        ('ON_HOLD', 'Приостановлен'),
        ('COMPLETED', 'Завершён'),
        ('CANCELLED', 'Отменён'),
    ]
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    domain = models.CharField(max_length=100, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, default='DRAFT', choices=STATUS_CHOICES)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='managed_projects',
    )
    calendar = models.ForeignKey(
        'plans.WorkCalendar', on_delete=models.SET_NULL, 
        null=True, blank=True, related_name='projects'
    )
    budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    risks = models.ManyToManyField('plans.Risk', blank=True, related_name='projects')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    def participations_qs(self):
        """История участия сотрудников в проекте (matching.ProjectParticipation)."""
        from matching.models import ProjectParticipation
        return ProjectParticipation.objects.filter(project=self)


class ProjectMember(models.Model):
    ROLE_CHOICES = [
        ('MANAGER', 'Менеджер'),
        ('DEVELOPER', 'Разработчик'),
        ('ANALYST', 'Аналитик'),
        ('DESIGNER', 'Дизайнер'),
        ('QA', 'Тестировщик'),
    ]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE, related_name='project_memberships',
    )
    role = models.CharField(max_length=30, choices=ROLE_CHOICES, default='DEVELOPER')
    role_ref = models.ForeignKey('plans.ProjectRole', on_delete=models.SET_NULL, null=True, blank=True, related_name='memberships')
    allocation_percentage = models.IntegerField(default=100, help_text="Процент занятости в этом проекте")
    joined_at = models.DateField(auto_now_add=True)

    # Права участника внутри проекта (настраиваются менеджером проекта флажками).
    # Для менеджеров проекта (role == 'MANAGER') все права считаются включёнными.
    can_view_all_tasks = models.BooleanField(default=False, help_text="Видит все задачи проекта, а не только свои")
    can_edit_tasks = models.BooleanField(default=False, help_text="Создаёт и редактирует задачи, этапы и процессы")
    can_assign_tasks = models.BooleanField(default=False, help_text="Назначает исполнителей на задачи")
    can_view_files = models.BooleanField(default=True, help_text="Видит файлы и базу знаний проекта")
    can_edit_files = models.BooleanField(default=False, help_text="Загружает, изменяет и удаляет файлы проекта")
    can_manage_members = models.BooleanField(default=False, help_text="Добавляет и исключает участников")

    class Meta:
        unique_together = ('project', 'user')

    def __str__(self):
        return f"{self.user.username} @ {self.project.name} ({self.role})"

    @property
    def is_manager(self):
        return self.role == 'MANAGER'


class PlanningBlock(models.Model):
    name = models.CharField(max_length=255)
    domain = models.CharField(max_length=100, blank=True)
    is_template = models.BooleanField(default=False)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')
    order = models.PositiveIntegerField(default=0)
    process_template = models.ForeignKey('workflows.WorkflowTemplate', on_delete=models.SET_NULL, null=True, blank=True, related_name='planning_blocks')
    # Из какого шаблона каталога создан этап — по нему считается статистика использования пакета
    source_template = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name='derived_blocks',
        limit_choices_to={'is_template': True},
    )

    # Metadata
    avg_duration = models.PositiveIntegerField(null=True, blank=True, help_text="Средняя длительность в днях")
    complexity = models.CharField(max_length=20, default='MEDIUM', choices=[
        ('LOW', 'Низкая'), ('MEDIUM', 'Средняя'), ('HIGH', 'Высокая'), ('CRITICAL', 'Критическая')
    ])
    success_rate = models.FloatField(default=1.0, help_text="Показатель успешности (0.0 - 1.0)")
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE,
        null=True, blank=True, related_name='blocks',
    )
    calendar = models.ForeignKey(
        'plans.WorkCalendar', on_delete=models.SET_NULL, 
        null=True, blank=True, related_name='blocks'
    )
    typical_risks = models.ManyToManyField('plans.Risk', blank=True, related_name='typical_in_blocks')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({'Template' if self.is_template else 'Project: ' + str(self.project)})"


class Task(models.Model):
    STATUS_CHOICES = [
        ('TODO', 'К выполнению'),
        ('IN_PROGRESS', 'В работе'),
        ('REVIEW', 'На проверке'),
        ('DONE', 'Выполнено'),
    ]
    block = models.ForeignKey(PlanningBlock, on_delete=models.CASCADE, related_name='tasks')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='subtasks')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    duration_days = models.IntegerField(default=1)
    start_offset_days = models.IntegerField(default=0, help_text="Количество дней от начала этапа")
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='project_tasks',
    )
    status = models.CharField(max_length=20, default='TODO', choices=STATUS_CHOICES)
    order = models.PositiveIntegerField(default=0)
    process_template = models.ForeignKey('workflows.WorkflowTemplate', on_delete=models.SET_NULL, null=True, blank=True, related_name='planning_tasks')
    weight = models.PositiveIntegerField(default=1, help_text="Вес задачи для расчета прогресса")
    
    # New fields
    priority = models.CharField(max_length=20, default='MEDIUM', choices=[
        ('LOW', 'Низкий'), ('MEDIUM', 'Средний'), ('HIGH', 'Высокий'), ('URGENT', 'Срочный')
    ])
    estimated_hours = models.FloatField(default=0.0)
    risk_level = models.CharField(max_length=20, default='LOW', choices=[
        ('LOW', 'Низкий'), ('MEDIUM', 'Средний'), ('HIGH', 'Высокий')
    ])
    
    workflow_task = models.OneToOneField(
        'workflows.WorkflowTask',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='wbs_task'
    )
    is_critical = models.BooleanField(default=False)
    depends_on = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='dependent_tasks')

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # Auto-prioritization check
        keywords = ["срочно", "критично", "горит", "в первую очередь", "авария", "срочно сделать", "asap"]
        text = f"{self.name or ''} {self.description or ''}".lower()
        is_urgent = any(kw in text for kw in keywords)
        # order сбрасываем только в момент повышения приоритета, а не при каждом сохранении
        if is_urgent and (self._state.adding or self.priority != 'URGENT'):
            self.priority = 'URGENT'
            self.order = 0
        super().save(*args, **kwargs)


class TaskDependency(models.Model):
    DEPENDENCY_TYPES = [
        ('FS', 'Finish-to-Start'),
        ('SS', 'Start-to-Start'),
        ('FF', 'Finish-to-Finish'),
        ('SF', 'Start-to-Finish'),
    ]
    from_task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='outgoing_dependencies')
    to_task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='incoming_dependencies')
    type = models.CharField(max_length=10, default='FS', choices=DEPENDENCY_TYPES)

    def __str__(self):
        return f"{self.from_task.name} -> {self.to_task.name} ({self.type})"


class AuditLog(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='audit_logs')
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True,
        related_name='audit_logs',
    )
    action = models.CharField(max_length=255)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {self.action}"


class KnowledgeMaterial(models.Model):
    """
    Документ файлового хранилища / базы знаний.
    project=None — общая база знаний организации, иначе — файл конкретного проекта
    (доступ определяется правами can_view_files / can_edit_files участника).
    """
    CATEGORY_CHOICES = [
        ('SPEC', 'Техническое задание'),
        ('DOC', 'Документ'),
        ('INSTRUCTION', 'Инструкция / регламент'),
        ('OTHER', 'Прочее'),
    ]
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='DOC')
    description = models.TextField(blank=True)
    file = models.FileField(upload_to='knowledge_base/', null=True, blank=True)
    text_instruction = models.TextField(blank=True)
    tags = models.JSONField(default=list, blank=True)
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='knowledge_materials')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

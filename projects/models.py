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
        ('DRAFT', 'Draft'),
        ('ACTIVE', 'Active'),
        ('AT_RISK', 'At Risk'),
        ('ON_HOLD', 'On Hold'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
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


class ProjectMember(models.Model):
    ROLE_CHOICES = [
        ('MANAGER', 'Manager'),
        ('DEVELOPER', 'Developer'),
        ('ANALYST', 'Analyst'),
        ('DESIGNER', 'Designer'),
        ('QA', 'QA Engineer'),
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

    class Meta:
        unique_together = ('project', 'user')

    def __str__(self):
        return f"{self.user.username} @ {self.project.name} ({self.role})"


class PlanningBlock(models.Model):
    name = models.CharField(max_length=255)
    domain = models.CharField(max_length=100, blank=True)
    is_template = models.BooleanField(default=False)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='children')
    order = models.PositiveIntegerField(default=0)
    process_template = models.ForeignKey('workflows.WorkflowTemplate', on_delete=models.SET_NULL, null=True, blank=True, related_name='planning_blocks')
    
    # Metadata
    avg_duration = models.PositiveIntegerField(null=True, blank=True, help_text="Средняя длительность в днях")
    complexity = models.CharField(max_length=20, default='MEDIUM', choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High'), ('CRITICAL', 'Critical')
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
        ('TODO', 'To Do'),
        ('IN_PROGRESS', 'In Progress'),
        ('REVIEW', 'Review'),
        ('DONE', 'Done'),
    ]
    block = models.ForeignKey(PlanningBlock, on_delete=models.CASCADE, related_name='tasks')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='subtasks')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    duration_days = models.IntegerField(default=1)
    start_offset_days = models.IntegerField(default=0, help_text="Days after block start")
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
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High'), ('URGENT', 'Urgent')
    ])
    estimated_hours = models.FloatField(default=0.0)
    risk_level = models.CharField(max_length=20, default='LOW', choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High')
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

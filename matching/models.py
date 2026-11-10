from django.db import models
from django.conf import settings


class Skill(models.Model):
    name = models.CharField(max_length=100, unique=True)
    category = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return self.name


class EmployeeProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile')
    position = models.CharField(max_length=100, blank=True)
    domain = models.CharField(max_length=100, blank=True)
    hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    bio = models.TextField(blank=True)
    skills = models.ManyToManyField(Skill, through='EmployeeSkill', blank=True)
    telegram_chat_id = models.CharField(max_length=100, blank=True, help_text="ID чата в Telegram для уведомлений")
    notify_telegram = models.BooleanField(default=True, verbose_name="Уведомления в Telegram")
    notify_email = models.BooleanField(default=True, verbose_name="Уведомления по электронной почте")
    notify_daily_digest = models.BooleanField(default=True, verbose_name="Ежедневный дайджест")

    def __str__(self):
        return f"Profile: {self.user.get_full_name() or self.user.username}"

    def active_entries(self):
        """Записи загрузки, занимающие сотрудника (проекты завершены или отменены — не в счёт)."""
        from .capacity import INACTIVE_PROJECT_STATUSES
        return self.workload_entries.exclude(project__status__in=INACTIVE_PROJECT_STATUSES)

    @property
    def current_workload_percentage(self):
        """Занятость сотрудника сегодня: сумма загрузок по активным записям."""
        import datetime
        from django.db.models import Sum
        today = datetime.date.today()
        total = self.active_entries().filter(
            start_date__lte=today, end_date__gte=today
        ).aggregate(total=Sum('load_percent'))['total'] or 0
        return round(float(total), 1)

    def _open_tasks(self):
        from workflows.models import WorkflowTask
        return WorkflowTask.objects.filter(
            assigned_to=self.user, status__in=['TODO', 'IN_PROGRESS', 'REVIEW', 'ESCALATED'],
        )

    @property
    def active_task_hours(self):
        """Оценка трудозатрат открытых задач, ч (поле «Трудозатраты» задачи; SLA — это срок, а не работа)."""
        from django.db.models import Sum
        return round(self._open_tasks().aggregate(total=Sum('estimated_hours'))['total'] or 0, 1)

    @property
    def open_task_count(self):
        return self._open_tasks().count()

    @property
    def unestimated_task_count(self):
        return self._open_tasks().filter(estimated_hours__lte=0).count()


class EmployeeSkill(models.Model):
    LEVEL_CHOICES = [
        (1, 'Начинающий'),
        (2, 'Базовый'),
        (3, 'Средний'),
        (4, 'Продвинутый'),
        (5, 'Эксперт'),
    ]
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name='employee_skills')
    skill = models.ForeignKey(Skill, on_delete=models.CASCADE)
    level = models.IntegerField(choices=LEVEL_CHOICES, default=1)
    years_experience = models.FloatField(default=0)

    class Meta:
        unique_together = ('employee', 'skill')

    def __str__(self):
        return f"{self.employee} — {self.skill.name} (lvl {self.level})"


class WorkloadEntry(models.Model):
    """Запись о занятости сотрудника в конкретный период."""
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name='workload_entries')
    project = models.ForeignKey('projects.Project', on_delete=models.CASCADE, null=True, blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    load_percent = models.IntegerField(default=100, help_text="Процент загрузки 0-100")
    note = models.CharField(max_length=255, blank=True)  # напр. "Отпуск"

    def __str__(self):
        return f"{self.employee} | {self.start_date}–{self.end_date} ({self.load_percent}%)"


class ProjectParticipation(models.Model):
    """История участия сотрудника в завершённых проектах."""
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name='participations')
    project = models.ForeignKey('projects.Project', on_delete=models.CASCADE)
    role = models.CharField(max_length=100)
    performance_score = models.FloatField(default=0, help_text="Оценка результативности 0.0–1.0 (0 — не оценён)")
    comment = models.TextField(blank=True, help_text="Комментарий руководителя к оценке")
    rated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='given_ratings',
    )
    rated_at = models.DateTimeField(null=True, blank=True)
    joined_at = models.DateField(null=True, blank=True)
    left_at = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = ('employee', 'project')

    def __str__(self):
        return f"{self.employee} @ {self.project.name} as {self.role}"


class EmployeeCertificate(models.Model):
    """Сертификаты и подтверждённые квалификации сотрудника."""
    employee = models.ForeignKey(
        EmployeeProfile,
        on_delete=models.CASCADE,
        related_name='certificates'
    )
    name = models.CharField(max_length=255, help_text='Название сертификата')
    issuer = models.CharField(max_length=255, blank=True, help_text='Выдавшая организация')
    credential_id = models.CharField(max_length=100, blank=True, help_text='Номер/ID сертификата')
    issued_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True, help_text='Дата истечения (пусто = бессрочный)')
    certificate_url = models.URLField(blank=True, help_text='Ссылка на онлайн-верификацию')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-issued_date']
        verbose_name = 'Сертификат'
        verbose_name_plural = 'Сертификаты'

    def __str__(self):
        return self.name

    @property
    def is_expired(self):
        # Поле используется CertificateSerializer; без него выдача профиля падала с 500
        import datetime
        return bool(self.expiry_date and self.expiry_date < datetime.date.today())


class EmployeeUnavailability(models.Model):
    TYPES = [
        ('VACATION', 'Отпуск'),
        ('SICK_LEAVE', 'Больничный'),
        ('UNPAID_LEAVE', 'За свой счет'),
        ('OTHER', 'Другое'),
    ]
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name='unavailability')
    type = models.CharField(max_length=20, choices=TYPES, default='VACATION')
    start_date = models.DateField()
    end_date = models.DateField()
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Недоступность сотрудника"
        verbose_name_plural = "Недоступность сотрудников"
        ordering = ['-start_date']

    def __str__(self):
        return f"{self.employee.user.username}: {self.get_type_display()} ({self.start_date} - {self.end_date})"


class EmployeeExperienceEmbedding(models.Model):
    """Cached local embedding of profile facts used by task semantic search."""
    employee = models.OneToOneField(EmployeeProfile, on_delete=models.CASCADE, related_name='experience_embedding')
    source_hash = models.CharField(max_length=64)
    vector = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)

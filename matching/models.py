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
    notify_email = models.BooleanField(default=True, verbose_name="Уведомления по Email")
    notify_daily_digest = models.BooleanField(default=True, verbose_name="Ежедневный дайджест")

    def __str__(self):
        return f"Profile: {self.user.get_full_name() or self.user.username}"

    @property
    def current_workload_percentage(self):
        """
        Dynamic workload calculation:
        (Project Commitments + Active Task Hours) / Monthly Capacity (from GlobalSetting)
        """
        from projects.models import GlobalSetting
        from workflows.models import WorkflowTask
        from django.db.models import Sum
        import datetime
        today = datetime.date.today()
        
        project_load = self.workload_entries.filter(
            start_date__lte=today, end_date__gte=today
        ).aggregate(total=Sum('load_percent'))['total'] or 0
        
        capacity = GlobalSetting.get_value('MONTHLY_CAPACITY_HOURS', '160')
        try:
            capacity_float = float(capacity)
        except ValueError:
            capacity_float = 160.0

        # If project_load is already in %, we just return it. 
        # But if we wanted to calculate based on hours: (hours / capacity_float) * 100
        # For now, workload_entries store %, so we just return it.
        return round(float(project_load), 1)

    @property
    def active_task_hours(self):
        from workflows.models import WorkflowTask
        from django.db.models import Sum
        hours = WorkflowTask.objects.filter(
            assigned_to=self.user,
            status__in=['TODO', 'IN_PROGRESS', 'REVIEW']
        ).aggregate(total=Sum('sla_hours'))['total'] or 0
        return int(hours)



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
    performance_score = models.FloatField(default=0, help_text="Оценка результативности 0.0–1.0")
    joined_at = models.DateField(null=True, blank=True)
    left_at = models.DateField(null=True, blank=True)

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

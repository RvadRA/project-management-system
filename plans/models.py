from django.db import models
from django.conf import settings


class WorkCalendar(models.Model):
    name = models.CharField(max_length=100)
    is_default = models.BooleanField(default=False)
    
    def __str__(self):
        return self.name


class CalendarHoliday(models.Model):
    calendar = models.ForeignKey(WorkCalendar, on_delete=models.CASCADE, related_name='holidays')
    date = models.DateField()
    name = models.CharField(max_length=255, blank=True)
    
    class Meta:
        unique_together = ('calendar', 'date')
    
    def __str__(self):
        return f"{self.calendar.name} - {self.date}"


class Risk(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    probability = models.CharField(max_length=20, choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High')
    ], default='MEDIUM')
    impact = models.CharField(max_length=20, choices=[
        ('LOW', 'Low'), ('MEDIUM', 'Medium'), ('HIGH', 'High')
    ], default='MEDIUM')
    mitigation = models.TextField(blank=True)
    
    def __str__(self):
        return self.name


class ProjectRole(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    
    def __str__(self):
        return self.name


class ProjectDomain(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    
    def __str__(self):
        return self.name


# Legacy/Link models

class PlanningBlockRisk(models.Model):
    block = models.ForeignKey('projects.PlanningBlock', on_delete=models.CASCADE, related_name='risks')
    risk = models.ForeignKey(Risk, on_delete=models.CASCADE)
    
    def __str__(self):
        return f"{self.block.name} - {self.risk.name}"


class TaskRequiredRole(models.Model):
    task = models.ForeignKey('projects.Task', on_delete=models.CASCADE, related_name='required_roles')
    role = models.ForeignKey(ProjectRole, on_delete=models.CASCADE)
    
    class Meta:
        unique_together = ('task', 'role')
    
    def __str__(self):
        return f"{self.task.name} requires {self.role.name}"
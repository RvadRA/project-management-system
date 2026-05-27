from django.contrib import admin
from .models import WorkCalendar, CalendarHoliday, Risk, ProjectRole, PlanningBlockRisk, TaskRequiredRole

@admin.register(WorkCalendar)
class WorkCalendarAdmin(admin.ModelAdmin):
    list_display = ['name', 'is_default']
    list_filter = ['is_default']


@admin.register(CalendarHoliday)
class CalendarHolidayAdmin(admin.ModelAdmin):
    list_display = ['calendar', 'date', 'name']
    list_filter = ['calendar']


@admin.register(Risk)
class RiskAdmin(admin.ModelAdmin):
    list_display = ['name', 'probability', 'impact']
    list_filter = ['probability', 'impact']


@admin.register(ProjectRole)
class ProjectRoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'description']


@admin.register(PlanningBlockRisk)
class PlanningBlockRiskAdmin(admin.ModelAdmin):
    list_display = ['block', 'risk']
    list_filter = ['block']


@admin.register(TaskRequiredRole)
class TaskRequiredRoleAdmin(admin.ModelAdmin):
    list_display = ['task', 'role']
    list_filter = ['role']
from django.contrib import admin
from .models import Skill, EmployeeProfile, EmployeeSkill, WorkloadEntry, ProjectParticipation


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
    list_display = ['name', 'category']
    search_fields = ['name', 'category']


@admin.register(EmployeeProfile)
class EmployeeProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'position', 'hourly_rate']
    search_fields = ['user__username', 'user__first_name', 'position']


@admin.register(EmployeeSkill)
class EmployeeSkillAdmin(admin.ModelAdmin):
    list_display = ['employee', 'skill', 'level', 'years_experience']
    list_filter = ['level']


@admin.register(WorkloadEntry)
class WorkloadEntryAdmin(admin.ModelAdmin):
    list_display = ['employee', 'project', 'start_date', 'end_date', 'load_percent']


@admin.register(ProjectParticipation)
class ProjectParticipationAdmin(admin.ModelAdmin):
    list_display = ['employee', 'project', 'role', 'performance_score']

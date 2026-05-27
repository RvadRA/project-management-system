from django.contrib import admin
from .models import Project, ProjectMember, PlanningBlock, Task, AuditLog


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'status', 'domain', 'manager', 'calendar', 'start_date', 'end_date']
    list_filter = ['status', 'domain', 'calendar']
    search_fields = ['name', 'description']


@admin.register(ProjectMember)
class ProjectMemberAdmin(admin.ModelAdmin):
    list_display = ['project', 'user', 'role', 'joined_at']
    list_filter = ['role']


@admin.register(PlanningBlock)
class PlanningBlockAdmin(admin.ModelAdmin):
    list_display = ['name', 'domain', 'is_template', 'project', 'calendar']
    list_filter = ['is_template', 'domain', 'calendar']
    filter_horizontal = ['typical_risks']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['name', 'block', 'status', 'assigned_to', 'start_date', 'end_date']
    list_filter = ['status']


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['project', 'user', 'action', 'created_at']
    list_filter = ['action']
    ordering = ['-created_at']

from django.contrib import admin
from .models import WorkflowTemplate, WorkflowTaskTemplate, WorkflowInstance, WorkflowTask, TaskReport, TaskAttachment


class WorkflowTaskTemplateInline(admin.TabularInline):
    model = WorkflowTaskTemplate
    extra = 0


@admin.register(WorkflowTemplate)
class WorkflowTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'version', 'is_published', 'created_by', 'created_at']
    list_filter = ['is_published']
    inlines = [WorkflowTaskTemplateInline]


@admin.register(WorkflowInstance)
class WorkflowInstanceAdmin(admin.ModelAdmin):
    list_display = ['name', 'template', 'project', 'status', 'started_at']
    list_filter = ['status']


@admin.register(WorkflowTask)
class WorkflowTaskAdmin(admin.ModelAdmin):
    list_display = ['name', 'workflow', 'status', 'assigned_to', 'due_date', 'order']
    list_filter = ['status', 'task_type']

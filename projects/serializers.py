from django.db import models
from django.utils import timezone
from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Project, ProjectMember, PlanningBlock, Task, TaskDependency, AuditLog, GlobalSetting, KnowledgeMaterial


from accounts.serializers import UserNestedSerializer
from plans.serializers import ProjectRoleSerializer, RiskSerializer, TaskRequiredRoleSerializer, WorkCalendarSerializer
from workflows.serializers import WorkflowTemplateSerializer
from . import access

User = get_user_model()


class GlobalSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalSetting
        fields = ['id', 'key', 'value', 'description', 'updated_at']
        read_only_fields = ['updated_at']


def restricted_task_user(context, project):
    """
    Возвращает пользователя, если ему в этом проекте видны только собственные задачи,
    иначе None (видны все). Результат кэшируется в контексте сериализатора.
    """
    request = context.get('request')
    if request is None or project is None:
        return None
    cache = context.setdefault('_task_scope', {})
    if project.id not in cache:
        sees_all = access.has_project_perm(request.user, project, 'can_view_all_tasks')
        cache[project.id] = None if sees_all else request.user
    return cache[project.id]


class ProjectMemberSerializer(serializers.ModelSerializer):
    user = UserNestedSerializer(read_only=True)

    role_info = ProjectRoleSerializer(source='role_ref', read_only=True)
    is_manager = serializers.BooleanField(read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = ProjectMember
        fields = [
            'id', 'user', 'role', 'role_ref', 'role_info', 'allocation_percentage', 'joined_at',
            'is_manager', 'permissions',
        ]
        read_only_fields = ['joined_at']

    def get_permissions(self, obj):
        # У менеджера проекта все права включены независимо от флажков
        return {key: bool(obj.is_manager or getattr(obj, key)) for key in access.PROJECT_PERMISSION_KEYS}


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = AuditLog
        fields = ['id', 'project', 'user', 'username', 'action', 'detail', 'created_at']
        read_only_fields = ['created_at']


class ProjectSerializer(serializers.ModelSerializer):
    manager = UserNestedSerializer(read_only=True)
    manager_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source='manager', write_only=True, required=False, allow_null=True
    )
    manager_allocation = serializers.IntegerField(write_only=True, required=False, min_value=1, max_value=100)
    members = ProjectMemberSerializer(many=True, read_only=True)
    progress_percentage = serializers.SerializerMethodField()
    calendar_info = WorkCalendarSerializer(source='calendar', read_only=True)
    risks_info = RiskSerializer(source='risks', many=True, read_only=True)
    my_permissions = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'description', 'domain', 'start_date', 'end_date',
            'status', 'manager', 'manager_id', 'manager_allocation', 'members', 'budget',
            'calendar', 'calendar_info', 'risks', 'risks_info',
            'progress_percentage', 'my_permissions', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_my_permissions(self, obj):
        request = self.context.get('request')
        if request is None:
            return None
        return access.project_permissions_for(request.user, obj)

    def get_progress_percentage(self, obj):
        from workflows.models import WorkflowTask
        from django.db.models import Sum, Q, Case, When, Value, FloatField
        
        # In canonical architecture, progress comes ONLY from the execution layer (WorkflowTasks)
        workflow_tasks = WorkflowTask.objects.filter(workflow__project=obj)
        
        total_weight = workflow_tasks.aggregate(s=Sum('weight'))['s'] or 0
        
        if total_weight == 0:
            # If no workflow tasks exist, check if there are any planning tasks
            # If there are planning tasks but no workflow, progress is 0%
            return 0
 
        # Partial progress multipliers for Execution
        # TODO=0, IN_PROGRESS=0.5, REVIEW=0.8, DONE=1.0
        def calculate_done_weight(queryset):
            return queryset.annotate(
                progress_val=Case(
                    When(status='DONE', then=Value(1.0)),
                    When(status='REVIEW', then=Value(0.8)),
                    When(status='IN_PROGRESS', then=Value(0.5)),
                    default=Value(0.0),
                    output_field=FloatField()
                )
            ).aggregate(s=Sum(models.F('weight') * models.F('progress_val')))['s'] or 0
            
        done_weight = calculate_done_weight(workflow_tasks)
        
        p = round((done_weight / total_weight) * 100)
        
        # Auto-update status logic based on execution
        total_tasks_count = workflow_tasks.count()
        overdue_tasks = workflow_tasks.filter(Q(status='ESCALATED') | Q(due_date__lt=timezone.now())).exclude(status='DONE').count()
        
        new_status = obj.status
        if total_tasks_count == 0:
            if obj.status not in ['ACTIVE', 'AT_RISK', 'COMPLETED']:
                new_status = 'DRAFT'
        elif p >= 100:
            new_status = 'COMPLETED'
        elif overdue_tasks > 0:
            new_status = 'AT_RISK'
        elif p > 0 and obj.status == 'DRAFT':
            new_status = 'ACTIVE'
            
        # Вручную поставленные «На паузе» и «Отменён» автоматикой не перезаписываем
        if new_status != obj.status and obj.status not in ('ON_HOLD', 'CANCELLED'):
            obj.status = new_status
            obj.save(update_fields=['status'])
            
        return min(p, 100)

    def create(self, validated_data):
        manager_allocation = validated_data.pop('manager_allocation', None)
        instance = super().create(validated_data)
        if manager_allocation is not None:
            validated_data['manager_allocation'] = manager_allocation
        return instance

    def update(self, instance, validated_data):
        manager_allocation = validated_data.pop('manager_allocation', None)
        instance = super().update(instance, validated_data)
        if manager_allocation is not None:
            validated_data['manager_allocation'] = manager_allocation
        return instance


class TaskDependencySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskDependency
        fields = '__all__'


class TaskSerializer(serializers.ModelSerializer):
    outgoing_dependencies = TaskDependencySerializer(many=True, read_only=True)
    incoming_dependencies = TaskDependencySerializer(many=True, read_only=True)
    required_roles = TaskRequiredRoleSerializer(many=True, read_only=True)
    process_template_info = WorkflowTemplateSerializer(source='process_template', read_only=True)
    workflow_status = serializers.CharField(source='workflow_task.status', read_only=True)
    assignee_workload = serializers.SerializerMethodField()
    subtasks = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            'id', 'block', 'parent', 'name', 'description', 'duration_days',
            'start_offset_days', 'start_date', 'end_date', 'assigned_to',
            'status', 'order', 'process_template', 'process_template_info',
            'weight', 'priority', 'estimated_hours', 'risk_level',
            'workflow_task', 'workflow_status', 'is_critical', 'subtasks',
            'outgoing_dependencies', 'incoming_dependencies', 'required_roles',
            'assignee_workload'
        ]

    def get_subtasks(self, obj):
        subtasks = obj.subtasks.all()
        only_user = restricted_task_user(self.context, obj.block.project)
        if only_user is not None:
            subtasks = subtasks.filter(assigned_to=only_user)
        return TaskSerializer(subtasks, many=True, context=self.context).data

    def get_assignee_workload(self, obj):
        if obj.assigned_to:
            from matching.models import EmployeeProfile
            try:
                profile = EmployeeProfile.objects.get(user=obj.assigned_to)
                return profile.current_workload_percentage
            except EmployeeProfile.DoesNotExist:
                return 0
        return 0


class PlanningBlockSerializer(serializers.ModelSerializer):
    tasks = serializers.SerializerMethodField()
    analytics = serializers.SerializerMethodField()
    typical_risks = RiskSerializer(many=True, read_only=True)
    calendar_info = WorkCalendarSerializer(source='calendar', read_only=True)
    process_template_info = WorkflowTemplateSerializer(source='process_template', read_only=True)
    children = serializers.SerializerMethodField()

    class Meta:
        model = PlanningBlock
        fields = '__all__'

    def get_tasks(self, obj):
        only_user = restricted_task_user(self.context, obj.project)
        if only_user is not None:
            # Исполнитель видит только свои задачи; вложенные показываем плоско,
            # если родительская задача ему не назначена
            tasks = obj.tasks.filter(assigned_to=only_user).exclude(parent__assigned_to=only_user)
        else:
            # Only return root tasks for the block
            tasks = obj.tasks.filter(parent__isnull=True)
        return TaskSerializer(tasks, many=True, context=self.context).data

    def get_children(self, obj):
        # Prevent deep recursion if needed, but for WBS it's fine
        return PlanningBlockSerializer(obj.children.all(), many=True, context=self.context).data

    def get_analytics(self, obj):
        if not obj.is_template:
            return None
            
        # Find all blocks derived from this template (same name and domain)
        # In a more advanced system, we'd have a 'template' FK on PlanningBlock
        derived_blocks = PlanningBlock.objects.filter(
            name=obj.name, 
            domain=obj.domain, 
            is_template=False
        ).prefetch_related('tasks')
        
        if not derived_blocks.exists():
            return {
                'avg_actual_duration': obj.avg_duration or 0,
                'success_rate': obj.success_rate or 1.0,
                'usage_count': 0
            }
            
        total_days = 0
        blocks_with_tasks = 0
        on_time_tasks = 0
        total_completed_tasks = 0
        
        for block in derived_blocks:
            tasks = block.tasks.all()
            if not tasks:
                continue
                
            # Duration: max end_date - min start_date
            starts = [t.start_date for t in tasks if t.start_date]
            ends = [t.end_date for t in tasks if t.end_date]
            if starts and ends:
                duration = (max(ends) - min(starts)).days
                total_days += duration
                blocks_with_tasks += 1
            
            # Success Rate: % of tasks completed by their end_date
            # For this simulation, we'll look at 'DONE' tasks
            from workflows.models import WorkflowTask
            # This is tricky because PlanningBlock tasks and WorkflowTasks are separate.
            # Usually we'd link them. For now, let's use a heuristic or just return template defaults
            # if we can't find direct workflow correlations.
            
        avg_dur = round(total_days / blocks_with_tasks) if blocks_with_tasks > 0 else (obj.avg_duration or 0)
        
        return {
            'avg_actual_duration': avg_dur,
            'success_rate': obj.success_rate or 0.85,
            'usage_count': derived_blocks.count()
        }


class KnowledgeMaterialSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField(read_only=True)
    project_name = serializers.SerializerMethodField(read_only=True)
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    file_name = serializers.SerializerMethodField(read_only=True)
    file_size = serializers.SerializerMethodField(read_only=True)
    can_edit = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = KnowledgeMaterial
        fields = '__all__'
        read_only_fields = ['created_by']

    def get_file_name(self, obj):
        import os
        return os.path.basename(obj.file.name) if obj.file else None

    def get_file_size(self, obj):
        if not obj.file:
            return None
        try:
            return obj.file.size
        except (OSError, ValueError):
            return None

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request is None:
            return False
        return can_edit_material(request.user, obj)

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_project_name(self, obj):
        if obj.project:
            return obj.project.name
        return None


def can_edit_material(user, material):
    """
    Файл проекта меняют менеджеры проекта и участники с правом can_edit_files.
    Материал общей базы знаний — администратор / руководитель проектов либо автор-менеджер.
    """
    if material.project_id:
        return access.has_project_perm(user, material.project, 'can_edit_files')
    if access.has_global_access(user):
        return True
    return access.can_manage_library(user) and material.created_by_id == user.id

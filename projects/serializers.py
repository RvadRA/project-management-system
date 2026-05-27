from django.db import models
from django.utils import timezone
from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Project, ProjectMember, PlanningBlock, Task, TaskDependency, AuditLog, GlobalSetting


class GlobalSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalSetting
        fields = ['id', 'key', 'value', 'description', 'updated_at']
        read_only_fields = ['updated_at']
from accounts.serializers import UserNestedSerializer
from plans.serializers import ProjectRoleSerializer, RiskSerializer, TaskRequiredRoleSerializer, WorkCalendarSerializer
from workflows.serializers import WorkflowTemplateSerializer

User = get_user_model()


class ProjectMemberSerializer(serializers.ModelSerializer):
    user = UserNestedSerializer(read_only=True)

    role_info = ProjectRoleSerializer(source='role_ref', read_only=True)

    class Meta:
        model = ProjectMember
        fields = ['id', 'user', 'role', 'role_ref', 'role_info', 'allocation_percentage', 'joined_at']
        read_only_fields = ['joined_at']


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

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'description', 'domain', 'start_date', 'end_date',
            'status', 'manager', 'manager_id', 'manager_allocation', 'members', 'budget',
            'calendar', 'calendar_info', 'risks', 'risks_info',
            'progress_percentage', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

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
            
        if new_status != obj.status and obj.status != 'ON_HOLD':
            obj.status = new_status
            obj.save(update_fields=['status'])
            
        return min(p, 100)


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
        return TaskSerializer(obj.subtasks.all(), many=True).data

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
        # Only return root tasks for the block
        return TaskSerializer(obj.tasks.filter(parent__isnull=True), many=True).data

    def get_children(self, obj):
        # Prevent deep recursion if needed, but for WBS it's fine
        return PlanningBlockSerializer(obj.children.all(), many=True).data

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

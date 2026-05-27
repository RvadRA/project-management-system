from rest_framework import serializers
from .models import (
    WorkflowTemplate, WorkflowTaskTemplate,
    WorkflowInstance, WorkflowTask, TaskReport, TaskAttachment,
)

# Expose on the model class for view-level validation
WorkflowTask.STATUS_CHOICES = WorkflowTask.STATUS_CHOICES  # noqa: keep for views import


class WorkflowTaskTemplateSerializer(serializers.ModelSerializer):
    frontend_id = serializers.CharField(required=False, write_only=True)
    depends_on_fids = serializers.ListField(child=serializers.CharField(), required=False, write_only=True)

    class Meta:
        model = WorkflowTaskTemplate
        fields = '__all__'
        extra_kwargs = {'template': {'required': False}}


class WorkflowTemplateSerializer(serializers.ModelSerializer):
    task_templates = WorkflowTaskTemplateSerializer(many=True, required=False)

    class Meta:
        model = WorkflowTemplate
        fields = '__all__'

    def create(self, validated_data):
        task_templates_data = validated_data.pop('task_templates', [])
        template = WorkflowTemplate.objects.create(**validated_data)
        
        # First pass: create all tasks
        created_tasks = {}
        for task_data in task_templates_data:
            depends_on_ids = task_data.pop('depends_on', []) # We'll handle this later if needed
            # For now, we assume frontend sends task_templates in a way we can create them.
            # But wait, depends_on in the frontend might refer to our own temporary IDs.
            
            # Simplified: just create them for now. 
            # We will improve this if we need complex dependencies.
            pass
            
        # Re-implementing correctly:
        return self.update(template, {'task_templates': task_templates_data})

    def update(self, instance, validated_data):
        task_templates_data = validated_data.pop('task_templates', None)
        
        # Update template fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if task_templates_data is not None:
            # Delete old tasks
            instance.task_templates.all().delete()
            
            # Map for dependency resolution (frontend ID -> created object)
            id_map = {}
            tasks_to_create = []

            for task_data in task_templates_data:
                # We expect 'frontend_id' if we want to resolve dependencies
                frontend_id = task_data.pop('frontend_id', None)
                depends_on_fids = task_data.pop('depends_on_fids', [])
                
                # Pop depends_on if it's there as a standard field to avoid issues
                task_data.pop('depends_on', None)
                
                task_obj = WorkflowTaskTemplate(template=instance, **task_data)
                tasks_to_create.append((task_obj, frontend_id, depends_on_fids))

            # Create all tasks first
            for task_obj, _, _ in tasks_to_create:
                task_obj.save()

            # Second pass: set dependencies
            # We need a map of frontend_id -> task_obj.id
            fid_to_obj = {f_id: t_obj for t_obj, f_id, _ in tasks_to_create if f_id}
            
            for task_obj, _, depends_on_fids in tasks_to_create:
                if depends_on_fids:
                    dep_tasks = [fid_to_obj[fid] for fid in depends_on_fids if fid in fid_to_obj]
                    task_obj.depends_on.set(dep_tasks)

        return instance


class TaskReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskReport
        fields = '__all__'


class TaskAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskAttachment
        fields = ['id', 'original_name', 'uploaded_by', 'uploaded_at', 'file']


class WorkflowTaskSerializer(serializers.ModelSerializer):
    report = TaskReportSerializer(read_only=True)
    attachments = TaskAttachmentSerializer(many=True, read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTask
        fields = '__all__'

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.username
        return None

    def get_is_overdue(self, obj):
        from django.utils import timezone
        if obj.due_date and obj.status not in ('DONE',):
            return timezone.now() > obj.due_date
        return False


class WorkflowInstanceSerializer(serializers.ModelSerializer):
    tasks = WorkflowTaskSerializer(many=True, read_only=True)
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowInstance
        fields = '__all__'

    def get_progress_percent(self, obj):
        tasks = obj.tasks.all()
        if not tasks:
            return 0
        from django.db.models import Sum
        total_w = tasks.aggregate(s=Sum('weight'))['s'] or 0
        if total_w == 0:
            return 0
        done_w = tasks.filter(status='DONE').aggregate(s=Sum('weight'))['s'] or 0
        return round(done_w / total_w * 100)

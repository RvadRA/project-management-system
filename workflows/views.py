from rest_framework import viewsets, status, serializers
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from projects.permissions import IsProjectManagerOrAdmin, CanUpdateTaskStatus
from django.utils import timezone
from django.db import models as django_models
from django.contrib.auth import get_user_model

from .models import WorkflowTemplate, WorkflowInstance, WorkflowTask, TaskReport, TaskAttachment, WorkflowTaskTemplate
from .serializers import (
    WorkflowTemplateSerializer, WorkflowInstanceSerializer,
    WorkflowTaskSerializer, TaskReportSerializer, TaskAttachmentSerializer,
    WorkflowTaskTemplateSerializer,
)
from .services import WorkflowService
User = get_user_model()


def _log(project, user, action, detail=None):
    if project:
        from projects.models import AuditLog
        AuditLog.objects.create(project=project, user=user, action=action, detail=detail or {})


class ProcessViewSet(viewsets.ModelViewSet):
    """
    /api/workflows/processes/
    WorkflowInstance = running process.
    """
    queryset = WorkflowInstance.objects.select_related(
        'template', 'project', 'created_by'
    ).prefetch_related(
        'tasks__report', 'tasks__attachments', 'tasks__assigned_to'
    ).all()
    serializer_class = WorkflowInstanceSerializer
    permission_classes = [IsAuthenticated, IsProjectManagerOrAdmin]

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role in ('ADMIN', 'MANAGER'):
            return qs
        member_project_ids = list(
            user.project_memberships.values_list('project_id', flat=True)
        )
        return qs.filter(
            django_models.Q(project_id__in=member_project_ids) |
            django_models.Q(project__isnull=True)
        )

    def perform_create(self, serializer):
        user = self.request.user
        data = self.request.data
        project_id = data.get('project')

        if user.role == 'EMPLOYEE':
            if not project_id:
                raise serializers.ValidationError("Сотрудник не может создавать независимые процессы.")
            from projects.models import Project
            is_manager = Project.objects.filter(id=project_id, members__user=user, members__role='MANAGER').exists()
            if not is_manager:
                raise serializers.ValidationError("Только менеджеры проекта могут создавать процессы.")

        template_id = data.get('template_id') or data.get('template')
        project = None
        if project_id:
            from projects.models import Project
            try:
                project = Project.objects.get(id=project_id)
            except Project.DoesNotExist:
                raise serializers.ValidationError("Проект не найден.")

        instance = serializer.save(
            created_by=self.request.user,
            started_at=timezone.now(),
            status='IN_PROGRESS',
        )
        
        _log(project, user, 'WORKFLOW_CREATED', {'workflow_name': instance.name})

        if template_id:
            try:
                template = WorkflowTemplate.objects.get(id=template_id)
                WorkflowService.create_process_from_template(
                    template=template,
                    project=project,
                    creator=user,
                    existing_instance=instance
                )
            except WorkflowTemplate.DoesNotExist:
                pass

    def perform_destroy(self, instance):
        user = self.request.user
        project = instance.project
        if user.role == 'EMPLOYEE':
            if not instance.project:
                raise serializers.ValidationError("Сотрудник не может удалять независимые процессы.")
            is_manager = instance.project.members.filter(user=user, role='MANAGER').exists()
            if not is_manager:
                raise serializers.ValidationError("Только менеджеры могут удалять этот процесс.")
        
        _log(project, user, 'WORKFLOW_DELETED', {'workflow_name': instance.name})
        instance.delete()


class WorkflowTemplateViewSet(viewsets.ModelViewSet):
    queryset = WorkflowTemplate.objects.prefetch_related('task_templates').all()
    serializer_class = WorkflowTemplateSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAuthenticated(), IsProjectManagerOrAdmin()]
        return [IsAuthenticated()]

    @action(detail=True, methods=['post'])
    def launch(self, request, pk=None):
        if request.user.role == 'EMPLOYEE':
            return Response({'error': 'Сотрудник не может запускать процессы.'}, status=status.HTTP_403_FORBIDDEN)
        template = self.get_object()
        project_id = request.data.get('project_id')
        project = None
        if project_id:
            from projects.models import Project
            project = Project.objects.filter(id=project_id).first()

        instance = WorkflowService.create_process_from_template(
            template=template,
            project=project,
            creator=request.user
        )
        if request.data.get('name'):
            instance.name = request.data.get('name')
            instance.save(update_fields=['name'])
            
        _log(project, request.user, 'WORKFLOW_LAUNCHED', {'workflow_name': instance.name})
        return Response(WorkflowInstanceSerializer(instance).data, status=status.HTTP_201_CREATED)


class TaskViewSet(viewsets.ModelViewSet):
    queryset = WorkflowTask.objects.select_related('assigned_to', 'workflow').prefetch_related('attachments', 'report').all()
    serializer_class = WorkflowTaskSerializer
    permission_classes = [IsAuthenticated, CanUpdateTaskStatus]

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role in ('ADMIN', 'MANAGER'):
            return qs
        member_project_ids = list(user.project_memberships.values_list('project_id', flat=True))
        return qs.filter(
            django_models.Q(assigned_to=user) |
            django_models.Q(workflow__project_id__in=member_project_ids)
        )

    def perform_create(self, serializer):
        user = self.request.user
        workflow_id = self.request.data.get('workflow')
        if user.role == 'EMPLOYEE':
            if workflow_id:
                workflow = WorkflowInstance.objects.filter(id=workflow_id).first()
                if workflow and workflow.project:
                    is_pm = workflow.project.members.filter(user=user, role='MANAGER').exists()
                    if not is_pm:
                        raise serializers.ValidationError("Доступ запрещен.")
                else:
                    raise serializers.ValidationError("Доступ запрещен.")
            else:
                raise serializers.ValidationError("ID процесса обязателен.")
        
        assigned_to_id = self.request.data.get('assigned_to')
        if assigned_to_id:
            user_obj = User.objects.get(id=assigned_to_id)
            sla_hours = int(self.request.data.get('sla_hours', 0))
            self._check_workload(user_obj, sla_hours)

        task = serializer.save()
        _log(task.workflow.project, user, 'TASK_CREATED', {'task_name': task.name, 'workflow': task.workflow.name})
        
        if task.assigned_to:
            self._notify_assignee(task, task.assigned_to)

    def perform_update(self, serializer):
        user = self.request.user
        old_task = self.get_object()
        old_assignee = old_task.assigned_to
        assigned_to_id = self.request.data.get('assigned_to')
        if assigned_to_id and str(assigned_to_id) != str(old_assignee.id if old_assignee else ''):
            user_obj = User.objects.get(id=assigned_to_id)
            sla_hours = int(self.request.data.get('sla_hours', old_task.sla_hours))
            self._check_workload(user_obj, sla_hours, old_task)
        
        task = serializer.save()
        
        if task.assigned_to and task.assigned_to != old_assignee:
            self._notify_assignee(task, task.assigned_to)

    def _check_workload(self, user, new_task_hours, task_instance=None):
        # Simplified workload check
        pass

    def _notify_user_rich(self, task, event_type, changer_name=None):
        try:
            from notifications.tasks import send_rich_task_notification
            recipients = set()
            
            # Add assignee to recipients
            if task.assigned_to:
                recipients.add(task.assigned_to.id)
            
            # Add project manager to recipients if someone else made the change
            if task.workflow.project and task.workflow.project.manager:
                if task.workflow.project.manager != self.request.user:
                    recipients.add(task.workflow.project.manager.id)
            
            # Send notifications to unique recipients
            for uid in recipients:
                send_rich_task_notification.delay(
                    user_id=uid,
                    task_id=task.id,
                    event_type=event_type,
                    changer_name=changer_name
                )
        except Exception:
            pass

    def _notify_assignee(self, task, assignee):
        self._notify_user_rich(task, 'ASSIGNED', self.request.user.get_full_name() or self.request.user.username)

    @action(detail=False, methods=['get'], url_path='my-tasks')
    def my_tasks(self, request):
        tasks = WorkflowTask.objects.filter(assigned_to=request.user)
        return Response(WorkflowTaskSerializer(tasks, many=True).data)

    @action(detail=True, methods=['patch'], url_path='status')
    def update_status(self, request, pk=None):
        task = self.get_object()
        user = request.user
        old_status = task.status
        new_status = request.data.get('status')
        
        if new_status == 'DONE':
            allowed, msg = WorkflowService.validate_transition(task, user, new_status)
            if not allowed:
                return Response({'error': msg}, status=status.HTTP_403_FORBIDDEN)
            task.completed_at = timezone.now()
            task.status = 'DONE'
            task.save()
            WorkflowService.activate_next_tasks(task)
            WorkflowService.sync_wbs_status(task)
            
            _log(task.workflow.project, user, 'TASK_STATUS_UPDATED', {
                'task_name': task.name, 'new_status': 'DONE', 'workflow': task.workflow.name
            })
            
            self._notify_user_rich(task, 'STATUS_CHANGED', user.get_full_name() or user.username)
            return Response(WorkflowTaskSerializer(task).data)
            
        task.status = new_status
        task.save()
        _log(task.workflow.project, user, 'TASK_STATUS_UPDATED', {
            'task_name': task.name, 'new_status': new_status, 'workflow': task.workflow.name
        })
        
        self._notify_user_rich(task, 'STATUS_CHANGED', user.get_full_name() or user.username)
        return Response(WorkflowTaskSerializer(task).data)

    @action(detail=True, methods=['post'], url_path='report')
    def submit_report(self, request, pk=None):
        task = self.get_object()
        user = request.user
        if user.role == 'EMPLOYEE' and task.assigned_to != user:
            return Response({'error': 'Отказ в доступе'}, status=status.HTTP_403_FORBIDDEN)
        
        task.attachments.all().delete()

        text_content = request.data.get('text_content', '').strip()
        if not text_content:
            if task.task_type == 'APPROVAL':
                text_content = "Обоснование не предоставлено"
            elif task.task_type == 'INTEGRATION':
                text_content = "Интеграция выполнена успешно"
            else:
                text_content = "Отчёт о выполнении принят"

        TaskReport.objects.update_or_create(
            task=task, 
            defaults={
                'text_content': text_content, 
                'checklist': request.data.get('checklist', []),
                'submitted_by': request.user
            }
        )
        task.status = 'REVIEW'
        task.save()
        _log(task.workflow.project, request.user, 'TASK_REPORT_SUBMITTED', {'task_name': task.name})
        
        self._notify_user_rich(task, 'STATUS_CHANGED', user.get_full_name() or user.username)
        return Response(WorkflowTaskSerializer(task).data)

    @action(detail=True, methods=['post'], url_path='attach')
    def attach_file(self, request, pk=None):
        task = self.get_object()
        file = request.FILES.get('file')
        if not file: return Response(status=400)
        att = TaskAttachment.objects.create(task=task, file=file, original_name=file.name, uploaded_by=request.user)
        return Response(TaskAttachmentSerializer(att).data, status=201)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        task = self.get_object()
        task.complete()
        WorkflowService.activate_next_tasks(task)
        WorkflowService.sync_wbs_status(task)
        
        _log(task.workflow.project, request.user, 'TASK_APPROVED', {'task_name': task.name})
        
        self._notify_user_rich(task, 'APPROVED', request.user.get_full_name() or request.user.username)
        return Response(WorkflowTaskSerializer(task).data)


class WorkflowTaskTemplateViewSet(viewsets.ModelViewSet):
    queryset = WorkflowTaskTemplate.objects.all()
    serializer_class = WorkflowTaskTemplateSerializer
    permission_classes = [IsAuthenticated, IsProjectManagerOrAdmin]

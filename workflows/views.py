import os

from config.uploads import file_response, validate_upload
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db.models import Q
from django.contrib.auth import get_user_model

from projects import access
from projects.permissions import CanManageLibraryOrReadOnly, require

from .models import WorkflowTemplate, WorkflowInstance, WorkflowTask, TaskReport, TaskAttachment, WorkflowTaskTemplate
from .serializers import (
    WorkflowTemplateSerializer, WorkflowInstanceSerializer,
    WorkflowTaskSerializer, TaskAttachmentSerializer,
    WorkflowTaskTemplateSerializer,
)
from .services import WorkflowService
User = get_user_model()


def _log(project, user, action, detail=None):
    if project:
        from projects.models import AuditLog
        AuditLog.objects.create(project=project, user=user, action=action, detail=detail or {})


def _has_workflow_perm(user, workflow, perm):
    """
    Права на процесс берутся из прав участника проекта.
    Независимым процессом (без проекта) управляет его автор либо администратор / руководитель.
    """
    if workflow.project_id:
        return access.has_project_perm(user, workflow.project, perm)
    return access.has_global_access(user) or (
        access.can_manage_library(user) and workflow.created_by_id == user.id
    )


def _get_project_or_400(project_id):
    from projects.models import Project
    try:
        return Project.objects.get(id=project_id)
    except (Project.DoesNotExist, ValueError, TypeError):
        raise ValidationError("Проект не найден.")


def _require_launchable(template):
    """Процесс запускается только по опубликованному шаблону, в котором есть хотя бы один шаг."""
    if not template.is_published:
        raise ValidationError("Шаблон ещё черновик. Опубликуйте его, чтобы запускать по нему процессы.")
    if not template.task_templates.exists():
        raise ValidationError("В шаблоне нет ни одного шага.")


class ProcessViewSet(viewsets.ModelViewSet):
    """
    /api/workflows/processes/
    WorkflowInstance = running process.
    """
    queryset = WorkflowInstance.objects.select_related(
        'template', 'project', 'created_by'
    ).prefetch_related(
        'tasks__report', 'tasks__attachments', 'tasks__assigned_to', 'tasks__depends_on'
    ).all().order_by('id')
    serializer_class = WorkflowInstanceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if access.has_global_access(user):
            return qs
        # Процессы проектов, где видны все задачи, + процессы с собственными задачами
        # (внутри них сериализатор покажет исполнителю только его задачи)
        return qs.filter(
            Q(project_id__in=access.project_ids_with_perm(user, 'can_view_all_tasks'))
            | Q(tasks__assigned_to=user)
            | Q(project__isnull=True, created_by=user)
        ).distinct()

    def perform_create(self, serializer):
        user = self.request.user
        data = self.request.data
        project = serializer.validated_data.get('project')

        if project is not None:
            require(
                access.has_project_perm(user, project, 'can_edit_tasks'),
                "Создавать процессы могут менеджеры проекта и участники с правом редактирования задач.",
            )
        else:
            require(access.can_manage_library(user), "Исполнитель не может создавать независимые процессы.")

        template = None
        template_id = data.get('template_id') or data.get('template')
        if template_id:
            try:
                template = WorkflowTemplate.objects.get(id=template_id)
            except (WorkflowTemplate.DoesNotExist, ValueError, TypeError):
                raise ValidationError("Шаблон процесса не найден.")
            _require_launchable(template)

        instance = serializer.save(
            created_by=user,
            started_at=timezone.now(),
            status='IN_PROGRESS',
        )

        _log(project, user, 'WORKFLOW_CREATED', {'workflow_name': instance.name})

        if template:
            WorkflowService.create_process_from_template(
                template=template,
                project=project,
                creator=user,
                existing_instance=instance
            )

    def perform_update(self, serializer):
        user = self.request.user
        instance = serializer.instance
        require(_has_workflow_perm(user, instance, 'can_edit_tasks'), "У вас нет прав изменять этот процесс.")
        # Перенос процесса в другой проект требует прав и в целевом проекте
        new_project = serializer.validated_data.get('project', instance.project)
        if new_project is not None and new_project != instance.project:
            require(access.has_project_perm(user, new_project, 'can_edit_tasks'), "Нет прав в целевом проекте.")
        serializer.save()

    def perform_destroy(self, instance):
        user = self.request.user
        require(_has_workflow_perm(user, instance, 'can_edit_tasks'), "У вас нет прав удалять этот процесс.")
        _log(instance.project, user, 'WORKFLOW_DELETED', {'workflow_name': instance.name})
        instance.delete()


class WorkflowTemplateViewSet(viewsets.ModelViewSet):
    queryset = WorkflowTemplate.objects.prefetch_related('task_templates').all()
    serializer_class = WorkflowTemplateSerializer
    permission_classes = [IsAuthenticated, CanManageLibraryOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def launch(self, request, pk=None):
        template = self.get_object()
        _require_launchable(template)
        project = None
        if request.data.get('project_id'):
            project = _get_project_or_400(request.data.get('project_id'))
            require(
                access.has_project_perm(request.user, project, 'can_edit_tasks'),
                "У вас нет прав запускать процессы в этом проекте.",
            )

        instance = WorkflowService.create_process_from_template(
            template=template,
            project=project,
            creator=request.user
        )
        if request.data.get('name'):
            instance.name = request.data.get('name')
            instance.save(update_fields=['name'])

        _log(project, request.user, 'WORKFLOW_LAUNCHED', {'workflow_name': instance.name})
        return Response(
            WorkflowInstanceSerializer(instance, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class TaskViewSet(viewsets.ModelViewSet):
    queryset = WorkflowTask.objects.select_related(
        'assigned_to', 'workflow__project'
    ).prefetch_related('attachments', 'report', 'depends_on').all().order_by('workflow_id', 'order', 'id')
    serializer_class = WorkflowTaskSerializer
    permission_classes = [IsAuthenticated]

    # Поля, которые исполнитель может менять в своей задаче без права редактирования
    ASSIGNEE_EDITABLE_FIELDS = {'checklist'}

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if access.has_global_access(user):
            return qs
        # Исполнитель видит только назначенные на него задачи; все задачи проекта —
        # менеджеры и участники с правом can_view_all_tasks
        return qs.filter(
            Q(assigned_to=user)
            | Q(workflow__project_id__in=access.project_ids_with_perm(user, 'can_view_all_tasks'))
            | Q(workflow__project__isnull=True, workflow__created_by=user)
        ).distinct()

    # ── helpers ──────────────────────────────────────────────────────────────

    def _can_edit(self, task):
        return _has_workflow_perm(self.request.user, task.workflow, 'can_edit_tasks')

    def _is_assignee(self, task):
        return task.assigned_to_id == self.request.user.id

    def _require_assignee_or_editor(self, task):
        require(
            self._is_assignee(task) or self._can_edit(task),
            "Действие доступно исполнителю задачи или менеджеру проекта.",
        )

    def _actor_name(self):
        return self.request.user.get_full_name() or self.request.user.username

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

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def perform_create(self, serializer):
        user = self.request.user
        workflow = serializer.validated_data['workflow']
        require(
            _has_workflow_perm(user, workflow, 'can_edit_tasks'),
            "У вас нет прав создавать задачи в этом процессе.",
        )
        if serializer.validated_data.get('assigned_to'):
            require(
                _has_workflow_perm(user, workflow, 'can_assign_tasks'),
                "У вас нет права назначать исполнителей.",
            )

        task = serializer.save()
        _log(task.workflow.project, user, 'TASK_CREATED', {'task_name': task.name, 'workflow': task.workflow.name})

        if task.assigned_to:
            self._notify_user_rich(task, 'ASSIGNED', self._actor_name())

    def perform_update(self, serializer):
        user = self.request.user
        task = serializer.instance
        old_assignee = task.assigned_to
        changed = set(serializer.validated_data)

        if not self._can_edit(task):
            require(self._is_assignee(task), "Вы не можете редактировать чужие задачи.")
            require(
                changed <= self.ASSIGNEE_EDITABLE_FIELDS,
                "Исполнитель не может изменять параметры задачи.",
            )
        if 'assigned_to' in changed and serializer.validated_data['assigned_to'] != old_assignee:
            require(
                _has_workflow_perm(user, task.workflow, 'can_assign_tasks'),
                "У вас нет права назначать исполнителей.",
            )
        if 'workflow' in changed and serializer.validated_data['workflow'] != task.workflow:
            require(
                _has_workflow_perm(user, serializer.validated_data['workflow'], 'can_edit_tasks'),
                "Нет прав в целевом процессе.",
            )

        # Статус меняется по общим правилам (блокировка зависимостями, запуск SLA, следующие этапы)
        new_status = serializer.validated_data.pop('status', None)
        if new_status and new_status != task.status:
            self._check_status_change(task, new_status)

        task = serializer.save()
        if new_status and new_status != task.status:
            self._apply_status(task, new_status)

        if task.assigned_to and task.assigned_to != old_assignee:
            self._notify_user_rich(task, 'ASSIGNED', self._actor_name())

    def perform_destroy(self, instance):
        require(self._can_edit(instance), "У вас нет прав удалять эту задачу.")
        _log(instance.workflow.project, self.request.user, 'TASK_DELETED',
             {'task_name': instance.name, 'workflow': instance.workflow.name})
        instance.delete()

    # ── Actions ──────────────────────────────────────────────────────────────

    @action(detail=False, methods=['get'], url_path='my-tasks')
    def my_tasks(self, request):
        tasks = WorkflowTask.objects.filter(assigned_to=request.user).select_related(
            'assigned_to', 'workflow'
        ).prefetch_related('attachments', 'report', 'depends_on')
        return Response(WorkflowTaskSerializer(tasks, many=True, context={'request': request}).data)

    # ── Смена статуса ────────────────────────────────────────────────────────

    def _check_status_change(self, task, new_status):
        """Общие правила перехода. Бросает ValidationError / PermissionDenied."""
        if new_status not in dict(WorkflowTask.STATUS_CHOICES):
            raise ValidationError({'error': 'Недопустимый статус задачи.'})
        if new_status != 'TODO' and WorkflowService.is_blocked(task):
            raise ValidationError({'error': 'Задача заблокирована: сначала должны быть выполнены предыдущие этапы процесса.'})

        if not self._can_edit(task):
            # Исполнитель может только взять задачу в работу или отозвать её с проверки.
            # Результат сдаётся отчётом, закрывает задачу менеджер.
            require(
                new_status == 'IN_PROGRESS' and task.status in ('TODO', 'REVIEW'),
                "Исполнитель сдаёт результат через отчёт; закрывает задачу менеджер проекта.",
            )
        allowed, msg = WorkflowService.validate_transition(task, self.request.user, new_status)
        require(allowed, msg)

    def _apply_status(self, task, new_status):
        old_status = task.status
        if new_status == 'DONE':
            WorkflowService.complete_task(task)
        elif new_status == 'IN_PROGRESS' and old_status == 'TODO':
            # Взятие в работу запускает отсчёт SLA
            WorkflowService.start_task(task, notify_assignee=False)
        else:
            task.status = new_status
            task.completed_at = None
            task.save()

        _log(task.workflow.project, self.request.user, 'TASK_STATUS_UPDATED', {
            'task_name': task.name, 'old_status': old_status, 'new_status': new_status,
            'workflow': task.workflow.name,
        })
        self._notify_user_rich(task, 'STATUS_CHANGED', self._actor_name())

    @action(detail=True, methods=['patch'], url_path='status')
    def update_status(self, request, pk=None):
        task = self.get_object()
        self._require_assignee_or_editor(task)

        new_status = request.data.get('status')
        if new_status != task.status:
            self._check_status_change(task, new_status)
            self._apply_status(task, new_status)
        return Response(self.get_serializer(task).data)

    # ── Сдача результата ─────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='report')
    def submit_report(self, request, pk=None):
        task = self.get_object()
        self._require_assignee_or_editor(task)
        if task.status == 'DONE':
            return Response({'error': 'Задача уже закрыта.'}, status=status.HTTP_400_BAD_REQUEST)
        if WorkflowService.is_blocked(task):
            return Response(
                {'error': 'Задача заблокирована: сначала должны быть выполнены предыдущие этапы процесса.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task.attachments.all().delete()

        text_content = (request.data.get('text_content') or '').strip()
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
                'checklist': request.data.get('checklist') or [],
                'submitted_by': request.user,
                'submitted_at': timezone.now(),
            }
        )
        task.started_at = task.started_at or timezone.now()
        _log(task.workflow.project, request.user, 'TASK_REPORT_SUBMITTED', {'task_name': task.name})

        if task.auto_approve:
            # Задача с автоутверждением закрывается сразу после сдачи отчёта
            WorkflowService.complete_task(task)
            self._notify_user_rich(task, 'APPROVED', 'Автоутверждение')
        else:
            task.status = 'REVIEW'
            task.save()
            self._notify_user_rich(task, 'STATUS_CHANGED', self._actor_name())
        return Response(self.get_serializer(task).data)

    @action(detail=True, methods=['post'], url_path='attach')
    def attach_file(self, request, pk=None):
        task = self.get_object()
        self._require_assignee_or_editor(task)
        if task.status == 'DONE':
            return Response({'error': 'Задача уже закрыта.'}, status=status.HTTP_400_BAD_REQUEST)
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'Файл не передан.'}, status=status.HTTP_400_BAD_REQUEST)
        validate_upload(file)
        if task.attachments.count() >= 20:
            return Response({'error': 'К задаче можно приложить не больше 20 файлов.'}, status=status.HTTP_400_BAD_REQUEST)
        att = TaskAttachment.objects.create(
            task=task, file=file, original_name=os.path.basename(file.name)[:255], uploaded_by=request.user)
        return Response(TaskAttachmentSerializer(att).data, status=201)

    @action(detail=True, methods=['get'], url_path=r'attachments/(?P<attachment_id>\d+)/download')
    def download_attachment(self, request, pk=None, attachment_id=None):
        """Скачивание вложения: доступно тем же, кто видит саму задачу (get_object ограничен get_queryset)."""
        task = self.get_object()
        attachment = task.attachments.filter(id=attachment_id).first()
        if attachment is None or not attachment.file:
            return Response({'error': 'Файл не найден.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            return file_response(attachment.file, attachment.original_name)
        except FileNotFoundError:
            return Response({'error': 'Файл не найден в хранилище.'}, status=status.HTTP_404_NOT_FOUND)

    # ── Проверка результата ──────────────────────────────────────────────────

    def _is_approver(self, task):
        """Задачу типа «Утверждение» закрывает её исполнитель — согласующий."""
        return task.task_type == 'APPROVAL' and self._is_assignee(task)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        task = self.get_object()
        # Результат утверждает менеджер; исполнитель не может утвердить собственный отчёт.
        require(
            self._can_edit(task) or self._is_approver(task),
            "Утвердить результат может только менеджер проекта.",
        )
        if task.status == 'DONE':
            return Response({'error': 'Задача уже закрыта.'}, status=status.HTTP_400_BAD_REQUEST)
        if WorkflowService.is_blocked(task):
            return Response(
                {'error': 'Задача заблокирована: сначала должны быть выполнены предыдущие этапы процесса.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if task.task_type != 'APPROVAL' and task.status != 'REVIEW':
            return Response(
                {'error': 'Утвердить можно только задачу, сданную на проверку.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        allowed, msg = WorkflowService.validate_transition(task, request.user, 'DONE')
        require(allowed, msg)

        WorkflowService.complete_task(task)
        _log(task.workflow.project, request.user, 'TASK_APPROVED', {'task_name': task.name})
        self._notify_user_rich(task, 'APPROVED', self._actor_name())
        return Response(self.get_serializer(task).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """
        POST /api/workflows/tasks/{id}/reject/ {"reason": "..."}
          - менеджер возвращает сданную задачу на доработку (REVIEW → IN_PROGRESS);
          - согласующий отклоняет задачу типа «Утверждение»: процесс останавливается
            на ней (ESCALATED) до решения менеджера.
        """
        task = self.get_object()
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Укажите причину.'}, status=status.HTTP_400_BAD_REQUEST)
        if task.status == 'DONE':
            return Response({'error': 'Задача уже закрыта.'}, status=status.HTTP_400_BAD_REQUEST)

        from notifications.utils import notify
        project = task.workflow.project
        if task.task_type == 'APPROVAL' and task.status != 'REVIEW':
            require(self._can_edit(task) or self._is_approver(task), "Отклонить может только согласующий.")
            task.review_comment = reason
            task.status = 'ESCALATED'
            task.save()
            TaskReport.objects.update_or_create(task=task, defaults={
                'text_content': f'ОТКЛОНЕНО\nПричина: {reason}',
                'submitted_by': request.user, 'submitted_at': timezone.now(),
            })
            recipients = {u for u in (project.manager if project else None, task.workflow.created_by) if u}
            recipients.discard(request.user)
            for recipient in recipients:
                notify(
                    recipient=recipient,
                    title='Согласование отклонено',
                    body=f'{self._actor_name()} отклонил(а) «{task.name}» в процессе «{task.workflow.name}». Причина: {reason}',
                    notif_type='ESCALATION', task_id=task.id, project_id=project.id if project else None,
                )
            action_name = 'TASK_APPROVAL_REJECTED'
        else:
            require(self._can_edit(task), "Вернуть задачу на доработку может только менеджер проекта.")
            if task.status != 'REVIEW':
                return Response(
                    {'error': 'Вернуть на доработку можно только задачу, сданную на проверку.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            task.review_comment = reason
            task.status = 'IN_PROGRESS'
            task.save()
            if task.assigned_to and task.assigned_to != request.user:
                notify(
                    recipient=task.assigned_to,
                    title='Задача возвращена на доработку',
                    body=f'«{task.name}»: {reason}',
                    notif_type='WARNING', task_id=task.id, project_id=project.id if project else None,
                )
            action_name = 'TASK_RETURNED'

        _log(project, request.user, action_name, {'task_name': task.name, 'reason': reason})
        return Response(self.get_serializer(task).data)


class WorkflowTaskTemplateViewSet(viewsets.ModelViewSet):
    queryset = WorkflowTaskTemplate.objects.all().order_by('template_id', 'order', 'id')
    serializer_class = WorkflowTaskTemplateSerializer
    permission_classes = [IsAuthenticated, CanManageLibraryOrReadOnly]

    def perform_destroy(self, instance):
        # Шаг убирают из середины цепочки: следующие шаги должны ждать его предшественников,
        # иначе они остались бы без связей и стартовали сразу при запуске процесса
        predecessors = list(instance.depends_on.all())
        for follower in instance.dependent_templates.all():
            follower.depends_on.add(*predecessors)
        instance.delete()

import datetime
from rest_framework import viewsets, status, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import models as django_models
from .models import Project, ProjectMember, PlanningBlock, Task, TaskDependency, AuditLog, GlobalSetting
from .serializers import (
    ProjectSerializer, ProjectMemberSerializer, PlanningBlockSerializer,
    TaskSerializer, TaskDependencySerializer, AuditLogSerializer, GlobalSettingSerializer,
)
from .services import PlanningImportService
from .permissions import IsProjectManagerOrAdmin
from django.db.models import Avg, Count
from django.utils import timezone
from datetime import timedelta
from notifications.utils import notify


class GlobalSettingViewSet(viewsets.ModelViewSet):
    queryset = GlobalSetting.objects.all()
    serializer_class = GlobalSettingSerializer
    permission_classes = [IsAuthenticated]

    def perform_update(self, serializer):
        if self.request.user.role != 'ADMIN':
            raise ValidationError("Только администратор может менять системные настройки.")
        serializer.save()

    def perform_create(self, serializer):
        if self.request.user.role != 'ADMIN':
            raise ValidationError("Только администратор может создавать системные настройки.")
        serializer.save()


def _log(project, user, action, detail=None):
    AuditLog.objects.create(project=project, user=user, action=action, detail=detail or {})


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.prefetch_related('members__user').all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ('update', 'partial_update', 'destroy', 'add_member', 'remove_member', 'import_from_project'):
            return [IsAuthenticated(), IsProjectManagerOrAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.role in ('ADMIN', 'MANAGER'):
            return qs
        # EMPLOYEE: only projects they're a member of
        member_project_ids = list(
            user.project_memberships.values_list('project_id', flat=True)
        )
        return qs.filter(id__in=member_project_ids)

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == 'EMPLOYEE':
            raise serializers.ValidationError("У сотрудника нет прав создавать проекты.")
        project = serializer.save()
        _log(project, user, 'PROJECT_CREATED', {'name': project.name})
        
        # If manager is assigned, add them to team as MANAGER with specified or default 100% allocation
        if project.manager:
            allocation = serializer.validated_data.get('manager_allocation', 100)
            
            # Try to find a global role for Project Manager to keep things in sync
            from plans.models import ProjectRole
            pm_role_ref = ProjectRole.objects.filter(name__icontains='manager').first()
            if not pm_role_ref:
                pm_role_ref = ProjectRole.objects.filter(name__icontains='менеджер').first()

            ProjectMember.objects.get_or_create(
                project=project, user=project.manager, 
                defaults={'role': 'MANAGER', 'allocation_percentage': allocation, 'role_ref': pm_role_ref}
            )
            # Add workload entry for manager
            self._sync_workload_entry(project, project.manager, allocation)
            
            # Notify manager
            notify(
                recipient=project.manager,
                title='Вы назначены менеджером проекта',
                body=f'Вы назначены ответственным за проект "{project.name}".',
                notif_type='INFO',
                project_id=project.id
            )

    def perform_update(self, serializer):
        user = self.request.user
        if user.role == 'EMPLOYEE':
            raise serializers.ValidationError("У сотрудника нет прав редактировать проекты.")
        
        # Capture old manager to demote if changed
        old_manager = None
        if self.get_object().manager:
            old_manager = self.get_object().manager

        project = serializer.save()
        _log(project, user, 'PROJECT_UPDATED', {'name': project.name})
        
        # If manager changed, notify new manager
        if project.manager and project.manager != old_manager:
            from notifications.tasks import send_notification_async
            notify(
                recipient=project.manager,
                title='Вы назначены менеджером проекта',
                body=f'Вы назначены новым ответственным за проект "{project.name}".',
                notif_type='INFO',
                project_id=project.id
            )
        
        # Sync manager to team roles
        if project.manager:
            allocation = serializer.validated_data.get('manager_allocation', 100)
            
            # Try to find a global role for Project Manager
            from plans.models import ProjectRole
            pm_role_ref = ProjectRole.objects.filter(name__icontains='manager').first()
            if not pm_role_ref:
                pm_role_ref = ProjectRole.objects.filter(name__icontains='менеджер').first()

            # Demote old manager if changed
            if old_manager and old_manager != project.manager:
                ProjectMember.objects.filter(project=project, user=old_manager, role='MANAGER').update(role='DEVELOPER')

            ProjectMember.objects.update_or_create(
                project=project, user=project.manager, 
                defaults={'role': 'MANAGER', 'allocation_percentage': allocation, 'role_ref': pm_role_ref}
            )
            self._sync_workload_entry(project, project.manager, allocation)

    def _sync_workload_entry(self, project, user, allocation):
        from matching.models import WorkloadEntry, EmployeeProfile
        try:
            profile = EmployeeProfile.objects.get(user=user)
            # Use filter().first() and manual update/create to avoid MultipleObjectsReturned (500 error)
            entry = WorkloadEntry.objects.filter(employee=profile, project=project).first()
            defaults = {
                'start_date': project.start_date or timezone.now().date(),
                'end_date': project.end_date or (timezone.now().date() + timedelta(days=90)),
                'load_percent': allocation
            }
            if entry:
                for k, v in defaults.items():
                    setattr(entry, k, v)
                entry.save()
            else:
                WorkloadEntry.objects.create(employee=profile, project=project, **defaults)
        except EmployeeProfile.DoesNotExist:
            pass

    def perform_destroy(self, instance):
        user = self.request.user
        if user.role == 'EMPLOYEE':
            raise serializers.ValidationError("У сотрудника нет прав удалять проекты.")
        _log(instance, user, 'PROJECT_DELETED', {'name': instance.name})
        instance.delete()

    @action(detail=True, methods=['get'], url_path='members')
    def members(self, request, pk=None):
        project = self.get_object()
        serializer = ProjectMemberSerializer(
            project.members.select_related('user').all(), many=True
        )
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='members/add')
    def add_member(self, request, pk=None):
        if request.user.role == 'EMPLOYEE':
            return Response({'error': 'У сотрудника нет прав.'}, status=status.HTTP_403_FORBIDDEN)
        project = self.get_object()
        user_id = request.data.get('user_id')
        role = request.data.get('role', 'OTHER')
        role_ref_id = request.data.get('role_ref_id')
        # 0. Ищем существующего участника, чтобы сохранить его загрузку при смене роли
        existing_member = ProjectMember.objects.filter(project=project, user_id=user_id).first()
        
        raw_allocation = request.data.get('allocation_percentage')
        if raw_allocation is not None and str(raw_allocation).strip() != "":
            allocation = int(raw_allocation)
        elif existing_member:
            allocation = existing_member.allocation_percentage
        else:
            allocation = 100
        
        if allocation <= 0:
            return Response({'error': 'Загрузка на проект должна быть больше 0%'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        role_ref = None
        if role_ref_id:
            from plans.models import ProjectRole
            try:
                role_ref = ProjectRole.objects.get(id=role_ref_id)
            except ProjectRole.DoesNotExist:
                pass

        # 1. Проверка на 1 менеджера в проекте
        if role == 'MANAGER':
            manager_exists = ProjectMember.objects.filter(
                project=project, role='MANAGER'
            ).exclude(user=target_user).exists()
            if manager_exists:
                return Response({'error': 'В проекте уже есть менеджер'}, status=status.HTTP_400_BAD_REQUEST)

        # 2. Проверка лимита загрузки (100%)
        from matching.models import EmployeeProfile
        try:
            profile = EmployeeProfile.objects.get(user=target_user)
            import datetime
            from django.db.models import Sum
            today = datetime.date.today()
            # Загрузка в других активных проектах
            current_load = profile.workload_entries.filter(
                start_date__lte=today, end_date__gte=today
            ).exclude(project=project).aggregate(total=Sum('load_percent'))['total'] or 0
            
            # existing_member уже определен выше
            if current_load + allocation > 100:
                # Если это обновление и нагрузка не увеличилась, разрешаем смену роли/данных
                if existing_member and allocation <= existing_member.allocation_percentage:
                    pass
                else:
                    return Response({
                        'error': f'Превышение загрузки сотрудника (занято {current_load}%, требуется {allocation}%). Максимум 100%.'
                    }, status=status.HTTP_400_BAD_REQUEST)
        except EmployeeProfile.DoesNotExist:
            pass

        # Determine if this is a Project Manager assignment (internal MANAGER role OR global 'Project Manager' role)
        is_pm_role = (role == 'MANAGER') or (role_ref and 'manager' in role_ref.name.lower())

        # 3. Проверка уникальности Project Manager
        if is_pm_role:
            existing_pm = ProjectMember.objects.filter(project=project, role='MANAGER').exclude(user=target_user).first()
            if not existing_pm and role_ref:
                # Check via role_ref too
                from plans.models import ProjectRole as PR
                pm_role_ids = PR.objects.filter(name__icontains='manager').values_list('id', flat=True)
                existing_pm = ProjectMember.objects.filter(
                    project=project, role_ref_id__in=pm_role_ids
                ).exclude(user=target_user).first()
            if existing_pm:
                return Response({
                    'error': f'В проекте уже есть Project Manager ({existing_pm.user.get_full_name() or existing_pm.user.username}). Выберите другую роль.'
                }, status=status.HTTP_400_BAD_REQUEST)

        member, created = ProjectMember.objects.update_or_create(
            project=project, user=target_user, 
            defaults={'role': role, 'role_ref': role_ref, 'allocation_percentage': allocation}
        )
        
        # Если это роль менеджера и в проекте ещё нет главного менеджера — назначаем автоматически
        if is_pm_role and not project.manager:
            project.manager = target_user
            project.save(update_fields=['manager'])
        
        self._sync_workload_entry(project, target_user, allocation)
            
        # Notify user about project assignment
        log_role = role_ref.name if role_ref else role
        notify(
            recipient=target_user,
            title=f"Новый проект: {project.name}",
            body=f"Вы были включены в команду проекта '{project.name}' в роли '{log_role}'.",
            notif_type='INFO',
            project_id=project.id
        )
            
        _log(project, request.user, 'MEMBER_ADDED', {'user_id': user_id, 'role': log_role, 'role_ref': role_ref_id, 'allocation': allocation})
        return Response(ProjectMemberSerializer(member).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], url_path='metadata')
    def metadata(self, request):
        """Return choices for statuses and other metadata."""
        return Response({
            'statuses': dict(Project.STATUS_CHOICES),
            'roles': dict(ProjectMember.ROLE_CHOICES),
            'task_statuses': dict(Task.STATUS_CHOICES),
        })

    @action(detail=True, methods=['post'], url_path='members/remove')
    def remove_member(self, request, pk=None):
        if request.user.role == 'EMPLOYEE':
            return Response({'error': 'У сотрудника нет прав.'}, status=status.HTTP_403_FORBIDDEN)
        project = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        ProjectMember.objects.filter(project=project, user_id=user_id).delete()
        
        # Также удаляем запись о нагрузке, чтобы % сразу уменьшился
        from matching.models import WorkloadEntry, EmployeeProfile
        try:
            profile = EmployeeProfile.objects.get(user_id=user_id)
            WorkloadEntry.objects.filter(employee=profile, project=project).delete()
        except EmployeeProfile.DoesNotExist:
            pass

        _log(project, request.user, 'MEMBER_REMOVED', {'user_id': user_id})
        
        # Notify user
        from notifications.tasks import send_notification_async
        send_notification_async.delay(
            user_id=user_id,
            title='Исключение из проекта',
            body=f'Вы были исключены из команды проекта "{project.name}".',
            channels=('email', 'telegram')
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='import')
    def import_from_project(self, request, pk=None):
        """Clone this project into a new project."""
        if request.user.role == 'EMPLOYEE':
            return Response({'error': 'У сотрудника нет прав.'}, status=status.HTTP_403_FORBIDDEN)
        source = self.get_object()
        new_name = request.data.get('name', f'{source.name} (копия)')
        copy_dates = request.data.get('copy_dates', False)
        copy_team = request.data.get('copy_team', True)
        scaling_factor = float(request.data.get('scaling_factor', 1.0))

        new_project = Project.objects.create(
            name=new_name,
            description=f'Импортировано из «{source.name}». {source.description}',
            domain=source.domain,
            status='DRAFT',
            start_date=datetime.date.today(),
            end_date=source.end_date if copy_dates else None,
            manager=request.user,
            budget=source.budget,
        )
        if copy_team:
            for m in source.members.select_related('user').all():
                ProjectMember.objects.get_or_create(
                    project=new_project, user=m.user, defaults={'role': m.role}
                )
        block_ids = request.data.get('block_ids', None)
        blocks_to_copy = source.blocks.filter(is_template=False).prefetch_related('tasks__outgoing_dependencies')
        if block_ids:
            blocks_to_copy = blocks_to_copy.filter(id__in=block_ids)

        for block in blocks_to_copy:
            try:
                PlanningImportService.import_block_to_project(
                    block, new_project, datetime.date.today(), scaling_factor
                )
            except Exception:
                pass
        _log(new_project, request.user, 'PROJECT_IMPORTED_FROM',
             {'source_id': source.id, 'source_name': source.name})
        return Response(ProjectSerializer(new_project).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='create-from-template')
    def create_from_template(self, request):
        """Create a new project using a template block as the initial WBS."""
        if request.user.role == 'EMPLOYEE':
            return Response({'error': 'У сотрудника нет прав.'}, status=status.HTTP_403_FORBIDDEN)
        
        template_id = request.data.get('template_id')
        new_name = request.data.get('name')
        if not template_id or not new_name:
            return Response({'error': 'template_id and name are required'}, status=400)
            
        try:
            template_block = PlanningBlock.objects.get(id=template_id, is_template=True)
        except PlanningBlock.DoesNotExist:
            return Response({'error': 'Template block not found'}, status=404)
            
        new_project = Project.objects.create(
            name=new_name,
            description=f'Создано из шаблона «{template_block.name}»',
            domain=template_block.domain or 'IT',
            status='DRAFT',
            start_date=datetime.date.today(),
            manager=request.user,
        )
        
        scaling_factor = float(request.data.get('scaling_factor', 1.0))
        task_ids = request.data.get('task_ids', None)
        
        PlanningImportService.import_template_to_project(
            template_block, new_project, datetime.date.today(), scaling_factor, task_ids=task_ids
        )
        
        _log(new_project, request.user, 'PROJECT_CREATED', {'name': new_name, 'template': template_block.name})
        return Response(ProjectSerializer(new_project).data, status=status.HTTP_201_CREATED)


class PlanningBlockViewSet(viewsets.ModelViewSet):
    queryset = PlanningBlock.objects.prefetch_related(
        'tasks__required_roles__role', 
        'tasks__incoming_dependencies', 
        'tasks__outgoing_dependencies',
        'typical_risks',
        'calendar'
    ).all()
    serializer_class = PlanningBlockSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            from projects.permissions import IsProjectManagerOrAdmin
            return [IsAuthenticated(), IsProjectManagerOrAdmin()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        template_id = self.request.data.get('template_id')
        if template_id:
            try:
                template_block = PlanningBlock.objects.get(id=template_id, is_template=True)
                project_id = self.request.data.get('project')
                project = Project.objects.get(id=project_id)
                start_date = project.start_date or datetime.date.today()
                
                new_block = PlanningImportService.clone_block_recursive(
                    template_block, project, start_date
                )
                # We return the new block, but serializer needs to know
                serializer.instance = new_block
            except (PlanningBlock.DoesNotExist, Project.DoesNotExist):
                serializer.save()
        else:
            serializer.save()

    @action(detail=False, methods=['get'], url_path='by-project')
    def by_project(self, request):
        """Fetch root planning blocks for a specific project."""
        project_id = request.query_params.get('project_id')
        if not project_id:
            return Response({'error': 'project_id is required'}, status=400)
        # Only fetch ROOT blocks (parent is None) to start the tree
        blocks = PlanningBlock.objects.filter(
            project_id=project_id, is_template=False, parent__isnull=True
        ).prefetch_related('tasks__incoming_dependencies', 'tasks__outgoing_dependencies', 'children')
        serializer = self.get_serializer(blocks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='transfer')
    def transfer(self, request, pk=None):
        source_block = self.get_object()
        project_id = request.data.get('project_id')
        start_date_str = request.data.get('start_date')
        if not project_id or not start_date_str:
            return Response({'error': 'project_id and start_date are required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            project = Project.objects.get(id=project_id)
            start_date = datetime.date.fromisoformat(start_date_str)
        except (Project.DoesNotExist, ValueError):
            return Response({'error': 'Invalid project_id or start_date'}, status=status.HTTP_400_BAD_REQUEST)
        
        scaling_factor = float(request.data.get('scaling_factor', 1.0))
        task_ids = request.data.get('task_ids', None)

        try:
            if source_block.is_template:
                new_block = PlanningImportService.import_template_to_project(
                    source_block, project, start_date, scaling_factor, task_ids=task_ids
                )
            else:
                new_block = PlanningImportService.import_block_to_project(
                    source_block, project, start_date, scaling_factor, task_ids=task_ids
                )
            
            _log(project, request.user, 'PLANNING_TRANSFERRED', {'block': source_block.name, 'from_template': source_block.is_template})
            return Response(PlanningBlockSerializer(new_block).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='make-template')
    def make_template(self, request, pk=None):
        block = self.get_object()
        if block.is_template:
            return Response({'error': 'Блок уже является шаблоном.'}, status=400)
        
        template_name = request.data.get('name', f"Шаблон: {block.name}")
        
        # Manually cloning here to avoid service edit issues for now
        new_template = PlanningBlock.objects.create(
            name=template_name,
            domain=block.domain,
            is_template=True,
            project=None,
            parent=None,
            order=0,
            process_template=block.process_template,
            calendar=block.calendar,
            avg_duration=block.avg_duration,
            complexity=block.complexity,
            success_rate=block.success_rate,
        )
        new_template.typical_risks.set(block.typical_risks.all())

        old_to_new_task_map = {}
        for t_task in block.tasks.all():
            new_task = Task.objects.create(
                block=new_template,
                name=t_task.name,
                description=t_task.description,
                duration_days=t_task.duration_days,
                start_offset_days=t_task.start_offset_days,
                status='TODO',
                weight=t_task.weight,
                priority=t_task.priority,
                estimated_hours=t_task.estimated_hours,
                risk_level=t_task.risk_level,
                order=t_task.order,
                process_template=t_task.process_template
            )
            from plans.models import TaskRequiredRole
            for rr in t_task.required_roles.all():
                TaskRequiredRole.objects.create(task=new_task, role=rr.role)
            old_to_new_task_map[t_task.id] = new_task

        for t_task in block.tasks.all():
            for dep in t_task.outgoing_dependencies.all():
                if dep.to_task.id in old_to_new_task_map:
                    TaskDependency.objects.create(
                        from_task=old_to_new_task_map[t_task.id],
                        to_task=old_to_new_task_map[dep.to_task.id],
                        type=dep.type,
                    )
        
        return Response(PlanningBlockSerializer(new_template).data, status=status.HTTP_201_CREATED)


class ImportPlanningView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        if request.user.role == 'EMPLOYEE':
            return Response({'error': 'У сотрудника нет прав.'}, status=status.HTTP_403_FORBIDDEN)
        block_id = request.data.get('block_id')
        project_id = request.data.get('project_id')
        start_date_str = request.data.get('start_date')
        if not all([block_id, project_id, start_date_str]):
            return Response({'error': 'block_id, project_id and start_date are required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            block = PlanningBlock.objects.get(id=block_id, is_template=True)
            project = Project.objects.get(id=project_id)
            start_date = datetime.date.fromisoformat(start_date_str)
        except (PlanningBlock.DoesNotExist, Project.DoesNotExist, ValueError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        scaling_factor = float(request.data.get('scaling_factor', 1.0))
        new_block = PlanningImportService.import_template_to_project(block, project, start_date, scaling_factor)
        _log(project, request.user, 'PLANNING_IMPORTED', {'block': block.name})
        return Response(PlanningBlockSerializer(new_block).data, status=status.HTTP_201_CREATED)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related('project', 'user').all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['project']


class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy', 'recalculate', 'shift', 'suggest_assignee'):
            return [IsAuthenticated(), IsProjectManagerOrAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = super().get_queryset().select_related('assigned_to', 'block__project', 'parent', 'workflow_task')
        project_id = self.request.query_params.get('project_id')
        if project_id:
            qs = qs.filter(block__project_id=project_id)
        return qs

    def perform_create(self, serializer):
        # Inherit process_template from block if not provided
        block_id = self.request.data.get('block')
        p_template = self.request.data.get('process_template')
        
        if block_id and not p_template:
            try:
                block = PlanningBlock.objects.get(id=block_id)
                if block.process_template:
                    serializer.validated_data['process_template'] = block.process_template
            except PlanningBlock.DoesNotExist:
                pass

        task = serializer.save()
        create_workflow = self.request.data.get('create_workflow', False)
        
        if create_workflow and task.process_template:
            from workflows.services import WorkflowService
            WorkflowService.create_process_from_template(
                task.process_template, 
                task.block.project, 
                wbs_task=task,
                creator=self.request.user
            )
            _log(task.block.project, self.request.user, 'PLANNING_TASK_WORKFLOW_CREATED', {'task_id': task.id})

        # Set default dates if not provided
        if not task.start_date:
            task.start_date = task.block.project.start_date or timezone.now().date()
            if not task.end_date:
                task.end_date = task.start_date + timedelta(days=task.duration_days or 1)
            task.save(update_fields=['start_date', 'end_date'])

    @action(detail=True, methods=['get'])
    def suggest_assignee(self, request, pk=None):
        task = self.get_object()
        project_members = task.block.project.members.select_related('user').all()
        
            # 1. Project Team search
        suggestions = []
        member_user_ids = set()
        for member in project_members:
            member_user_ids.add(member.user.id)
            score = 0
            breakdown = {'role_match': 0, 'workload': 0, 'experience': 0, 'availability': 0}
            reasons = []
            
            # Role match
            required_role_names = [rr.role.name for rr in task.required_roles.all()]
            if member.role in required_role_names:
                breakdown['role_match'] = 50
                score += 50
                reasons.append(f"Role match: {member.role}")
            
            # Workload check
            from matching.models import EmployeeProfile
            try:
                profile = EmployeeProfile.objects.get(user=member.user)
                load = profile.current_workload_percentage
                if load < 70:
                    breakdown['workload'] = 30
                    score += 30
                    reasons.append(f"Low workload: {load}%")
                elif load > 100:
                    breakdown['workload'] = -20
                    score -= 20
                    reasons.append(f"Overloaded: {load}%")
                else:
                    breakdown['workload'] = 10
                    score += 10
                    reasons.append(f"Stable workload: {load}%")
            except EmployeeProfile.DoesNotExist:
                pass
            
            if score > 0 or not required_role_names:
                if not required_role_names:
                    breakdown['availability'] = 20
                    score += 20 
                
                suggestions.append({
                    'user_id': member.user.id,
                    'full_name': member.user.get_full_name() or member.user.username,
                    'score': score,
                    'breakdown': breakdown,
                    'reasons': reasons if reasons else ["Available member"],
                    'is_external': False
                })

        # 2. Global search if project team is small or no matches
        if len(suggestions) < 3:
            from matching.models import EmployeeProfile
            external_candidates = EmployeeProfile.objects.exclude(user_id__in=member_user_ids).select_related('user')
            required_role_names = [rr.role.name for rr in task.required_roles.all()]
            
            for profile in external_candidates[:10]:
                score = 0
                breakdown = {'role_match': 0, 'workload': 0, 'experience': 40, 'availability': 0}
                reasons = []
                
                # Simple role heuristic: position contains role name
                for role_name in required_role_names:
                    if role_name.lower() in profile.position.lower():
                        breakdown['role_match'] = 40
                        score += 40
                        reasons.append(f"Global role match: {profile.position}")
                        break
                
                load = profile.current_workload_percentage
                if load < 50:
                    breakdown['availability'] = 30
                    score += 30
                    reasons.append(f"Global availability: {load}% load")
                
                if score > 10:
                    suggestions.append({
                        'user_id': profile.user.id,
                        'full_name': profile.user.get_full_name() or profile.user.username,
                        'score': score,
                        'breakdown': breakdown,
                        'reasons': reasons,
                        'is_external': True
                    })
        
        suggestions.sort(key=lambda x: x['score'], reverse=True)
        return Response(suggestions)

    @action(detail=True, methods=['post'])
    def assign_user(self, request, pk=None):
        task = self.get_object()
        user_id = request.data.get('user_id')
        allow_auto_add = request.data.get('allow_auto_add', False)

        if not user_id:
            return Response({'error': 'user_id is required'}, status=400)
            
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            user = User.objects.get(id=user_id)
            from .services import AssignmentService
            
            role = request.data.get('role', 'DEVELOPER')
            role_ref_id = request.data.get('role_ref_id')
            
            allocation = request.data.get('allocation_percentage')
            
            try:
                AssignmentService.assign_user(
                    task, user, 
                    allow_auto_add=allow_auto_add, 
                    role=role, 
                    role_ref_id=role_ref_id,
                    allocation_percentage=allocation
                )
                
                # If linked to WorkflowTask, update that too
                if hasattr(task, 'workflow_task') and task.workflow_task:
                    task.workflow_task.assigned_to = user
                    task.workflow_task.save(update_fields=['assigned_to'])
                    
                return Response({'status': 'assigned', 'user': user.get_full_name()})
            except ValidationError as e:
                return Response({'error': str(e.detail[0]) if isinstance(e.detail, list) else str(e.detail)}, status=400)

        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=404)

    @action(detail=True, methods=['post'])
    def simulate(self, request, pk=None):
        """Pre-calculate schedule changes without saving."""
        task = self.get_object()
        days = int(request.data.get('days', 0))
        
        # Simple simulation: what's the new end date for the block?
        # In a real app we'd run the propagation in-memory
        from datetime import timedelta
        new_end = task.end_date + timedelta(days=days) if task.end_date else None
        
        return Response({
            'new_end_date': new_end.strftime('%Y-%m-%d') if new_end else None,
            'impacted_tasks_count': task.dependent_tasks.count()
        })


    @action(detail=True, methods=['post'])
    def recalculate(self, request, pk=None):
        task = self.get_object()
        PlanningImportService.recalculate_block_schedule(task.block)
        return Response({'status': 'schedule recalculated'})

    @action(detail=True, methods=['post'])
    def shift(self, request, pk=None):
        task = self.get_object()
        new_start_date_str = request.data.get('start_date')
        if not new_start_date_str:
            return Response({'error': 'start_date is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            new_start_date = datetime.date.fromisoformat(new_start_date_str)
        except ValueError:
            return Response({'error': 'invalid date format'}, status=status.HTTP_400_BAD_REQUEST)
        
        PlanningImportService.shift_task_with_propagation(task, new_start_date)
        return Response({'status': 'task shifted'})


class TaskDependencyViewSet(viewsets.ModelViewSet):
    queryset = TaskDependency.objects.all()
    serializer_class = TaskDependencySerializer
    permission_classes = [IsAuthenticated]


class AnalyticsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        from matching.models import EmployeeProfile
        from workflows.models import WorkflowTask
        user = request.user
        if user.role == 'EMPLOYEE':
            return Response({
                'kpis': {'total_projects': 0, 'active_projects': 0, 'total_employees': 0, 'avg_progress': 0},
                'domain_stats': [],
                'performance_trend': []
            })

        total_projects = Project.objects.count()
        active_projects = Project.objects.filter(status__in=['ACTIVE', 'AT_RISK']).count()
        total_employees = EmployeeProfile.objects.count()
        workflow_tasks = WorkflowTask.objects.all()
        total_tasks_count = workflow_tasks.count()
        done_tasks_count = workflow_tasks.filter(status='DONE').count()
        avg_progress = round((done_tasks_count / total_tasks_count * 100)) if total_tasks_count > 0 else 0

        domain_stats = EmployeeProfile.objects.values('domain').annotate(
            avg_load=Avg('workload_entries__load_percent'),
            emp_count=Count('id', distinct=True)
        )

        today = timezone.now().date()
        performance_trend = []
        for i in range(29, -1, -1):
            date = today - timedelta(days=i)
            actual = WorkflowTask.objects.filter(status='DONE', completed_at__date=date).count()
            planned = WorkflowTask.objects.filter(due_date__date=date).count()
            performance_trend.append({'period': date.strftime('%d.%m'), 'planned': planned, 'actual': actual})

        return Response({
            'kpis': {
                'total_projects': total_projects,
                'active_projects': active_projects,
                'total_employees': total_employees,
                'avg_progress': avg_progress,
            },
            'domain_stats': list(domain_stats),
            'performance_trend': performance_trend,
        })
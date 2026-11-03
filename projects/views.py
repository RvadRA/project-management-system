import datetime
import os
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from notifications.utils import notify
from . import access
from .models import Project, ProjectMember, PlanningBlock, Task, TaskDependency, AuditLog, GlobalSetting, KnowledgeMaterial
from .permissions import (
    IsAdminOrReadOnly, require, require_project_perm, require_project_manager,
)
from .serializers import (
    ProjectSerializer, ProjectMemberSerializer, PlanningBlockSerializer,
    TaskSerializer, TaskDependencySerializer, AuditLogSerializer, GlobalSettingSerializer,
    KnowledgeMaterialSerializer, can_edit_material,
)
from .services import (
    PlanningImportService, auto_allocation, default_allocation_period, employee_capacity, sync_workload_entry,
)

User = get_user_model()

PM_ROLE_KEYWORDS = ('manager', 'менеджер', 'руководитель')


def _log(project, user, action, detail=None):
    AuditLog.objects.create(project=project, user=user, action=action, detail=detail or {})


def _is_pm_role_name(name):
    name = (name or '').lower()
    return any(kw in name for kw in PM_ROLE_KEYWORDS)


def _parse_scaling_factor(data):
    try:
        factor = float(data.get('scaling_factor', 1.0))
    except (TypeError, ValueError):
        raise ValidationError({'scaling_factor': 'Коэффициент масштабирования должен быть числом.'})
    if factor <= 0:
        raise ValidationError({'scaling_factor': 'Коэффициент масштабирования должен быть больше 0.'})
    return factor


def _parse_date(value, field):
    if value in (None, ''):
        return None
    try:
        return datetime.date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({field: 'Дата должна быть в формате ГГГГ-ММ-ДД.'})


def _require_block_edit(user, block):
    """Этапы проекта правят участники с can_edit_tasks, шаблоны — те, кто ведёт библиотеку."""
    if block.project_id:
        require_project_perm(user, block.project, 'can_edit_tasks')
    else:
        require(access.can_manage_library(user), "Изменять шаблоны могут только менеджеры и администраторы.")


class GlobalSettingViewSet(viewsets.ModelViewSet):
    queryset = GlobalSetting.objects.all().order_by('key')
    serializer_class = GlobalSettingSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


class KnowledgeMaterialViewSet(viewsets.ModelViewSet):
    """
    Файловое хранилище и база знаний.
    project=NULL — общая база знаний, иначе — файлы проекта с проверкой прав участника.
    """
    queryset = KnowledgeMaterial.objects.select_related('project', 'created_by').all()
    serializer_class = KnowledgeMaterialSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['project', 'category']
    search_fields = ['title', 'description', 'text_instruction']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if self.request.query_params.get('scope') == 'global':
            qs = qs.filter(project__isnull=True)
        if access.has_global_access(user):
            return qs
        return qs.filter(
            Q(project__isnull=True)
            | Q(project_id__in=access.project_ids_with_perm(user, 'can_view_files'))
        )

    def _require_create_in(self, project):
        user = self.request.user
        if project is not None:
            require_project_perm(user, project, 'can_edit_files', "У вас нет права загружать файлы в этот проект.")
        else:
            require(
                access.can_manage_library(user),
                "Добавлять материалы в общую базу знаний могут только менеджеры и администраторы.",
            )

    def perform_create(self, serializer):
        self._require_create_in(serializer.validated_data.get('project'))
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        material = serializer.instance
        require(can_edit_material(self.request.user, material), "У вас нет прав для изменения этого материала.")
        # Перенос в другой проект требует права записи и там
        if 'project' in serializer.validated_data and serializer.validated_data['project'] != material.project:
            self._require_create_in(serializer.validated_data['project'])
        serializer.save()

    def perform_destroy(self, instance):
        require(can_edit_material(self.request.user, instance), "У вас нет прав для удаления этого материала.")
        if instance.file:
            instance.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """Скачивание файла с проверкой прав (get_object уже ограничен get_queryset)."""
        material = self.get_object()
        if not material.file:
            return Response({'error': 'К материалу не прикреплён файл.'}, status=status.HTTP_404_NOT_FOUND)
        from config.uploads import file_response
        try:
            # ?inline=1 — показать картинку в интерфейсе; остальное всегда отдаётся как вложение
            return file_response(material.file, inline_image=request.query_params.get('inline') == '1')
        except FileNotFoundError:
            return Response({'error': 'Файл не найден в хранилище.'}, status=status.HTTP_404_NOT_FOUND)


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.prefetch_related('members__user').all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return access.filter_visible_projects(super().get_queryset(), self.request.user)

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _pm_role_ref():
        from plans.models import ProjectRole
        return (
            ProjectRole.objects.filter(name__icontains='manager').first()
            or ProjectRole.objects.filter(name__icontains='менеджер').first()
        )

    def _ensure_manager_member(self, project, user, allocation=None):
        """Менеджер проекта всегда состоит в команде с ролью MANAGER."""
        member = ProjectMember.objects.filter(project=project, user=user).first()
        if member:
            member.role = access.MEMBER_ROLE_MANAGER
            if allocation is not None:
                member.allocation_percentage = allocation
            if member.role_ref is None:
                member.role_ref = self._pm_role_ref()
            member.save()
        else:
            member = ProjectMember.objects.create(
                project=project, user=user, role=access.MEMBER_ROLE_MANAGER,
                role_ref=self._pm_role_ref(),
                allocation_percentage=allocation if allocation is not None else 100,
            )
        self._sync_workload_entry(project, user, member.allocation_percentage)
        return member

    def _sync_workload_entry(self, project, user, allocation, start=None, end=None):
        sync_workload_entry(project, user, allocation, start, end)

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def perform_create(self, serializer):
        user = self.request.user
        require(access.can_create_projects(user), "У вас нет прав создавать проекты.")

        extra = {}
        # Менеджер без глобального доступа должен остаться менеджером созданного проекта,
        # иначе он сразу потеряет к нему доступ
        if not serializer.validated_data.get('manager') and not access.has_global_access(user):
            extra['manager'] = user
        project = serializer.save(**extra)
        _log(project, user, 'PROJECT_CREATED', {'name': project.name})

        base_instructions = self.request.data.get('base_instructions')
        if base_instructions:
            KnowledgeMaterial.objects.create(
                title=f"Базовая инструкция: {project.name}",
                description=f"Базовые методические материалы для проекта {project.name}",
                text_instruction=base_instructions,
                category='INSTRUCTION',
                tags=["базовая", "инструкция"],
                project=project,
                created_by=user
            )

        if project.manager:
            allocation = serializer.validated_data.get('manager_allocation', 100)
            self._ensure_manager_member(project, project.manager, allocation)
            if project.manager != user and not access.has_global_access(user):
                # Создатель-менеджер, назначивший ответственным коллегу, остаётся со-менеджером
                ProjectMember.objects.get_or_create(
                    project=project, user=user,
                    defaults={'role': access.MEMBER_ROLE_MANAGER, 'role_ref': self._pm_role_ref(), 'allocation_percentage': 0},
                )
            if project.manager != user:
                notify(
                    recipient=project.manager,
                    title='Вы назначены менеджером проекта',
                    body=f'Вы назначены ответственным за проект "{project.name}".',
                    notif_type='INFO',
                    project_id=project.id
                )

    def perform_update(self, serializer):
        user = self.request.user
        old_manager = serializer.instance.manager
        require_project_manager(user, serializer.instance, "Редактировать проект может только его менеджер.")

        project = serializer.save()
        _log(project, user, 'PROJECT_UPDATED', {'name': project.name})

        if project.manager and project.manager != old_manager:
            notify(
                recipient=project.manager,
                title='Вы назначены менеджером проекта',
                body=f'Вы назначены новым ответственным за проект "{project.name}".',
                notif_type='INFO',
                project_id=project.id
            )
            # Прежний ответственный остаётся в команде обычным участником
            if old_manager:
                ProjectMember.objects.filter(
                    project=project, user=old_manager, role=access.MEMBER_ROLE_MANAGER
                ).update(role='DEVELOPER')

        if project.manager:
            allocation = serializer.validated_data.get('manager_allocation')
            self._ensure_manager_member(project, project.manager, allocation)

    def perform_destroy(self, instance):
        user = self.request.user
        require_project_manager(user, instance, "Удалить проект может только его менеджер.")
        instance.delete()

    # ── Команда и права ──────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='members')
    def members(self, request, pk=None):
        project = self.get_object()
        serializer = ProjectMemberSerializer(
            project.members.select_related('user').all(), many=True
        )
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='members/add')
    def add_member(self, request, pk=None):
        project = self.get_object()
        require_project_perm(request.user, project, 'can_manage_members', "У вас нет прав управлять командой проекта.")

        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_user = User.objects.get(id=user_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        role = str(request.data.get('role') or 'DEVELOPER')[:30]  # CharField(max_length=30)
        role_ref = None
        role_ref_id = request.data.get('role_ref_id')
        if role_ref_id:
            from plans.models import ProjectRole
            role_ref = ProjectRole.objects.filter(id=role_ref_id).first()

        # Ищем существующего участника, чтобы сохранить его загрузку при смене роли
        existing_member = ProjectMember.objects.filter(project=project, user=target_user).first()

        raw_allocation = request.data.get('allocation_percentage')
        if raw_allocation is not None and str(raw_allocation).strip() != "":
            try:
                allocation = int(raw_allocation)
            except (TypeError, ValueError):
                return Response({'error': 'Загрузка должна быть целым числом.'}, status=status.HTTP_400_BAD_REQUEST)
        elif existing_member:
            allocation = existing_member.allocation_percentage
        else:
            allocation = None   # новый участник без указанной загрузки — берём свободное время сотрудника

        if allocation is not None and not 0 < allocation <= 100:
            return Response({'error': 'Загрузка на проект должна быть от 1 до 100%'}, status=status.HTTP_400_BAD_REQUEST)

        # Роль «Project Manager» из справочника приравнивается к менеджеру проекта.
        # Менеджеров в проекте может быть несколько.
        is_pm_role = role == access.MEMBER_ROLE_MANAGER or (role_ref is not None and _is_pm_role_name(role_ref.name))
        if is_pm_role:
            role = access.MEMBER_ROLE_MANAGER

        # Назначать и разжаловать менеджеров может только менеджер проекта
        if is_pm_role or (existing_member and existing_member.is_manager):
            require_project_manager(request.user, project, "Назначать менеджеров может только менеджер проекта.")

        # Период загрузки: явный, либо прежний (у существующего участника), либо сроки проекта
        from matching.models import WorkloadEntry
        from matching.services import ensure_profile
        start = _parse_date(request.data.get('start_date'), 'start_date')
        end = _parse_date(request.data.get('end_date'), 'end_date')
        profile = ensure_profile(target_user)
        old_entry = WorkloadEntry.objects.filter(employee=profile, project=project).first()
        period_start = start or (old_entry.start_date if old_entry else default_allocation_period(project)[0])
        period_end = end or (old_entry.end_date if old_entry else default_allocation_period(project)[1])
        if period_end < period_start:
            return Response({'error': 'Дата окончания не может быть раньше даты начала.'}, status=status.HTTP_400_BAD_REQUEST)

        # Проверка лимита загрузки (100%) по самому занятому дню периода, а не только по сегодняшнему
        cap = employee_capacity(profile, project, period_start, period_end)
        if allocation is None:
            allocation = int(min(100, (cap['free_percent'] // 5) * 5))
            if allocation <= 0:
                return Response({
                    'error': (
                        f"В период {period_start:%d.%m.%Y} – {period_end:%d.%m.%Y} сотрудник полностью занят "
                        f"(пик {cap['peak_load_percent']:.0f}%) — добавить его в команду нельзя."
                    )
                }, status=status.HTTP_400_BAD_REQUEST)
        increases_load = (
            not existing_member or allocation > existing_member.allocation_percentage or bool(start) or bool(end)
        )
        if allocation > cap['free_percent'] and increases_load:
            return Response({
                'error': (
                    f"Превышение загрузки сотрудника: в период {period_start:%d.%m.%Y} – {period_end:%d.%m.%Y} "
                    f"в самые занятые дни он занят на {cap['peak_load_percent']:.0f}%, свободно {cap['free_percent']:.0f}%, "
                    f"а требуется {allocation}%. Максимум 100%."
                )
            }, status=status.HTTP_400_BAD_REQUEST)

        member, created = ProjectMember.objects.update_or_create(
            project=project, user=target_user,
            defaults={'role': role, 'role_ref': role_ref, 'allocation_percentage': allocation}
        )

        if is_pm_role and not project.manager:
            project.manager = target_user
            project.save(update_fields=['manager'])
        elif not is_pm_role and project.manager_id == target_user.id:
            # Ответственного менеджера разжаловали — передаём ответственность другому менеджеру
            self._reassign_primary_manager(project, exclude_user=target_user)

        self._sync_workload_entry(project, target_user, allocation, start, end)

        log_role = role_ref.name if role_ref else role
        if created:
            notify(
                recipient=target_user,
                title=f"Новый проект: {project.name}",
                body=f"Вы были включены в команду проекта '{project.name}' в роли '{log_role}'.",
                notif_type='INFO',
                project_id=project.id
            )

        _log(project, request.user, 'MEMBER_ADDED' if created else 'MEMBER_UPDATED',
             {'user_id': target_user.id, 'role': log_role, 'role_ref': role_ref_id, 'allocation': allocation,
              'period': f'{period_start}..{period_end}'})
        return Response(ProjectMemberSerializer(member).data, status=status.HTTP_201_CREATED)

    # ── Загрузка: свободное время и рекомендация ─────────────────────────────

    @action(detail=True, methods=['get'], url_path='capacity')
    def capacity(self, request, pk=None):
        """
        GET /projects/list/{id}/capacity/?user_id=5&start=2026-11-01&end=2026-12-31

        Как определить «Загрузку на этот проект (%)»: сколько у сотрудника свободно в период,
        сколько часов это даёт и какая загрузка нужна под его назначенные задачи проекта.
        """
        from matching.capacity import hours_to_percent, percent_to_hours
        from matching.services import ensure_profile
        from workflows.models import WorkflowTask

        project = self.get_object()
        require_project_perm(request.user, project, 'can_manage_members', "У вас нет прав управлять командой проекта.")
        try:
            target = User.objects.get(id=request.query_params.get('user_id'))
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        default_start, default_end = default_allocation_period(project)
        start = _parse_date(request.query_params.get('start'), 'start') or default_start
        end = _parse_date(request.query_params.get('end'), 'end') or default_end
        if end < start:
            return Response({'error': 'Дата окончания не может быть раньше даты начала.'}, status=status.HTTP_400_BAD_REQUEST)

        profile = ensure_profile(target)
        cap = employee_capacity(profile, project, start, end)

        member = ProjectMember.objects.filter(project=project, user=target).first()
        # Трудозатраты уже назначенных на сотрудника открытых задач проекта (плана и процессов)
        open_wbs = Task.objects.filter(block__project=project, assigned_to=target).exclude(status='DONE')
        open_wf = WorkflowTask.objects.filter(workflow__project=project, assigned_to=target).exclude(status='DONE')
        assigned_hours = round(
            sum(t.estimated_hours or 0 for t in open_wbs) + sum(t.estimated_hours or 0 for t in open_wf), 1
        )
        unestimated = open_wbs.filter(estimated_hours__lte=0).count() + open_wf.filter(estimated_hours__lte=0).count()
        from_tasks = hours_to_percent(assigned_hours, cap['available_hours']) if assigned_hours else None

        free = cap['free_percent']
        # Под задачи — сколько нужно, но не больше свободного; без оценок — всё свободное время
        recommended = min(free, from_tasks) if from_tasks is not None else free
        recommended = float((recommended // 5) * 5) if recommended >= 5 else 0.0
        return Response({
            **cap,
            'start': start, 'end': end,
            'current_percent': member.allocation_percentage if member else None,
            'assigned_hours': assigned_hours,
            'unestimated_tasks': unestimated,
            'from_tasks_percent': from_tasks,
            'recommended_percent': recommended,
            'free_hours': percent_to_hours(free, cap['available_hours']),
        })

    # ── Оценка участников по итогам проекта ──────────────────────────────────

    def _ratings_payload(self, project):
        from matching.services import sync_project_participations
        sync_project_participations(project)
        rows = []
        participations = {
            p.employee.user_id: p
            for p in project.participations_qs().select_related('employee__user', 'rated_by')
        }
        for member in project.members.select_related('user', 'role_ref'):
            part = participations.get(member.user_id)
            score = part.performance_score if part and part.performance_score > 0 else None
            rows.append({
                'user_id': member.user_id,
                'full_name': member.user.get_full_name() or member.user.username,
                'position': 'Менеджер проекта' if member.is_manager else (member.role_ref.name if member.role_ref else member.role),
                'stars': round(score * 5) if score else None,
                'comment': part.comment if part else '',
                'rated_at': part.rated_at if part else None,
                'rated_by': (part.rated_by.get_full_name() or part.rated_by.username) if part and part.rated_by else None,
            })
        return rows

    @action(detail=True, methods=['get', 'post'], url_path='ratings')
    def ratings(self, request, pk=None):
        """
        GET  /projects/list/{id}/ratings/ — участники и их оценки;
        POST {"ratings": [{"user_id": 5, "stars": 4, "comment": "..."}]} — выставить оценки 1–5.
        Оценки по итогам проекта учитываются в подборе команды (компонент «Результативность»).
        """
        from matching.models import ProjectParticipation
        project = self.get_object()
        require_project_manager(request.user, project, "Оценивать участников может только менеджер проекта.")

        if request.method == 'GET':
            return Response({'project_status': project.status, 'ratings': self._ratings_payload(project)})

        if project.status != 'COMPLETED':
            return Response({'error': 'Оценить команду можно после завершения проекта.'}, status=status.HTTP_400_BAD_REQUEST)
        items = request.data.get('ratings')
        if not isinstance(items, list) or not items:
            return Response({'error': 'ratings must be a non-empty list'}, status=status.HTTP_400_BAD_REQUEST)

        self._ratings_payload(project)   # гарантирует, что записи участия созданы
        saved = 0
        for item in items:
            try:
                user_id = int(item.get('user_id'))
                stars = int(item.get('stars'))
            except (AttributeError, TypeError, ValueError):
                return Response({'error': 'Для каждого участника нужны user_id и stars (1–5).'}, status=status.HTTP_400_BAD_REQUEST)
            if not 1 <= stars <= 5:
                return Response({'error': 'Оценка должна быть от 1 до 5.'}, status=status.HTTP_400_BAD_REQUEST)
            if user_id == request.user.id:
                return Response({'error': 'Нельзя оценивать себя.'}, status=status.HTTP_400_BAD_REQUEST)
            part = ProjectParticipation.objects.filter(project=project, employee__user_id=user_id).first()
            if part is None:
                return Response({'error': f'Пользователь {user_id} не участвовал в проекте.'}, status=status.HTTP_400_BAD_REQUEST)
            part.performance_score = stars / 5
            part.comment = str(item.get('comment') or '').strip()[:1000]
            part.rated_by = request.user
            part.rated_at = timezone.now()
            part.save()
            saved += 1
        _log(project, request.user, 'TEAM_RATED', {'count': saved})
        return Response({'saved': saved, 'ratings': self._ratings_payload(project)})

    @action(detail=True, methods=['post'], url_path='members/permissions')
    def set_member_permissions(self, request, pk=None):
        """
        Настройка прав участника флажками.
        Body: {"user_id": 5, "permissions": {"can_edit_tasks": true, "can_view_files": false}}
        """
        project = self.get_object()
        require_project_manager(request.user, project, "Настраивать права участников может только менеджер проекта.")

        member = ProjectMember.objects.filter(project=project, user_id=request.data.get('user_id')).first()
        if not member:
            return Response({'error': 'Участник не найден в проекте.'}, status=status.HTTP_404_NOT_FOUND)
        if member.is_manager:
            return Response(
                {'error': 'У менеджера проекта все права включены. Чтобы ограничить его, смените роль.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        perms = request.data.get('permissions')
        if not isinstance(perms, dict):
            return Response({'error': 'permissions must be an object'}, status=status.HTTP_400_BAD_REQUEST)
        unknown = set(perms) - set(access.PROJECT_PERMISSION_KEYS)
        if unknown:
            return Response({'error': f'Неизвестные права: {", ".join(sorted(unknown))}'}, status=status.HTTP_400_BAD_REQUEST)

        changed = {}
        for key, value in perms.items():
            value = bool(value)
            if getattr(member, key) != value:
                setattr(member, key, value)
                changed[key] = value
        if changed:
            member.save(update_fields=list(changed))
            _log(project, request.user, 'MEMBER_PERMISSIONS_UPDATED', {'user_id': member.user_id, 'changed': changed})
        return Response(ProjectMemberSerializer(member).data)

    @staticmethod
    def _reassign_primary_manager(project, exclude_user):
        successor = ProjectMember.objects.filter(
            project=project, role=access.MEMBER_ROLE_MANAGER
        ).exclude(user=exclude_user).select_related('user').first()
        project.manager = successor.user if successor else None
        project.save(update_fields=['manager'])

    @action(detail=False, methods=['get'], url_path='metadata')
    def metadata(self, request):
        """Return choices for statuses and other metadata."""
        return Response({
            'statuses': dict(Project.STATUS_CHOICES),
            'roles': dict(ProjectMember.ROLE_CHOICES),
            'task_statuses': dict(Task.STATUS_CHOICES),
            'user_roles': dict(User.ROLE_CHOICES),
            'member_permissions': [{'key': key, 'label': label} for key, label in access.PROJECT_PERMISSIONS],
            'material_categories': dict(KnowledgeMaterial.CATEGORY_CHOICES),
        })

    @action(detail=True, methods=['post'], url_path='members/remove')
    def remove_member(self, request, pk=None):
        project = self.get_object()
        require_project_perm(request.user, project, 'can_manage_members', "У вас нет прав управлять командой проекта.")
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        member = ProjectMember.objects.filter(project=project, user_id=user_id).select_related('user').first()
        if not member:
            return Response(status=status.HTTP_204_NO_CONTENT)
        if member.is_manager:
            require_project_manager(request.user, project, "Исключить менеджера может только менеджер проекта.")
        target_user = member.user
        member.delete()

        if project.manager_id == target_user.id:
            self._reassign_primary_manager(project, exclude_user=target_user)

        # Также удаляем запись о нагрузке, чтобы % сразу уменьшился
        from matching.models import WorkloadEntry
        WorkloadEntry.objects.filter(employee__user=target_user, project=project).delete()

        _log(project, request.user, 'MEMBER_REMOVED', {'user_id': target_user.id})
        notify(
            recipient=target_user,
            title='Исключение из проекта',
            body=f'Вы были исключены из команды проекта "{project.name}".',
            notif_type='INFO',
            project_id=project.id,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Импорт / шаблоны ─────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='import')
    def import_from_project(self, request, pk=None):
        """Clone this project into a new project."""
        source = self.get_object()
        require(access.can_create_projects(request.user), "У вас нет прав создавать проекты.")
        require_project_manager(request.user, source, "Клонировать проект может только его менеджер.")

        new_name = request.data.get('name', f'{source.name} (копия)')
        copy_dates = request.data.get('copy_dates', False)
        copy_team = request.data.get('copy_team', True)
        scaling_factor = _parse_scaling_factor(request.data)

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
                    project=new_project, user=m.user,
                    defaults={
                        'role': m.role, 'role_ref': m.role_ref,
                        **{key: getattr(m, key) for key in access.PROJECT_PERMISSION_KEYS},
                    }
                )
        self._ensure_manager_member(new_project, request.user)

        block_ids = request.data.get('block_ids', None)
        blocks_to_copy = source.blocks.filter(is_template=False).prefetch_related('tasks__outgoing_dependencies')
        if block_ids:
            blocks_to_copy = blocks_to_copy.filter(id__in=block_ids)

        failed_blocks = []
        for block in blocks_to_copy:
            try:
                PlanningImportService.import_block_to_project(
                    block, new_project, datetime.date.today(), scaling_factor
                )
            except Exception:
                failed_blocks.append(block.name)
        _log(new_project, request.user, 'PROJECT_IMPORTED_FROM',
             {'source_id': source.id, 'source_name': source.name, 'failed_blocks': failed_blocks})
        return Response(self.get_serializer(new_project).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='create-from-template')
    def create_from_template(self, request):
        """Create a new project using a template block as the initial WBS."""
        require(access.can_create_projects(request.user), "У вас нет прав создавать проекты.")

        template_id = request.data.get('template_id')
        new_name = request.data.get('name')
        if not template_id or not new_name:
            return Response({'error': 'template_id and name are required'}, status=400)

        try:
            template_block = PlanningBlock.objects.get(id=template_id, is_template=True)
        except PlanningBlock.DoesNotExist:
            return Response({'error': 'Template block not found'}, status=404)

        scaling_factor = _parse_scaling_factor(request.data)
        task_ids = request.data.get('task_ids', None)

        new_project = Project.objects.create(
            name=new_name,
            description=f'Создано из шаблона «{template_block.name}»',
            domain=template_block.domain or 'IT',
            status='DRAFT',
            start_date=datetime.date.today(),
            manager=request.user,
        )
        self._ensure_manager_member(new_project, request.user)

        PlanningImportService.import_template_to_project(
            template_block, new_project, datetime.date.today(), scaling_factor, task_ids=task_ids
        )

        _log(new_project, request.user, 'PROJECT_CREATED', {'name': new_name, 'template': template_block.name})
        return Response(self.get_serializer(new_project).data, status=status.HTTP_201_CREATED)


class PlanningBlockViewSet(viewsets.ModelViewSet):
    queryset = PlanningBlock.objects.prefetch_related(
        'tasks__required_roles__role',
        'tasks__incoming_dependencies',
        'tasks__outgoing_dependencies',
        'typical_risks',
        'calendar'
    ).all().order_by('id')
    serializer_class = PlanningBlockSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if access.has_global_access(user):
            return qs
        visible = Q(project_id__in=access.visible_project_ids(user))
        if access.can_manage_library(user):
            visible |= Q(project__isnull=True)
        return qs.filter(visible)

    def perform_create(self, serializer):
        user = self.request.user
        project = serializer.validated_data.get('project')
        parent = serializer.validated_data.get('parent')
        if project is None and parent is not None:
            project = parent.project
        if project is not None:
            require_project_perm(user, project, 'can_edit_tasks', "У вас нет прав изменять план этого проекта.")
        else:
            require(access.can_manage_library(user), "Создавать шаблоны могут только менеджеры и администраторы.")

        template_id = self.request.data.get('template_id')
        if template_id and project is not None:
            try:
                template_block = PlanningBlock.objects.get(id=template_id, is_template=True)
            except (PlanningBlock.DoesNotExist, ValueError, TypeError):
                raise ValidationError({'template_id': 'Шаблон не найден.'})
            start_date = project.start_date or datetime.date.today()
            # We return the new block, but serializer needs to know
            serializer.instance = PlanningImportService.clone_block_recursive(
                template_block, project, start_date, parent=parent
            )
        else:
            serializer.save()

    def perform_update(self, serializer):
        _require_block_edit(self.request.user, serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        _require_block_edit(self.request.user, instance)
        instance.delete()

    @action(detail=False, methods=['get'], url_path='by-project')
    def by_project(self, request):
        """Fetch root planning blocks for a specific project."""
        project_id = request.query_params.get('project_id')
        if not project_id:
            return Response({'error': 'project_id is required'}, status=400)
        project = access.filter_visible_projects(Project.objects.all(), request.user).filter(id=project_id).first()
        if not project:
            return Response({'error': 'Проект не найден или недоступен.'}, status=status.HTTP_404_NOT_FOUND)
        # Only fetch ROOT blocks (parent is None) to start the tree
        blocks = PlanningBlock.objects.filter(
            project=project, is_template=False, parent__isnull=True
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
        except (Project.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Invalid project_id or start_date'}, status=status.HTTP_400_BAD_REQUEST)

        require_project_perm(request.user, project, 'can_edit_tasks', "У вас нет прав изменять план целевого проекта.")
        if source_block.project_id:
            require_project_perm(
                request.user, source_block.project, 'can_view_all_tasks',
                "У вас нет прав копировать план исходного проекта.",
            )

        scaling_factor = _parse_scaling_factor(request.data)
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
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        _log(project, request.user, 'PLANNING_TRANSFERRED', {'block': source_block.name, 'from_template': source_block.is_template})
        return Response(self.get_serializer(new_block).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='make-template')
    def make_template(self, request, pk=None):
        block = self.get_object()
        require(access.can_manage_library(request.user), "Сохранять шаблоны могут только менеджеры и администраторы.")
        if block.is_template:
            return Response({'error': 'Блок уже является шаблоном.'}, status=400)
        require_project_perm(request.user, block.project, 'can_view_all_tasks')

        template_name = (request.data.get('name') or '').strip() or f"Шаблон: {block.name}"
        new_template = PlanningImportService.save_block_as_template(block, template_name)
        _log(block.project, request.user, 'PLANNING_SAVED_AS_TEMPLATE', {'block': block.name, 'template': template_name})
        return Response(self.get_serializer(new_template).data, status=status.HTTP_201_CREATED)


class ImportPlanningView(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def create(self, request):
        block_id = request.data.get('block_id')
        project_id = request.data.get('project_id')
        start_date_str = request.data.get('start_date')
        if not all([block_id, project_id, start_date_str]):
            return Response({'error': 'block_id, project_id and start_date are required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            block = PlanningBlock.objects.get(id=block_id, is_template=True)
            project = Project.objects.get(id=project_id)
            start_date = datetime.date.fromisoformat(start_date_str)
        except (PlanningBlock.DoesNotExist, Project.DoesNotExist, ValueError, TypeError) as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        require_project_perm(request.user, project, 'can_edit_tasks', "У вас нет прав изменять план этого проекта.")
        scaling_factor = _parse_scaling_factor(request.data)
        new_block = PlanningImportService.import_template_to_project(block, project, start_date, scaling_factor)
        _log(project, request.user, 'PLANNING_IMPORTED', {'block': block.name})
        return Response(
            PlanningBlockSerializer(new_block, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related('project', 'user').all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ['project']

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if access.has_global_access(user):
            return qs
        # Журнал проекта доступен только его менеджерам
        return qs.filter(project_id__in=access.managed_project_ids(user))


class TaskViewSet(viewsets.ModelViewSet):
    queryset = Task.objects.all().order_by('block_id', 'order', 'id')
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset().select_related('assigned_to', 'block__project', 'parent', 'workflow_task')
        project_id = self.request.query_params.get('project_id')
        if project_id:
            qs = qs.filter(block__project_id=project_id)
        user = self.request.user
        if access.has_global_access(user):
            return qs
        visible = (
            Q(block__project_id__in=access.project_ids_with_perm(user, 'can_view_all_tasks'))
            | Q(assigned_to=user, block__project_id__in=access.visible_project_ids(user))
        )
        if access.can_manage_library(user):
            visible |= Q(block__project__isnull=True)
        return qs.filter(visible)

    def _require_edit(self, task):
        _require_block_edit(self.request.user, task.block)

    def _require_assign(self, project):
        require_project_perm(
            self.request.user, project, 'can_assign_tasks', "У вас нет права назначать исполнителей в этом проекте."
        )

    def perform_create(self, serializer):
        user = self.request.user
        block = serializer.validated_data['block']
        _require_block_edit(user, block)
        if serializer.validated_data.get('assigned_to') and block.project_id:
            self._require_assign(block.project)

        # Inherit process_template from block if not provided
        extra = {}
        if not serializer.validated_data.get('process_template') and block.process_template:
            extra['process_template'] = block.process_template

        task = serializer.save(**extra)
        project = block.project
        if project is None:
            return

        create_workflow = self.request.data.get('create_workflow', False)
        if create_workflow and task.process_template:
            from workflows.services import WorkflowService
            WorkflowService.create_process_from_template(
                task.process_template,
                project,
                wbs_task=task,
                creator=user
            )
            _log(project, user, 'PLANNING_TASK_WORKFLOW_CREATED', {'task_id': task.id})

        # Set default dates if not provided
        if not task.start_date:
            task.start_date = project.start_date or timezone.now().date()
            if not task.end_date:
                task.end_date = task.start_date + timedelta(days=task.duration_days or 1)
            task.save(update_fields=['start_date', 'end_date'])

    def perform_update(self, serializer):
        user = self.request.user
        task = serializer.instance
        project = task.block.project
        can_edit = (
            access.has_project_perm(user, project, 'can_edit_tasks') if project
            else access.can_manage_library(user)
        )
        changed = set(serializer.validated_data)
        if not can_edit:
            # Исполнитель может менять только статус собственной задачи
            require(task.assigned_to_id == user.id, "Вы не можете редактировать чужие задачи.")
            require(changed <= {'status'}, "Исполнитель может изменять только статус своей задачи.")
        if 'assigned_to' in changed and serializer.validated_data['assigned_to'] != task.assigned_to and project:
            self._require_assign(project)
        serializer.save()

    def perform_destroy(self, instance):
        self._require_edit(instance)
        instance.delete()

    @action(detail=True, methods=['get'])
    def suggest_assignee(self, request, pk=None):
        task = self.get_object()
        project = task.block.project
        if project is None:
            return Response([])
        self._require_assign(project)
        project_members = project.members.select_related('user', 'role_ref').all()
        required_role_names = [rr.role.name for rr in task.required_roles.select_related('role')]

        from matching.models import EmployeeProfile

        # 1. Project Team search
        suggestions = []
        member_user_ids = set()
        for member in project_members:
            member_user_ids.add(member.user.id)
            score = 0
            breakdown = {'role_match': 0, 'workload': 0, 'experience': 0, 'availability': 0}
            reasons = []

            # Role match
            member_role_names = {member.role, member.role_ref.name if member.role_ref else None}
            if member_role_names & set(required_role_names):
                breakdown['role_match'] = 50
                score += 50
                reasons.append(f"Role match: {member.role_ref.name if member.role_ref else member.role}")

            # Workload check
            profile = EmployeeProfile.objects.filter(user=member.user).first()
            if profile:
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
            external_candidates = EmployeeProfile.objects.exclude(user_id__in=member_user_ids).select_related('user')

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
        project = task.block.project
        if project is None:
            return Response({'error': 'Нельзя назначить исполнителя на задачу шаблона.'}, status=400)
        self._require_assign(project)

        user_id = request.data.get('user_id')
        allow_auto_add = bool(request.data.get('allow_auto_add', False))
        if not user_id:
            return Response({'error': 'user_id is required'}, status=400)
        try:
            user = User.objects.get(id=user_id)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'User not found'}, status=404)

        role = str(request.data.get('role') or 'DEVELOPER')[:30]  # CharField(max_length=30)
        role_ref_id = request.data.get('role_ref_id')
        allocation = request.data.get('allocation_percentage')

        is_member = ProjectMember.objects.filter(project=project, user=user).exists()
        if allow_auto_add and not is_member:
            # Автодобавление в команду — это уже управление составом проекта
            require_project_perm(request.user, project, 'can_manage_members', "У вас нет прав добавлять участников в проект.")
            if role == access.MEMBER_ROLE_MANAGER:
                require_project_manager(request.user, project, "Назначать менеджеров может только менеджер проекта.")

        from .services import AssignmentService
        try:
            AssignmentService.assign_user(
                task, user,
                allow_auto_add=allow_auto_add,
                role=role,
                role_ref_id=role_ref_id,
                allocation_percentage=allocation
            )
        except ValidationError as e:
            return Response({'error': str(e.detail[0]) if isinstance(e.detail, list) else str(e.detail)}, status=400)

        # If linked to WorkflowTask, update that too
        if task.workflow_task:
            task.workflow_task.assigned_to = user
            task.workflow_task.save(update_fields=['assigned_to'])

        return Response({'status': 'assigned', 'user': user.get_full_name() or user.username})

    @action(detail=True, methods=['post'])
    def simulate(self, request, pk=None):
        """Pre-calculate schedule changes without saving."""
        task = self.get_object()
        try:
            days = int(request.data.get('days', 0))
        except (TypeError, ValueError):
            return Response({'error': 'days must be an integer'}, status=status.HTTP_400_BAD_REQUEST)

        # Simple simulation: what's the new end date for the block?
        # In a real app we'd run the propagation in-memory
        new_end = task.end_date + timedelta(days=days) if task.end_date else None

        return Response({
            'new_end_date': new_end.strftime('%Y-%m-%d') if new_end else None,
            'impacted_tasks_count': task.outgoing_dependencies.count()
        })

    @action(detail=True, methods=['post'])
    def recalculate(self, request, pk=None):
        task = self.get_object()
        self._require_edit(task)
        PlanningImportService.recalculate_block_schedule(task.block)
        return Response({'status': 'schedule recalculated'})

    @action(detail=True, methods=['post'])
    def shift(self, request, pk=None):
        task = self.get_object()
        self._require_edit(task)
        new_start_date_str = request.data.get('start_date')
        if not new_start_date_str:
            return Response({'error': 'start_date is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            new_start_date = datetime.date.fromisoformat(new_start_date_str)
        except (ValueError, TypeError):
            return Response({'error': 'invalid date format'}, status=status.HTTP_400_BAD_REQUEST)

        PlanningImportService.shift_task_with_propagation(task, new_start_date)
        return Response({'status': 'task shifted'})


class TaskDependencyViewSet(viewsets.ModelViewSet):
    queryset = TaskDependency.objects.select_related(
        'from_task__block__project', 'to_task__block__project'
    ).all().order_by('id')
    serializer_class = TaskDependencySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if access.has_global_access(user):
            return qs
        visible = Q(from_task__block__project_id__in=access.project_ids_with_perm(user, 'can_view_all_tasks'))
        if access.can_manage_library(user):
            visible |= Q(from_task__block__project__isnull=True)
        return qs.filter(visible)

    def _require_edit(self, *tasks):
        for task in tasks:
            _require_block_edit(self.request.user, task.block)

    def perform_create(self, serializer):
        from_task = serializer.validated_data['from_task']
        to_task = serializer.validated_data['to_task']
        if from_task == to_task:
            raise ValidationError("Задача не может зависеть сама от себя.")
        self._require_edit(from_task, to_task)
        serializer.save()

    def perform_update(self, serializer):
        self._require_edit(serializer.instance.from_task, serializer.instance.to_task)
        self._require_edit(
            serializer.validated_data.get('from_task', serializer.instance.from_task),
            serializer.validated_data.get('to_task', serializer.instance.to_task),
        )
        serializer.save()

    def perform_destroy(self, instance):
        self._require_edit(instance.from_task, instance.to_task)
        instance.delete()


class AnalyticsViewSet(viewsets.ViewSet):
    """
    GET /projects/dashboard/?days=30|90|180|365

    Все цифры считаются по проектам, к которым у пользователя есть доступ:
    администратор и руководитель проектов видят всё, менеджер — свои проекты.
    """
    permission_classes = [IsAuthenticated]
    ALLOWED_PERIODS = (30, 90, 180, 365)

    @staticmethod
    def _trend(workflow_tasks, days):
        """
        План / факт по задачам процессов за период: план — задачи со сроком в этот день,
        факт — задачи, завершённые в этот день. Для периодов длиннее месяца точки — недели.
        """
        today = timezone.now().date()
        first = today - timedelta(days=days - 1)
        step = 1 if days <= 31 else 7
        buckets = []
        day = first
        while day <= today:
            buckets.append((day, min(day + timedelta(days=step - 1), today)))
            day += timedelta(days=step)

        planned_dates = list(workflow_tasks.filter(
            due_date__date__gte=first, due_date__date__lte=today,
        ).values_list('due_date', flat=True))
        done_dates = list(workflow_tasks.filter(
            status='DONE', completed_at__date__gte=first, completed_at__date__lte=today,
        ).values_list('completed_at', flat=True))
        planned_days = [d.date() for d in planned_dates]
        done_days = [d.date() for d in done_dates]

        trend = []
        for start, end in buckets:
            label = start.strftime('%d.%m') if step == 1 else f"{start:%d.%m}–{end:%d.%m}"
            trend.append({
                'period': label,
                'planned': sum(1 for d in planned_days if start <= d <= end),
                'actual': sum(1 for d in done_days if start <= d <= end),
            })
        return trend

    def list(self, request):
        from django.db.models import F, FloatField, Sum
        from django.db.models.expressions import Case, Value, When
        from matching.capacity import INACTIVE_PROJECT_STATUSES
        from matching.models import EmployeeProfile, WorkloadEntry
        from workflows.models import WorkflowTask
        user = request.user
        try:
            days = int(request.query_params.get('days', 30))
        except (TypeError, ValueError):
            days = 30
        if days not in self.ALLOWED_PERIODS:
            days = 30

        if not access.can_view_staff(user):
            return Response({
                'kpis': {'total_projects': 0, 'active_projects': 0, 'total_employees': 0, 'avg_progress': 0,
                         'tasks_total': 0, 'tasks_done': 0, 'tasks_overdue': 0},
                'domain_stats': [],
                'performance_trend': [],
                'period': {'days': days},
            })

        # Менеджер проекта видит аналитику только по своим проектам
        projects = Project.objects.all()
        workflow_tasks = WorkflowTask.objects.all()
        profiles = EmployeeProfile.objects.filter(user__is_active=True).exclude(user__role='ADMIN')
        if not access.has_global_access(user):
            managed_ids = list(access.managed_project_ids(user))
            projects = projects.filter(id__in=managed_ids)
            workflow_tasks = workflow_tasks.filter(workflow__project_id__in=managed_ids)
            profiles = profiles.filter(user__project_memberships__project_id__in=managed_ids).distinct()

        # Прогресс считается так же, как в карточке проекта: задачи со статусом «на проверке» — 80%, «в работе» — 50%
        progress = Case(
            When(status='DONE', then=Value(1.0)),
            When(status='REVIEW', then=Value(0.8)),
            When(status='IN_PROGRESS', then=Value(0.5)),
            default=Value(0.0), output_field=FloatField(),
        )
        scoped_tasks = workflow_tasks.filter(workflow__project__in=projects)
        total_weight = scoped_tasks.aggregate(s=Sum('weight'))['s'] or 0
        done_weight = scoped_tasks.annotate(p=progress).aggregate(s=Sum(F('weight') * F('p')))['s'] or 0
        avg_progress = round(done_weight / total_weight * 100) if total_weight else 0

        now = timezone.now()
        tasks_overdue = scoped_tasks.filter(
            Q(status='ESCALATED') | (Q(due_date__lt=now) & ~Q(status__in=['DONE', 'REVIEW', 'TODO']))
        ).count()

        # Загрузка по доменам: средняя текущая занятость СОТРУДНИКОВ домена, включая свободных
        # (раньше усреднялись все записи за всё время и сотрудники без загрузки не учитывались)
        today = datetime.date.today()
        load_by_profile = dict(
            WorkloadEntry.objects.filter(start_date__lte=today, end_date__gte=today)
            .exclude(project__status__in=INACTIVE_PROJECT_STATUSES)
            .values_list('employee_id').annotate(total=Sum('load_percent'))
        )
        domains = {}
        for profile in profiles:
            row = domains.setdefault(profile.domain or '', {'domain': profile.domain or '', 'emp_count': 0, 'total': 0, 'overloaded': 0, 'free': 0})
            load = float(load_by_profile.get(profile.id, 0) or 0)
            row['emp_count'] += 1
            row['total'] += load
            row['overloaded'] += 1 if load > 90 else 0
            row['free'] += 1 if load < 50 else 0
        domain_stats = [
            {
                'domain': r['domain'], 'emp_count': r['emp_count'], 'avg_load': round(r['total'] / r['emp_count'], 1),
                'overloaded': r['overloaded'], 'free': r['free'],
            }
            for r in sorted(domains.values(), key=lambda r: r['domain'])
        ]

        return Response({
            'kpis': {
                'total_projects': projects.count(),
                'active_projects': projects.filter(status__in=['ACTIVE', 'AT_RISK']).count(),
                'total_employees': profiles.count(),
                'avg_progress': avg_progress,
                'tasks_total': scoped_tasks.count(),
                'tasks_done': scoped_tasks.filter(status='DONE').count(),
                'tasks_overdue': tasks_overdue,
            },
            'domain_stats': domain_stats,
            'performance_trend': self._trend(scoped_tasks, days),
            'period': {'days': days, 'bucket': 'day' if days <= 31 else 'week'},
        })

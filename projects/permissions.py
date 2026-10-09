from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied

from . import access


def require(condition, message="У вас нет прав для выполнения этого действия."):
    if not condition:
        raise PermissionDenied(message)


def require_project_perm(user, project, perm, message=None):
    """403, если у пользователя нет права perm в проекте (менеджеры проекта имеют все права)."""
    require(
        access.has_project_perm(user, project, perm),
        message or "Недостаточно прав в этом проекте.",
    )


def require_project_manager(user, project, message=None):
    require(
        access.is_project_manager(user, project),
        message or "Действие доступно только менеджеру проекта.",
    )


class IsAdmin(permissions.BasePermission):
    message = "Действие доступно только администратору."

    def has_permission(self, request, view):
        return access.is_admin(request.user)


class IsAdminOrReadOnly(permissions.BasePermission):
    """Справочники и системные настройки: читать могут все, менять — только администратор."""
    message = "Изменять системные справочники может только администратор."

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return access.is_admin(request.user)


class CanViewStaff(permissions.BasePermission):
    message = "Раздел доступен только менеджерам и администраторам."

    def has_permission(self, request, view):
        return access.can_view_staff(request.user)


class CanManageLibraryOrReadOnly(permissions.BasePermission):
    """Библиотека шаблонов: читать могут все, менять — администратор, руководитель, менеджеры."""
    message = "Изменять шаблоны могут только менеджеры и администраторы."

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return access.can_manage_library(request.user)


class IsProjectManagerOrAdmin(permissions.BasePermission):
    """
    Запись разрешена администратору, руководителю проектов и менеджерам
    конкретного проекта. Объекты без проекта (шаблоны) — тем, кто ведёт библиотеку.
    """
    message = "Действие доступно только менеджеру проекта."

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        if access.has_global_access(request.user):
            return True
        if request.method == 'POST' and not view.kwargs.get('pk'):
            project = self._project_from_data(request.data)
            if project is not None:
                return access.is_project_manager(request.user, project)
            return access.can_manage_library(request.user)
        # PATCH/PUT/DELETE и detail-actions проверяются в has_object_permission
        return True

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        project = access.project_of(obj)
        if project is None:
            return access.can_manage_library(request.user)
        return access.is_project_manager(request.user, project)

    @staticmethod
    def _project_from_data(data):
        from .models import Project, PlanningBlock
        from workflows.models import WorkflowInstance
        try:
            if data.get('project'):
                return Project.objects.filter(id=data.get('project')).first()
            if data.get('block'):
                block = PlanningBlock.objects.select_related('project').filter(id=data.get('block')).first()
                return block.project if block else None
            if data.get('workflow'):
                wf = WorkflowInstance.objects.select_related('project').filter(id=data.get('workflow')).first()
                return wf.project if wf else None
        except (TypeError, ValueError):
            return None
        return None


class IsProjectMember(permissions.BasePermission):
    """Доступ всем участникам проекта."""

    def has_object_permission(self, request, view, obj):
        project = access.project_of(obj)
        if project is None:
            return access.has_global_access(request.user)
        return access.is_project_member(request.user, project)


class CanUpdateTaskStatus(permissions.BasePermission):
    """Статус задачи меняет её исполнитель либо участник с правом редактирования задач."""

    def has_object_permission(self, request, view, obj):
        if getattr(obj, 'assigned_to_id', None) == request.user.id:
            return True
        project = access.project_of(obj)
        if project is None:
            return access.has_global_access(request.user)
        return access.has_project_perm(request.user, project, 'can_edit_tasks')

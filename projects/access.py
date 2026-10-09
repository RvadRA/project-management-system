"""
Единая точка проверки прав доступа (RBAC + права на уровне проекта).

Глобальные роли (accounts.CustomUser.role):
  ADMIN            — полный доступ, включая настройки системы и учётные записи.
  GENERAL_MANAGER  — видит и управляет всеми проектами, но не админ-панелью.
  MANAGER          — управляет только проектами, где он назначен менеджером.
  EMPLOYEE         — исполнитель: свои задачи и общие файлы своих проектов.

Права внутри проекта задаются флажками на ProjectMember (см. PROJECT_PERMISSIONS).
Менеджеры проекта (ProjectMember.role == 'MANAGER' или Project.manager) имеют все права.
"""
from django.db.models import Q

ROLE_ADMIN = 'ADMIN'
ROLE_GENERAL_MANAGER = 'GENERAL_MANAGER'
ROLE_MANAGER = 'MANAGER'
ROLE_EMPLOYEE = 'EMPLOYEE'

MEMBER_ROLE_MANAGER = 'MANAGER'

# Флажки прав участника проекта: (поле ProjectMember, подпись для интерфейса)
PROJECT_PERMISSIONS = (
    ('can_view_all_tasks', 'Просмотр всех задач проекта'),
    ('can_edit_tasks', 'Редактирование задач и плана'),
    ('can_assign_tasks', 'Назначение исполнителей'),
    ('can_view_files', 'Просмотр файлов и базы знаний'),
    ('can_edit_files', 'Загрузка и изменение файлов'),
    ('can_manage_members', 'Управление командой'),
)
PROJECT_PERMISSION_KEYS = tuple(key for key, _ in PROJECT_PERMISSIONS)


# ── Глобальные роли ──────────────────────────────────────────────────────────

def is_admin(user):
    return bool(user and user.is_authenticated and (user.is_superuser or user.role == ROLE_ADMIN))


def has_global_access(user):
    """Администратор и руководитель проектов работают со всеми проектами организации."""
    return is_admin(user) or bool(user and user.is_authenticated and user.role == ROLE_GENERAL_MANAGER)


def can_create_projects(user):
    return has_global_access(user) or bool(user and user.is_authenticated and user.role == ROLE_MANAGER)


def can_view_staff(user):
    """Кому доступен справочник сотрудников (подбор команды, загрузка)."""
    return can_create_projects(user)


def can_browse_users(user):
    """Список пользователей нужен и участнику с правом управления командой — чтобы выбрать, кого добавить."""
    if can_view_staff(user):
        return True
    from .models import ProjectMember
    return ProjectMember.objects.filter(user=user, can_manage_members=True).exists()


def can_manage_staff(user):
    """Редактирование профилей сотрудников (навыки, сертификаты, отпуска)."""
    return has_global_access(user)


def can_manage_library(user):
    """Библиотека шаблонов WBS и бизнес-процессов."""
    return can_create_projects(user)


# ── Права внутри проекта ─────────────────────────────────────────────────────

def project_of(obj):
    """Определяет проект для Project / PlanningBlock / Task / WorkflowInstance / WorkflowTask / KnowledgeMaterial."""
    from .models import Project
    if obj is None:
        return None
    if isinstance(obj, Project):
        return obj
    for attr in ('project', 'block', 'workflow', 'task', 'from_task'):
        if hasattr(obj, attr):
            related = getattr(obj, attr)
            if attr == 'project':
                return related
            return project_of(related)
    return None


def get_membership(user, project):
    if not project or not user or not user.is_authenticated:
        return None
    return project.members.filter(user=user).first()


def is_project_manager(user, project):
    if not project:
        return False
    if has_global_access(user):
        return True
    if project.manager_id and project.manager_id == user.id:
        return True
    member = get_membership(user, project)
    return bool(member and member.role == MEMBER_ROLE_MANAGER)


def is_project_member(user, project):
    if not project:
        return False
    return is_project_manager(user, project) or get_membership(user, project) is not None


def has_project_perm(user, project, perm):
    """perm — одно из PROJECT_PERMISSION_KEYS."""
    if not project:
        return False
    if is_project_manager(user, project):
        return True
    member = get_membership(user, project)
    return bool(member and getattr(member, perm, False))


def project_permissions_for(user, project):
    """Словарь эффективных прав пользователя в проекте — для фронтенда."""
    manager = is_project_manager(user, project)
    member = None if manager else get_membership(user, project)
    perms = {key: bool(manager or (member and getattr(member, key))) for key in PROJECT_PERMISSION_KEYS}
    perms['is_manager'] = manager
    return perms


# ── Выборки ──────────────────────────────────────────────────────────────────

def visible_project_ids(user):
    """ID проектов, где пользователь участник или менеджер. Для глобальных ролей не вызывается."""
    from .models import Project
    return Project.objects.filter(Q(members__user=user) | Q(manager=user)).values_list('id', flat=True).distinct()


def managed_project_ids(user):
    from .models import Project
    return Project.objects.filter(
        Q(manager=user) | Q(members__user=user, members__role=MEMBER_ROLE_MANAGER)
    ).values_list('id', flat=True).distinct()


def project_ids_with_perm(user, perm):
    """ID проектов, где у пользователя есть право perm (менеджеры имеют все права)."""
    from .models import Project
    return Project.objects.filter(
        Q(manager=user)
        | Q(members__user=user, members__role=MEMBER_ROLE_MANAGER)
        | Q(members__user=user, **{f'members__{perm}': True})
    ).values_list('id', flat=True).distinct()


def filter_visible_projects(qs, user):
    if has_global_access(user):
        return qs
    return qs.filter(id__in=visible_project_ids(user))

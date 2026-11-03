// Ролевая модель (зеркало projects/access.py на бэкенде).
// Проверки на фронтенде только скрывают недоступные элементы — права проверяет сервер.

export type UserRole = 'ADMIN' | 'GENERAL_MANAGER' | 'MANAGER' | 'EMPLOYEE';

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  GENERAL_MANAGER: 'Руководитель проектов',
  MANAGER: 'Менеджер проекта',
  EMPLOYEE: 'Исполнитель',
};

/** Роли, работающие с проектами как менеджеры (создание проектов, подбор команды, библиотека). */
export const STAFF_ROLES: UserRole[] = ['ADMIN', 'GENERAL_MANAGER', 'MANAGER'];
export const ALL_ROLES: UserRole[] = ['ADMIN', 'GENERAL_MANAGER', 'MANAGER', 'EMPLOYEE'];

type WithRole = { role?: string } | null | undefined;

export const isAdmin = (user: WithRole) => user?.role === 'ADMIN';

/** Администратор и руководитель проектов видят и управляют всеми проектами. */
export const hasGlobalAccess = (user: WithRole) =>
  user?.role === 'ADMIN' || user?.role === 'GENERAL_MANAGER';

/** Может создавать проекты, вести библиотеку шаблонов, видеть справочник сотрудников. */
export const isStaff = (user: WithRole) => STAFF_ROLES.includes(user?.role as UserRole);

/** Редактирование профилей сотрудников (навыки, сертификаты, отпуска). */
export const canManageStaff = hasGlobalAccess;

// ── Права внутри проекта ────────────────────────────────────────────────────

export interface ProjectPermissions {
  is_manager: boolean;
  can_view_all_tasks: boolean;
  can_edit_tasks: boolean;
  can_assign_tasks: boolean;
  can_view_files: boolean;
  can_edit_files: boolean;
  can_manage_members: boolean;
}

export type MemberPermissionKey = Exclude<keyof ProjectPermissions, 'is_manager'>;

/** Флажки, которые менеджер проекта настраивает для каждого участника. */
export const MEMBER_PERMISSIONS: { key: MemberPermissionKey; label: string; hint: string }[] = [
  { key: 'can_view_all_tasks', label: 'Все задачи', hint: 'Видит все задачи проекта, а не только свои' },
  { key: 'can_edit_tasks', label: 'Правка задач', hint: 'Создаёт и редактирует задачи, этапы и процессы' },
  { key: 'can_assign_tasks', label: 'Назначение', hint: 'Назначает исполнителей на задачи' },
  { key: 'can_view_files', label: 'Файлы: просмотр', hint: 'Видит файлы и базу знаний проекта' },
  { key: 'can_edit_files', label: 'Файлы: правка', hint: 'Загружает, изменяет и удаляет файлы проекта' },
  { key: 'can_manage_members', label: 'Команда', hint: 'Добавляет и исключает участников' },
];

export const NO_PROJECT_PERMISSIONS: ProjectPermissions = {
  is_manager: false,
  can_view_all_tasks: false,
  can_edit_tasks: false,
  can_assign_tasks: false,
  can_view_files: false,
  can_edit_files: false,
  can_manage_members: false,
};

/** Права текущего пользователя в проекте (сервер отдаёт их в поле my_permissions). */
export const projectPerms = (
  project: { my_permissions?: ProjectPermissions | null } | null | undefined,
): ProjectPermissions => project?.my_permissions ?? NO_PROJECT_PERMISSIONS;

// ── Должность участника в проекте ───────────────────────────────────────────
// В системе три разных понятия, которые раньше все назывались «роль»:
//   1. Роль в системе (ROLE_LABELS) — уровень доступа учётной записи, задаёт администратор.
//   2. Должность в проекте — чем человек занят в проекте (справочник «Должности»), на права не влияет.
//   3. Менеджер проекта + флажки прав — что участнику разрешено в конкретном проекте.

export const MEMBER_ROLE_MANAGER = 'MANAGER';
/** Значение ProjectMember.role для участника без должности */
export const MEMBER_ROLE_DEFAULT = 'DEVELOPER';

/** Старые встроенные значения ProjectMember.role — остались в данных, новым участникам не назначаются */
const LEGACY_MEMBER_ROLES: Record<string, string> = {
  DEVELOPER: 'Участник',
  ANALYST: 'Аналитик',
  DESIGNER: 'Дизайнер',
  QA: 'Тестировщик',
  OTHER: 'Участник',
};

/** «Project Manager» из справочника должностей равнозначен менеджеру проекта (как и на сервере). */
export const isPmRoleName = (name: string | null | undefined) =>
  /manager|менеджер|руководитель/i.test(name ?? '');

export const memberRoleLabel = (role: string | null | undefined) =>
  role === MEMBER_ROLE_MANAGER ? 'Менеджер проекта' : LEGACY_MEMBER_ROLES[role ?? ''] ?? role ?? 'Участник';

interface MemberLike {
  role: string;
  role_ref?: number | null;
  role_info?: { id: number; name: string } | null;
  is_manager?: boolean;
}

export const isMemberManager = (m: MemberLike) => m.is_manager ?? m.role === MEMBER_ROLE_MANAGER;

/** Подпись должности участника для отображения. */
export const memberPositionLabel = (m: MemberLike) =>
  isMemberManager(m) ? 'Менеджер проекта' : m.role_info?.name ?? memberRoleLabel(m.role);

/** Значение для MemberRoleSelect по данным участника. */
export const memberRoleValue = (m: MemberLike) => {
  if (isMemberManager(m)) return MEMBER_ROLE_MANAGER;
  if (m.role_ref) return String(m.role_ref);
  return m.role === MEMBER_ROLE_DEFAULT || m.role === 'OTHER' ? '' : m.role;
};

/** Превращает значение MemberRoleSelect в параметры запроса members/add. */
export const resolveMemberRole = (
  value: string,
  positions: { id: number; name: string }[],
): { role: string; roleRefId?: number } => {
  if (value === MEMBER_ROLE_MANAGER) {
    return { role: MEMBER_ROLE_MANAGER, roleRefId: positions.find(p => isPmRoleName(p.name))?.id };
  }
  const position = positions.find(p => String(p.id) === value);
  if (position) return { role: position.name.slice(0, 30), roleRefId: position.id };
  return { role: value || MEMBER_ROLE_DEFAULT };
};

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { toast } from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserNested {
  id: number;
  username: string;
  full_name: string;
  email: string;
}

export interface ProjectMember {
  id: number;
  user: UserNested;
  role: string;
  role_ref?: number | null;
  role_info?: { id: number; name: string } | null;
  allocation_percentage: number;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  status: 'DRAFT' | 'ACTIVE' | 'AT_RISK' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  domain: string;
  start_date: string | null;
  end_date: string | null;
  budget: string | null;
  manager: UserNested | null;
  members: ProjectMember[];
  progress_percentage: number;
  risks?: number[];
  risks_info?: Risk[];
  created_at: string;
}

export interface Skill {
  id: number;
  name: string;
  category: string;
}

export interface EmployeeSkill {
  id: number;
  skill: Skill;
  level_score: number;
  years_experience: number;
}

export interface Certificate {
  id: number;
  name: string;
  issuer: string;
  credential_id: string;
  issued_date: string | null;
  expiry_date: string | null;
  certificate_url: string;
  is_expired: boolean;
  created_at: string;
}

export interface Unavailability {
  id: number;
  type: 'VACATION' | 'SICK_LEAVE' | 'UNPAID_LEAVE' | 'OTHER';
  type_display: string;
  start_date: string;
  end_date: string;
  note: string;
  created_at: string;
}

export interface Employee {
  id: number;
  user: UserNested;
  full_name: string;
  position: string;
  domain: string;
  hourly_rate: string;
  bio: string;
  current_workload_percentage: number;
  active_task_hours: number;
  skills: EmployeeSkill[];
  certificates: Certificate[];
  total_tasks: number;
  completed_tasks: number;
  memberships: {
    id: number;
    project: number;
    project_name: string;
    role: string;
    role_info?: { id: number; name: string } | null;
  }[];
  unavailability: Unavailability[];
}

export interface WorkflowTaskTemplate {
  id: number;
  name: string;
  task_type: string;
  sla_hours: number;
  order: number;
  weight: number;
  priority: string;
  estimated_hours: number;
  risk_level: string;
  checklist?: string[];
  assigned_role?: string;
  depends_on?: number[];
}

export interface WorkflowTemplate {
  id: number;
  name: string;
  description: string;
  is_published: boolean;
  ui_config?: any;
  task_templates: WorkflowTaskTemplate[];
}

export interface KanbanTask {
  id: number;
  workflow: number;
  name: string;
  description: string;
  task_type: string;
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'ESCALATED';
  weight: number;
  priority: string;
  estimated_hours: number;
  risk_level: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  due_date: string | null;
  sla_hours: number;
  order: number;
  is_overdue: boolean;
  report: {
    text_content: string;
    checklist: { id: number; text: string; is_done: boolean }[];
  } | null;
  checklist?: { text: string; is_done: boolean }[];
  attachments: { id: number; original_name: string; file: string }[];
  created_at: string;
}

export interface WorkflowProcess {
  id: number;
  name: string;
  status: string;
  template: number | null;
  project: number | null;
  progress_percent: number;
  tasks: KanbanTask[];
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  link: string | null;
}

export interface PlanningBlock {
  id: number;
  name: string;
  domain: string;
  is_template: boolean;
  project: number | null;
  avg_duration: number | null;
  complexity: string;
  success_rate: number;
  tasks?: any[];
  analytics?: {
    avg_actual_duration: number;
    success_rate: number;
    usage_count: number;
  };
  typical_risks?: any[];
  calendar_info?: {
    id: number;
    name: string;
  };
}

export interface AuditLog {
  id: number;
  project: number;
  username: string;
  action: string;
  detail: Record<string, any>;
  created_at: string;
}

export interface AnalyticsData {
  kpis: {
    total_projects: number;
    active_projects: number;
    total_employees: number;
    avg_progress: number;
  };
  domain_stats: {
    domain: string;
    avg_load: number | null;
    emp_count: number;
  }[];
  performance_trend: {
    period: string;
    planned: number;
    actual: number;
}[];
}

export interface Risk {
  id: number;
  name: string;
  description: string;
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  mitigation: string;
}

export interface ProjectRole {
  id: number;
  name: string;
  description: string;
}

export interface ProjectDomain {
  id: number;
  name: string;
  description: string;
}

export interface WorkCalendar {
  id: number;
  name: string;
  is_default: boolean;
  holidays?: CalendarHoliday[];
}

export interface CalendarHoliday {
  id: number;
  calendar: number;
  date: string;
  name: string;
}

export interface GlobalSetting {
  id: number;
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

// ─── Context type ─────────────────────────────────────────────────────────────

interface AppContextType {
  projects: Project[];
  employees: Employee[];
  projectRoles: Record<string, string>;
  processes: WorkflowProcess[];
  allTasks: KanbanTask[];
  myTasks: KanbanTask[];
  notifications: Notification[];
  templates: WorkflowTemplate[];
  planningBlocks: PlanningBlock[];
  skills: Skill[];
  users: UserNested[];
  globalSettings: GlobalSetting[];
  metadata: {
    statuses: Record<string, string>;
    roles: Record<string, string>;
    task_statuses: Record<string, string>;
  } | null;
  loading: boolean;
  extractError: (err: any, defaultMsg: string) => string;
  refreshData: () => Promise<void>;
  updateTaskStatus: (id: number, status: KanbanTask['status']) => Promise<void>;
  createTask: (data: Record<string, any>) => Promise<void>;
  createProcess: (name: string, projectId: number, templateId?: number, description?: string) => Promise<WorkflowProcess | null>;
  submitTaskReport: (taskId: number, data: { text_content: string; checklist?: any[]; files?: File[] }) => Promise<void>;
  uploadTaskFile: (taskId: number, file: File) => Promise<void>;
  approveTask: (taskId: number) => Promise<void>;
  updateProcess: (id: number, data: Record<string, any>) => Promise<void>;
  deleteProcess: (id: number) => Promise<void>;
  createProject: (data: Record<string, any>) => Promise<Project | null>;
  updateProject: (id: number, data: Record<string, any>) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  removeMemberFromProject: (projectId: number, userId: number) => Promise<void>;
  importProject: (sourceId: number, newName: string, copyDates: boolean, copyTeam: boolean, scalingFactor: number, blockIds?: number[]) => Promise<Project | null>;
  transferBlock: (sourceBlockId: number, targetProjectId: number, startDate: string, scalingFactor: number, taskIds?: number[]) => Promise<any>;
  saveBlockAsTemplate: (blockId: number, name?: string) => Promise<void>;
  createEmployee: (userData: Record<string, any>, profileData: Record<string, any>, skillIds: { skill_id: number; level: number }[]) => Promise<void>;
  updateEmployee: (profileId: number, profileData: Record<string, any>) => Promise<void>;
  deleteEmployee: (profileId: number) => Promise<void>;
  updateWorkflowTask: (id: number, data: Record<string, any>) => Promise<void>;
  deleteWorkflowTask: (id: number) => Promise<void>;
  addSkillToEmployee: (profileId: number, skillId: number, level: number, years?: number) => Promise<void>;
  deleteEmployeeSkill: (profileId: number, employeeSkillId: number) => Promise<void>;
  addCertificateToEmployee: (profileId: number, certData: Partial<Certificate>) => Promise<void>;
  deleteEmployeeCertificate: (profileId: number, certId: number) => Promise<void>;
  addUnavailabilityToEmployee: (profileId: number, data: Partial<Unavailability>) => Promise<void>;
  deleteEmployeeUnavailability: (profileId: number, itemId: number) => Promise<void>;
  addMemberToProject: (projectId: number, userId: number, role: string, allocation: number, roleRefId?: number) => Promise<void>;
  assignEmployeeToProject: (empId: number, projectId: number, role: string, load: number, roleRefId?: number) => Promise<void>;
  markNotificationRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  unreadCount: number;
  auditLogs: AuditLog[];
  globalAuditLogs: AuditLog[];
  fetchAuditLogs: (projectId: number) => Promise<void>;
  recalculateSchedule: (taskId: number) => Promise<void>;
  shiftTask: (taskId: number, newStartDate: string) => Promise<void>;
  analytics: AnalyticsData | null;
   fetchAnalytics: () => Promise<void>;
  getTaskRecommendations: (taskId: number) => Promise<any[]>;
  // Settings CRUD
  risks: Risk[];
  createRisk: (data: Partial<Risk>) => Promise<void>;
  updateRisk: (id: number, data: Partial<Risk>) => Promise<void>;
  deleteRisk: (id: number) => Promise<void>;
  globalRoles: ProjectRole[];
  domains: ProjectDomain[];
  calendars: WorkCalendar[];
  createGlobalRole: (data: Partial<ProjectRole>) => Promise<void>;
  updateGlobalRole: (id: number, data: Partial<ProjectRole>) => Promise<void>;
  deleteGlobalRole: (id: number) => Promise<void>;
  createDomain: (data: Partial<ProjectDomain>) => Promise<void>;
  updateDomain: (id: number, data: Partial<ProjectDomain>) => Promise<void>;
  deleteDomain: (id: number) => Promise<void>;
  createCalendar: (data: Partial<WorkCalendar>) => Promise<void>;
  updateCalendar: (id: number, data: Partial<WorkCalendar>) => Promise<void>;
  deleteCalendar: (id: number) => Promise<void>;
  createHoliday: (data: Partial<CalendarHoliday>) => Promise<void>;
  deleteHoliday: (id: number) => Promise<void>;
  createSkill: (data: Partial<Skill>) => Promise<void>;
  updateSkill: (id: number, data: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: number) => Promise<void>;
  createUser: (data: any) => Promise<void>;
  updateUser: (id: number, data: any) => Promise<void>;
  deleteUser: (id: number) => Promise<void>;
  createTemplate: (data: any) => Promise<void>;
  updateTemplate: (id: number, data: any) => Promise<void>;
  deleteTemplate: (id: number) => Promise<void>;
  createTaskTemplate: (data: any) => Promise<void>;
  updateTaskTemplate: (id: number, data: any) => Promise<void>;
  deleteTaskTemplate: (id: number) => Promise<void>;
  updateGlobalSetting: (id: number, data: Partial<GlobalSetting>) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRoles, setProjectRoles] = useState<Record<string, string>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [processes, setProcesses] = useState<WorkflowProcess[]>([]);
  const [allTasks, setAllTasks] = useState<KanbanTask[]>([]);
  const [myTasks, setMyTasks] = useState<KanbanTask[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [planningBlocks, setPlanningBlocks] = useState<PlanningBlock[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [globalAuditLogs, setGlobalAuditLogs] = useState<AuditLog[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [users, setUsers] = useState<UserNested[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSetting[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [risks, setRisks] = useState<Risk[]>([]);
  const [globalRoles, setGlobalRoles] = useState<ProjectRole[]>([]);
  const [domains, setDomains] = useState<ProjectDomain[]>([]);
  const [calendars, setCalendars] = useState<WorkCalendar[]>([]);

  const getList = (res: any): any[] => {
    if (Array.isArray(res.data)) return res.data;
    if (Array.isArray(res.data?.results)) return res.data.results;
    return [];
  };

  const fetchAllData = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const results = await Promise.allSettled([
        api.get('/projects/list/'),          // 0
        api.get('/employees/profiles/'),     // 1
        api.get('/workflows/processes/'),    // 2
        api.get('/workflows/tasks/my-tasks/'), // 3
        api.get('/notifications/'),          // 4
        api.get('/workflows/templates/'),    // 5
        api.get('/projects/blocks/'),        // 6
        api.get('/employees/skills/'),       // 7
        api.get('/users/'),                  // 8
        api.get('/projects/dashboard/').catch(() => ({ data: null })),     // 9
        api.get('/projects/list/metadata/'), // 10
        api.get('/planning/risks/'),            // 11
        api.get('/planning/roles/'),            // 12
        api.get('/planning/domains/'),          // 13
        api.get('/planning/calendars/'),        // 14
        api.get('/projects/audit-logs/'),       // 15
        api.get('/workflows/tasks/'),           // 16
        api.get('/projects/settings/'),         // 17
      ]);

      const safe = (r: PromiseSettledResult<any>) =>
        r.status === 'fulfilled' ? getList(r.value) : [];

      const procs: WorkflowProcess[] = safe(results[2]);

      setProjects(safe(results[0]));
      setEmployees(safe(results[1]));
      setProcesses(procs);
      setMyTasks(safe(results[3]));
      setNotifications(safe(results[4]));
      setTemplates(safe(results[5]));
      setPlanningBlocks(safe(results[6]));
      setSkills(safe(results[7]));
      setUsers(safe(results[8]));
      setAllTasks(safe(results[16]));
      setGlobalSettings(safe(results[17]));

      if (results[9].status === 'fulfilled') {
        setAnalytics(results[9].value.data);
      }
      if (results[10].status === 'fulfilled') {
        setMetadata(results[10].value.data);
        setProjectRoles(results[10].value.data.roles || {});
      }
      setRisks(safe(results[11]));
      setGlobalRoles(safe(results[12]));
      setDomains(safe(results[13]));
      setCalendars(safe(results[14]));
      setGlobalAuditLogs(safe(results[15]));
    } catch (err) {
      console.error('fetchAllData error:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchAllData(); }, [fetchAllData]);

  // Real-time updates polling (every 60 seconds, silent)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchAllData(true);
    }, 60000);
    return () => clearInterval(interval);
  }, [user, fetchAllData]);

  // ── Task ─────────────────────────────────────────────────────────────────

  const updateTaskStatus = async (id: number, status: KanbanTask['status']) => {
    // Optimistic UI
    const patch = (t: KanbanTask) => t.id === id ? { ...t, status } : t;
    const oldAllTasks = allTasks;
    const oldMyTasks = myTasks;
    const oldProcesses = processes;

    setAllTasks(prev => prev.map(patch));
    setMyTasks(prev => prev.map(patch));
    setProcesses(prev => prev.map(p => ({ ...p, tasks: p.tasks.map(patch) })));

    try {
      await api.patch(`/workflows/tasks/${id}/status/`, { status });
      await fetchAllData();
      toast.success("Статус обновлен");
    } catch (err: any) {
      // Rollback
      setAllTasks(oldAllTasks);
      setMyTasks(oldMyTasks);
      setProcesses(oldProcesses);
      const msg = err?.response?.data?.error || "Ошибка при обновлении статуса";
      toast.error(msg);
    }
  };

  const extractError = (err: any, defaultMsg: string = "Произошла ошибка") => {
    if (!err?.response?.data) return defaultMsg;
    const data = err.response.data;
    if (typeof data === 'string') return data;
    if (data.detail) return data.detail;
    if (data.error) return data.error;
    if (data.non_field_errors) return Array.isArray(data.non_field_errors) ? data.non_field_errors[0] : data.non_field_errors;
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length > 0) {
        const first = data[keys[0]];
        return `${keys[0]}: ${Array.isArray(first) ? first[0] : first}`;
      }
    }
    return defaultMsg;
  };

  const createTask = async (data: Record<string, any>) => {
    try {
      await api.post('/workflows/tasks/', data);
      await fetchAllData();
      toast.success("Задача создана");
    } catch (err: any) {
      toast.error(extractError(err, "Ошибка при создании задачи"));
    }
  };

  const updateWorkflowTask = async (id: number, data: Record<string, any>) => {
    try {
      await api.patch(`/workflows/tasks/${id}/`, data);
      await fetchAllData();
      toast.success("Задача обновлена");
    } catch (err: any) {
      toast.error(extractError(err, "Ошибка при обновлении задачи"));
    }
  };

  const deleteWorkflowTask = async (id: number) => {
    try {
      await api.delete(`/workflows/tasks/${id}/`);
      await fetchAllData();
      toast.success("Задача удалена");
    } catch (err: any) {
      toast.error("Ошибка при удалении задачи");
    }
  };

  const uploadTaskFile = async (taskId: number, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    await api.post(`/workflows/tasks/${taskId}/attach/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  };

  const submitTaskReport = async (taskId: number, data: { text_content: string; checklist?: any[]; files?: File[] }) => {
    // 1. Submit report (this also clears old attachments on backend)
    await api.post(`/workflows/tasks/${taskId}/report/`, {
      text_content: data.text_content,
      checklist: data.checklist
    });

    // 2. Upload new files if any
    if (data.files && data.files.length > 0) {
      for (const file of data.files) {
        await uploadTaskFile(taskId, file);
      }
    }
    
    await fetchAllData();
  };

  const approveTask = async (taskId: number) => {
    await api.post(`/workflows/tasks/${taskId}/approve/`);
    await fetchAllData();
  };

  const recalculateSchedule = async (taskId: number) => {
    await api.post(`/projects/tasks/${taskId}/recalculate/`);
    await fetchAllData();
  };

  const shiftTask = async (taskId: number, newStartDate: string) => {
    await api.post(`/projects/tasks/${taskId}/shift/`, { start_date: newStartDate });
    await fetchAllData();
  };

  // ── Process ───────────────────────────────────────────────────────────────

  const createProcess = async (
    name: string,
    projectId: number,
    templateId?: number,
    description?: string
  ): Promise<WorkflowProcess | null> => {
    try {
      const res = await api.post('/workflows/processes/', {
        name,
        description: description || '',
        project: projectId,
        template_id: templateId || null,
        status: 'IN_PROGRESS',
      });
      const p: WorkflowProcess = { ...res.data, tasks: res.data.tasks || [] };
      setProcesses(prev => [...prev, p]);
      return p;
    } catch (err) {
      console.error('Error creating process:', err);
      return null;
    }
  };

  const updateProcess = async (id: number, data: Record<string, any>) => {
    try {
      const res = await api.put(`/workflows/processes/${id}/`, data);
      setProcesses(prev => prev.map(p => p.id === id ? { ...p, ...res.data } : p));
    } catch (err) {
      console.error('Error updating process:', err);
      throw err;
    }
  };

  const deleteProcess = async (id: number) => {
    try {
      await api.delete(`/workflows/processes/${id}/`);
      setProcesses(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Error deleting process:', err);
      throw err;
    }
  };

  // ── Project ───────────────────────────────────────────────────────────────

  const createProject = async (data: Record<string, any>): Promise<Project | null> => {
    try {
      const res = await api.post('/projects/list/', data);
      setProjects(prev => [res.data, ...prev]);
      return res.data;
    } catch (err) {
      console.error('createProject failed', err);
      return null;
    }
  };

  const updateProject = async (id: number, data: Record<string, any>) => {
    await api.patch(`/projects/list/${id}/`, data);
    await fetchAllData();
  };

  const transferBlock = async (sourceBlockId: number, targetProjectId: number, startDate: string, scalingFactor: number, taskIds?: number[]) => {
    try {
      const res = await api.post(`/projects/blocks/${sourceBlockId}/transfer/`, {
        project_id: targetProjectId,
        start_date: startDate,
        scaling_factor: scalingFactor,
        task_ids: taskIds
      });
      await fetchAllData();
      return res.data;
    } catch (err: any) {
      const msg = extractError(err, 'Ошибка при переносе блока');
      toast.error(msg);
      throw err;
    }
  };

  const deleteProject = async (id: number) => {
    await api.delete(`/projects/list/${id}/`);
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  const importProject = async (
    sourceId: number,
    newName: string,
    copyDates: boolean,
    copyTeam: boolean,
    scalingFactor: number,
    blockIds?: number[],
  ): Promise<Project | null> => {
    try {
      const isTemplate = planningBlocks.some(b => b.id === sourceId && b.is_template);
      
      if (isTemplate) {
        const res = await api.post('/projects/list/create-from-template/', {
          name: newName,
          template_id: sourceId,
          scaling_factor: scalingFactor,
          task_ids: blockIds,
        });
        await fetchAllData();
        return res.data;
      } else {
        const res = await api.post(`/projects/list/${sourceId}/import/`, {
          name: newName,
          copy_dates: copyDates,
          copy_team: copyTeam,
          scaling_factor: scalingFactor,
          block_ids: blockIds,
        });
        await fetchAllData();
        return res.data;
      }
    } catch (err) {
      console.error('importProject failed', err);
      return null;
    }
  };

  // ── Employee ──────────────────────────────────────────────────────────────

  const createEmployee = async (
    userData: Record<string, any>,
    profileData: Record<string, any>,
    skillIds: { skill_id: number; level: number }[],
  ) => {
    // 1. Create user account
    const userRes = await api.post('/users/', userData);
    const newUserId: number = userRes.data.id;

    // 2. Create employee profile linked to the user
    const profileRes = await api.post('/employees/profiles/', {
      ...profileData,
      user: newUserId,
    });
    const profileId: number = profileRes.data.id;
    if (!profileId) {
      throw new Error('Failed to get profile ID from response');
    }

    // 3. Attach skills one by one
    for (const s of skillIds) {
      try {
        await api.post(`/employees/profiles/${profileId}/skills/`, {
          skill_id: s.skill_id,
          level: s.level,
        });
      } catch (err) {
        console.error('Failed to add skill:', s, err);
      }
    }
    await fetchAllData();
  };

  const updateEmployee = async (profileId: number, profileData: Record<string, any>) => {
    await api.patch(`/employees/profiles/${profileId}/`, profileData);
    await fetchAllData();
  };

  const deleteEmployee = async (profileId: number) => {
    const profile = employees.find(e => e.id === profileId);
    if (!profile) return;
    // Deleting user cascades to profile
    await api.delete(`/users/${profile.user.id}/`);
    await fetchAllData();
  };

  const addSkillToEmployee = async (profileId: number, skillId: number, level: number, years?: number) => {
    await api.post(`/employees/profiles/${profileId}/skills/`, {
      skill_id: skillId,
      level,
      years_experience: years || 0,
    });
    await fetchAllData();
  };

  const deleteEmployeeSkill = async (profileId: number, employeeSkillId: number) => {
    await api.delete(`/employees/profiles/${profileId}/skills/${employeeSkillId}/`);
    await fetchAllData();
  };

  const addCertificateToEmployee = async (profileId: number, certData: Partial<Certificate>) => {
    await api.post(`/employees/profiles/${profileId}/certificates/add/`, certData);
    await fetchAllData();
  };

  const deleteEmployeeCertificate = async (profileId: number, certId: number) => {
    await api.delete(`/employees/profiles/${profileId}/certificates/${certId}/`);
    await fetchAllData();
  };

  const addUnavailabilityToEmployee = async (profileId: number, data: Partial<Unavailability>) => {
    await api.post(`/employees/profiles/${profileId}/unavailability/add/`, data);
    await fetchAllData();
  };

  const deleteEmployeeUnavailability = async (profileId: number, itemId: number) => {
    await api.delete(`/employees/profiles/${profileId}/unavailability-delete/${itemId}/`);
    await fetchAllData();
  };

  const addMemberToProject = async (projectId: number, userId: number, role: string, allocation: number, roleRefId?: number) => {
    try {
      await api.post(`/projects/list/${projectId}/members/add/`, { 
        user_id: userId, 
        role,
        role_ref_id: roleRefId,
        allocation_percentage: allocation
      });
      toast.success("Участник успешно добавлен");
      await fetchAllData();
    } catch (err: any) {
      toast.error(extractError(err));
      throw err;
    }
  };

  const removeMemberFromProject = async (projectId: number, userId: number) => {
    await api.post(`/projects/list/${projectId}/members/remove/`, { user_id: userId });
    await fetchAllData();
  };

  const assignEmployeeToProject = async (
    empId: number, projectId: number, role: string,
    load: number,
    roleRefId?: number,
  ) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    // members/add already calls _sync_workload_entry on the backend — no duplicate call needed
    await api.post(`/projects/list/${projectId}/members/add/`, {
      user_id: emp.user.id,
      role,
      role_ref_id: roleRefId,
      allocation_percentage: load,
    });
    await fetchAllData();
  };

  const saveBlockAsTemplate = async (blockId: number, name?: string) => {
    try {
      await api.post(`/planning/blocks/${blockId}/make-template/`, { name });
      await fetchAllData();
      toast.success("Пакет сохранен в библиотеку");
    } catch (err: any) {
      toast.error(extractError(err, "Ошибка при сохранении пакета"));
    }
  };

  const fetchAuditLogs = async (projectId: number) => {
    try {
      // Backend registers audit logs as /api/projects/audit-logs/
      const res = await api.get(`/projects/audit-logs/?project=${projectId}`);
      setAuditLogs(getList(res));
    } catch {
      setAuditLogs([]);
    }
  };

  // ── Notifications ─────────────────────────────────────────────────────────

  const markNotificationRead = async (id: number) => {
    try {
      await api.patch(`/notifications/${id}/read/`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all/');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch { /* ignore */ }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const fetchAnalytics = async () => {
    try {
      const res = await api.get('/projects/dashboard/');
      setAnalytics(res.data);
    } catch (err) {
      console.error('fetchAnalytics failed', err);
    }
  };

  // ── Settings CRUD ────────────────────────────────────────────────────────
  const createRisk = async (data: Partial<Risk>) => { await api.post('/planning/risks/', data); await fetchAllData(); };
  const updateRisk = async (id: number, data: Partial<Risk>) => { await api.patch(`/planning/risks/${id}/`, data); await fetchAllData(); };
  const deleteRisk = async (id: number) => { await api.delete(`/planning/risks/${id}/`); await fetchAllData(); };

  const createGlobalRole = async (data: Partial<ProjectRole>) => { await api.post('/planning/roles/', data); await fetchAllData(); };
  const updateGlobalRole = async (id: number, data: Partial<ProjectRole>) => { await api.patch(`/planning/roles/${id}/`, data); await fetchAllData(); };
  const deleteGlobalRole = async (id: number) => { await api.delete(`/planning/roles/${id}/`); await fetchAllData(); };

  const createDomain = async (data: Partial<ProjectDomain>) => { await api.post('/planning/domains/', data); await fetchAllData(); };
  const updateDomain = async (id: number, data: Partial<ProjectDomain>) => { await api.patch(`/planning/domains/${id}/`, data); await fetchAllData(); };
  const deleteDomain = async (id: number) => { await api.delete(`/planning/domains/${id}/`); await fetchAllData(); };

  const createCalendar = async (data: Partial<WorkCalendar>) => { await api.post('/planning/calendars/', data); await fetchAllData(); };
  const updateCalendar = async (id: number, data: Partial<WorkCalendar>) => { await api.patch(`/planning/calendars/${id}/`, data); await fetchAllData(); };
  const deleteCalendar = async (id: number) => { await api.delete(`/planning/calendars/${id}/`); await fetchAllData(); };

  const createHoliday = async (data: Partial<CalendarHoliday>) => { await api.post('/planning/holidays/', data); await fetchAllData(); };
  const deleteHoliday = async (id: number) => { await api.delete(`/planning/holidays/${id}/`); await fetchAllData(); };

  const createSkill = async (data: Partial<Skill>) => { await api.post('/matching/skills/', data); await fetchAllData(); };
  const updateSkill = async (id: number, data: Partial<Skill>) => { await api.patch(`/matching/skills/${id}/`, data); await fetchAllData(); };
  const deleteSkill = async (id: number) => { await api.delete(`/matching/skills/${id}/`); await fetchAllData(); };
  
  const createUser = async (data: any) => { await api.post('/users/', data); await fetchAllData(); };
  const updateUser = async (id: number, data: any) => { await api.patch(`/users/${id}/`, data); await fetchAllData(); };
  const deleteUser = async (id: number) => { await api.delete(`/users/${id}/`); await fetchAllData(); };
  
  const createTemplate = async (data: any) => { await api.post('/workflows/templates/', data); await fetchAllData(); };
  const updateTemplate = async (id: number, data: any) => { await api.patch(`/workflows/templates/${id}/`, data); await fetchAllData(); };
  const deleteTemplate = async (id: number) => { await api.delete(`/workflows/templates/${id}/`); await fetchAllData(); };
  
  const createTaskTemplate = async (data: any) => { await api.post('/workflows/task-templates/', data); await fetchAllData(); };
  const updateTaskTemplate = async (id: number, data: any) => { await api.patch(`/workflows/task-templates/${id}/`, data); await fetchAllData(); };
  const deleteTaskTemplate = async (id: number) => { await api.delete(`/workflows/task-templates/${id}/`); await fetchAllData(); };
  
  const updateGlobalSetting = async (id: number, data: Partial<GlobalSetting>) => {
    try {
      await api.patch(`/projects/settings/${id}/`, data);
      await fetchAllData();
      toast.success("Настройка обновлена");
    } catch (err: any) {
      toast.error(extractError(err, "Ошибка обновления настройки"));
    }
  };

  const getTaskRecommendations = async (taskId: number) => {
    const res = await api.get(`/matching/recommend/${taskId}/`);
    return res.data;
  };

  return (
    <AppContext.Provider value={{
      projects, employees, projectRoles, processes, allTasks, myTasks,
      notifications, unreadCount, templates, planningBlocks, skills, users, globalSettings, metadata, loading,
      auditLogs, globalAuditLogs, analytics, risks, globalRoles, domains, calendars,
      extractError,
      refreshData: fetchAllData,
      updateTaskStatus, createTask,
      createProcess, updateProcess, deleteProcess,
      createProject, updateProject, deleteProject, importProject,
      createEmployee, updateEmployee, deleteEmployee,
      addSkillToEmployee, deleteEmployeeSkill,
      addCertificateToEmployee, deleteEmployeeCertificate,
      updateWorkflowTask, deleteWorkflowTask,
      addMemberToProject, removeMemberFromProject, assignEmployeeToProject,
      transferBlock, addUnavailabilityToEmployee, deleteEmployeeUnavailability,
      saveBlockAsTemplate,
      markNotificationRead, markAllRead, fetchAuditLogs,
      submitTaskReport, uploadTaskFile, approveTask,
      recalculateSchedule, shiftTask,
      fetchAnalytics,
      createRisk, updateRisk, deleteRisk,
      createGlobalRole, updateGlobalRole, deleteGlobalRole,
      createDomain, updateDomain, deleteDomain,
      createCalendar, updateCalendar, deleteCalendar,
      createHoliday, deleteHoliday,
      createSkill, updateSkill, deleteSkill,
      createUser, updateUser, deleteUser,
      createTemplate, updateTemplate, deleteTemplate,
      createTaskTemplate, updateTaskTemplate, deleteTaskTemplate,
      getTaskRecommendations,
      updateGlobalSetting
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
};
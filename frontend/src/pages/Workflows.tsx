import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GitBranch, Plus, Clock, AlertTriangle, CheckCircle2,
  Circle, Loader2, ArrowRight, X, FileText, Upload, List, ThumbsUp, Zap, Edit2, Trash2
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import { niceConfirm } from '../utils/confirm';


type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'ESCALATED';

const statusConfig: Record<string, { label: string; color: string; icon: any; headerBg: string }> = {
  TODO:        { label: 'К выполнению', color: 'text-slate-400',  icon: Circle,       headerBg: 'bg-slate-500/10 border-slate-500/20' },
  IN_PROGRESS: { label: 'В работе',     color: 'text-blue-400',   icon: Loader2,      headerBg: 'bg-blue-500/10 border-blue-500/20' },
  REVIEW:      { label: 'На проверке',  color: 'text-amber-400',  icon: Clock,        headerBg: 'bg-amber-500/10 border-amber-500/20' },
  DONE:        { label: 'Выполнено',    color: 'text-emerald-400', icon: CheckCircle2, headerBg: 'bg-emerald-500/10 border-emerald-500/20' },
  ESCALATED:   { label: 'Эскалация',   color: 'text-red-400',     icon: AlertTriangle, headerBg: 'bg-red-500/10 border-red-500/20' },
};

const taskTypeConfig: Record<string, { label: string; color: string; icon: any }> = {
  TEXT_REPORT: { label: 'Отчёт',       color: 'bg-violet-500/10 text-violet-400', icon: FileText },
  FILE_UPLOAD: { label: 'Файлы',       color: 'bg-blue-500/10 text-blue-400',     icon: Upload },
  CHECKLIST:   { label: 'Чек-лист',    color: 'bg-emerald-500/10 text-emerald-400', icon: List },
  APPROVAL:    { label: 'Утверждение', color: 'bg-amber-500/10 text-amber-400',   icon: ThumbsUp },
  INTEGRATION: { label: 'Интеграция',  color: 'bg-pink-500/10 text-pink-400',     icon: Zap },
};

const STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'ESCALATED'];

const getInitials = (name?: string | null) => {
  if (!name) return '?';
  const p = name.trim().split(' ');
  return p.length >= 2 ? `${p[0][0]}${p[1][0]}`.toUpperCase() : name.substring(0, 2).toUpperCase();
};

const GRADIENTS = [
  'from-violet-500 to-indigo-500', 'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-500',  'from-amber-500 to-orange-500',
  'from-blue-500 to-cyan-500',
];
const getGradient = (id?: number | null) => GRADIENTS[(id ?? 0) % GRADIENTS.length];

export default function Workflows() {
  const navigate = useNavigate();
  const { 
    processes, templates, createProcess, updateProcess, deleteProcess,
    updateTaskStatus, submitTaskReport, approveTask, projects, 
    employees, addMemberToProject, extractError,
    createTemplate, updateTemplate, deleteTemplate,
    createTaskTemplate, updateTaskTemplate, deleteTaskTemplate,
    createTask, updateWorkflowTask, deleteWorkflowTask
  } = useAppContext();
  const { user } = useAuth();

  const [activeProcessId, setActiveProcessId] = useState<number | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [isProcessModalOpen, setIsProcessModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isEditTaskModalOpen, setIsEditTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [pendingStatus, setPendingStatus] = useState<TaskStatus>('TODO');
  const [newProcessName, setNewProcessName] = useState('');
  const [newProcessDesc, setNewProcessDesc] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'catalog'>('active');

  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [templateFormData, setTemplateFormData] = useState({ name: '', description: '', is_published: false });

  const [isTaskTemplateModalOpen, setIsTaskTemplateModalOpen] = useState(false);
  const [editingTaskTemplate, setEditingTaskTemplate] = useState<any | null>(null);
  const [taskTemplateFormData, setTaskTemplateFormData] = useState<any>({
    name: '', description: '', task_type: 'TEXT_REPORT', sla_hours: 24, order: 0, 
    is_parallel: false, weight: 1, priority: 'MEDIUM', estimated_hours: 0, 
    risk_level: 'LOW', integration_url: '', integration_config: {}
  });
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskType, setNewTaskType] = useState('TEXT_REPORT');
  const [newTaskSla, setNewTaskSla] = useState(24);
  const [newTaskAssignee, setNewTaskAssignee] = useState<number | ''>('');
  const [submittingProcess, setSubmittingProcess] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<number | null>(null);

  const [isEditProcessModalOpen, setIsEditProcessModalOpen] = useState(false);
  const [editingProcess, setEditingProcess] = useState<any | null>(null);
  const [editProcessName, setEditProcessName] = useState('');
  const [editProcessDesc, setEditProcessDesc] = useState('');

  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewingTask, setReviewingTask] = useState<any | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submittingTaskRef, setSubmittingTaskRef] = useState<any | null>(null);
  const [reportData, setReportData] = useState({ text_content: '', checklist: [] as any[], files: [] as File[] });

  const filteredProcesses = useMemo(() => {
    return selectedProjectFilter
      ? processes.filter(p => p.project === selectedProjectFilter)
      : processes;
  }, [processes, selectedProjectFilter]);

  // Reset/update active process when filters change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetTaskId = params.get('task');

    if (targetTaskId && processes.length > 0) {
      // Find which process contains this task
      for (const proc of processes) {
        if (proc.tasks.some(t => t.id === Number(targetTaskId))) {
          setActiveProcessId(proc.id);
          // Also clear the project filter if the process is not in it
          if (selectedProjectFilter && proc.project !== selectedProjectFilter) {
            setSelectedProjectFilter(null);
          }
          break;
        }
      }
    } else if (filteredProcesses.length > 0) {
      // If current active is not in filtered, pick first
      if (!filteredProcesses.find(p => p.id === activeProcessId)) {
        setActiveProcessId(filteredProcesses[0].id);
      }
    } else {
      setActiveProcessId(null);
    }
  }, [selectedProjectFilter, processes, filteredProcesses, activeProcessId]);

  const activeProcess = useMemo(() => {
    return filteredProcesses.find(p => p.id === activeProcessId) ?? null;
  }, [filteredProcesses, activeProcessId]);

  const currentProject = useMemo(() => {
    return projects.find(p => p.id === activeProcess?.project) ?? null;
  }, [projects, activeProcess]);

  const isSystemManager = useMemo(() => {
    return user?.role === 'ADMIN' || user?.role === 'MANAGER';
  }, [user]);

  const canCreateProcess = isSystemManager;
  const canManageTasks = isSystemManager;

  const isManager = isSystemManager;

  const projectMemberUserIds = useMemo(() => {
    return new Set(currentProject?.members.map(m => m.user.id) || []);
  }, [currentProject]);

  const processTasks = useMemo(() => {
    return activeProcess?.tasks ?? [];
  }, [activeProcess]);

  const doneCount = processTasks.filter(t => t.status === 'DONE').length;
  const progressPct = processTasks.length > 0 ? (doneCount / processTasks.length) * 100 : 0;

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedTaskId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  
  const isBlocked = (task: any) => {
    if (!task.depends_on || task.depends_on.length === 0) return false;
    return task.depends_on.some((depId: number) => {
      const dep = processTasks.find(t => t.id === depId);
      return dep && dep.status !== 'DONE';
    });
  };
  const handleDrop = async (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    if (!isManager) return;
    if (draggedTaskId !== null) {
      await updateTaskStatus(draggedTaskId, status);
      setDraggedTaskId(null);
    }
  };

  const handleCreateProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProcessName.trim() || !selectedProjectId) return;
    setSubmittingProcess(true);
    const p = await createProcess(
      newProcessName.trim(), 
      Number(selectedProjectId), 
      selectedTemplateId ? Number(selectedTemplateId) : undefined,
      newProcessDesc.trim()
    );
    setSubmittingProcess(false);
    if (p) {
      setActiveProcessId(p.id);
      setIsProcessModalOpen(false);
      setNewProcessName(''); 
      setNewProcessDesc('');
      setSelectedProjectId('');
      setSelectedTemplateId('');
    }
  };

  const handleEditProcess = (proc: any) => {
    setEditingProcess(proc);
    setEditProcessName(proc.name);
    setEditProcessDesc(proc.description || '');
    setIsEditProcessModalOpen(true);
  };

  const handleUpdateProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) return;
    if (!editingProcess || !editProcessName.trim()) return;
    setSubmittingProcess(true);
    try {
      await updateProcess(editingProcess.id, {
        name: editProcessName.trim(),
        description: editProcessDesc.trim(),
      });
      setIsEditProcessModalOpen(false);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при обновлении процесса'));
    } finally {
      setSubmittingProcess(false);
    }
  };

  const handleDeleteProcess = async (procId: number) => {
    if (!isManager) return;
    const proc = processes.find(p => p.id === procId);
    if (!proc) return;
    if (proc.tasks.length > 0) {
      if (!await niceConfirm(`Процесс «${proc.name}» содержит задачи (${proc.tasks.length}). Вы уверены, что хотите его УДАЛИТЬ?`)) return;
    } else {
      if (!await niceConfirm(`Удалить процесс «${proc.name}»?`)) return;
    }
    await deleteProcess(procId);
  };

  const openAddTask = (status: TaskStatus) => {
    setPendingStatus(status);
    setNewTaskName('');
    setNewTaskType('TEXT_REPORT');
    setNewTaskSla(24);
    setNewTaskAssignee('');
    setIsTaskModalOpen(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) return;
    if (!activeProcessId || !newTaskName.trim() || !activeProcess?.project) return;
    
    setSubmittingTask(true);
    try {
      if (newTaskAssignee && !projectMemberUserIds.has(Number(newTaskAssignee))) {
        await addMemberToProject(activeProcess.project, Number(newTaskAssignee), 'DEVELOPER', 100);
      }

      await createTask({
        workflow: activeProcessId,
        name: newTaskName.trim(),
        task_type: newTaskType,
        status: pendingStatus,
        sla_hours: newTaskSla,
        assigned_to: newTaskAssignee || null,
      });
      setIsTaskModalOpen(false);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при создании задачи'));
    } finally {
      setSubmittingTask(false);
    }
  };

  const handleEditTask = (task: any) => {
    if (!isManager) return;
    setEditingTask({
      id: task.id,
      name: task.name,
      task_type: task.task_type,
      sla_hours: task.sla_hours,
      assigned_to: task.assigned_to || '',
    });
    setIsEditTaskModalOpen(true);
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager || !editingTask) return;
    
    if (!editingTask.sla_hours || editingTask.sla_hours <= 0) {
      toast.error("SLA должен быть больше 0");
      return;
    }
    setSubmittingTask(true);
    try {
      await updateWorkflowTask(editingTask.id, {
        name: editingTask.name,
        task_type: editingTask.task_type,
        sla_hours: editingTask.sla_hours,
        assigned_to: editingTask.assigned_to || null,
      });
      setIsEditTaskModalOpen(false);
      setEditingTask(null);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при обновлении задачи'));
    } finally {
      setSubmittingTask(false);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!isManager) return;
    if (!await niceConfirm('Удалить эту задачу?')) return;
    await deleteWorkflowTask(taskId);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) return;
    try {
      if (editingTemplate) await updateTemplate(editingTemplate.id, templateFormData);
      else await createTemplate(templateFormData);
      toast.success('Шаблон сохранен');
      setIsTemplateModalOpen(false);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка сохранения шаблона'));
    }
  };

  const handleSaveTaskTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) return;
    try {
      if (editingTaskTemplate) await updateTaskTemplate(editingTaskTemplate.id, taskTemplateFormData);
      else await createTaskTemplate(taskTemplateFormData);
      toast.success('Шаг шаблона сохранен');
      setIsTaskTemplateModalOpen(false);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка сохранения шага'));
    }
  };

  return (
    <div className="p-8 space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <GitBranch size={22} className="text-violet-400" /> Бизнес-процессы
          </h1>
          <p className="text-sm text-slate-400 mt-1">Канбан-доска для управления задачами процесса</p>
        </div>

        <div className="flex items-center gap-3">
          {(canCreateProcess || canManageTasks) && (
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 mr-2">
              <button 
                onClick={() => setActiveTab('active')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'active' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Активные
              </button>
              <button 
                onClick={() => setActiveTab('catalog')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'catalog' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Шаблоны
              </button>
            </div>
          )}

          {activeTab === 'active' ? (
            canCreateProcess && (
              <button
                onClick={() => setIsProcessModalOpen(true)}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-lg shadow-violet-500/20"
              >
                <Plus size={16} /> Новый процесс
              </button>
            )
          ) : (
            canManageTasks && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate('/workflows/editor')}
                  className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-lg shadow-violet-500/20"
                >
                  <GitBranch size={16} /> Визуальный редактор
                </button>
                <button
                  onClick={() => { setEditingTemplate(null); setTemplateFormData({ name: '', description: '', is_published: true }); setIsTemplateModalOpen(true); }}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors border border-slate-700"
                >
                  <Plus size={16} /> Создать шаблон
                </button>
              </div>
            )
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <select
          value={selectedProjectFilter || ''}
          onChange={e => setSelectedProjectFilter(e.target.value ? Number(e.target.value) : null)}
          className="bg-slate-900 border border-slate-800 text-slate-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
        >
          <option value="">Все проекты</option>
          {projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {activeProcess && canManageTasks && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => handleEditProcess(activeProcess)}
              className="p-2 text-slate-500 hover:text-violet-400 hover:bg-slate-800 rounded-lg transition-all"
              title="Изменить процесс"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => handleDeleteProcess(activeProcess.id)}
              className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
              title="Удалить процесс"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1 min-w-[200px]">
          <select
            value={activeProcessId || ''}
            onChange={e => setActiveProcessId(e.target.value ? Number(e.target.value) : null)}
            className="w-full bg-transparent border-none text-slate-300 text-xs rounded px-2 py-1.5 focus:outline-none cursor-pointer"
          >
            <option value="" className="bg-slate-900 text-slate-500">Выберите процесс...</option>
            {filteredProcesses.map(p => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                {p.name}
              </option>
            ))}
          </select>
          {filteredProcesses.length === 0 && (
            <span className="absolute left-1/2 -translate-x-1/2 px-3 py-1.5 text-[10px] text-slate-600 pointer-events-none">Нет процессов</span>
          )}
        </div>
        {activeProcess && (
          <div className="flex items-center gap-2 ml-auto text-xs text-slate-500">
            <span>Прогресс:</span>
            <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-slate-300 font-medium">{doneCount}/{processTasks.length}</span>
          </div>
        )}
      </div>

      {processTasks.length > 0 && (
        <div className="flex items-center gap-1 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 overflow-x-auto">
          {processTasks.slice(0, 7).map((task, i, arr) => (
            <div key={task.id} className="flex items-center gap-1">
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                task.status === 'DONE'        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                task.status === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                task.status === 'REVIEW'      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                'bg-slate-800 text-slate-500 border border-slate-700'
              }`}>
                {task.status === 'DONE' && <CheckCircle2 size={11} />}
                {task.name}
              </div>
              {i < arr.length - 1 && <ArrowRight size={12} className="text-slate-700 flex-shrink-0" />}
            </div>
          ))}
          {processTasks.length > 7 && (
            <span className="text-xs text-slate-600 ml-1">+{processTasks.length - 7} ещё</span>
          )}
        </div>
      )}

      {activeTab === 'active' ? (
        <div className="flex gap-4 flex-1 overflow-x-auto pb-4">
            {STATUSES.map(status => {
              const cfg = statusConfig[status];
              const Icon = cfg.icon;
              const colTasks = processTasks
                .filter(t => t.status === status)
                .sort((a, b) => (a.order || 0) - (b.order || 0));

              return (
                <div
                  key={status}
                  className="flex-1 min-w-[260px] flex flex-col"
                  onDragOver={handleDragOver}
                  onDrop={(e => handleDrop(e, status))}
                >
                  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border mb-3 flex-shrink-0 ${cfg.headerBg}`}>
                    <Icon size={14} className={cfg.color} />
                    <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-[10px] font-bold text-slate-600 bg-slate-800 rounded-full w-5 h-5 flex items-center justify-center ml-auto">
                      {colTasks.length}
                    </span>
                  </div>

                  <div className="space-y-2.5 flex-1 overflow-y-auto p-1 -m-1">
                    {colTasks.map(task => {
                      const tt = taskTypeConfig[task.task_type] ?? taskTypeConfig.TEXT_REPORT;
                      const TypeIcon = tt.icon;
                      const params = new URLSearchParams(window.location.search);
                      const isTargeted = params.get('task') === task.id.toString();

                      return (
                        <div
                          key={task.id}
                          draggable={(isManager || user?.id === task.assigned_to) && !isBlocked(task)}
                          onDragStart={e => handleDragStart(e, task.id)}
                          className={`bg-slate-900 border rounded-lg p-3.5 hover:border-slate-700 transition-all group shadow-sm ${
                            isBlocked(task) ? 'opacity-60 grayscale-[0.5]' : 'cursor-grab active:cursor-grabbing'
                          } ${
                            isTargeted ? 'border-amber-500 ring-2 ring-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.2)] animate-pulse' : 'border-slate-800'
                          }`}
                        >
                            {isTargeted && (
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-400 mb-2">
                                <Zap size={10} className="fill-amber-400" /> ВЫБРАНО ИЗ ПЛАНА
                              </div>
                            )}
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 ${tt.color}`}>
                                <TypeIcon size={9} />{tt.label}
                              </span>
                              {isBlocked(task) && (
                                <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                                  <X size={8} /> LOCKED
                                </span>
                              )}
                            </div>
                            <div className={`flex items-center gap-2 text-[11px] ${task.is_overdue ? 'text-red-400' : 'text-slate-500'}`}>
                              {task.is_overdue && <AlertTriangle size={10} />}
                              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {canManageTasks && (
                                  <>
                                    <button onClick={(e) => { e.stopPropagation(); handleEditTask(task); }} className="p-0.5 hover:text-white transition-colors" title="Редактировать"><Edit2 size={10} /></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }} className="p-0.5 hover:text-red-400 transition-colors" title="Удалить"><Trash2 size={10} /></button>
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock size={10} />
                                {task.due_date
                                  ? new Date(task.due_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
                                  : '—'}
                              </div>
                            </div>
                          </div>
                          <p className="text-sm font-medium text-slate-200 leading-snug mb-2 group-hover:text-white">{task.name}</p>
                          
                          <div className="mb-3">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">SLA Progress</span>
                              <span className={`text-[9px] font-bold ${
                                task.sla_hours > 0 && task.created_at && (Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000) > 1 ? 'text-red-400' : 'text-slate-500'
                              }`}>
                                {task.sla_hours > 0 && task.created_at
                                  ? Math.round(Math.min(100, ((Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000)) * 100)) 
                                  : 0}%
                              </span>
                            </div>
                            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all duration-1000 ${
                                  task.sla_hours > 0 && task.created_at && (Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000) > 1 ? 'bg-red-500' :
                                  task.sla_hours > 0 && task.created_at && (Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000) > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}
                                style={{ width: `${task.sla_hours > 0 && task.created_at ? Math.min(100, ((Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000)) * 100) : 0}%` }}
                              />
                            </div>
                          </div>

                          {/* SLA Escalation Banner */}
                          {task.sla_hours > 0 && task.created_at && task.status !== 'DONE' && task.status !== 'ESCALATED' &&
                            (Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000) > 1.5 && (
                            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg animate-pulse">
                              <p className="text-[10px] text-red-400 flex items-center gap-1 font-bold">
                                <AlertTriangle size={10} />
                                Требуется эскалация! SLA превышен в {Math.round((Date.now() - new Date(task.created_at).getTime()) / (task.sla_hours * 3600000) * 10) / 10}x
                              </p>
                            </div>
                          )}
                          {task.status === 'ESCALATED' && (
                            <div className="mt-2 p-2 bg-red-500/15 border border-red-500/30 rounded-lg">
                              <p className="text-[10px] text-red-300 flex items-center gap-1 font-bold">
                                <AlertTriangle size={10} />
                                Эскалировано — требуется вмешательство
                              </p>
                            </div>
                          )}

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${getGradient(task.assigned_to)} flex items-center justify-center text-[9px] font-bold text-white`}>
                                {getInitials(task.assigned_to_name)}
                              </div>
                              <span className="text-xs text-slate-500">{task.assigned_to_name || 'Не назначен'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 border-l border-slate-800 pl-2 ml-2">
                              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-tighter">SLA {task.sla_hours}h</span>
                            </div>
                          </div>
                          {task.report?.checklist && task.report.checklist.length > 0 && (
                            <div className="mt-3 mb-2 p-2 bg-slate-950/40 rounded-lg border border-slate-800/50">
                              <div className="flex justify-between items-center mb-1.5">
                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1.5">
                                  <List size={10} className="text-emerald-500" /> Чек-лист
                                </span>
                                <span className="text-[10px] font-bold text-emerald-400 tabular-nums">
                                  {task.report.checklist.filter((i: any) => i.is_done).length}/{task.report.checklist.length}
                                </span>
                              </div>
                              <div className="flex gap-1">
                                {task.report.checklist.map((item: any, idx: number) => (
                                  <div 
                                    key={idx} 
                                    className={`h-1 flex-1 rounded-full ${item.is_done ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.3)]' : 'bg-slate-800'}`} 
                                    title={item.text}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {task.status === 'REVIEW' && isManager && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setReviewingTask(task); setIsReviewModalOpen(true); }}
                              className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 rounded-lg transition-colors"
                            >
                              <Clock size={12} /> Проверить результат
                            </button>
                          )}
                          {task.status === 'IN_PROGRESS' && (user?.id === task.assigned_to || isManager) && (
                            <button
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setSubmittingTaskRef(task); 
                                const initialCl = task.report?.checklist || task.checklist || [];
                                setReportData({ text_content: '', checklist: [...initialCl], files: [] });
                                setIsSubmitModalOpen(true); 
                              }}
                              className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-semibold text-blue-400 border border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 rounded-lg transition-colors"
                            >
                              <ThumbsUp size={12} /> Отправить результат
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {canManageTasks && (
                      <button
                        onClick={() => openAddTask(status)}
                        disabled={!activeProcessId}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 mt-2 text-xs text-slate-600 hover:text-slate-400 border border-dashed border-slate-800 hover:border-slate-700 rounded-lg transition-colors disabled:opacity-40"
                      >
                        <Plus size={13} /> Добавить
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pb-10">
          {templates.map(tpl => (
            <div key={tpl.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition-all group relative overflow-hidden flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                    <GitBranch size={20} />
                  </div>
                  <div>
                    <h3 className="text-white font-bold">{tpl.name}</h3>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{tpl.task_templates.length} шагов</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button onClick={() => navigate(`/workflows/editor/${tpl.id}`)} className="p-1.5 text-slate-400 hover:text-violet-400 hover:bg-slate-800 rounded-lg" title="Визуальный редактор"><GitBranch size={14}/></button>
                   <button onClick={() => { setEditingTemplate(tpl); setTemplateFormData({ name: tpl.name, description: tpl.description || '', is_published: tpl.is_published }); setIsTemplateModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"><Edit2 size={14}/></button>
                   <button onClick={async () => { if(await niceConfirm('Удалить шаблон?')) deleteTemplate(tpl.id); }} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg"><Trash2 size={14}/></button>
                </div>
              </div>
              <p className="text-xs text-slate-500 mb-6 line-clamp-2">{tpl.description || 'Нет описания'}</p>
              
              <div className="space-y-2 flex-1">
                 {tpl.task_templates.sort((a,b) => a.order - b.order).map((tt, idx) => (
                   <div key={tt.id} className="flex items-center gap-3 p-2 bg-slate-800/30 rounded-lg border border-slate-800/50 group/step">
                      <span className="text-[10px] font-bold text-slate-600 w-4">{idx+1}</span>
                      <span className="text-xs text-slate-300 flex-1 truncate">{tt.name}</span>
                      <div className="flex items-center gap-1.5">
                         <span className={`text-[8px] font-bold px-1 rounded ${taskTypeConfig[tt.task_type]?.color || ''}`}>
                            {tt.task_type.split('_')[0]}
                         </span>
                          {canManageTasks && (
                            <>
                              <button 
                                onClick={() => { setEditingTaskTemplate(tt); setTaskTemplateFormData(tt); setIsTaskTemplateModalOpen(true); }}
                                className="opacity-0 group-hover/step:opacity-100 p-1 text-slate-500 hover:text-white transition-all"
                              >
                                 <Edit2 size={10} />
                              </button>
                              <button 
                                onClick={async () => { if(await niceConfirm('Удалить этот шаг?')) deleteTaskTemplate(tt.id); }}
                                className="opacity-0 group-hover/step:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                              >
                                 <Trash2 size={10} />
                              </button>
                            </>
                          )}
                      </div>
                   </div>
                 ))}
                 {canManageTasks && (
                   <button 
                     onClick={() => { 
                       setEditingTaskTemplate(null); 
                       setTaskTemplateFormData({ 
                         template: tpl.id, name: '', description: '', task_type: 'TEXT_REPORT', 
                         sla_hours: 24, order: tpl.task_templates.length, weight: 1, 
                         priority: 'MEDIUM', risk_level: 'LOW', checklist: [] 
                       }); 
                       setIsTaskTemplateModalOpen(true); 
                     }}
                     className="w-full py-2 border border-dashed border-slate-800 rounded-lg text-[10px] font-bold text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-all uppercase tracking-widest"
                   >
                      + Добавить шаг
                   </button>
                 )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                 <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tpl.is_published ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {tpl.is_published ? 'ОПУБЛИКОВАН' : 'ЧЕРНОВИК'}
                 </span>
                 {canCreateProcess && (
                   <button 
                     onClick={() => { setSelectedProjectId(''); setSelectedTemplateId(tpl.id); setIsProcessModalOpen(true); }}
                     className="text-xs font-bold text-violet-400 hover:text-violet-300 flex items-center gap-1.5"
                   >
                      Запустить <ArrowRight size={12} />
                   </button>
                 )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isProcessModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Запуск процесса</h2>
              <button onClick={() => setIsProcessModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateProcess} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название процесса</label>
                <input 
                  type="text" required autoFocus
                  value={newProcessName}
                  onChange={e => setNewProcessName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                  placeholder="Например: Разработка фичи X"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Проект</label>
                <select 
                  required
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">Выберите проект...</option>
                  {projects.filter(p => {
                    if (user?.role === 'ADMIN' || user?.role === 'MANAGER') return true;
                    const isMgr = p.members?.some(m => m.user.id === user?.id && m.role === 'MANAGER');
                    return (p.status === 'ACTIVE' || p.status === 'AT_RISK') && isMgr;
                  }).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Шаблон (опционально)</label>
                <select 
                  value={selectedTemplateId}
                  onChange={e => setSelectedTemplateId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">Без шаблона (пустой процесс)</option>
                  {templates.filter(t => t.is_published).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Описание (опционально)</label>
                <textarea 
                  value={newProcessDesc}
                  onChange={e => setNewProcessDesc(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 h-20 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsProcessModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button 
                  type="submit" 
                  disabled={submittingProcess}
                  className="px-6 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/20"
                >
                  {submittingProcess ? 'Запуск...' : 'Запустить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Process */}
      {isEditProcessModalOpen && editingProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Изменить процесс</h2>
              <button onClick={() => setIsEditProcessModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateProcess} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название процесса</label>
                <input 
                  type="text" required autoFocus
                  value={editProcessName}
                  onChange={e => setEditProcessName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                <textarea 
                  value={editProcessDesc}
                  onChange={e => setEditProcessDesc(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 h-24 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsEditProcessModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button 
                  type="submit" 
                  disabled={submittingProcess}
                  className="px-6 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/20"
                >
                  {submittingProcess ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Template */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">{editingTemplate ? 'Изменить' : 'Создать'} шаблон</h2>
              <button onClick={() => setIsTemplateModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveTemplate} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название</label>
                <input 
                  type="text" required autoFocus
                  value={templateFormData.name}
                  onChange={e => setTemplateFormData({...templateFormData, name: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                <textarea 
                  value={templateFormData.description}
                  onChange={e => setTemplateFormData({...templateFormData, description: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 h-24 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                 <input 
                   type="checkbox"
                   checked={templateFormData.is_published}
                   onChange={e => setTemplateFormData({...templateFormData, is_published: e.target.checked})}
                   className="w-4 h-4 rounded text-violet-600 focus:ring-violet-500 bg-slate-900 border-slate-700"
                 />
                 <span className="text-sm text-slate-200">Опубликовать (будет доступен для запуска)</span>
              </div>
              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button type="submit" className="px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/20">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Task Template */}
      {isTaskTemplateModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-8 my-8 shadow-2xl animate-in zoom-in-95 duration-200 relative">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold text-white">{editingTaskTemplate ? 'Редактировать шаг' : 'Добавить шаг в шаблон'}</h2>
              <button onClick={() => setIsTaskTemplateModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={24} /></button>
            </div>
            <form onSubmit={handleSaveTaskTemplate} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="col-span-full">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Название шага</label>
                  <input 
                    type="text" required autoFocus
                    value={taskTemplateFormData.name}
                    onChange={e => setTaskTemplateFormData({...taskTemplateFormData, name: e.target.value})}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 transition-all"
                    placeholder="Например: Архитектурный ревью"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Тип задачи</label>
                  <select 
                    value={taskTemplateFormData.task_type}
                    onChange={e => setTaskTemplateFormData({...taskTemplateFormData, task_type: e.target.value})}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-all"
                  >
                    {Object.entries(taskTypeConfig).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">SLA (часов)</label>
                  <input 
                    type="number" required
                    value={taskTemplateFormData.sla_hours}
                    onChange={e => setTaskTemplateFormData({...taskTemplateFormData, sla_hours: Number(e.target.value)})}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-all"
                  />
                </div>
                <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Приоритет</label>
                   <select 
                    value={taskTemplateFormData.priority}
                    onChange={e => setTaskTemplateFormData({...taskTemplateFormData, priority: e.target.value})}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-all"
                   >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                   </select>
                </div>
                 <div>
                   <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Порядок (0 = старт)</label>
                   <input 
                    type="number" required
                    value={taskTemplateFormData.order}
                    onChange={e => setTaskTemplateFormData({...taskTemplateFormData, order: Number(e.target.value)})}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-all"
                   />
                </div>
                <div className="col-span-full">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Чек-лист (каждый пункт с новой строки)</label>
                  <textarea 
                    value={Array.isArray(taskTemplateFormData.checklist) ? taskTemplateFormData.checklist.join('\n') : ''}
                    onChange={e => setTaskTemplateFormData({...taskTemplateFormData, checklist: e.target.value.split('\n').filter(l => l.trim()) })}
                    className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-sm rounded-xl px-4 py-3 h-32 focus:outline-none focus:border-violet-500 transition-all font-mono"
                    placeholder="Пункт 1&#10;Пункт 2&#10;Пункт 3"
                  />
                </div>
              </div>

              {taskTemplateFormData.task_type === 'INTEGRATION' && (
                <div className="p-5 bg-pink-500/5 border border-pink-500/20 rounded-2xl space-y-4">
                   <div className="flex items-center gap-2 text-pink-400 font-bold text-xs uppercase tracking-widest">
                      <Zap size={14} /> Настройки интеграции
                   </div>
                   <div>
                      <label className="block text-[10px] text-slate-500 mb-1.5 font-bold uppercase">Webhook URL</label>
                      <input 
                        type="url"
                        value={taskTemplateFormData.integration_url || ''}
                        onChange={e => setTaskTemplateFormData({...taskTemplateFormData, integration_url: e.target.value})}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg px-4 py-2.5 focus:outline-none focus:border-pink-500 transition-all"
                        placeholder="https://api.example.com/webhook"
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] text-slate-500 mb-1.5 font-bold uppercase">JSON Config (headers/timeout)</label>
                      <textarea 
                        value={typeof taskTemplateFormData.integration_config === 'string' ? taskTemplateFormData.integration_config : JSON.stringify(taskTemplateFormData.integration_config, null, 2)}
                        onChange={e => {
                          try {
                            const val = e.target.value;
                            setTaskTemplateFormData({...taskTemplateFormData, integration_config: val });
                          } catch(e) {}
                        }}
                        className="w-full bg-slate-900 border border-slate-800 text-slate-400 text-[11px] font-mono rounded-lg px-4 py-2.5 h-24 focus:outline-none focus:border-pink-500 transition-all"
                        placeholder='{ "headers": { "Authorization": "Bearer..." } }'
                      />
                   </div>
                </div>
              )}

              <div className="pt-6 border-t border-slate-800 flex items-center justify-end gap-4">
                <button type="button" onClick={() => setIsTaskTemplateModalOpen(false)} className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors">Отмена</button>
                <button 
                  type="submit" 
                  className="px-8 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold rounded-xl transition-all shadow-xl shadow-violet-600/20 active:scale-95"
                >
                   {editingTaskTemplate ? 'Обновить шаг' : 'Добавить шаг'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: New Task */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Добавить задачу</h2>
              <button onClick={() => setIsTaskModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название задачи</label>
                <input
                  type="text" required autoFocus
                  value={newTaskName}
                  onChange={e => setNewTaskName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Тип задачи</label>
                  <select
                    value={newTaskType}
                    onChange={e => setNewTaskType(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                  >
                    {Object.entries(taskTypeConfig).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">SLA (часов)</label>
                  <input
                    type="number" min={1} max={720}
                    value={newTaskSla}
                    onChange={e => setNewTaskSla(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Исполнитель</label>
                <select
                  value={newTaskAssignee}
                  onChange={e => setNewTaskAssignee(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">— Не назначен —</option>
                  <optgroup label="Команда проекта">
                    {employees.filter(e => projectMemberUserIds.has(e.user.id)).map(emp => (
                      <option key={emp.user.id} value={emp.user.id}>{emp.full_name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Все сотрудники">
                    {employees.filter(e => !projectMemberUserIds.has(e.user.id)).map(emp => (
                      <option key={emp.user.id} value={emp.user.id}>{emp.full_name}</option>
                    ))}
                  </optgroup>
                </select>
                {newTaskAssignee && !projectMemberUserIds.has(Number(newTaskAssignee)) && currentProject && (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-400 flex items-center justify-between">
                    <span>Сотрудник не в команде проекта.</span>
                    <button 
                      type="button" 
                      onClick={async () => {
                        await addMemberToProject(currentProject.id, Number(newTaskAssignee), 'DEVELOPER', 100);
                      }}
                      className="underline font-bold hover:text-amber-300 transition-colors"
                    >
                      Добавить в команду
                    </button>
                  </div>
                )}
              </div>
              <div className="pt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white">Отмена</button>
                <button
                  type="submit"
                  disabled={submittingTask}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {submittingTask ? 'Создание...' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Task */}
      {isEditTaskModalOpen && editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Изменить задачу</h2>
              <button onClick={() => setIsEditTaskModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateTask} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название задачи</label>
                <input
                  type="text" required
                  value={editingTask.name}
                  onChange={e => setEditingTask({ ...editingTask, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Тип</label>
                  <select
                    value={editingTask.task_type}
                    onChange={e => setEditingTask({ ...editingTask, task_type: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5"
                  >
                    {Object.entries(taskTypeConfig).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">SLA (часы)</label>
                  <input
                    type="number" required
                    value={editingTask.sla_hours}
                    onChange={e => setEditingTask({ 
                      ...editingTask, 
                      sla_hours: e.target.value === '' ? '' : Number(e.target.value) 
                    })}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Исполнитель</label>
                <select
                  value={editingTask.assigned_to || ''}
                  onChange={e => setEditingTask({ ...editingTask, assigned_to: e.target.value ? Number(e.target.value) : '' })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">— Не назначен —</option>
                  <optgroup label="Команда проекта">
                    {employees.filter(e => projectMemberUserIds.has(e.user.id)).map(emp => (
                      <option key={emp.user.id} value={emp.user.id}>{emp.full_name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Все сотрудники">
                    {employees.filter(e => !projectMemberUserIds.has(e.user.id)).map(emp => (
                      <option key={emp.user.id} value={emp.user.id}>{emp.full_name}</option>
                    ))}
                  </optgroup>
                </select>
                {editingTask.assigned_to && !projectMemberUserIds.has(Number(editingTask.assigned_to)) && currentProject && (
                  <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-400 flex items-center justify-between">
                    <span>Сотрудник не в команде проекта.</span>
                    <button 
                      type="button" 
                      onClick={async () => {
                        await addMemberToProject(currentProject.id, Number(editingTask.assigned_to), 'DEVELOPER', 100);
                      }}
                      className="underline font-bold hover:text-amber-300 transition-colors"
                    >
                      Добавить в команду
                    </button>
                  </div>
                )}
              </div>
              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsEditTaskModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button
                  type="submit"
                  disabled={submittingTask}
                  className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2"
                >
                  {submittingTask && <Loader2 size={16} className="animate-spin" />}
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Process */}
      {isEditProcessModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit2 size={18} className="text-violet-400" /> Изменить процесс
              </h2>
              <button onClick={() => setIsEditProcessModalOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleUpdateProcess} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название процесса</label>
                <input
                  type="text" required autoFocus
                  value={editProcessName}
                  onChange={e => setEditProcessName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                <textarea
                  value={editProcessDesc}
                  onChange={e => setEditProcessDesc(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 min-h-[100px] resize-none"
                  placeholder="Добавьте описание процесса..."
                />
              </div>
              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsEditProcessModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button
                  type="submit"
                  disabled={submittingProcess}
                  className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2"
                >
                  {submittingProcess && <Loader2 size={16} className="animate-spin" />}
                  Обновить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Review Task Modal */}
      {isReviewModalOpen && reviewingTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                  <Clock size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Проверка результата</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Задача: {reviewingTask.name}</p>
                </div>
              </div>
              <button onClick={() => setIsReviewModalOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {reviewingTask.report && (reviewingTask.report.text_content || reviewingTask.task_type !== 'INTEGRATION') && (
                <div className="space-y-2">
                  <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest flex items-center gap-2">
                    <FileText size={12} /> Текст отчёта
                  </h4>
                  <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {reviewingTask.report.text_content || "Текст отсутствует"}
                  </div>
                </div>
              )}

              {reviewingTask.report?.checklist && reviewingTask.report.checklist.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest flex items-center gap-2">
                    <List size={12} /> Чек-лист
                  </h4>
                  <div className="space-y-2 bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                    {reviewingTask.report.checklist.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${item.is_done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-700'}`}>
                          {item.is_done && <CheckCircle2 size={10} />}
                        </div>
                        <span className={`text-xs ${item.is_done ? 'text-slate-300' : 'text-slate-500'}`}>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reviewingTask.attachments && reviewingTask.attachments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest flex items-center gap-2">
                    <Upload size={12} /> Прикреплённые файлы
                  </h4>
                  <div className="grid grid-cols-1 gap-2">
                    {reviewingTask.attachments.map((a: any) => (
                      <a 
                        key={a.id} 
                        href={a.file.startsWith('http') ? a.file : `http://localhost:8000${a.file}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center justify-between p-3 bg-slate-800/30 border border-slate-800 rounded-xl hover:border-violet-500/50 hover:bg-violet-500/5 transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 group-hover:scale-110 transition-transform">
                            <FileText size={16} />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-slate-300">{a.original_name}</p>
                            <p className="text-[9px] text-slate-500">Нажмите, чтобы открыть</p>
                          </div>
                        </div>
                        <Upload size={14} className="text-slate-600 group-hover:text-violet-400 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-800/20 border-t border-slate-800 flex gap-3">
              <button
                onClick={async () => {
                  await updateTaskStatus(reviewingTask.id, 'IN_PROGRESS');
                  setIsReviewModalOpen(false);
                  toast.success("Задача возвращена в работу");
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-700 text-xs font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
              >
                <X size={14} /> Вернуть в работу
              </button>
              <button
                onClick={async () => {
                  await approveTask(reviewingTask.id);
                  setIsReviewModalOpen(false);
                  toast.success("Задача успешно утверждена");
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/20 transition-all"
              >
                <CheckCircle2 size={14} /> Утвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Submit Task Report */}
      {isSubmitModalOpen && submittingTaskRef && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${taskTypeConfig[submittingTaskRef.task_type]?.color || 'bg-slate-800 text-slate-400'}`}>
                   {(() => {
                      const Icon = taskTypeConfig[submittingTaskRef.task_type]?.icon || FileText;
                      return <Icon size={20} />;
                   })()}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Сдать работу</h2>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{taskTypeConfig[submittingTaskRef.task_type]?.label || 'Задача'}</p>
                </div>
              </div>
              <button onClick={() => setIsSubmitModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={20} /></button>
            </div>
            
            <div className="space-y-5">
              {/* Common: Text Content */}
              <div>
                <label className="block text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">Комментарий / Результат</label>
                <textarea 
                  value={reportData.text_content}
                  onChange={e => setReportData({ ...reportData, text_content: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 h-28 focus:outline-none focus:border-violet-500 transition-all placeholder:text-slate-600"
                  placeholder={submittingTaskRef.task_type === 'APPROVAL' ? "Введите обоснование для утверждения..." : "Опишите, что было сделано..."}
                />
              </div>
              
              {/* Type-based: Checklist */}
              {submittingTaskRef.task_type === 'CHECKLIST' && reportData.checklist.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">Чек-лист выполнения</label>
                    <span className={`text-[10px] font-bold ${reportData.checklist.every((i: any) => i.is_done) ? 'text-emerald-400' : 'text-amber-400'}`}>
                       {reportData.checklist.filter((i: any) => i.is_done).length} / {reportData.checklist.length}
                    </span>
                  </div>
                  <div className="space-y-2 bg-slate-950/40 rounded-xl p-4 border border-slate-800/50">
                    {reportData.checklist.map((item: any, idx: number) => (
                      <label key={idx} className="flex items-center gap-3 group cursor-pointer">
                        <div className="relative flex items-center justify-center">
                          <input 
                            type="checkbox"
                            checked={item.is_done}
                            onChange={e => {
                              const newCl = [...reportData.checklist];
                              newCl[idx].is_done = e.target.checked;
                              setReportData({ ...reportData, checklist: newCl });
                            }}
                            className="peer w-5 h-5 rounded border-2 border-slate-700 bg-slate-900 text-violet-600 focus:ring-0 focus:ring-offset-0 transition-all checked:border-violet-500"
                          />
                          <CheckCircle2 size={12} className="absolute text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                        </div>
                        <span className={`text-xs font-medium transition-colors ${item.is_done ? 'text-slate-400 line-through' : 'text-slate-200 group-hover:text-white'}`}>{item.text}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Type-based: File Upload */}
              {submittingTaskRef.task_type === 'FILE_UPLOAD' && (
                <div className="space-y-3">
                  <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest">Прикрепить файлы</label>
                  <div className="grid grid-cols-1 gap-2">
                    {reportData.files.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-slate-800/50 border border-slate-700 rounded-lg group">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-400">
                             <Upload size={14} />
                          </div>
                          <span className="text-xs text-slate-300 truncate">{file.name}</span>
                        </div>
                        <button 
                          onClick={() => setReportData({ ...reportData, files: reportData.files.filter((_, i) => i !== idx) })}
                          className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-slate-800 border-dashed rounded-xl cursor-pointer hover:bg-slate-800/30 hover:border-violet-500/50 transition-all group">
                    <div className="flex flex-col items-center justify-center pt-2 pb-2">
                      <Upload size={20} className="text-slate-500 group-hover:text-violet-400 group-hover:scale-110 transition-all mb-2" />
                      <p className="text-[10px] text-slate-500 group-hover:text-slate-300 uppercase font-bold">Нажмите или перетащите файл</p>
                    </div>
                    <input 
                      type="file" multiple className="hidden" 
                      onChange={e => {
                        if (e.target.files) {
                          setReportData({ ...reportData, files: [...reportData.files, ...Array.from(e.target.files)] });
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsSubmitModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors">Отмена</button>
                <button 
                  onClick={async () => {
                    // Validation
                    if (submittingTaskRef.task_type === 'CHECKLIST' && !reportData.checklist.every((i: any) => i.is_done)) {
                      toast.error('Пожалуйста, выполните все пункты чек-листа');
                      return;
                    }
                    if (submittingTaskRef.task_type === 'FILE_UPLOAD' && reportData.files.length === 0) {
                      toast.error('Пожалуйста, прикрепите хотя бы один файл');
                      return;
                    }

                    setSubmittingTask(true);
                    try {
                      await submitTaskReport(submittingTaskRef.id, reportData);
                      setIsSubmitModalOpen(false);
                      toast.success('Отчёт успешно отправлен');
                    } catch (err: any) {
                      toast.error(extractError(err, 'Ошибка при отправке'));
                    } finally {
                      setSubmittingTask(false);
                    }
                  }}
                  disabled={submittingTask}
                  className="px-8 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-violet-600/30 flex items-center gap-2"
                >
                  {submittingTask ? (
                    <><span className="animate-spin text-sm">⟳</span> Отправка...</>
                  ) : (
                    <><ArrowRight size={16} /> Сдать работу</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
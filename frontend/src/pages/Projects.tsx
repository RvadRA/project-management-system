import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, ArrowUpRight, Calendar, Users, X, Copy, FolderOpen, Trash2, Edit2, Save, ListTree, GitMerge, History, Zap, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import { niceConfirm } from '../utils/confirm';
import type { Project, PlanningBlock } from '../context/AppContext';
import TransferWizard from '../components/TransferWizard';
import GanttChart from '../components/GanttChart';

// Status labels in Russian
const statusMap: Record<string, string> = {
  ACTIVE: 'Активен',
  AT_RISK: 'В зоне риска',
  DRAFT: 'Черновик',
  ON_HOLD: 'На паузе',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
};

const statusStyle: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  AT_RISK: 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse',
  DRAFT: 'bg-slate-700/50 text-slate-400 border-slate-600/30',
  ON_HOLD: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  COMPLETED: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CANCELLED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const domainColor: Record<string, string> = {
  IT: 'bg-violet-500/10 text-violet-400',
  Data: 'bg-indigo-500/10 text-indigo-400',
  Analytics: 'bg-amber-500/10 text-amber-400',
  Design: 'bg-blue-500/10 text-blue-400',
  DevOps: 'bg-emerald-500/10 text-emerald-400',
  HR: 'bg-teal-500/10 text-teal-400',
  Marketing: 'bg-pink-500/10 text-pink-400',
  Sales: 'bg-orange-500/10 text-orange-400',
  QA: 'bg-rose-500/10 text-rose-400',
  Support: 'bg-slate-500/10 text-slate-400',
};


type ModalMode = 'none' | 'create' | 'import' | 'edit' | 'detail';

const WBSTaskItem = ({ 
  task, 
  isManager, 
  handleShift, 
  handleRecalculate,
  handleCreateTask,
  blockId,
  addingTaskToBlockId,
  setAddingTaskToBlockId,
  newTaskName,
  setNewTaskName,
  depth = 0,
  wbsNumber = '',
  ganttRange,
  onRefresh,
  setAiSuggestion,
  setPreview,
  preview,
  handleDeleteTask,
  handleUpdateTask
}: any) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const navigate = useNavigate();
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;

  return (
    <div className={`transition-all ${depth > 0 ? 'ml-6 border-l border-slate-800/30 pl-3 mt-1' : ''}`}>
      <div className="p-3 hover:bg-slate-800/30 transition-colors group/task rounded-lg">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono text-slate-600 w-8">{wbsNumber}</span>
              {hasSubtasks && (
                <button 
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  className="p-0.5 text-slate-500 hover:text-slate-300"
                >
                  <ListTree size={10} className={isCollapsed ? '-rotate-90 transition-transform' : 'transition-transform'} />
                </button>
              )}
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input 
                    autoFocus
                    type="text" 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        handleUpdateTask(task.id, { name: editName });
                        setIsEditing(false);
                      }
                      if (e.key === 'Escape') setIsEditing(false);
                    }}
                    className="bg-slate-900 border border-violet-500 text-xs text-white rounded px-2 py-0.5 outline-none"
                  />
                  <button onClick={() => { handleUpdateTask(task.id, { name: editName }); setIsEditing(false); }} className="text-emerald-400"><Save size={12}/></button>
                  <button onClick={() => setIsEditing(false)} className="text-slate-500"><X size={12}/></button>
                </div>
              ) : (
                <p className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  {task.name}
                  <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700/50 uppercase tracking-tighter">PLAN</span>
                  {task.assigned_to_name && (
                    <span className="text-[10px] text-slate-500 font-normal">
                      — {task.assigned_to_name} (Planned)
                    </span>
                  )}
                </p>
              )}

              {task.is_critical && (
                <span className="text-[9px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 font-bold tracking-tight">
                  CRITICAL
                </span>
              )}

              {task.process_template_info && (
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">
                  AUTO WF
                </span>
              )}

              {task.workflow_status && (
                <div className="flex items-center gap-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                    task.workflow_status === 'DONE'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : task.workflow_status === 'IN_PROGRESS'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}>
                    EXECUTION: {task.workflow_status}
                  </span>
                  <ArrowUpRight size={10} className="text-slate-600" />
                </div>
              )}

              {task.assignee_workload > 100 && (
                <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30 font-bold animate-pulse">
                  OVERLOAD
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-3 mt-1 ml-10">
              <span className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                <Calendar size={10}/> {task.start_date || 'Не задано'} — {task.end_date || 'Не задано'}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                task.risk_level === 'HIGH' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                task.risk_level === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                'bg-slate-800 text-slate-500 border-slate-700'
              }`}>
                {task.risk_level}
              </span>
              {task.required_roles?.length > 0 && (
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                  <Users size={10} className="text-slate-500" />
                  <div className="flex gap-1">
                    {task.required_roles.map((rr: any) => (
                      <span key={rr.id} className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded" title={rr.role.description}>
                        {rr.role.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            {/* Timeline Bar Visual */}
            {ganttRange && task.start_date && task.end_date && (
              <div className="mt-3 h-1.5 bg-slate-800/50 rounded-full relative overflow-hidden ml-10">
                <div 
                  className={`absolute h-full rounded-full transition-all ${
                    task.is_critical 
                      ? 'bg-red-500 shadow-[0_0_12px_#ef4444] animate-pulse' 
                      : task.risk_level === 'HIGH' 
                      ? 'bg-red-500/60'
                      : task.risk_level === 'MEDIUM' 
                      ? 'bg-amber-500/60' 
                      : 'bg-violet-500/60'
                  }`}
                  style={{ 
                    left: `${((new Date(task.start_date).getTime() - ganttRange.start) / ganttRange.total) * 100}%`,
                    width: `${((new Date(task.end_date).getTime() - new Date(task.start_date).getTime() + 86400000) / ganttRange.total) * 100}%`
                  }}
                />
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-1 opacity-0 group-hover/task:opacity-100 transition-opacity">
            {task.workflow_task && (
              <button 
                onClick={() => navigate(`/workflows?task=${task.workflow_task}`)}
                className="p-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg flex items-center gap-1 text-[9px] font-bold"
                title="Перейти к исполнению"
              >
                WF
              </button>
            )}
            {isManager && (
              <>
                <button 
                  onClick={async () => {
                    try {
                      const res = await api.get(`/projects/tasks/${task.id}/suggest_assignee/`);
                      if (res.data.length > 0) {
                        setAiSuggestion({ ...res.data[0], taskId: task.id });
                      } else {
                        alert('Все подходящие сотрудники заняты на 100% или кандидаты не найдены.');
                      }
                    } catch (err) {
                      alert('Ошибка при подборе исполнителя');
                    }
                  }}
                  className="p-1 text-slate-500 hover:text-amber-400" title="Умный подбор исполнителя"
                >
                  <Zap size={12} />
                </button>
                <button 
                  onClick={() => setAddingTaskToBlockId(`task-${task.id}`)}
                  className="p-1 text-slate-500 hover:text-violet-400" title="Добавить подзадачу"
                >
                  <Plus size={12} />
                </button>
                <button 
                  onClick={() => handleShift(task.id, -1)}
                  className="p-1 text-slate-500 hover:text-white text-[10px]" title="-1 день"
                >
                  -1д
                </button>
                <button 
                  onClick={() => handleShift(task.id, 1)}
                  className="p-1 text-slate-500 hover:text-white text-[10px]" title="+1 день"
                >
                  +1д
                </button>
                <button 
                  onClick={() => handleRecalculate(task.id)}
                  className="ml-2 p-1.5 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 rounded transition-colors"
                  title="Пересчитать всё"
                >
                  <GitMerge size={14}/>
                </button>
                <button 
                  onClick={async () => {
                    if (!task.id) {
                      alert('Задача еще не полностью загружена. Пожалуйста, подождите или обновите страницу.');
                      return;
                    }
                    try {
                      const res = await api.post(`/projects/tasks/${task.id}/simulate/`, { days: 1 });
                      setPreview({ taskId: task.id, ...res.data });
                    } catch (err) {
                      alert('Ошибка при выполнении симуляции');
                    }
                  }}
                  className="p-1.5 text-violet-400 hover:text-white text-[10px]" title="Что если? (+1д)"
                >
                  What-if?
                </button>
                <div className="w-px h-4 bg-slate-800 mx-1" />
                <button 
                  onClick={() => { setIsEditing(true); setEditName(task.name); }}
                  className="p-1 text-slate-500 hover:text-violet-400" title="Редактировать"
                >
                  <Edit2 size={12} />
                </button>
                <button 
                  onClick={() => handleDeleteTask(task.id)}
                  className="p-1 text-slate-500 hover:text-red-400" title="Удалить"
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        {preview && preview.taskId === task.id && (
          <div className="bg-slate-900 border border-violet-500/30 p-3 mt-2 rounded-lg flex justify-between items-center animate-in fade-in slide-in-from-top-1 ml-10">
            <div>
              <p className="text-[10px] text-violet-400 font-bold uppercase tracking-widest mb-1">Simulation Preview</p>
              <p className="text-xs text-slate-300">
                Новое завершение: <span className="text-white font-bold">{preview.new_end_date}</span>
              </p>
              <p className="text-[10px] text-slate-500">
                Затронуто зависимых задач: {preview.impacted_tasks_count}
              </p>
            </div>
            <button onClick={() => setPreview(null)} className="text-slate-500 hover:text-white"><X size={14}/></button>
          </div>
        )}

        {/* Inline Task Creation for Subtasks */}
        {addingTaskToBlockId === `task-${task.id}` && (
          <div className="mt-2 ml-10 flex gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Название подзадачи..."
              value={newTaskName}
              onChange={e => setNewTaskName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateTask(blockId, task.id);
                if (e.key === 'Escape') setAddingTaskToBlockId(null);
              }}
              className="flex-1 bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
            />
            <button 
              onClick={() => handleCreateTask(blockId, task.id)}
              className="bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold px-3 rounded-lg"
            >
              OK
            </button>
            <button onClick={() => setAddingTaskToBlockId(null)} className="text-slate-500 hover:text-slate-300 px-2"><X size={14} /></button>
          </div>
        )}

        {!isCollapsed && hasSubtasks && (
          <div className="space-y-1">
            {task.subtasks.map((sub: any, idx: number) => (
              <WBSTaskItem 
                key={sub.id || `temp-${wbsNumber}-${idx}`} 
                task={sub} 
                isManager={isManager}
                depth={depth + 1}
                wbsNumber={`${wbsNumber}.${idx + 1}`}
                blockId={blockId}
                handleShift={handleShift}
                handleRecalculate={handleRecalculate}
                handleCreateTask={handleCreateTask}
                addingTaskToBlockId={addingTaskToBlockId}
                setAddingTaskToBlockId={setAddingTaskToBlockId}
                newTaskName={newTaskName}
                setNewTaskName={setNewTaskName}
                ganttRange={ganttRange}
                onRefresh={onRefresh}
                setAiSuggestion={setAiSuggestion}
                setPreview={setPreview}
                preview={preview}
                handleDeleteTask={handleDeleteTask}
                handleUpdateTask={handleUpdateTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
const WBSBlockItem = ({ 
  block, 
  isManager, 
  handleUpdateBlock, 
  handleDeleteBlock, 
  handleShift, 
  handleRecalculate,
  handleCreateBlock,
  addingTaskToBlockId,
  setAddingTaskToBlockId,
  newTaskName,
  setNewTaskName,
  handleCreateTask,
  depth = 0,
  wbsNumber = '',
  ganttRange,
  onRefresh,
  setAiSuggestion,
  setPreview,
  preview,
  handleDeleteTask,
  handleUpdateTask
}: any) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  return (
    <div className={`space-y-4 ${depth > 0 ? 'ml-6 border-l-2 border-slate-800/50 pl-4' : ''}`}>
      <div className="bg-slate-800/20 border border-slate-800 rounded-xl overflow-hidden group/block shadow-lg shadow-black/10">
        <div className="px-4 py-2.5 bg-slate-800/40 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-slate-500 font-mono">{wbsNumber}</span>
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ListTree size={14} className={isCollapsed ? '-rotate-90 transition-transform' : 'transition-transform'} />
            </button>
            <div className="flex-1">
              <input 
                type="text" 
                defaultValue={block.name}
                onBlur={(e) => {
                  if (e.target.value !== block.name) handleUpdateBlock(block.id, e.target.value);
                }}
                className="bg-transparent border-none text-[11px] font-bold text-slate-300 uppercase tracking-widest focus:outline-none focus:ring-1 focus:ring-violet-500/50 rounded px-1 w-full"
              />
              {/* Block Timeline Bar placeholder */}
              {ganttRange && block.tasks?.length > 0 && (
                <div className="h-1 bg-slate-800/50 rounded-full mt-1 relative overflow-hidden" />
              )}
            </div>
            {block.process_template_info && (
              <span className="flex items-center gap-1 text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full ml-2">
                <Zap size={10} /> {block.process_template_info.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {block.calendar_info && <span className="text-[10px] text-violet-400 bg-violet-500/5 px-1.5 rounded border border-violet-500/10">{block.calendar_info.name}</span>}
            <span className="text-[10px] text-slate-500 font-mono tracking-tighter">{block.domain}</span>
            {isManager && (
              <div className="flex items-center gap-1.5 ml-2">
                <button 
                  onClick={() => handleCreateBlock(undefined, block.id)}
                  className="p-1 text-slate-500 hover:text-violet-400" title="Добавить подэтап"
                >
                  <Plus size={12} />
                </button>
                <button 
                  onClick={() => handleDeleteBlock(block.id)}
                  className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover/block:opacity-100 transition-opacity"
                  title="Удалить этап"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div className="divide-y divide-slate-800">
            {(block.tasks || []).filter((t: any) => !t.parent).map((task: any, idx: number) => (
              <WBSTaskItem 
                key={task.id} 
                task={task} 
                isManager={isManager}
                wbsNumber={`${wbsNumber}.${idx + 1}`}
                blockId={block.id}
                handleShift={handleShift}
                handleRecalculate={handleRecalculate}
                handleCreateTask={handleCreateTask}
                addingTaskToBlockId={addingTaskToBlockId}
                setAddingTaskToBlockId={setAddingTaskToBlockId}
                newTaskName={newTaskName}
                setNewTaskName={setNewTaskName}
                ganttRange={ganttRange}
                onRefresh={onRefresh}
                setAiSuggestion={setAiSuggestion}
                setPreview={setPreview}
                preview={preview}
                handleDeleteTask={handleDeleteTask}
                handleUpdateTask={handleUpdateTask}
              />
            ))}

            {isManager && (
              <div className="p-2 bg-slate-900/30">
                {addingTaskToBlockId === block.id ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Название новой задачи..."
                      value={newTaskName}
                      onChange={e => setNewTaskName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateTask(block.id);
                        if (e.key === 'Escape') setAddingTaskToBlockId(null);
                      }}
                      className="flex-1 bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500"
                    />
                    <button 
                      onClick={() => handleCreateTask(block.id)}
                      className="bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold px-3 rounded-lg"
                    >
                      OK
                    </button>
                    <button onClick={() => setAddingTaskToBlockId(null)} className="text-slate-500 hover:text-slate-300 px-2"><X size={14} /></button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setAddingTaskToBlockId(block.id)}
                    className="w-full py-1.5 flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-300 text-[10px] font-bold border border-dashed border-slate-800 rounded-lg transition-all hover:bg-slate-800/20"
                  >
                    <Plus size={12} /> Добавить плановую задачу
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && block.children?.length > 0 && (
        <div className="space-y-4">
          {block.children.map((child: any, idx: number) => (
            <WBSBlockItem 
              key={child.id} 
              block={child} 
              isManager={isManager}
              depth={depth + 1}
              wbsNumber={`${wbsNumber}.${idx + 1}`}
              handleUpdateBlock={handleUpdateBlock}
              handleDeleteBlock={handleDeleteBlock}
              handleShift={handleShift}
              handleRecalculate={handleRecalculate}
              handleCreateBlock={handleCreateBlock}
              addingTaskToBlockId={addingTaskToBlockId}
              setAddingTaskToBlockId={setAddingTaskToBlockId}
              newTaskName={newTaskName}
              setNewTaskName={setNewTaskName}
              handleCreateTask={handleCreateTask}
              ganttRange={ganttRange}
              onRefresh={onRefresh}
              setAiSuggestion={setAiSuggestion}
              setPreview={setPreview}
              preview={preview}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function ProjectDetailPanel({ 
  project, 
  onClose,
  isWizardOpen,
  setIsWizardOpen,
  wizardSource,
  setWizardSource
}: { 
  project: Project; 
  onClose: () => void;
  isWizardOpen: boolean;
  setIsWizardOpen: (open: boolean) => void;
  wizardSource: Project | PlanningBlock | null;
  setWizardSource: (source: Project | PlanningBlock | null) => void;
}) {
  const { employees, addMemberToProject, updateProject, deleteProject, users, removeMemberFromProject, fetchAuditLogs, auditLogs, recalculateSchedule, shiftTask, globalRoles, domains, extractError, risks, planningBlocks } = useAppContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isSystemManager = useMemo(() => {
    return user?.role === 'ADMIN' || user?.role === 'MANAGER';
  }, [user]);

  const isManager = useMemo(() => {
    // Strict RBAC: only system managers can perform administrative actions
    return isSystemManager;
  }, [isSystemManager]);

  const canDelete = isSystemManager;
  
  const [activeTab, setActiveTab] = useState<'details' | 'team' | 'gantt' | 'history'>('details');
  const [wbsView, setWbsView] = useState<'tree' | 'gantt'>('tree');
  const [projectBlocks, setProjectBlocks] = useState<PlanningBlock[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  
  // State for adding team members
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [selectedRole, setSelectedRole] = useState('DEVELOPER');
  const [selectedLoad, setSelectedLoad] = useState(100);
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  
  // State for WBS management
  const [addingTaskToBlockId, setAddingTaskToBlockId] = useState<string | number | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [showAddBlockModal, setShowAddBlockModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [creatingBlock, setCreatingBlock] = useState(false);
  
  // Project editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: project.name,
    description: project.description || '',
    manager_id: project.manager?.id || '',
    start_date: project.start_date || '',
    end_date: project.end_date || '',
    budget: project.budget || '',
    domain: project.domain || 'IT',
    status: project.status,
    risk_ids: project.risks_info?.map((r: any) => r.id) || [],
    manager_allocation: project.members?.find(m => m.user.id === (project.manager?.id || 0) && m.role === 'MANAGER')?.allocation_percentage || 100
  });
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [aiSuggestionRole, setAiSuggestionRole] = useState<string | number>('DEVELOPER');

  const handleDeleteTask = async (taskId: number) => {
    if (!await niceConfirm('Удалить эту задачу?')) return;
    try {
      await api.delete(`/projects/tasks/${taskId}/`);
      fetchProjectBlocks();
      toast.success('Задача удалена');
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при удалении задачи'));
    }
  };

  const handleUpdateTask = async (taskId: number, data: any) => {
    try {
      await api.patch(`/projects/tasks/${taskId}/`, data);
      fetchProjectBlocks();
      toast.success('Задача обновлена');
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при обновлении задачи'));
    }
  };

  useEffect(() => {
    let managerId = project.manager?.id || '';
    if (!managerId && project.members) {
      const pm = project.members.find(m => m.role === 'MANAGER');
      if (pm) managerId = pm.user.id;
    }
    setEditForm({
      name: project.name,
      description: project.description || '',
      manager_id: managerId,
      start_date: project.start_date || '',
      end_date: project.end_date || '',
      budget: project.budget || '',
      domain: project.domain || 'IT',
      status: project.status,
      risk_ids: project.risks_info?.map((r: any) => r.id) || [],
      manager_allocation: project.members?.find(m => m.user.id === (managerId || 0) && m.role === 'MANAGER')?.allocation_percentage || 100
    });
  }, [project]);

  // Calculate Gantt Timeline Range
  const getGanttRange = () => {
    if (projectBlocks.length === 0) return null;
    const allTasks: any[] = [];
    const collectTasks = (tasks: any[]) => {
      tasks.forEach(t => {
        allTasks.push(t);
        if (t.subtasks) collectTasks(t.subtasks);
      });
    };
    projectBlocks.forEach(b => collectTasks(b.tasks || []));
    
    const dates = allTasks
      .map(t => t.start_date)
      .filter(Boolean)
      .map(d => new Date(d).getTime());
    
    if (dates.length === 0) return null;
    
    const start = Math.min(...dates);
    const end = Math.max(...allTasks.map(t => t.end_date).filter(Boolean).map(d => new Date(d).getTime()), start + 86400000 * 30);
    
    return { start, end, total: end - start };
  };
  const ganttRange = getGanttRange();

  const handleUpdate = async () => {
    try {
      const sanitizedForm = {
        ...editForm,
        budget: editForm.budget === '' ? null : Number(editForm.budget),
        manager_id: editForm.manager_id === '' ? null : Number(editForm.manager_id),
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        risks: editForm.risk_ids,
        manager_allocation: Number(editForm.manager_allocation)
      };
      await updateProject(project.id, sanitizedForm);
      setIsEditing(false);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при обновлении проекта'));
    }
  };

  const handleDelete = async () => {
    if (await niceConfirm('Вы уверены, что хотите удалить этот проект?')) {
      await deleteProject(project.id);
      onClose();
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    try {
      await updateProject(project.id, { status: newStatus });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedUserId) return;
    
    const emp = employees.find(e => e.user.id === Number(selectedUserId));
    if (emp) {
      // Logic for existing employee check can go here if needed
    }

    setAdding(true);
    try {
      const roleId = parseInt(selectedRole);
      const isGlobalRole = !isNaN(roleId) && globalRoles.some(r => r.id === roleId);
      const globalRole = isGlobalRole ? globalRoles.find(r => r.id === roleId) : null;
      
      let roleName = selectedRole;
      if (globalRole) {
        roleName = globalRole.name;
        // Map "Project Manager" global role to internal "MANAGER" for logic consistency
        if (roleName.toLowerCase().includes('manager') || roleName.toLowerCase().includes('менеджер')) {
          roleName = 'MANAGER';
        }
      }
      
      await addMemberToProject(
        project.id, 
        Number(selectedUserId), 
        roleName, 
        selectedLoad, 
        isGlobalRole ? roleId : undefined
      );
      setSelectedUserId('');
      setSelectedLoad(100);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при добавлении участника'));
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateMemberRole = async (userId: number, newRole: string, currentAllocation: number) => {
    try {
      const roleId = parseInt(newRole);
      const isGlobalRole = !isNaN(roleId) && globalRoles.some(r => r.id === roleId);
      const roleName = isGlobalRole ? globalRoles.find(r => r.id === roleId)?.name || 'OTHER' : newRole;

      await addMemberToProject(project.id, userId, roleName, currentAllocation, isGlobalRole ? roleId : undefined);
      toast.success('Роль обновлена');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Ошибка при изменении роли';
      toast.error(msg);
    }
  };

  const fetchProjectBlocks = async () => {
    setLoadingBlocks(true);
    try {
      const res = await api.get(`/projects/blocks/by-project/?project_id=${project.id}`);
      setProjectBlocks(Array.isArray(res.data) ? res.data : []);
    } catch {
      setProjectBlocks([]);
    } finally {
      setLoadingBlocks(false);
    }
  };

  const handleTabChange = (tab: 'details' | 'team' | 'gantt' | 'history') => {
    setActiveTab(tab);
    if (tab === 'history') fetchAuditLogs(project.id);
    if (tab === 'gantt') fetchProjectBlocks();
  };

  const handleRecalculate = async (taskId: number) => {
    await recalculateSchedule(taskId);
    await fetchProjectBlocks();
  };

  const handleShift = async (taskId: number, days: number) => {
    // Find task in nested structure
    let targetTask: any = null;
    const search = (tasks: any[]) => {
      for (const t of tasks) {
        if (t.id === taskId) { targetTask = t; return; }
        if (t.subtasks) search(t.subtasks);
      }
    };
    projectBlocks.forEach(b => search(b.tasks || []));
    
    if (!targetTask || !targetTask.start_date) return;
    const date = new Date(targetTask.start_date);
    date.setDate(date.getDate() + days);
    await shiftTask(taskId, date.toISOString().split('T')[0]);
    await fetchProjectBlocks();
  };

  const handleCreateBlock = async (templateId?: number, parentId?: number) => {
    setCreatingBlock(true);
    try {
      await api.post('/projects/blocks/', {
        project: project.id,
        name: templateId ? 'Импорт из шаблона...' : 'Новый этап',
        domain: project.domain,
        complexity: 'MEDIUM',
        template_id: templateId,
        parent: parentId
      });
      await fetchProjectBlocks();
      setShowAddBlockModal(false);
      setSelectedTemplateId('');
      toast.success("Этап успешно создан");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Ошибка при создании блока');
    } finally {
      setCreatingBlock(false);
    }
  };

  const handleCreateTask = async (blockId: number, parentId?: number) => {
    try {
      // Find block to check if it has a process template
      const findBlock = (blocks: any[]): any => {
        for (const b of blocks) {
          if (b.id === blockId) return b;
          if (b.children) {
            const found = findBlock(b.children);
            if (found) return found;
          }
        }
        return null;
      };
      const targetBlock = findBlock(projectBlocks);
      if (!targetBlock) {
        toast.error("Этап не найден");
        return;
      }
      
      const hasTemplate = targetBlock?.process_template_info;

      if (!newTaskName.trim()) {
        toast.error("Введите название задачи");
        return;
      }

      await api.post('/projects/tasks/', {
        block: blockId,
        parent: parentId,
        name: newTaskName.trim(),
        status: 'TODO',
        duration_days: 1, // Ensure default duration is sent
        create_workflow: !!hasTemplate
      });
      await fetchProjectBlocks();
      setNewTaskName('');
      setAddingTaskToBlockId(null);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при создании задачи'));
    }
  };

  const handleDeleteBlock = async (blockId: number) => {
    if (!await niceConfirm('Удалить этот этап планирования?')) return;
    try {
      await api.delete(`/projects/blocks/${blockId}/`);
      await fetchProjectBlocks();
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при удалении блока'));
    }
  };

  const handleUpdateBlock = async (blockId: number, name: string) => {
    try {
      await api.patch(`/projects/blocks/${blockId}/`, { name });
      await fetchProjectBlocks();
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при обновлении блока'));
    }
  };

  const existingUserIds = new Set(project.members?.map(m => m.user.id) || []);
  const availableUsers = users.filter(u => !existingUserIds.has(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className={`bg-slate-900 border border-slate-800 rounded-2xl w-full shadow-2xl flex flex-col transition-all duration-300 ${
        activeTab === 'gantt' ? 'max-w-[95vw] h-[95vh]' : 'max-w-xl max-h-[90vh]'
      }`}>
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
        <div className="flex justify-between items-start mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${domainColor[project.domain] || 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                {project.domain}
              </span>
              <select
                value={project.status}
                disabled={updatingStatus}
                onChange={e => handleStatusChange(e.target.value)}
                className={`text-xs px-2 py-0.5 rounded-full border font-medium bg-transparent focus:outline-none cursor-pointer ${statusStyle[project.status] ?? statusStyle.DRAFT} disabled:opacity-50`}
              >
                {Object.entries(statusMap).map(([val, label]) => (
                  <option key={val} value={val} className="bg-slate-900 text-white">{label}</option>
                ))}
              </select>
            </div>
            {isEditing ? (
              <div className="space-y-2 mt-2">
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-white text-lg font-bold rounded px-2 py-1 focus:border-violet-500 outline-none"
                  placeholder="Название проекта"
                />
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Менеджер</label>
                    <div className="flex gap-2">
                      <select
                        value={editForm.manager_id}
                        onChange={e => {
                          const mid = e.target.value ? Number(e.target.value) : '';
                          // Default PM to 100% allocation if possible
                          setEditForm({ 
                            ...editForm, 
                            manager_id: mid,
                            manager_allocation: mid ? 100 : 100 
                          });
                        }}
                        className={`flex-1 bg-slate-800 border ${Number(editForm.manager_id) && (employees.find(e => e.user.id === Number(editForm.manager_id))?.current_workload_percentage || 0) > 90 ? 'border-amber-500/50' : 'border-slate-700'} text-white text-xs rounded px-2 py-1.5 focus:border-violet-500 outline-none`}
                      >
                        <option value="">— Не назначен —</option>
                        {employees.map(e => (
                          <option key={e.user.id} value={e.user.id} className={e.current_workload_percentage > 90 ? 'text-amber-400' : ''}>
                            {e.full_name} ({e.current_workload_percentage}%)
                          </option>
                        ))}
                      </select>
                      {editForm.manager_id && (
                        <div className="w-20">
                          <input 
                            type="number"
                            min="1" max="100"
                            value={editForm.manager_allocation}
                            onChange={e => setEditForm({ ...editForm, manager_allocation: Number(e.target.value) })}
                            className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded px-2 py-1.5 focus:border-violet-500 outline-none"
                            placeholder="%"
                          />
                        </div>
                      )}
                    </div>
                    {Number(editForm.manager_id) && (employees.find(e => e.user.id === Number(editForm.manager_id))?.current_workload_percentage || 0) > 90 && (
                      <p className="text-[9px] text-amber-400 font-bold mt-1 flex items-center gap-1">
                        <AlertTriangle size={10} /> Внимание: Менеджер уже загружен на {employees.find(e => e.user.id === Number(editForm.manager_id))?.current_workload_percentage}%
                      </p>
                    )}
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1">Домен</label>
                  <select
                    value={editForm.domain}
                    onChange={e => setEditForm({ ...editForm, domain: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-white text-xs rounded px-2 py-1.5 focus:border-violet-500 outline-none"
                  >
                    {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <h2 className="text-lg font-bold text-white">{project.name}</h2>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4">
            {isManager && (
              <>
                {isEditing ? (
                  <button onClick={handleUpdate} className="p-2 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors" title="Сохранить">
                    <Save size={18} />
                  </button>
                ) : (
                  <button onClick={() => setIsEditing(true)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Редактировать">
                    <Edit2 size={18} />
                  </button>
                )}
              </>
            )}
            {canDelete && (
              <button onClick={handleDelete} className="p-2 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Удалить проект">
                <Trash2 size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-300 transition-colors" title="Закрыть">
              <X size={20} />
            </button>
          </div>
        </div>

        {isEditing ? (
          <textarea
            rows={3}
            value={editForm.description}
            onChange={e => setEditForm({ ...editForm, description: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 text-sm text-slate-300 rounded p-2 mb-4 focus:border-violet-500 outline-none resize-none"
            placeholder="Описание проекта"
          />
        ) : (
          project.description && (
            <p className="text-sm text-slate-400 leading-relaxed mb-5">{project.description}</p>
          )
        )}

        <div className="flex items-center gap-4 border-b border-slate-800 mb-6">
          {(['details', 'team', 'gantt', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`pb-2 text-sm font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
                activeTab === tab
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'details' && <><Plus size={14}/> Детали</>}
              {tab === 'team' && <><Users size={14}/> Команда</>}
              {tab === 'gantt' && <><ListTree size={14}/> WBS / План</>}
              {tab === 'history' && <><History size={14}/> Логи</>}
            </button>
          ))}
        </div>

        {activeTab === 'details' && (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-xl p-4">
              <div className="flex justify-between text-xs text-slate-400 mb-2">
                <span>Прогресс</span>
                <span className="text-slate-200 font-semibold">{project.progress_percentage}%</span>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-700"
                  style={{ width: `${project.progress_percentage}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {isEditing ? (
                <>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase">Начало</label>
                    <input type="date" value={editForm.start_date} onChange={e => setEditForm({ ...editForm, start_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase">Конец</label>
                    <input type="date" value={editForm.end_date} onChange={e => setEditForm({ ...editForm, end_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1 uppercase">Бюджет</label>
                    <input type="number" value={editForm.budget} onChange={e => setEditForm({ ...editForm, budget: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" />
                  </div>
                </>
              ) : (
                [
                  { label: 'Начало', value: project.start_date ?? '—' },
                  { label: 'Дедлайн', value: project.end_date ?? '—' },
                  { label: 'Бюджет', value: project.budget ? `${Number(project.budget).toLocaleString('ru-RU')} ₽` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-800/50 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">{label}</p>
                    <p className="text-sm font-medium text-slate-200">{value}</p>
                  </div>
                ))
              )}
            </div>

            {project.manager && (
              <div className="pt-2">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Project Manager</p>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white shadow-lg shadow-violet-500/20">
                    {project.manager.full_name.substring(0, 1)}
                  </div>
                  <span className="text-sm font-medium text-slate-200">{project.manager.full_name}</span>
                </div>
              </div>
            )}

            {(isEditing || (project.risks_info && project.risks_info.length > 0)) && (
              <div className="pt-2 border-t border-slate-800/50 mt-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">
                  {isEditing ? 'Управление рисками' : `Активные риски (${project.risks_info?.length || 0})`}
                </p>
                
                {isEditing ? (
                  <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto custom-scrollbar space-y-2">
                    {risks.map(r => (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={editForm.risk_ids.includes(r.id)}
                          onChange={e => {
                            const ids = e.target.checked 
                              ? [...editForm.risk_ids, r.id]
                              : editForm.risk_ids.filter(id => id !== r.id);
                            setEditForm({ ...editForm, risk_ids: ids });
                          }}
                          className="w-3.5 h-3.5 rounded border-slate-700 text-violet-500 bg-slate-800 focus:ring-0"
                        />
                        <div className="flex flex-col">
                           <span className="text-xs text-slate-300 group-hover:text-white transition-colors">{r.name}</span>
                           <span className="text-[8px] text-slate-500 uppercase">Prob: {r.probability} · Impact: {r.impact}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {project.risks_info?.map((r: any) => (
                      <div key={r.id} className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5 group cursor-help transition-all hover:bg-red-500/10" title={r.description}>
                        <AlertTriangle size={12} className="text-red-400" />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-semibold text-red-200 leading-none">{r.name}</span>
                          <span className="text-[8px] text-red-400/60 uppercase mt-0.5">Вероятность: {r.probability} · Влияние: {r.impact}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'team' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Команда проекта ({project.members?.length ?? 0} чел.)</p>
              {project.members?.map((m: any) => {
                const isProjectManager = project.manager?.id === m.user.id;
                const emp = employees.find(e => e.user.id === m.user.id);
                return (
                  <div key={m.id} className="flex items-center gap-3 p-3 bg-slate-800/20 border border-slate-800/50 rounded-xl group/member transition-all hover:bg-slate-800/40">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0 bg-gradient-to-br ${isProjectManager ? 'from-blue-500 to-indigo-500 ring-2 ring-blue-500/50' : 'from-slate-600 to-slate-700'}`}>
                      {m.user.full_name.substring(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200 truncate">{m.user.full_name}</p>
                      {isManager && !isProjectManager ? (
                        <select
                          value={m.role_ref ? m.role_ref : m.role}
                          onChange={(e) => handleUpdateMemberRole(m.user.id, e.target.value, m.allocation_percentage)}
                          className="bg-transparent border-none p-0 text-[10px] uppercase tracking-wider font-bold mt-0.5 text-violet-400 focus:ring-0 cursor-pointer hover:text-violet-300"
                        >
                          <option value="MANAGER" disabled={m.role !== 'MANAGER' && project.members?.some(member => member.role === 'MANAGER')}>
                            Project Manager
                          </option>
                          <optgroup label="Глобальные роли">
                            {globalRoles.map(r => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </optgroup>
                        </select>
                      ) : (
                        <p className={`text-[10px] uppercase tracking-wider font-bold mt-0.5 ${isProjectManager ? 'text-blue-400' : 'text-slate-500'}`}>
                          {isProjectManager ? 'Project Manager' : (m.role_info?.name || m.role)}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className={`text-[10px] font-bold ${m.allocation_percentage > 80 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        Загрузка: {m.allocation_percentage}%
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${
                        (emp?.current_workload_percentage ?? 0) > 100 ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                        (emp?.current_workload_percentage ?? 0) > 70 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      }`}>
                        Всего: {emp?.current_workload_percentage ?? 0}%
                      </span>
                    </div>
                    {isManager && !isProjectManager && (
                      <button
                        onClick={() => removeMemberFromProject(project.id, m.user.id)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover/member:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isManager && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Управление командой</h4>
                  <button
                    onClick={() => {
                      sessionStorage.setItem('targetProjectId', project.id.toString());
                      navigate('/matching');
                    }}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 px-2 py-1 rounded transition-all"
                  >
                    <Zap size={12} /> Умный подбор
                  </button>
                </div>
                
                <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-4">
                  <p className="text-[10px] text-slate-500 uppercase font-medium">Добавить участника вручную</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] text-slate-500 uppercase mb-1.5">Сотрудник</label>
                      <select
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : '')}
                        className={`w-full bg-slate-900 border ${Number(selectedUserId) && (employees.find(e => e.user.id === Number(selectedUserId))?.current_workload_percentage || 0) > 90 ? 'border-amber-500/50' : 'border-slate-700'} text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500`}
                      >
                        <option value="">— Выбрать из списка —</option>
                        {availableUsers.map(u => {
                          const empLoad = employees.find(e => e.user.id === u.id)?.current_workload_percentage || 0;
                          return (
                            <option key={u.id} value={u.id} className={empLoad > 90 ? 'text-amber-400' : ''}>
                              {u.full_name} ({empLoad}%)
                            </option>
                          );
                        })}
                      </select>
                      {Number(selectedUserId) && (
                        <p className={`text-[9px] mt-1.5 flex items-center gap-1 font-bold ${ (employees.find(e => e.user.id === Number(selectedUserId))?.current_workload_percentage || 0) > 90 ? 'text-amber-400' : 'text-slate-500' }`}>
                          {(employees.find(e => e.user.id === Number(selectedUserId))?.current_workload_percentage || 0) > 90 && <AlertTriangle size={10} />}
                          Текущая загрузка сотрудника: {employees.find(e => e.user.id === Number(selectedUserId))?.current_workload_percentage || 0}%
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase mb-1.5">Роль</label>
                      <select
                        value={selectedRole}
                        onChange={e => setSelectedRole(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                      >
                        <option value="" disabled>— Выберите роль —</option>
                        <optgroup label="Глобальные роли">
                          {globalRoles.map(r => {
                            const isPM = r.name.toLowerCase().includes('manager') || r.name.toLowerCase().includes('менеджер');
                            const alreadyHasPM = project.members?.some(m => m.role === 'MANAGER' || (m.role_info?.name || '').toLowerCase().includes('manager'));
                            return (
                              <option key={r.id} value={r.id} disabled={isPM && alreadyHasPM}>
                                {r.name} {isPM && alreadyHasPM ? '(уже назначен)' : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase mb-1.5">Загрузка %</label>
                      <input type="number" min={1} max={100} value={selectedLoad} onChange={e => setSelectedLoad(Number(e.target.value))}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase mb-1.5">Начало</label>
                      <input type="date" value={selectedStart} onChange={e => setSelectedStart(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase mb-1.5">Конец</label>
                      <input type="date" value={selectedEnd} onChange={e => setSelectedEnd(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500" />
                    </div>
                  </div>
                  <button
                    onClick={handleAddMember}
                    disabled={adding || !selectedUserId}
                    className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-lg transition-all shadow-lg shadow-violet-900/20 flex items-center justify-center gap-2"
                  >
                    {adding ? 'Добавление...' : <><Plus size={14} /> Добавить участника</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'gantt' && (
          <div className="space-y-4">
            {/* Sub-tab toggle: Tree vs Gantt */}
            <div className="flex items-center justify-between">
              <div className="flex items-center bg-slate-800/60 border border-slate-700/50 rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => setWbsView('tree')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    wbsView === 'tree'
                      ? 'bg-violet-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ListTree size={13} /> WBS Дерево
                </button>
                <button
                  onClick={() => setWbsView('gantt')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    wbsView === 'gantt'
                      ? 'bg-violet-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Calendar size={13} /> Диаграмма Ганта
                </button>
              </div>
              {isManager && wbsView === 'tree' && (
                <button
                  onClick={() => setShowAddBlockModal(true)}
                  className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-lg shadow-violet-900/20"
                >
                  <Plus size={14} /> Новый этап
                </button>
              )}
            </div>

            {loadingBlocks ? (
              <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"/></div>
            ) : wbsView === 'gantt' ? (
              <GanttChart
                blocks={projectBlocks as any}
                projectStartDate={project.start_date}
                projectEndDate={project.end_date}
              />
            ) : (
              <div className="space-y-4">
                {projectBlocks.length === 0 ? (
                  <div className="text-center py-12 bg-slate-800/20 rounded-2xl border border-dashed border-slate-800">
                    <ListTree size={32} className="mx-auto text-slate-600 mb-3" />
                    <p className="text-sm text-slate-500">В этом проекте пока нет блоков планирования</p>
                    {isManager && (
                      <button onClick={() => setShowAddBlockModal(true)} className="mt-4 text-xs text-violet-400 font-bold hover:text-violet-300 transition-colors">
                        Создать первый этап →
                      </button>
                    )}
                  </div>
                ) : (
                  projectBlocks.map((block, idx) => (
                    <WBSBlockItem
                      key={block.id}
                      block={block}
                      isManager={isManager}
                      wbsNumber={`${idx + 1}`}
                      handleUpdateBlock={handleUpdateBlock}
                      handleDeleteBlock={handleDeleteBlock}
                      handleShift={handleShift}
                      handleRecalculate={handleRecalculate}
                      handleCreateBlock={handleCreateBlock}
                      addingTaskToBlockId={addingTaskToBlockId}
                      setAddingTaskToBlockId={setAddingTaskToBlockId}
                      newTaskName={newTaskName}
                      setNewTaskName={setNewTaskName}
                      handleCreateTask={handleCreateTask}
                      handleDeleteTask={handleDeleteTask}
                      handleUpdateTask={handleUpdateTask}
                      ganttRange={ganttRange}
                      onRefresh={fetchProjectBlocks}
                      setAiSuggestion={setAiSuggestion}
                      setPreview={setPreview}
                      preview={preview}
                    />
                  ))
                )}
              </div>
            )}

        {/* Floating AI Suggestion Popup */}
        {aiSuggestion && (
          <div className="fixed bottom-6 right-6 z-[100] animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl w-80 shadow-2xl shadow-black/50">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest mb-1">AI Recommendation</p>
                  <h4 className="text-sm font-bold text-white">{aiSuggestion.full_name}</h4>
                </div>
                <button onClick={() => setAiSuggestion(null)} className="text-slate-500 hover:text-white"><X size={16}/></button>
              </div>

              {aiSuggestion.is_external && (
                <div className="mb-4 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg">
                  <p className="text-[10px] text-amber-300 leading-relaxed">
                    ⚠️ Сотрудник не в команде проекта. Будет добавлен автоматически.
                  </p>
                </div>
              )}

              <div className="space-y-4 mb-5">
                {/* Score Breakdown Visualization */}
                {aiSuggestion.breakdown && (
                  <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                      <span>Score Components</span>
                      <span className="text-violet-400">{aiSuggestion.score} pts</span>
                    </div>
                    {Object.entries(aiSuggestion.breakdown).map(([key, val]: any) => (
                      <div key={key} className="space-y-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span className="capitalize">{key.replace('_', ' ')}</span>
                          <span className={val > 0 ? 'text-emerald-400' : val < 0 ? 'text-red-400' : 'text-slate-500'}>
                            {val > 0 ? `+${val}` : val}
                          </span>
                        </div>
                        <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${val > 30 ? 'bg-emerald-500' : val > 0 ? 'bg-violet-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.abs(val)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {aiSuggestion.reasons.map((r: string, i: number) => (
                  <div key={i} className="flex gap-2 text-[11px] text-slate-400">
                    <span className="text-emerald-500 font-bold">✔</span>
                    <span className="leading-snug">{r}</span>
                  </div>
                ))}
                
                {aiSuggestion.is_external && (
                  <div className="pt-2 border-t border-slate-800">
                    <label className="block text-[10px] text-slate-500 uppercase font-bold mb-1.5">Выберите роль для добавления</label>
                    <select
                      value={aiSuggestionRole}
                      onChange={e => setAiSuggestionRole(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
                    >
                    
                      <option value="MANAGER" disabled={project.members?.some(m => m.role === 'MANAGER')}>Project Manager</option>
                      <optgroup label="Глобальные роли">
                        {globalRoles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                )}
              </div>

              <button
                onClick={async () => {
                  try {
                    const roleId = parseInt(aiSuggestionRole.toString());
                    const isGlobal = !isNaN(roleId) && globalRoles.some(r => r.id === roleId);
                    const roleName = isGlobal ? globalRoles.find(r => r.id === roleId)?.name || 'OTHER' : aiSuggestionRole.toString();

                    // If role is PM, check for existing and set 100% allocation
                    const isPM = roleName === 'MANAGER' || (isGlobal && (roleName.toLowerCase().includes('manager') || roleName.toLowerCase().includes('менеджер')));
                    
                    if (isPM && project.members?.some(m => m.role === 'MANAGER')) {
                      toast.error("В проекте уже есть Project Manager. Выберите другую роль.");
                      return;
                    }

                    await api.post(`/projects/tasks/${aiSuggestion.taskId}/assign_user/`, {
                      user_id: aiSuggestion.user_id,
                      allow_auto_add: true,
                      role: roleName,
                      role_ref_id: isGlobal ? roleId : undefined,
                      allocation_percentage: isPM ? 100 : undefined
                    });
                    setAiSuggestion(null);
                    fetchProjectBlocks();
                    toast.success("Исполнитель назначен" + (isPM ? " как Project Manager" : ""));
                  } catch (err: any) {
                    toast.error(extractError(err, 'Ошибка при назначении'));
                  }
                }}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-violet-900/20"
              >
                Назначить на задачу
              </button>
            </div>
          </div>
        )}

            {showAddBlockModal && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 backdrop-blur-md">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-bold text-white">Добавить этап</h3>
                    <button onClick={() => setShowAddBlockModal(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
                  </div>
                  <div className="space-y-4">
                    <button
                      onClick={() => handleCreateBlock()}
                      disabled={creatingBlock}
                      className="w-full flex items-center justify-between p-4 bg-slate-800/30 hover:bg-slate-800 border border-slate-800 rounded-xl transition-all group disabled:opacity-50"
                    >
                      <div className="text-left">
                        <p className="text-sm font-bold text-white">Пустой блок</p>
                        <p className="text-xs text-slate-500">Создать этап вручную</p>
                      </div>
                      {creatingBlock ? (
                        <div className="w-5 h-5 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
                      ) : (
                        <Plus className="text-slate-600 group-hover:text-violet-400" size={20} />
                      )}
                    </button>

                    <div className="relative py-2">
                      <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-800"></span></div>
                      <div className="relative flex justify-center text-[10px] uppercase text-slate-600">
                        <span className="bg-slate-900 px-2 flex items-center gap-2">
                          Или из шаблона 
                          <span className="bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-md text-[9px] font-bold">
                            {planningBlocks.filter(t => t.is_template).length} всего
                          </span>
                        </span>
                      </div>
                    </div>

                    <select
                      value={selectedTemplateId}
                      onChange={e => setSelectedTemplateId(e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 appearance-none"
                    >
                      <option value="">— Выберите пакет планирования —</option>
                      {planningBlocks.filter(t => t.is_template).map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.tasks?.length || 0} задач)
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => {
                        const t = planningBlocks.find(p => p.id === Number(selectedTemplateId));
                        if (t) {
                          setWizardSource(t);
                          setShowAddBlockModal(false);
                          setIsWizardOpen(true);
                        }
                      }}
                      disabled={!selectedTemplateId}
                      className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-900/20"
                    >
                      Открыть мастер переноса
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {isWizardOpen && wizardSource && (
              <TransferWizard 
                source={wizardSource} 
                isOpen={isWizardOpen} 
                targetProjectId={project.id}
                onClose={() => { setIsWizardOpen(false); setWizardSource(null); fetchProjectBlocks(); }} 
              />
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            {auditLogs.length === 0 ? (
              <div className="text-center py-12">
                <History size={32} className="mx-auto text-slate-700 mb-2 opacity-20" />
                <p className="text-sm text-slate-500">История изменений пуста</p>
              </div>
            ) : (
              auditLogs.map(log => (
                <div key={log.id} className="bg-slate-800/30 border border-slate-800/50 rounded-xl p-4 flex gap-4 transition-colors hover:bg-slate-800/50">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-2 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-slate-300 leading-snug">
                      <span className="font-bold text-white">{log.username}</span>{' '}
                      {log.action === 'PROJECT_CREATED' && 'создал(а) проект'}
                      {log.action === 'PROJECT_UPDATED' && 'обновил(а) настройки проекта'}
                      {log.action === 'MEMBER_ADDED' && `добавил(а) участника (ID: ${log.detail?.user_id})`}
                      {log.action === 'MEMBER_REMOVED' && `удалил(а) участника (ID: ${log.detail?.user_id})`}
                      {log.action === 'PLANNING_IMPORTED' && `импортировал(а) блок «${log.detail?.block}»`}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono mt-1.5">
                      {new Date(log.created_at).toLocaleString('ru-RU')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default function Projects() {
  const { projects, createProject, importProject, loading, risks, planningBlocks, domains, extractError, employees } = useAppContext();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modalMode, setModalMode] = useState<ModalMode>('none');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardSource, setWizardSource] = useState<Project | PlanningBlock | null>(null);

  // Create form state
  const [newProject, setNewProject] = useState({
    name: '',
    description: '',
    status: 'DRAFT' as const,
    domain: 'IT',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '2026-12-31',
    budget: '',
    manager_id: '' as number | '',
    manager_allocation: 100,
    risk_ids: [] as number[],
  });

  // Import form state
  const [importSourceId, setImportSourceId] = useState<number | ''>('');
  const [importOptions, setImportOptions] = useState({
    copyTeam: true,
    copyDates: false,
    scalingFactor: 1.0,
  });
  const [importName, setImportName] = useState('');
  const [sourceBlocks, setSourceBlocks] = useState<PlanningBlock[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<number[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);

  useEffect(() => {
    if (importSourceId) {
      setLoadingBlocks(true);
      api.get(`/projects/blocks/by-project/?project_id=${importSourceId}`)
        .then(res => {
          setSourceBlocks(res.data);
          setSelectedBlockIds(res.data.map((b: any) => b.id));
        })
        .catch(() => setError('Ошибка при загрузке блоков'))
        .finally(() => setLoadingBlocks(false));
    } else {
      setSourceBlocks([]);
      setSelectedBlockIds([]);
    }
  }, [importSourceId]);

  const filtered = projects.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase());
    
    let matchStatus = false;
    if (statusFilter === 'ALL') {
      matchStatus = true;
    } else if (statusFilter === 'ACTIVE') {
      // "Active" projects include both regular active and at-risk ones
      matchStatus = p.status === 'ACTIVE' || p.status === 'AT_RISK';
    } else {
      matchStatus = p.status === statusFilter;
    }
    
    return matchSearch && matchStatus;
  });

  const [similarProjects, setSimilarProjects] = useState<Project[]>([]);
  
  useEffect(() => {
    if (newProject.name.length > 2) {
      const match = projects.filter(p => p.name.toLowerCase().includes(newProject.name.toLowerCase()) && p.id !== selectedProjectId);
      setSimilarProjects(match.slice(0, 3));
    } else {
      setSimilarProjects([]);
    }
  }, [newProject.name, projects]);

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createProject({
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        status: newProject.status,
        domain: newProject.domain,
        start_date: newProject.start_date || null,
        end_date: newProject.end_date || null,
        budget: newProject.budget ? Number(newProject.budget) : null,
        manager_id: newProject.manager_id || null,
        manager_allocation: Number(newProject.manager_allocation),
        risks: newProject.risk_ids,
      });
      setModalMode('none');
      setNewProject({ 
        name: '', description: '', status: 'DRAFT', domain: 'IT', 
        start_date: new Date().toISOString().split('T')[0], 
        end_date: '2026-12-31', budget: '', manager_id: '',
        risk_ids: [],
        manager_allocation: 100
      });
    } catch (err: any) {
      setError(extractError(err, 'Ошибка при создании проекта'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importSourceId || !importName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await importProject(
        Number(importSourceId), 
        importName.trim(), 
        importOptions.copyDates, 
        importOptions.copyTeam, 
        importOptions.scalingFactor,
        selectedBlockIds.length > 0 ? selectedBlockIds : undefined
      );
      setModalMode('none');
      setImportSourceId('');
      setImportName('');
      setImportOptions({ copyTeam: true, copyDates: false, scalingFactor: 1.0 });
    } catch (err: any) {
      setError(extractError(err, 'Ошибка при импорте'));
    } finally {
      setSubmitting(false);
    }
  };

  const closeModal = () => { setModalMode('none'); setError(''); setSelectedProjectId(null); };

  const { user } = useAuth();
  const isManager = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  if (loading && projects.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Загрузка проектов...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 relative h-full overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Проекты</h1>
          <p className="text-sm text-slate-400 mt-1">Управление всеми проектами и блоками планирования</p>
        </div>
        {isManager && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setWizardSource(projects[0]); setIsWizardOpen(true); setError(''); }}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              <Copy size={15} />
              Мастер переноса
            </button>
            <button
              onClick={() => { setModalMode('create'); setError(''); }}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-lg shadow-violet-500/20"
            >
              <Plus size={16} />
              Новый проект
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск проектов..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
          {[['ALL', 'Все'], ['ACTIVE', 'Активные'], ['DRAFT', 'Черновики'], ['ON_HOLD', 'На паузе'], ['COMPLETED', 'Завершённые']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${statusFilter === val ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-600">{filtered.length} проектов</span>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((project) => (
          <div
            key={project.id}
            onClick={() => { setSelectedProjectId(project.id); setModalMode('detail'); }}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300 cursor-pointer group flex flex-col"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${domainColor[project.domain] || 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                  {project.domain}
                </span>
                {isManager && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setWizardSource(project);
                      setIsWizardOpen(true);
                    }}
                    className="p-1 text-slate-500 hover:text-violet-400 hover:bg-violet-500/10 rounded-md transition-all"
                    title="Клонировать / Перенести этапы"
                  >
                    <Copy size={13} />
                  </button>
                )}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusStyle[project.status] ?? statusStyle.DRAFT}`}>
                {statusMap[project.status] ?? project.status}
              </span>
            </div>
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-slate-100 group-hover:text-white leading-snug">{project.name}</h3>
              <ArrowUpRight size={14} className="text-slate-600 group-hover:text-violet-400 transition-colors flex-shrink-0 mt-0.5" />
            </div>
            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-4 flex-1">{project.description}</p>
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Прогресс</span>
                <span className="text-slate-300 font-medium">{project.progress_percentage}%</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-700"
                  style={{ width: `${project.progress_percentage}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-auto">
              <div className="flex items-center gap-1.5">
                <Users size={12} />
                {project.members?.length ?? 0} чел.
              </div>
              <div className="flex items-center gap-1.5 truncate max-w-[100px]">
                <Calendar size={12} className="flex-shrink-0" />
                {project.end_date ?? '—'}
              </div>
              {project.manager && (
                <div className="flex items-center gap-1 text-violet-400 font-medium">
                  <div className="w-4 h-4 rounded bg-violet-500/20 flex items-center justify-center text-[8px]">M</div>
                  {project.manager.full_name.split(' ')[0]}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Add card */}
        {isManager && (
          <div
            onClick={() => { setModalMode('create'); setError(''); }}
            className="border-2 border-dashed border-slate-800 hover:border-violet-500/50 rounded-xl p-5 flex flex-col items-center justify-center gap-3 cursor-pointer group transition-all duration-300 min-h-[220px]"
          >
            <div className="w-10 h-10 rounded-lg bg-slate-800 group-hover:bg-violet-500/10 flex items-center justify-center transition-colors">
              <Plus size={20} className="text-slate-500 group-hover:text-violet-400 transition-colors" />
            </div>
            <p className="text-sm text-slate-500 group-hover:text-slate-300 transition-colors font-medium">Создать проект</p>
          </div>
        )}

        {filtered.length === 0 && projects.length > 0 && (
          <div className="col-span-3 py-20 flex flex-col items-center text-slate-600 gap-3">
            <FolderOpen size={40} className="opacity-40" />
            <p className="text-sm">Проекты не найдены по фильтру</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {modalMode === 'detail' && selectedProject && (
        <ProjectDetailPanel 
          project={selectedProject} 
          onClose={closeModal}
          isWizardOpen={isWizardOpen}
          setIsWizardOpen={setIsWizardOpen}
          wizardSource={wizardSource}
          setWizardSource={setWizardSource}
        />
      )}

      {/* ── Modal: Create ── */}
      {modalMode === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-xl font-bold text-white">Создать новый проект</h2>
              <button onClick={() => setModalMode('none')} className="text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleAddProject} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">{error}</div>
                )}

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Название проекта *</label>
                  <input
                    type="text" autoFocus required
                    value={newProject.name}
                    onChange={e => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    placeholder="Например: Обновление API"
                  />
                  {similarProjects.length > 0 && (
                    <div className="mt-2 p-3 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                      <p className="text-[10px] text-violet-400 font-bold uppercase mb-2 flex items-center gap-1">
                        <Zap size={10} /> Найдены похожие проекты:
                      </p>
                      <div className="space-y-1.5">
                        {similarProjects.map(p => (
                          <div key={p.id} className="flex items-center justify-between group">
                            <span className="text-xs text-slate-300 truncate max-w-[200px]">{p.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setImportSourceId(p.id);
                                setImportName(`${newProject.name} (копия из ${p.name})`);
                                setModalMode('import');
                              }}
                              className="text-[10px] bg-violet-600 hover:bg-violet-500 text-white px-2 py-0.5 rounded transition-all opacity-0 group-hover:opacity-100"
                            >
                              Импортировать задачи
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                  <textarea
                    rows={3}
                    value={newProject.description}
                    onChange={e => setNewProject({ ...newProject, description: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 resize-none"
                    placeholder="Краткое описание целей"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Область (Домен)</label>
                    <select
                      value={newProject.domain}
                      onChange={e => setNewProject({ ...newProject, domain: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    >
                      <option value="">— Выбрать домен —</option>
                      {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Статус</label>
                    <select
                      value={newProject.status}
                      onChange={e => setNewProject({ ...newProject, status: e.target.value as any })}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    >
                      <option value="DRAFT">Черновик</option>
                      <option value="ACTIVE">Активен</option>
                      <option value="ON_HOLD">На паузе</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Начало</label>
                    <input
                      type="date"
                      value={newProject.start_date}
                      onChange={e => setNewProject({ ...newProject, start_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Дедлайн</label>
                    <input
                      type="date" required
                      value={newProject.end_date}
                      onChange={e => setNewProject({ ...newProject, end_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Бюджет (₽)</label>
                  <input
                    type="number" min="0"
                    value={newProject.budget}
                    onChange={e => setNewProject({ ...newProject, budget: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Ответственный менеджер</label>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <select
                        value={newProject.manager_id}
                        onChange={e => {
                          const mid = e.target.value ? Number(e.target.value) : '';
                          const emp = employees.find(emp => emp.user.id === mid);
                          const remaining = emp ? Math.max(0, 100 - emp.current_workload_percentage) : 100;
                          setNewProject({ 
                            ...newProject, 
                            manager_id: mid,
                            manager_allocation: mid ? (remaining > 0 ? remaining : 10) : 100 
                          });
                        }}
                        className={`w-full bg-slate-800 border ${newProject.manager_id && (employees.find(e => e.user.id === Number(newProject.manager_id))?.current_workload_percentage || 0) > 90 ? 'border-amber-500/50' : 'border-slate-700'} text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500`}
                      >
                        <option value="">— Не назначен —</option>
                        {employees.map(e => (
                          <option key={e.user.id} value={e.user.id} className={e.current_workload_percentage > 90 ? 'text-amber-400' : ''}>
                            {e.full_name} ({e.current_workload_percentage}%)
                          </option>
                        ))}
                      </select>
                    </div>
                    {newProject.manager_id && (
                      <div className="w-24">
                        <div className="relative">
                          <input 
                            type="number"
                            min="1" max="100"
                            value={newProject.manager_allocation}
                            onChange={e => setNewProject({ ...newProject, manager_allocation: Number(e.target.value) })}
                            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 pr-8"
                            placeholder="Загрузка"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
                        </div>
                      </div>
                    )}
                  </div>
                  {newProject.manager_id && (employees.find(e => e.user.id === Number(newProject.manager_id))?.current_workload_percentage || 0) > 90 && (
                    <p className="text-[10px] text-amber-400 font-bold mt-1.5 flex items-center gap-1">
                      <AlertTriangle size={12} /> Внимание: Менеджер уже загружен на {employees.find(e => e.user.id === Number(newProject.manager_id))?.current_workload_percentage}%
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-2">Риски проекта</label>
                  <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3 max-h-32 overflow-y-auto custom-scrollbar space-y-2">
                    {risks.map(r => (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={newProject.risk_ids.includes(r.id)}
                          onChange={e => {
                            const ids = e.target.checked 
                              ? [...newProject.risk_ids, r.id]
                              : newProject.risk_ids.filter(id => id !== r.id);
                            setNewProject({ ...newProject, risk_ids: ids });
                          }}
                          className="w-3.5 h-3.5 rounded border-slate-700 text-violet-500 bg-slate-800 focus:ring-0"
                        />
                        <span className="text-[11px] text-slate-400 group-hover:text-slate-200 transition-colors">{r.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-800 flex items-center justify-end gap-3 flex-shrink-0">
                <button type="button" onClick={() => setModalMode('none')} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-violet-500/20"
                >
                  {submitting ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Import ── */}
      {modalMode === 'import' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl overflow-y-auto max-h-[90vh] custom-scrollbar">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-bold text-white">Импорт планирования</h2>
                <p className="text-xs text-slate-500 mt-0.5">Перенести структуру из существующего проекта</p>
              </div>
              <button onClick={closeModal} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={20} /></button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">{error}</div>
            )}

            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Источник (исходный проект)</label>
                <select
                  required
                  value={importSourceId}
                  onChange={e => {
                    const id = Number(e.target.value);
                    setImportSourceId(id);
                    const src = [...projects, ...planningBlocks].find(p => p.id === id);
                    if (src) setImportName(`${src.name} (копия)`);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                >
                  <option value="">— Выберите источник —</option>
                  <optgroup label="Ваши проекты">
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Каталог (шаблоны)">
                    {planningBlocks.filter(b => b.is_template).map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.domain})</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {importSourceId && (
                <>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Название нового проекта</label>
                    <input
                      type="text" required autoFocus
                      value={importName}
                      onChange={e => setImportName(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div className="border border-slate-800 rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-400">Что перенести:</p>
                    {([
                      ['copyTeam', 'Команду проекта'],
                      ['copyDates', 'Сроки (дедлайн)'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={importOptions[key]}
                          onChange={() => setImportOptions(prev => ({ ...prev, [key]: !prev[key] }))}
                          className="w-4 h-4 rounded border-slate-600 text-violet-500 focus:ring-violet-500 bg-slate-700"
                        />
                        <span className="text-sm text-slate-300">{label}</span>
                      </label>
                    ))}

                    <div className="pt-2">
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-xs font-semibold text-slate-400">Масштабирование трудозатрат:</label>
                        <span className="text-xs font-bold text-violet-400">x{importOptions.scalingFactor.toFixed(1)}</span>
                      </div>
                      <input 
                        type="range" min="0.5" max="3.0" step="0.1"
                        value={importOptions.scalingFactor}
                        onChange={e => setImportOptions(prev => ({ ...prev, scalingFactor: Number(e.target.value) }))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-600"
                      />
                      <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                        <span>Сжать (0.5x)</span>
                        <span>Расширить (3.0x)</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800">
                      <p className="text-xs font-semibold text-slate-400 mb-2 flex justify-between">
                        Блоки планирования:
                        <span className="text-[10px] text-slate-500 font-normal">({selectedBlockIds.length} из {sourceBlocks.length})</span>
                      </p>
                      {loadingBlocks ? (
                        <div className="py-2 flex justify-center"><div className="w-4 h-4 border border-violet-500 border-t-transparent rounded-full animate-spin"/></div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                          {sourceBlocks.map(block => (
                            <label key={block.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${selectedBlockIds.includes(block.id) ? 'bg-violet-500/10' : 'hover:bg-slate-800'}`}>
                              <input
                                type="checkbox"
                                checked={selectedBlockIds.includes(block.id)}
                                onChange={() => {
                                  setSelectedBlockIds(prev => 
                                    prev.includes(block.id) ? prev.filter(id => id !== block.id) : [...prev, block.id]
                                  );
                                }}
                                className="w-3.5 h-3.5 rounded border-slate-600 text-violet-500 focus:ring-violet-500 bg-slate-700"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                  <p className="text-xs text-slate-200 truncate">{block.name}</p>
                                  {block.analytics && (
                                    <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded">
                                      {Math.round(block.analytics.success_rate * 100)}%
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <p className="text-[10px] text-slate-500">{block.domain} • {block.complexity}</p>
                                  {block.analytics && (
                                    <p className="text-[10px] text-slate-400 border-l border-slate-700 pl-2">
                                      {block.analytics.avg_actual_duration}д / {block.analytics.usage_count}x
                                    </p>
                                  )}
                                </div>
                              </div>
                            </label>
                          ))}
                          {sourceBlocks.length === 0 && <p className="text-[10px] text-slate-600 italic">Блоки не найдены</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button
                  type="submit"
                  disabled={!importSourceId || submitting}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-violet-500/20"
                >
                  {submitting ? 'Импорт...' : 'Перенести'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
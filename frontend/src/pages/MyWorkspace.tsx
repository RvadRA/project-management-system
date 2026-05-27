import { useState } from 'react';
import {
  ClipboardCheck, Clock, CheckCircle2, FileText,
  ChevronDown, ChevronUp, Bell, Calendar, BarChart3,
  Upload, List, ThumbsUp, Zap
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { TaskSubmissionRouter } from '../components/tasks/TaskSubmissionRouter';


// Priority is derived from task id as mock since backend doesn't have priority
const getPriority = (id: number) => {
  if (id % 3 === 0) return 'HIGH';
  if (id % 2 === 0) return 'MEDIUM';
  return 'LOW';
};
const priorityStyle: Record<string, string> = {
  HIGH: 'bg-red-500/10 text-red-400 border-red-500/20',
  MEDIUM: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  LOW: 'bg-slate-700/50 text-slate-400 border-slate-600/30',
};
const priorityLabel: Record<string, string> = { HIGH: 'Высокий', MEDIUM: 'Средний', LOW: 'Низкий' };

const taskTypeInfo: Record<string, { label: string; icon: any }> = {
  TEXT_REPORT: { label: 'Отчёт',       icon: FileText },
  FILE_UPLOAD: { label: 'Файлы',       icon: Upload },
  CHECKLIST:   { label: 'Чек-лист',    icon: List },
  APPROVAL:    { label: 'Утверждение', icon: ThumbsUp },
  INTEGRATION: { label: 'Интеграция',  icon: Zap },
};



export default function MyWorkspace() {
  const { myTasks, notifications, processes, markNotificationRead, markAllRead, unreadCount } = useAppContext();
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Build process name lookup
  const processNameById: Record<number, string> = {};
  processes.forEach(p => { processNameById[p.id] = p.name; });

  const activeTasks = myTasks.filter(t => t.status !== 'DONE' && t.status !== 'REVIEW');
  const reviewTasks = myTasks.filter(t => t.status === 'REVIEW');
  const completedTasks = myTasks.filter(t => t.status === 'DONE');

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ClipboardCheck size={22} className="text-violet-400" />
            Мой кабинет
          </h1>
          <p className="text-sm text-slate-400 mt-1">Ваши задачи, отчётность и уведомления</p>
        </div>
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Calendar size={14} />
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main: tasks */}
        <div className="col-span-2 space-y-4">
          {/* Stats mini */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Активных задач', value: activeTasks.length, icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { label: 'На проверке', value: reviewTasks.length, icon: BarChart3, color: 'text-amber-400', bg: 'bg-amber-500/10' },
              { label: 'Завершено (всего)', value: completedTasks.length, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}>
                  <s.icon size={18} className={s.color} />
                </div>
                <div>
                  <p className="text-xl font-bold text-white">{s.value}</p>
                  <p className="text-xs text-slate-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Active tasks */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800">
              <h2 className="text-sm font-semibold text-white">Активные задачи</h2>
            </div>

            <div className="divide-y divide-slate-800">
              {activeTasks.map(task => {
                const isExpanded = expandedTask === task.id;
                const priority = getPriority(task.id);
                const processName = processNameById[task.workflow] ?? '';
                return (
                  <div key={task.id}>
                    <div
                      className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-800/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    >
                      {(() => {
                        const info = taskTypeInfo[task.task_type] || taskTypeInfo['TEXT_REPORT'];
                        const Icon = info.icon;
                        return <Icon size={16} className="text-slate-500 flex-shrink-0" />;
                      })()}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-200 truncate">{task.name}</p>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 font-bold uppercase tracking-tight">
                            {taskTypeInfo[task.task_type]?.label || 'Задача'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {processName && `${processName} · `}
                          {task.due_date ? `До ${new Date(task.due_date).toLocaleDateString()}` : 'Дедлайн не задан'}
                          {task.is_overdue && (
                            <span className="ml-2 text-red-400 font-semibold">⚠ Просрочена</span>
                          )}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${priorityStyle[priority]}`}>
                        {priorityLabel[priority]}
                      </span>
                      <span className={`text-xs flex-shrink-0 ${task.status === 'IN_PROGRESS' ? 'text-blue-400' : 'text-slate-500'}`}>
                        {task.status === 'IN_PROGRESS' ? 'В работе' : 'К выполнению'}
                      </span>
                      {isExpanded ? <ChevronUp size={14} className="text-slate-600 flex-shrink-0" /> : <ChevronDown size={14} className="text-slate-600 flex-shrink-0" />}
                    </div>

                    {isExpanded && (
                      <div className="px-5 pb-4">
                        <TaskSubmissionRouter
                          task={task}
                          onClose={() => setExpandedTask(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {activeTasks.length === 0 && (
                <div className="p-6 text-center text-slate-500 text-sm">Нет активных задач</div>
              )}
            </div>
          </div>

          {/* Review tasks */}
          {reviewTasks.length > 0 && (
            <div className="bg-slate-900 border border-amber-500/20 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-2">
                <Clock size={14} className="text-amber-400" />
                <h2 className="text-sm font-semibold text-amber-400">На проверке</h2>
                <span className="ml-auto text-xs text-amber-400 font-bold">{reviewTasks.length}</span>
              </div>
              <div className="divide-y divide-slate-800">
                {reviewTasks.map(task => (
                  <div key={task.id} className="px-5 py-3 flex items-center gap-4 opacity-80">
                    <Clock size={14} className="text-amber-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-slate-300">{task.name}</p>
                      <p className="text-xs text-slate-600">{processNameById[task.workflow] ?? ''}</p>
                    </div>
                    <span className="text-xs text-amber-400">Ожидает</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed tasks toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-400">История выполненных задач</h2>
              </div>
              {showHistory ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
            </button>
            {showHistory && (
              <div className="divide-y divide-slate-800 border-t border-slate-800">
                {completedTasks.map(task => {
                  const isExpanded = expandedTask === task.id;
                  const priority = getPriority(task.id);
                  const typeInfo = taskTypeInfo[task.task_type] || taskTypeInfo['TEXT_REPORT'];
                  const Icon = typeInfo.icon;
                  
                  return (
                    <div key={task.id}>
                      <div 
                        className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-800/20 transition-colors cursor-pointer relative"
                        onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                      >
                        {/* Priority indicator strip */}
                        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-r-full ${
                          priority === 'HIGH' ? 'bg-red-500/50' : 
                          priority === 'MEDIUM' ? 'bg-amber-500/50' : 'bg-slate-700/50'
                        }`} />

                        <Icon size={14} className="text-emerald-500/70 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-300 font-medium truncate">{task.name}</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            {processNameById[task.workflow] ?? ''} · Завершено {task.created_at ? new Date(task.created_at).toLocaleDateString() : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                            {typeInfo.label}
                          </span>
                          <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-tight">Выполнено</span>
                        </div>
                        {isExpanded ? <ChevronUp size={12} className="text-slate-700" /> : <ChevronDown size={12} className="text-slate-700" />}
                      </div>
                      
                      {isExpanded && (
                        <div className="px-5 pb-5 pt-1 animate-in slide-in-from-top-1 duration-200">
                          <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/30 space-y-4">
                            {/* Report Text */}
                            {task.report?.text_content && (
                              <div className="space-y-1.5">
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Отчёт:</h4>
                                <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/50 p-2.5 rounded-lg border border-slate-800">
                                  {task.report.text_content}
                                </p>
                              </div>
                            )}

                            {/* Checklist Result */}
                            {task.report?.checklist && task.report.checklist.length > 0 && (
                              <div className="space-y-1.5">
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Чек-лист:</h4>
                                <div className="grid grid-cols-1 gap-1">
                                  {task.report.checklist.map((item, idx) => (
                                    <div key={idx} className="flex items-center gap-2 text-[11px] text-slate-400">
                                      {item.is_done ? 
                                        <CheckCircle2 size={10} className="text-emerald-500" /> : 
                                        <div className="w-2.5 h-2.5 border border-slate-600 rounded-sm" />
                                      }
                                      <span className={item.is_done ? 'line-through opacity-50' : ''}>{item.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Attachments */}
                            {task.attachments && task.attachments.length > 0 && (
                              <div className="space-y-1.5">
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Прикрепленные файлы:</h4>
                                <div className="flex flex-wrap gap-2">
                                  {task.attachments.map(file => (
                                    <a 
                                      key={file.id} 
                                      href={file.file} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg hover:border-violet-500/50 transition-colors group"
                                    >
                                      <FileText size={14} className="text-violet-400" />
                                      <span className="text-[11px] text-slate-300 group-hover:text-violet-300 truncate max-w-[150px]">
                                        {file.original_name}
                                      </span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}

                            {!task.report?.text_content && (!task.attachments || task.attachments.length === 0) && (
                              <p className="text-xs text-slate-600 italic">Детальная информация отсутствует</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {completedTasks.length === 0 && (
                  <div className="p-12 text-center">
                    <CheckCircle2 size={32} className="text-slate-800 mx-auto mb-3" />
                    <p className="text-sm text-slate-600">История выполненных задач пуста</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: notifications + SLA */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-2">
              <Bell size={14} className="text-violet-400" />
              <h2 className="text-sm font-semibold text-white">Уведомления</h2>
              {unreadCount > 0 && (
                <span className="ml-1 text-[10px] font-bold bg-violet-600 text-white rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                  {unreadCount}
                </span>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="ml-auto text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Прочитать все
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-800 max-h-[320px] overflow-y-auto">
              {notifications.slice(0, 15).map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.is_read && markNotificationRead(n.id)}
                  className={`px-5 py-3.5 hover:bg-slate-800/30 transition-colors cursor-pointer ${n.is_read ? 'opacity-50' : ''}`}
                >
                  <p className="text-xs font-semibold text-slate-100">{n.title}</p>
                  {n.body && (
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{n.body}</p>
                  )}
                  <p className="text-[10px] text-slate-600 mt-1">{new Date(n.created_at).toLocaleString('ru-RU')}</p>
                </div>
              ))}
              {notifications.length === 0 && (
                <div className="p-4 text-center text-slate-500 text-sm">Уведомлений нет</div>
              )}
            </div>
          </div>

          {/* SLA overview */}
          {activeTasks.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Соблюдение SLA</h3>
              <div className="space-y-3">
                {activeTasks.slice(0, 5).map(t => {
                  const createdTime = t.created_at ? new Date(t.created_at).getTime() : Date.now();
                  const totalTime = (t.sla_hours || 24) * 3600000;
                  const elapsedRatio = Math.max(0, Math.min(1, (Date.now() - createdTime) / totalTime));
                  const isOver = elapsedRatio >= 1;
                  return (
                    <div key={t.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400 truncate max-w-[150px]">{t.name}</span>
                        <span className={`font-medium ${isOver ? 'text-red-400' : elapsedRatio > 0.7 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {Math.round(elapsedRatio * (t.sla_hours || 24))}ч / {t.sla_hours || 24}ч
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isOver ? 'bg-red-500' : elapsedRatio > 0.7 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                          style={{ width: `${elapsedRatio * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

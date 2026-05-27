import { useMemo } from 'react';
import { TrendingUp, CheckCircle2, AlertTriangle, ArrowUpRight, Clock, Bell } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';

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

const notifTypeIcon: Record<string, string> = {
  INFO: '💬',
  SUCCESS: '✅',
  WARNING: '⚠️',
  ERROR: '❌',
  TASK_ASSIGNED: '📋',
  TASK_DEADLINE: '⏰',
  ESCALATION: '🚨',
};

export default function Dashboard() {
  const { projects, employees, notifications, allTasks, loading, markAllRead, skills, globalAuditLogs } = useAppContext();
  const navigate = useNavigate();

  const activeProjectsCount = useMemo(() => projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').length, [projects]);
  const atRiskCount = useMemo(() => projects.filter(p => p.status === 'AT_RISK').length, [projects]);
  const overdueTasksCount = useMemo(() => allTasks.filter(t => t.is_overdue).length, [allTasks]);
  const escalatedCount = useMemo(() => allTasks.filter(t => t.status === 'ESCALATED').length, [allTasks]);
  const doneTasksCount = useMemo(() => allTasks.filter(t => t.status === 'DONE').length, [allTasks]);
  const totalTasks = allTasks.length;
  const donePercent = useMemo(() => totalTasks > 0 ? Math.round((doneTasksCount / totalTasks) * 100) : 0, [totalTasks, doneTasksCount]);
  const unreadNotifications = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications]);

  const stats = useMemo(() => [
    {
      label: 'Активных проектов',
      value: activeProjectsCount.toString(),
      change: `Всего ${projects.length} проектов`,
      icon: TrendingUp,
      bg: 'bg-violet-500/10',
      text: 'text-violet-400',
    },
    {
      label: 'В зоне риска',
      value: atRiskCount.toString(),
      change: escalatedCount > 0 ? `${escalatedCount} эскалаций` : 'Риски под контролем',
      icon: AlertTriangle,
      bg: 'bg-red-500/10',
      text: 'text-red-400',
    },
    {
      label: 'Задач выполнено',
      value: `${donePercent}%`,
      change: `${doneTasksCount} из ${totalTasks}`,
      icon: CheckCircle2,
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
    },
    {
      label: 'Просрочено задач',
      value: overdueTasksCount.toString(),
      change: overdueTasksCount > 0 ? 'Требует внимания' : 'Всё в порядке',
      icon: Clock,
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
    },
    {
      label: 'Сотрудников',
      value: employees.length.toString(),
      change: `${skills.length} навыков в базе`,
      icon: TrendingUp,
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
    },
  ], [activeProjectsCount, projects.length, employees.length, skills.length, donePercent, doneTasksCount, totalTasks, overdueTasksCount, escalatedCount]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Дашборд</h1>
          <p className="text-sm text-slate-400 mt-1">Добро пожаловать! Вот сводка по всем проектам.</p>
        </div>
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Clock size={14} />
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-5 gap-4">
        {stats.map(({ label, value, change, icon: Icon, bg, text }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors duration-200">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={18} className={text} />
              </div>
              <ArrowUpRight size={14} className="text-slate-600" />
            </div>
            <p className="text-3xl font-bold text-white">{value}</p>
            <p className="text-sm text-slate-400 mt-1">{label}</p>
            <p className="text-xs text-slate-600 mt-2">{change}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Projects Table */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[500px]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
            <h2 className="text-sm font-semibold text-white">Недавние проекты</h2>
            <button
              onClick={() => navigate('/projects')}
              className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors"
            >
              Все проекты <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="divide-y divide-slate-800 overflow-y-auto">
            {projects.slice(0, 6).map((p) => (
              <div
                key={p.id}
                onClick={() => navigate('/projects')}
                className="px-6 py-4 flex items-center gap-4 hover:bg-slate-800/30 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-100 truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    До {p.end_date || 'не указано'} · {p.members?.length ?? 0} чел.
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${statusStyle[p.status] ?? statusStyle.DRAFT}`}>
                  {statusMap[p.status] ?? p.status}
                </span>
                <div className="w-32 space-y-1 flex-shrink-0">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Прогресс</span>
                    <span className="text-slate-300 font-medium">{p.progress_percentage}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${p.progress_percentage}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {projects.length === 0 && (
              <div className="px-6 py-8 text-center text-slate-500 text-sm">Нет доступных проектов</div>
            )}
          </div>
        </div>

        {/* Notifications feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[500px]">
          <div className="px-6 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Bell size={14} className="text-violet-400" />
              Уведомления
            </h2>
            <div className="flex items-center gap-3">
              {unreadNotifications > 0 && (
                <button 
                  onClick={markAllRead}
                  className="text-[10px] text-slate-500 hover:text-violet-400 font-medium transition-colors"
                >
                  Прочитать все
                </button>
              )}
              {unreadNotifications > 0 && (
                <span className="text-xs font-bold bg-violet-600 text-white rounded-full px-2 py-0.5">
                  {unreadNotifications}
                </span>
              )}
            </div>
          </div>
          <div className="px-6 py-4 space-y-5 overflow-y-auto">
            {notifications.slice(0, 8).map((item) => (
              <div key={item.id} className={`flex gap-3 ${!item.is_read ? 'opacity-100' : 'opacity-60'}`}>
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                  {notifTypeIcon[item.type] ?? '💬'}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-100">{item.title}</p>
                  {item.body && (
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.body}</p>
                  )}
                  <p className="text-xs text-slate-600 mt-1">
                    {new Date(item.created_at).toLocaleString('ru-RU')}
                  </p>
                </div>
              </div>
            ))}
            {notifications.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-4">Нет уведомлений</div>
            )}
          </div>
        </div>

        {/* Global Activity feed */}
        <div className="col-span-3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-800 shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-400" />
              Глобальная активность
            </h2>
            <button onClick={() => navigate('/audit')} className="text-[10px] text-slate-500 hover:text-violet-400 font-medium transition-colors">
              Журнал аудита
            </button>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-800">
             <div className="p-6 space-y-4">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Последние изменения</p>
                <div className="space-y-4 max-h-[200px] overflow-y-auto pr-1 thin-scrollbar">
                   {globalAuditLogs.slice(0, 6).map(log => (
                      <div key={log.id} className="flex gap-3 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 flex-shrink-0" />
                        <div>
                          <p className="text-slate-200">
                            <span className="font-bold text-white">{log.username}</span>{' '}
                            {log.action === 'PROJECT_CREATED' && 'создал проект'}
                            {log.action === 'PROJECT_UPDATED' && 'обновил проект'}
                            {log.action === 'MEMBER_ADDED' && 'добавил участника'}
                            {log.action === 'TASK_COMPLETED' && 'завершил задачу'}
                            {log.action === 'PLANNING_IMPORTED' && 'импортировал блок'}
                            {!['PROJECT_CREATED', 'PROJECT_UPDATED', 'MEMBER_ADDED', 'TASK_COMPLETED', 'PLANNING_IMPORTED'].includes(log.action) && log.action.toLowerCase().replace('_', ' ')}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {new Date(log.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                   ))}
                   {globalAuditLogs.length === 0 && <p className="text-xs text-slate-600">Нет активности</p>}
                </div>
             </div>
             <div className="p-6">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Эффективность планирования</p>
                <div className="space-y-4">
                   <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Использование шаблонов</span>
                      <span className="text-xs font-bold text-emerald-400">84%</span>
                   </div>
                   <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 w-[84%] rounded-full" />
                   </div>
                   <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Точность прогнозов</span>
                      <span className="text-xs font-bold text-violet-400">92%</span>
                   </div>
                   <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-violet-500 w-[92%] rounded-full" />
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { X, Star, Loader2, CheckCircle2, Clock, AlertTriangle, Eye, CircleDashed, Briefcase } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useAppContext } from '../context/AppContext';

type Timeliness = 'on_time' | 'late' | 'overdue' | 'review' | 'open' | 'done';

interface ContributionTask {
  id: string;
  source: 'process' | 'plan';
  name: string;
  group: string;
  status: string;
  timeliness: Timeliness;
  due: string | null;
  finished: string | null;
  late_hours: number | null;
  estimated_hours: number;
}

interface Contribution {
  project: { id: number; name: string; status: string; start_date: string | null; end_date: string | null };
  employee: { id: number; full_name: string };
  position: string;
  is_member: boolean;
  joined_at: string | null;
  left_at: string | null;
  load_percent: number | null;
  rating: { stars: number; comment: string; rated_by: string | null; rated_at: string | null } | null;
  summary: {
    total: number; done: number; on_time: number; late: number; overdue: number; review: number; open: number;
    done_plan: number; estimated_hours: number; done_hours: number; on_time_rate: number | null;
  };
  tasks: ContributionTask[];
}

interface Props {
  profileId: number;
  projectId: number;
  onClose: () => void;
}

const TIMELINESS: Record<Timeliness, { label: string; style: string; icon: typeof Clock }> = {
  on_time: { label: 'В срок', style: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  done: { label: 'Выполнена', style: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  late: { label: 'С опозданием', style: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: Clock },
  overdue: { label: 'Просрочена', style: 'text-red-400 bg-red-500/10 border-red-500/20', icon: AlertTriangle },
  review: { label: 'На проверке', style: 'text-violet-300 bg-violet-500/10 border-violet-500/20', icon: Eye },
  open: { label: 'В работе', style: 'text-slate-300 bg-slate-700/40 border-slate-600/40', icon: CircleDashed },
};

const PROJECT_STATUS: Record<string, string> = {
  DRAFT: 'Черновик', PLANNING: 'Планирование', ACTIVE: 'В работе', IN_PROGRESS: 'В работе', AT_RISK: 'В зоне риска',
  ON_HOLD: 'На паузе', COMPLETED: 'Завершён', CANCELLED: 'Отменён',
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString('ru-RU') : '—');

const lateLabel = (hours: number) => (hours >= 24 ? `+${Math.round(hours / 24)} дн.` : `+${Math.max(1, Math.round(hours))} ч`);

/**
 * Вклад сотрудника в проект: какие задачи он вёл, как уложился в сроки и какую оценку получил.
 * Сроки считаются тем же правилом, что и «Результативность» в подборе команды.
 */
export default function ContributionModal({ profileId, projectId, onClose }: Props) {
  const { extractError } = useAppContext();
  const [data, setData] = useState<Contribution | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Contribution>(`/employees/profiles/${profileId}/contribution/`, { params: { project: projectId } })
      .then(res => { if (!cancelled) setData(res.data); })
      .catch(err => { if (!cancelled) { toast.error(extractError(err, 'Не удалось загрузить данные по проекту')); onClose(); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const summary = data?.summary;
  const groups = data ? [...new Set(data.tasks.map(t => t.group))] : [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()} role="dialog" aria-label="Вклад в проект"
      >
        {!data || !summary ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-violet-400" /></div>
        ) : (
          <>
            <div className="p-5 border-b border-slate-800 flex items-start justify-between gap-3 flex-shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 flex-shrink-0">
                  <Briefcase size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-white truncate">{data.project.name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {data.employee.full_name}{data.position ? ` · ${data.position}` : ''} · {PROJECT_STATUS[data.project.status] ?? data.project.status}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {data.joined_at ? `В проекте с ${formatDate(data.joined_at)}${data.left_at ? ` по ${formatDate(data.left_at)}` : ''}` : 'Период участия не указан'}
                    {data.load_percent ? ` · загрузка ${data.load_percent}%` : ''}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors flex-shrink-0" aria-label="Закрыть"><X size={20} /></button>
            </div>

            <div className="p-5 overflow-y-auto custom-scrollbar space-y-4 flex-1">
              {/* Оценка руководителя */}
              <div className="p-3.5 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                {data.rating ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-amber-200">Оценка руководителя</p>
                      <span className="flex items-center gap-0.5" title={`${data.rating.stars} из 5`}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star key={n} size={15} className={n <= Math.round(data.rating!.stars) ? 'fill-amber-400 text-amber-400' : 'text-slate-700'} />
                        ))}
                        <span className="text-sm font-bold text-amber-300 ml-1.5">{data.rating.stars}</span>
                      </span>
                    </div>
                    {data.rating.comment && <p className="text-xs text-slate-300 mt-2 leading-relaxed">«{data.rating.comment}»</p>}
                    {(data.rating.rated_at || data.rating.rated_by) && (
                      <p className="text-[10px] text-slate-500 mt-1.5">
                        {data.rating.rated_at ? `Оценено ${formatDate(data.rating.rated_at)}` : 'Оценка'}{data.rating.rated_by ? ` · ${data.rating.rated_by}` : ''}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-400">
                    {data.project.status === 'COMPLETED'
                      ? 'Руководитель ещё не оценил работу в этом проекте.'
                      : 'Оценка руководителя ставится после завершения проекта.'}
                  </p>
                )}
              </div>

              {/* Итоги по задачам */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Задач', value: summary.total, hint: `выполнено ${summary.done}`, color: 'text-white' },
                  { label: 'В срок', value: summary.on_time, hint: summary.on_time_rate !== null ? `${summary.on_time_rate}% от оценённых` : 'нет данных', color: 'text-emerald-400' },
                  { label: 'С опозданием', value: summary.late, hint: 'сданы позже срока', color: 'text-amber-400' },
                  { label: 'Просрочено', value: summary.overdue, hint: 'не сданы, срок вышел', color: 'text-red-400' },
                ].map(tile => (
                  <div key={tile.label} className="p-3 bg-slate-800/30 border border-slate-800 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{tile.label}</p>
                    <p className={`text-xl font-bold mt-0.5 ${tile.color}`}>{tile.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{tile.hint}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {summary.estimated_hours > 0
                  ? `Трудозатраты: ${summary.done_hours} ч выполнено из ${summary.estimated_hours} ч по оценке.`
                  : 'Трудозатраты у задач не указаны.'}
                {summary.review > 0 && ` На проверке: ${summary.review}.`}
                {summary.open > 0 && ` В работе и в очереди: ${summary.open}.`}
                {summary.done_plan > 0 && ` Задач плана без отметки времени сдачи: ${summary.done_plan} — в долю «в срок» они не входят.`}
              </p>

              {/* Задачи */}
              {data.tasks.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">В этом проекте сотруднику не назначали задач.</p>
              ) : groups.map(group => (
                <div key={group} className="space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{group}</p>
                  {data.tasks.filter(t => t.group === group).map(task => {
                    const meta = TIMELINESS[task.timeliness] ?? TIMELINESS.open;
                    const Icon = meta.icon;
                    return (
                      <div key={task.id} className="flex items-start gap-3 p-2.5 bg-slate-800/30 border border-slate-800 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-200">{task.name}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {task.source === 'plan' ? 'План' : 'Процесс'}
                            {task.due && ` · срок ${formatDate(task.due)}`}
                            {task.finished && ` · сдано ${formatDate(task.finished)}`}
                            {task.estimated_hours > 0 && ` · ${task.estimated_hours} ч`}
                          </p>
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md border flex-shrink-0 ${meta.style}`}>
                          <Icon size={11} /> {meta.label}{task.late_hours ? ` ${lateLabel(task.late_hours)}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

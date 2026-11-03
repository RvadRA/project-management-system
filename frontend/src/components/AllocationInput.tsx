import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, Info, Sparkles } from 'lucide-react';
import api from '../api/client';

/** Ответ GET /projects/list/{id}/capacity/ — свободное время сотрудника за период */
export interface Capacity {
  start: string;
  end: string;
  period_days: number;
  working_days: number;
  unavailable_days: number;
  available_hours: number;
  avg_load_percent: number;
  peak_load_percent: number;
  /** Свободно на весь период (по самому занятому дню) */
  free_percent: number;
  free_hours: number;
  current_percent: number | null;
  /** Трудозатраты открытых задач сотрудника в этом проекте, ч */
  assigned_hours: number;
  unestimated_tasks: number;
  from_tasks_percent: number | null;
  recommended_percent: number;
}

interface Props {
  projectId: number | '';
  /** id учётной записи (user.id), не профиля */
  userId: number | '';
  start: string;
  end: string;
  onPeriodChange: (start: string, end: string) => void;
  value: number;
  onChange: (percent: number) => void;
  /** Узкая версия для карточек сравнения */
  compact?: boolean;
  /** Период задаётся задачей и не редактируется вручную */
  periodLocked?: boolean;
  /** false — за период нет подтверждённых записей WorkloadEntry */
  availabilityConfirmed?: boolean;
}

const clampPercent = (n: number) => Math.min(100, Math.max(5, Math.round(n / 5) * 5));

/**
 * Ввод «Загрузки на проект».
 *   Загрузка, % — доля рабочего времени сотрудника на период; 100% = полный рабочий день.
 *   Часы = % × рабочие часы периода (без выходных, праздников и отпусков сотрудника).
 * Сервер не даст назначить больше, чем свободно в самый занятый день периода.
 */
export default function AllocationInput({
  projectId, userId, start, end, onPeriodChange, value, onChange, compact, periodLocked,
  availabilityConfirmed,
}: Props) {
  // Ответ хранится вместе с ключом запроса: устаревший ответ для другого сотрудника не показывается
  const [response, setResponse] = useState<{ key: string; data: Capacity | null } | null>(null);
  const touched = useRef(false);

  const valid = Boolean(projectId && userId && !(start && end && end < start));
  const key = `${projectId}|${userId}|${start}|${end}`;
  const capacity = valid && response?.key === key ? response.data : null;
  const loading = valid && response?.key !== key;

  // Новый сотрудник или проект — подсказка снова может подставить значение
  useEffect(() => { touched.current = false; }, [projectId, userId]);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<Capacity>(`/projects/list/${projectId}/capacity/`, {
        params: { user_id: userId, start: start || undefined, end: end || undefined },
      })
        .then(res => {
          if (cancelled) return;
          setResponse({ key, data: res.data });
          if (!touched.current && availabilityConfirmed !== false && res.data.recommended_percent > 0) {
            onChange(clampPercent(res.data.recommended_percent));
          }
        })
        .catch(() => { if (!cancelled) setResponse({ key, data: null }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, valid, availabilityConfirmed]);

  const change = (percent: number) => {
    touched.current = true;
    onChange(Math.min(100, Math.max(1, Math.round(percent))));
  };

  const hours = capacity ? Math.round((value / 100) * capacity.available_hours * 10) / 10 : null;
  const overFree = capacity ? value > capacity.free_percent : false;
  const availabilityUnconfirmed = availabilityConfirmed === false;
  const fieldClass = 'w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500';

  return (
    <div className={`space-y-3 ${compact ? 'text-[10px]' : 'text-xs'}`}>
      {periodLocked ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300">
          <span className="text-[10px] text-slate-500 uppercase">Период задачи:</span>{' '}
          <span className="font-medium">{start || '—'} — {end || '—'}</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-slate-500 uppercase mb-1">С</label>
            <input type="date" value={start} onChange={e => onPeriodChange(e.target.value, end)} className={fieldClass} />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 uppercase mb-1">По</label>
            <input type="date" value={end} min={start || undefined} onChange={e => onPeriodChange(start, e.target.value)} className={fieldClass} />
          </div>
        </div>
      )}

      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Загрузка на этот проект</label>
          <span className="text-sm text-slate-100 font-bold tabular-nums">{value}%</span>
        </div>
        <input
          type="range" min={5} max={100} step={5}
          value={Math.min(100, Math.max(5, value))}
          onChange={e => change(Number(e.target.value))}
          className="w-full accent-emerald-500 cursor-pointer"
        />

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 flex-1">
            <Clock size={11} className="text-slate-500 flex-shrink-0" />
            <input
              type="number" min={0} step={1}
              value={hours ?? ''}
              disabled={!capacity || capacity.available_hours <= 0}
              onChange={e => capacity && capacity.available_hours > 0 && change((Number(e.target.value) / capacity.available_hours) * 100)}
              placeholder="—"
              className={`${fieldClass} w-20 text-center`}
            />
            <span className="text-slate-500">{availabilityUnconfirmed ? 'ч (расчёт)' : 'ч за период'}</span>
          </div>
          <div className="flex gap-1">
            {[25, 50, 100].map(p => (
              <button key={p} type="button" onClick={() => change(p)}
                className={`px-1.5 py-1 rounded border text-[10px] font-semibold transition-colors ${
                  value === p ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}>
                {p}%
              </button>
            ))}
          </div>
        </div>

        {loading && !capacity && <p className="text-slate-500">Считаем ёмкость периода…</p>}

        {capacity && (
          <div className="space-y-1.5 pt-1 border-t border-emerald-500/10">
            <p className={`flex items-start gap-1.5 ${
              availabilityUnconfirmed ? 'text-amber-300' : capacity.free_percent <= 0 ? 'text-red-400' : 'text-slate-400'
            }`}>
              <Info size={11} className="flex-shrink-0 mt-0.5" />
              <span>
                {availabilityUnconfirmed ? 'Расчётная ёмкость периода' : 'Свободно'}{' '}
                <b className="text-slate-200">{capacity.free_percent}%</b>
                {capacity.available_hours > 0 && <> (≈ {capacity.free_hours} ч из {capacity.available_hours} ч)</>}
                {' · '}рабочих дней: {capacity.working_days}
                {capacity.unavailable_days > 0 && <>, из них отпуск/больничный: {capacity.unavailable_days}</>}
                {capacity.peak_load_percent > 0 && <> · в самый занятый день занят на {capacity.peak_load_percent}%</>}
              </span>
            </p>

            {availabilityUnconfirmed && (
              <p className="flex items-start gap-1.5 text-amber-300">
                <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                <span>
                  За период нет записей WorkloadEntry. Показанная ёмкость рассчитана по календарю
                  и не является подтверждённой доступностью сотрудника.
                </span>
              </p>
            )}

            {availabilityConfirmed === true && (
              <p className="text-emerald-400/80">Загрузка подтверждена записями WorkloadEntry.</p>
            )}

            {capacity.from_tasks_percent !== null && (
              <button
                type="button"
                onClick={() => change(Math.min(capacity.from_tasks_percent!, capacity.free_percent))}
                className="flex items-start gap-1.5 text-left text-violet-300 hover:text-violet-200"
              >
                <Sparkles size={11} className="flex-shrink-0 mt-0.5" />
                <span>
                  По назначенным задачам: {capacity.assigned_hours} ч ≈ {capacity.from_tasks_percent}% — применить
                  {capacity.unestimated_tasks > 0 && ` (ещё у ${capacity.unestimated_tasks} часы не указаны)`}
                </span>
              </button>
            )}

            {availabilityConfirmed !== false && capacity.free_percent > 0 && capacity.recommended_percent !== value && (
              <button type="button" onClick={() => change(capacity.recommended_percent)}
                className="text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline">
                Рекомендуем {capacity.recommended_percent}%
                {capacity.from_tasks_percent === null ? ' (всё свободное время)' : ''}
              </button>
            )}

            {(overFree || capacity.free_percent <= 0) && (
              <p className="flex items-start gap-1.5 text-red-400 font-medium">
                <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                {capacity.free_percent <= 0
                  ? 'В этот период сотрудник полностью занят — назначение будет отклонено.'
                  : `Больше свободного (${capacity.free_percent}%) — назначение будет отклонено.`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

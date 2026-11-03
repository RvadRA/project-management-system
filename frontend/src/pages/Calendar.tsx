import { useState, useMemo } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Users,
  AlertTriangle, Clock, Briefcase, Flag, X, Info
} from 'lucide-react';
import { useAppContext, type Employee, type Project } from '../context/AppContext';
import { toDateKey } from '../utils/dates';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

/** Загрузка проектов в этих статусах сотрудника не занимает (как на сервере) */
const INACTIVE_PROJECT_STATUSES = ['COMPLETED', 'CANCELLED'];

/** Сетка месяца с понедельника: целые недели, дни соседних месяцев приглушены */
function getMonthGrid(year: number, month: number): Date[] {
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(year, month, 1 - startOffset + i));
}

const initials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

type Tone = 'free' | 'normal' | 'busy' | 'over';
const toneOf = (load: number): Tone => (load > 100 ? 'over' : load >= 80 ? 'busy' : load >= 50 ? 'normal' : 'free');

// Классы Tailwind записаны целиком, чтобы попасть в сборку
const TONE_DOT: Record<Tone, string> = {
  free: 'bg-emerald-500/70', normal: 'bg-violet-500/70', busy: 'bg-amber-500', over: 'bg-red-500',
};
const TONE_TEXT: Record<Tone, string> = {
  free: 'text-emerald-400', normal: 'text-slate-300', busy: 'text-amber-400', over: 'text-red-400',
};
const TONE_BAR: Record<Tone, string> = {
  free: 'bg-emerald-500', normal: 'bg-violet-500', busy: 'bg-amber-500', over: 'bg-red-500',
};
const TONE_CELL: Record<Tone, string> = {
  free: 'bg-emerald-500/[0.06]', normal: 'bg-slate-950', busy: 'bg-amber-500/[0.08]', over: 'bg-red-500/[0.10]',
};

interface EmpDay {
  emp: Employee;
  leave: { type_display: string; start_date: string; end_date: string } | null;
  load: number;
  projects: { name: string; load: number }[];
}

interface DayInfo {
  date: Date;
  key: string;
  inMonth: boolean;
  weekend: boolean;
  holiday: string | null;
  working: boolean;
  employees: EmpDay[];
  present: EmpDay[];
  avgLoad: number | null;
  freePeople: number;
  deadlines: Project[];
  starts: Project[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Calendar() {
  const { employees, projects, calendars } = useAppContext();
  const today = new Date();
  const todayKey = toDateKey(today);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<number>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Праздники берутся из календаря по умолчанию (иначе одна и та же дата из разных календарей дублировалась)
  const holidays = useMemo(() => {
    const source = calendars.find(c => c.is_default) ? [calendars.find(c => c.is_default)!] : calendars;
    const map = new Map<string, string>();
    source.forEach(cal => (cal.holidays || []).forEach(h => { if (!map.has(h.date)) map.set(h.date, h.name || 'Праздничный день'); }));
    return map;
  }, [calendars]);

  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);

  const filteredEmployees = useMemo(
    () => (selectedEmpIds.size === 0 ? employees : employees.filter(e => selectedEmpIds.has(e.id))),
    [employees, selectedEmpIds],
  );

  // Всё считаем один раз на месяц: по каждому дню — кто в отпуске, кто сколько загружен
  const days: DayInfo[] = useMemo(() => {
    return getMonthGrid(viewYear, viewMonth).map(date => {
      const key = toDateKey(date);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const holiday = holidays.get(key) ?? null;
      const working = !weekend && !holiday;

      const empDays: EmpDay[] = filteredEmployees.map(emp => {
        const leave = (emp.unavailability ?? []).find(u => u.start_date <= key && key <= u.end_date) ?? null;
        const entries = (emp.workload_entries ?? []).filter(e => {
          if (!(e.start_date <= key && key <= e.end_date)) return false;
          const project = e.project ? projectById.get(e.project) : null;
          return !(project && INACTIVE_PROJECT_STATUSES.includes(project.status));
        });
        return {
          emp, leave,
          load: entries.reduce((sum, e) => sum + e.load_percent, 0),
          projects: entries.map(e => ({
            name: (e.project ? projectById.get(e.project)?.name : null) ?? (e.note || 'Вне проектов'),
            load: e.load_percent,
          })),
        };
      });
      const present = working ? empDays.filter(d => !d.leave) : [];
      return {
        date, key, weekend, holiday, working,
        inMonth: date.getMonth() === viewMonth,
        employees: empDays,
        present,
        avgLoad: present.length ? Math.round(present.reduce((s, d) => s + d.load, 0) / present.length) : null,
        // «Свободные люди» — суммарная свободная ёмкость в человеко-днях, а не число людей с нулевой загрузкой
        freePeople: present.reduce((s, d) => s + Math.max(0, 100 - d.load), 0) / 100,
        deadlines: projects.filter(p => p.end_date === key && (p.status === 'ACTIVE' || p.status === 'AT_RISK')),
        starts: projects.filter(p => p.start_date === key && ['ACTIVE', 'AT_RISK', 'DRAFT'].includes(p.status)),
      };
    });
  }, [viewYear, viewMonth, filteredEmployees, holidays, projects, projectById]);

  const monthDays = days.filter(d => d.inMonth);

  // Итоги месяца и средняя загрузка каждого сотрудника (по рабочим дням без отпуска)
  const summary = useMemo(() => {
    const working = monthDays.filter(d => d.working && d.avgLoad !== null);
    const avg = working.length ? Math.round(working.reduce((s, d) => s + (d.avgLoad ?? 0), 0) / working.length) : null;
    const peak = working.reduce<DayInfo | null>((best, d) => (!best || (d.avgLoad ?? 0) > (best.avgLoad ?? 0) ? d : best), null);
    const leaveDays = monthDays.reduce((s, d) => s + (d.working ? d.employees.filter(e => e.leave).length : 0), 0);
    const deadlines = monthDays.reduce((s, d) => s + d.deadlines.length, 0);
    return { avg, peak, leaveDays, deadlines };
  }, [monthDays]);

  // Для боковой панели — средняя загрузка каждого сотрудника за месяц независимо от фильтра
  const empMonthLoad = useMemo(() => {
    const workingKeys = monthDays.filter(d => d.working).map(d => d.key);
    const map = new Map<number, number>();
    employees.forEach(emp => {
      const values = workingKeys
        .filter(key => !(emp.unavailability ?? []).some(u => u.start_date <= key && key <= u.end_date))
        .map(key => (emp.workload_entries ?? [])
          .filter(e => e.start_date <= key && key <= e.end_date)
          .filter(e => {
            const project = e.project ? projectById.get(e.project) : null;
            return !(project && INACTIVE_PROJECT_STATUSES.includes(project.status));
          })
          .reduce((s, e) => s + e.load_percent, 0));
      map.set(emp.id, values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0);
    });
    return map;
  }, [employees, monthDays, projectById]);

  const absences = useMemo(() => {
    const monthStart = toDateKey(new Date(viewYear, viewMonth, 1));
    const monthEnd = toDateKey(new Date(viewYear, viewMonth + 1, 0));
    const list: { emp: Employee; u: Employee['unavailability'][number] }[] = [];
    filteredEmployees.forEach(emp => {
      (emp.unavailability ?? []).forEach(u => {
        if (u.start_date <= monthEnd && u.end_date >= monthStart) list.push({ emp, u });
      });
    });
    return list.sort((a, b) => a.u.start_date.localeCompare(b.u.start_date));
  }, [filteredEmployees, viewYear, viewMonth]);

  const monthDeadlines = useMemo(
    () => monthDays.flatMap(d => d.deadlines.map(p => ({ p, key: d.key }))).filter((x, i, arr) => arr.findIndex(y => y.p.id === x.p.id) === i),
    [monthDays],
  );

  function prevMonth() {
    setSelectedKey(null);
    if (viewMonth === 0) { setViewMonth(11); setViewYear(v => v - 1); } else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    setSelectedKey(null);
    if (viewMonth === 11) { setViewMonth(0); setViewYear(v => v + 1); } else setViewMonth(m => m + 1);
  }

  const toggleEmp = (id: number) => {
    setSelectedEmpIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedDay = selectedKey ? days.find(d => d.key === selectedKey) ?? null : null;

  return (
    <div className="flex h-full bg-slate-950">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Users size={16} className="text-violet-400" /> Фильтр сотрудников
            </h2>
            {selectedEmpIds.size > 0 && (
              <button onClick={() => setSelectedEmpIds(new Set())} className="text-[10px] font-bold text-violet-400 hover:text-violet-300">Сбросить</button>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {selectedEmpIds.size === 0 ? 'Все сотрудники' : `Выбрано: ${selectedEmpIds.size}`} · загрузка — средняя за {MONTH_NAMES[viewMonth].toLowerCase()}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          {employees.map(emp => {
            const load = empMonthLoad.get(emp.id) ?? 0;
            const tone = toneOf(load);
            return (
              <button
                key={emp.id}
                onClick={() => toggleEmp(emp.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left border ${
                  selectedEmpIds.has(emp.id)
                    ? 'bg-violet-600/20 border-violet-500/40 text-white'
                    : selectedEmpIds.size === 0
                    ? 'bg-slate-800/30 border-slate-800/50 text-slate-300 hover:bg-slate-800/60'
                    : 'bg-slate-900/50 border-slate-800/30 text-slate-500 hover:bg-slate-800/30'
                }`}
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                  {initials(emp.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate">{emp.full_name}</p>
                  <p className="text-[9px] text-slate-500 truncate">{emp.position}</p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-800 ${TONE_TEXT[tone]}`}>{load}%</span>
              </button>
            );
          })}
        </div>

        {/* Absences */}
        <div className="border-t border-slate-800 px-4 py-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Clock size={10} /> Отсутствия в {MONTH_NAMES[viewMonth].toLowerCase()}е
          </p>
          {absences.length === 0 ? (
            <p className="text-[10px] text-slate-600 italic">Нет отсутствий</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {absences.map(({ emp, u }, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-amber-500/5 border border-amber-500/15 rounded-lg">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                    {initials(emp.full_name)}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-amber-300">{emp.full_name.split(' ')[0]}</p>
                    <p className="text-[9px] text-slate-500">{u.type_display}</p>
                    <p className="text-[9px] text-slate-600">{u.start_date} — {u.end_date}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Project deadlines */}
        {monthDeadlines.length > 0 && (
          <div className="border-t border-slate-800 px-4 py-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Briefcase size={10} /> Дедлайны проектов
            </p>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {monthDeadlines.map(({ p, key }) => (
                <div key={p.id} className="flex items-start gap-2 p-2 bg-red-500/5 border border-red-500/15 rounded-lg">
                  <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-semibold text-red-300 leading-tight">{p.name}</p>
                    <p className="text-[9px] text-slate-500">{key}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main calendar */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="px-8 py-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <CalendarDays size={24} className="text-violet-400" />
              Календарь ресурсов
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">Загрузка команды по дням, отпуска и сроки проектов</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelectedKey(todayKey); }}
              className="text-xs font-medium px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              Сегодня
            </button>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button onClick={prevMonth} aria-label="Предыдущий месяц" className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="px-4 py-2 text-sm font-bold text-white min-w-[160px] text-center">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
              <button onClick={nextMonth} aria-label="Следующий месяц" className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Month summary + legend */}
        <div className="px-8 py-2.5 border-b border-slate-800 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-5 text-[11px] text-slate-400">
            <span>Средняя загрузка: <b className={summary.avg === null ? 'text-slate-500' : TONE_TEXT[toneOf(summary.avg)]}>{summary.avg === null ? '—' : `${summary.avg}%`}</b></span>
            {summary.peak && summary.peak.avgLoad !== null && (
              <span>Пик: <b className="text-slate-200">{summary.peak.date.getDate()} {MONTH_NAMES[viewMonth].slice(0, 3).toLowerCase()}.</b> ({summary.peak.avgLoad}%)</span>
            )}
            <span>Дней отпуска/больничных: <b className="text-slate-200">{summary.leaveDays}</b></span>
            <span>Дедлайнов: <b className="text-slate-200">{summary.deadlines}</b></span>
          </div>
          <div className="flex items-center gap-4">
            {[
              { color: 'bg-emerald-500/70', label: 'до 50%' },
              { color: 'bg-violet-500/70', label: '50–80%' },
              { color: 'bg-amber-500', label: '80–100%' },
              { color: 'bg-red-500', label: 'перегруз' },
              { color: 'bg-slate-600', label: 'отпуск' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                <span className="text-[10px] text-slate-500">{l.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5"><Flag size={10} className="text-red-400" /><span className="text-[10px] text-slate-500">дедлайн</span></div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-slate-800">
              {DAY_NAMES.map((d, i) => (
                <div key={d} className={`py-2 text-center text-[11px] font-bold uppercase tracking-wider ${i >= 5 ? 'text-slate-600' : 'text-slate-500'}`}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-7 auto-rows-fr min-h-full">
                {days.map(day => {
                  const tone = day.avgLoad === null ? null : toneOf(day.avgLoad);
                  const isToday = day.key === todayKey;
                  const isSelected = day.key === selectedKey;
                  const leaveCount = day.working ? day.employees.filter(e => e.leave).length : 0;
                  return (
                    <button
                      key={day.key}
                      onClick={() => setSelectedKey(isSelected ? null : day.key)}
                      className={`relative text-left border-b border-r border-slate-800/50 p-2 transition-colors min-h-[112px] hover:bg-slate-900/80 ${
                        !day.inMonth ? 'bg-slate-900/30 opacity-40'
                        : day.holiday ? 'bg-blue-500/[0.06]'
                        : day.weekend ? 'bg-slate-900/50'
                        : tone ? TONE_CELL[tone] : 'bg-slate-950'
                      } ${isSelected ? 'ring-2 ring-inset ring-violet-500' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${
                          isToday ? 'bg-violet-600 text-white' : day.weekend || day.holiday ? 'text-slate-600' : 'text-slate-300'
                        }`}>
                          {day.date.getDate()}
                        </span>
                        {day.inMonth && day.weekend && !day.holiday && (
                          <span className="text-[8px] text-slate-700 font-bold uppercase">выходной</span>
                        )}
                      </div>

                      {day.holiday && (
                        <div className="mb-1 text-[9px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded truncate border border-blue-500/20" title={day.holiday}>
                          🎉 {day.holiday}
                        </div>
                      )}

                      {day.deadlines.length > 0 && (
                        <div className="mb-1 space-y-0.5">
                          {day.deadlines.map(p => (
                            <div key={p.id} className="text-[9px] bg-red-500/15 text-red-300 px-1.5 py-0.5 rounded truncate border border-red-500/20 flex items-center gap-1" title={`Дедлайн: ${p.name}`}>
                              <Flag size={8} className="flex-shrink-0" /> {p.name}
                            </div>
                          ))}
                        </div>
                      )}
                      {day.starts.length > 0 && (
                        <div className="mb-1 space-y-0.5">
                          {day.starts.map(p => (
                            <div key={p.id} className="text-[9px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded truncate border border-emerald-500/20" title={`Старт: ${p.name}`}>
                              ▶ {p.name}
                            </div>
                          ))}
                        </div>
                      )}

                      {day.inMonth && day.employees.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {day.employees.slice(0, 12).map(({ emp, leave, load }) => (
                            <div
                              key={emp.id}
                              title={`${emp.full_name} — ${leave ? leave.type_display : day.working ? `загрузка ${load}%` : 'нерабочий день'}`}
                              className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white border border-white/10 ${
                                leave ? 'bg-slate-600' : day.working ? TONE_DOT[toneOf(load)] : 'bg-slate-800'
                              }`}
                            >
                              {initials(emp.full_name)}
                            </div>
                          ))}
                          {day.employees.length > 12 && <span className="text-[8px] text-slate-600">+{day.employees.length - 12}</span>}
                        </div>
                      )}

                      {day.inMonth && day.working && day.avgLoad !== null && (
                        <div className="mt-1.5 space-y-0.5">
                          <div className="flex items-center justify-between text-[9px]">
                            <span className={`font-semibold ${TONE_TEXT[toneOf(day.avgLoad)]}`}>{day.avgLoad}%</span>
                            <span className="text-slate-500">
                              {day.freePeople >= 0.05 ? `своб. ${day.freePeople.toFixed(1).replace('.', ',')}` : 'нет свободных'}
                            </span>
                          </div>
                          {leaveCount > 0 && <p className="text-[9px] text-slate-500">в отпуске: {leaveCount}</p>}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Day details */}
          {selectedDay && (
            <aside className="w-80 flex-shrink-0 border-l border-slate-800 bg-slate-900 overflow-y-auto custom-scrollbar">
              <div className="p-5 border-b border-slate-800 flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-white">
                    {selectedDay.date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {selectedDay.holiday ? `Праздник: ${selectedDay.holiday}` : selectedDay.weekend ? 'Выходной день' : 'Рабочий день'}
                    {selectedDay.working && selectedDay.avgLoad !== null && ` · средняя загрузка ${selectedDay.avgLoad}%`}
                  </p>
                </div>
                <button onClick={() => setSelectedKey(null)} className="text-slate-500 hover:text-white" aria-label="Закрыть"><X size={16} /></button>
              </div>

              <div className="p-5 space-y-5">
                {(selectedDay.deadlines.length > 0 || selectedDay.starts.length > 0) && (
                  <div className="space-y-1.5">
                    {selectedDay.deadlines.map(p => (
                      <p key={`d${p.id}`} className="text-xs text-red-300 flex items-center gap-1.5"><Flag size={12} /> Дедлайн проекта «{p.name}»</p>
                    ))}
                    {selectedDay.starts.map(p => (
                      <p key={`s${p.id}`} className="text-xs text-emerald-300">▶ Старт проекта «{p.name}»</p>
                    ))}
                  </div>
                )}

                {!selectedDay.working && (
                  <p className="text-xs text-slate-500 flex items-start gap-1.5">
                    <Info size={12} className="flex-shrink-0 mt-0.5" /> В нерабочий день загрузка не учитывается, отпуска показаны для справки.
                  </p>
                )}

                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Сотрудники ({selectedDay.employees.length})</p>
                  {[...selectedDay.employees]
                    .sort((a, b) => Number(!!a.leave) - Number(!!b.leave) || b.load - a.load)
                    .map(({ emp, leave, load, projects: entries }) => {
                      const tone = toneOf(load);
                      return (
                        <div key={emp.id} className="p-2.5 bg-slate-800/30 border border-slate-800 rounded-lg">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-200 truncate">{emp.full_name}</p>
                            {leave ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">{leave.type_display}</span>
                            ) : selectedDay.working ? (
                              <span className={`text-[11px] font-bold flex-shrink-0 ${TONE_TEXT[tone]}`}>{load}%</span>
                            ) : null}
                          </div>
                          {leave ? (
                            <p className="text-[10px] text-slate-500 mt-1">{leave.start_date} — {leave.end_date}</p>
                          ) : selectedDay.working && (
                            <>
                              <div className="h-1 bg-slate-700 rounded-full overflow-hidden mt-1.5">
                                <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${Math.min(100, load)}%` }} />
                              </div>
                              {entries.length > 0 ? (
                                <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                                  {entries.map(e => `${e.name} ${e.load}%`).join(' · ')}
                                </p>
                              ) : (
                                <p className="text-[10px] text-emerald-500/80 mt-1.5">Свободен</p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

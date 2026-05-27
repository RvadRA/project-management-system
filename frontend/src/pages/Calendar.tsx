import { useState, useMemo } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Users,
  AlertTriangle, Clock, Briefcase
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Pad to Monday start
  const startDow = (first.getDay() + 6) % 7; // 0=Mon
  for (let i = 0; i < startDow; i++) {
    days.push(new Date(year, month, -startDow + i + 1));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  // Pad to complete last row
  while (days.length % 7 !== 0) {
    days.push(new Date(year, month + 1, days.length - last.getDate() - startDow + 1));
  }
  return days;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dateInRange(d: Date, start: string, end: string): boolean {
  const dt = d.getTime();
  return dt >= new Date(start).getTime() && dt <= new Date(end).getTime();
}

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
];
const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Calendar() {
  const { employees, projects, calendars } = useAppContext();
  const today = new Date();

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<number>>(new Set());
  const [hoveredDay, setHoveredDay] = useState<Date | null>(null);

  // All calendar holidays flat list
  const allHolidays = useMemo(() =>
    calendars.flatMap(cal => (cal.holidays || []).map(h => ({ ...h, calendarName: cal.name }))),
    [calendars]
  );

  // Active projects (with deadlines)
  const activeProjects = useMemo(() =>
    projects.filter(p => p.end_date && (p.status === 'ACTIVE' || p.status === 'AT_RISK')),
    [projects]
  );

  // Filtered employees
  const filteredEmployees = useMemo(() =>
    selectedEmpIds.size === 0
      ? employees
      : employees.filter(e => selectedEmpIds.has(e.id)),
    [employees, selectedEmpIds]
  );

  // Compute day info
  const days = useMemo(() => getDaysInMonth(viewYear, viewMonth), [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(v => v - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(v => v + 1); }
    else setViewMonth(m => m + 1);
  }

  // Who's unavailable on a given day
  function getUnavailableEmployees(day: Date) {
    return filteredEmployees.filter(emp =>
      emp.unavailability.some(u => dateInRange(day, u.start_date, u.end_date))
    );
  }

  // Projects ending on this day
  function getProjectDeadlines(day: Date) {
    return activeProjects.filter(p => p.end_date && sameDay(new Date(p.end_date), day));
  }

  // Holidays on this day
  function getHolidays(day: Date) {
    return allHolidays.filter(h => sameDay(new Date(h.date), day));
  }

  // Is weekend
  function isWeekend(day: Date) {
    return day.getDay() === 0 || day.getDay() === 6;
  }

  // Is current month
  function isCurrentMonth(day: Date) {
    return day.getMonth() === viewMonth && day.getFullYear() === viewYear;
  }

  // Upcoming absences this month
  const upcomingAbsences = useMemo(() => {
    const monthStart = new Date(viewYear, viewMonth, 1);
    const monthEnd = new Date(viewYear, viewMonth + 1, 0);
    const results: { emp: typeof employees[0]; u: typeof employees[0]['unavailability'][0] }[] = [];
    filteredEmployees.forEach(emp => {
      emp.unavailability.forEach(u => {
        const uStart = new Date(u.start_date);
        const uEnd = new Date(u.end_date);
        if (uStart <= monthEnd && uEnd >= monthStart) {
          results.push({ emp, u });
        }
      });
    });
    return results.sort((a, b) => new Date(a.u.start_date).getTime() - new Date(b.u.start_date).getTime());
  }, [filteredEmployees, viewYear, viewMonth]);

  // Project deadlines this month
  const monthDeadlines = useMemo(() => {
    const monthStart = new Date(viewYear, viewMonth, 1).getTime();
    const monthEnd = new Date(viewYear, viewMonth + 1, 0).getTime();
    return activeProjects.filter(p => {
      if (!p.end_date) return false;
      const d = new Date(p.end_date).getTime();
      return d >= monthStart && d <= monthEnd;
    });
  }, [activeProjects, viewYear, viewMonth]);

  const toggleEmp = (id: number) => {
    setSelectedEmpIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full bg-slate-950">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-slate-800 bg-slate-900 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Users size={16} className="text-violet-400" /> Фильтр сотрудников
          </h2>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {selectedEmpIds.size === 0 ? 'Все сотрудники' : `Выбрано: ${selectedEmpIds.size}`}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
          {employees.map(emp => {
            const load = emp.current_workload_percentage;
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
                  {emp.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate">{emp.full_name}</p>
                  <p className="text-[9px] text-slate-500 truncate">{emp.position}</p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  load > 90 ? 'bg-red-500/20 text-red-400' :
                  load > 70 ? 'bg-amber-500/20 text-amber-400' :
                  'bg-emerald-500/20 text-emerald-400'
                }`}>{load}%</span>
              </button>
            );
          })}
        </div>

        {/* Upcoming absences */}
        <div className="border-t border-slate-800 px-4 py-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Clock size={10} /> Отсутствия в {MONTH_NAMES[viewMonth]}
          </p>
          {upcomingAbsences.length === 0 ? (
            <p className="text-[10px] text-slate-600 italic">Нет отсутствий</p>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {upcomingAbsences.map(({ emp, u }, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-amber-500/5 border border-amber-500/15 rounded-lg">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                    {emp.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
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
            <div className="space-y-2">
              {monthDeadlines.map(p => (
                <div key={p.id} className="flex items-start gap-2 p-2 bg-red-500/5 border border-red-500/15 rounded-lg">
                  <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-semibold text-red-300 leading-tight">{p.name}</p>
                    <p className="text-[9px] text-slate-500">{p.end_date}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main calendar */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <CalendarDays size={24} className="text-violet-400" />
                Календарь ресурсов
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">Доступность команды и дедлайны проектов</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
              className="text-xs font-medium px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              Сегодня
            </button>
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <button onClick={prevMonth} className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <span className="px-4 py-2 text-sm font-bold text-white min-w-[160px] text-center">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
              <button onClick={nextMonth} className="p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="px-8 py-2 border-b border-slate-800 flex items-center gap-6">
          {[
            { color: 'bg-violet-500', label: 'Доступен' },
            { color: 'bg-amber-500', label: 'В отпуске/отсутствует' },
            { color: 'bg-red-500', label: 'Дедлайн проекта' },
            { color: 'bg-blue-500', label: 'Праздник' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
              <span className="text-[10px] text-slate-500">{l.label}</span>
            </div>
          ))}
        </div>

        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-slate-800">
          {DAY_NAMES.map((d, i) => (
            <div
              key={d}
              className={`py-2 text-center text-[11px] font-bold uppercase tracking-wider ${
                i >= 5 ? 'text-slate-600' : 'text-slate-500'
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-7 h-full">
            {days.map((day, idx) => {
              const unavailEmps = getUnavailableEmployees(day);
              const deadlines = getProjectDeadlines(day);
              const holidays = getHolidays(day);
              const isWE = isWeekend(day);
              const isCurMonth = isCurrentMonth(day);
              const isToday = sameDay(day, today);
              const isHovered = hoveredDay && sameDay(day, hoveredDay);

              const availableCount = holidays.length > 0 ? 0 : filteredEmployees.length - unavailEmps.length;
              const isHoliday = holidays.length > 0;

              return (
                <div
                  key={idx}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  className={`relative border-b border-r border-slate-800/50 p-2 transition-colors min-h-[110px] ${
                    !isCurMonth ? 'bg-slate-900/30 opacity-40' :
                    isWE ? 'bg-slate-900/50' : 'bg-slate-950'
                  } ${isHovered && isCurMonth ? 'bg-slate-900/80' : ''}`}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                      isToday
                        ? 'bg-violet-600 text-white'
                        : isWE
                        ? 'text-slate-600'
                        : 'text-slate-300'
                    }`}>
                      {day.getDate()}
                    </span>
                    {/* Weekend badge */}
                    {isWE && isCurMonth && (
                      <span className="text-[8px] text-slate-700 font-bold uppercase">
                        {day.getDay() === 6 ? 'Сб' : 'Вс'}
                      </span>
                    )}
                  </div>

                  {/* Holiday indicator */}
                  {holidays.length > 0 && (
                    <div className="mb-1">
                      {holidays.map((h, hi) => (
                        <div key={hi} className="text-[9px] bg-blue-500/15 text-blue-300 px-1.5 py-0.5 rounded truncate border border-blue-500/20">
                          🎉 {h.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Project deadlines */}
                  {deadlines.length > 0 && (
                    <div className="mb-1 space-y-0.5">
                      {deadlines.map(p => (
                        <div key={p.id} className="text-[9px] bg-red-500/15 text-red-300 px-1.5 py-0.5 rounded truncate border border-red-500/20 flex items-center gap-1">
                          <AlertTriangle size={8} className="flex-shrink-0" />
                          {p.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Employee availability dots */}
                  {isCurMonth && filteredEmployees.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1">
                      {filteredEmployees.slice(0, 12).map(emp => {
                        const isUnavail = unavailEmps.some(e => e.id === emp.id);
                        return (
                          <div
                            key={emp.id}
                            title={`${emp.full_name}${isUnavail ? ' — отсутствует' : ' — доступен'}`}
                            className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white transition-transform hover:scale-150 border border-white/10 ${
                              isUnavail ? 'bg-amber-500' : 'bg-violet-500/60'
                            }`}
                          >
                            {emp.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                          </div>
                        );
                      })}
                      {filteredEmployees.length > 12 && (
                        <span className="text-[8px] text-slate-600">+{filteredEmployees.length - 12}</span>
                      )}
                    </div>
                  )}

                  {/* Availability summary */}
                  {isCurMonth && !isWE && filteredEmployees.length > 0 && (
                    <div className="mt-1">
                      <span className={`text-[9px] font-medium ${
                        availableCount === 0 ? 'text-red-400' :
                        availableCount < filteredEmployees.length * 0.5 ? 'text-amber-400' :
                        'text-emerald-400'
                      }`}>
                        {isHoliday ? (
                          <span className="text-blue-400">Выходной день</span>
                        ) : (
                          <>
                            {availableCount}/{filteredEmployees.length} свободны
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

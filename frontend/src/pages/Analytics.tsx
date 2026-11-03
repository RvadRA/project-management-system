import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart3, TrendingUp, Users,
  Target, Download, Filter, ChevronDown, AlertTriangle, Info
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, Cell, PieChart, Pie, ReferenceLine
} from 'recharts';
import api from '../api/client';
import { useAppContext, type AnalyticsData } from '../context/AppContext';
import { exportSectionsToPDF } from '../utils/exportPdf';
import { daysBetween, formatDate, parseLocalDate, startOfToday } from '../utils/dates';
import { HEALTH_META, expectedProgress, forecastProject, projectHealth, type Health } from '../utils/projectHealth';

const PERIODS = [
  { days: 30, label: '30 дн.' },
  { days: 90, label: '3 мес.' },
  { days: 180, label: '6 мес.' },
  { days: 365, label: 'Год' },
];

/** Оптимальная средняя загрузка команды: ниже — простой, выше — риск перегруза */
const IDEAL_LOAD = 75;
const NO_DOMAIN = 'Без домена';

interface TooltipEntry { color?: string; name?: string; value?: number | string }
interface TooltipProps { active?: boolean; payload?: { payload?: Record<string, unknown>; color?: string; name?: string; value?: number | string }[]; label?: string }

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl">
        <p className="text-sm font-semibold text-white mb-2">{label}</p>
        {(payload as TooltipEntry[]).map((entry, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-300">{entry.name}:</span>
            <span className="font-medium text-white">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const DomainTooltip = ({ active, payload }: TooltipProps) => {
  const row = payload?.[0]?.payload as { name: string; load: number; emp_count: number; overloaded: number; free: number } | undefined;
  if (!active || !row) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs space-y-1">
      <p className="text-sm font-semibold text-white mb-1">{row.name}</p>
      <p className="text-slate-300">Средняя загрузка: <b className="text-white">{row.load}%</b></p>
      <p className="text-slate-300">Сотрудников: <b className="text-white">{row.emp_count}</b></p>
      <p className="text-slate-300">Перегружены (&gt;90%): <b className="text-red-400">{row.overloaded}</b></p>
      <p className="text-slate-300">Свободны (&lt;50%): <b className="text-emerald-400">{row.free}</b></p>
    </div>
  );
};

// Классы Tailwind должны быть записаны целиком — собранные из переменных не попадут в сборку
const LOAD_TONES = {
  red: { text: 'text-red-400', bar: 'bg-red-500', badge: 'bg-red-500/10 text-red-400 border-red-500/20' },
  amber: { text: 'text-amber-400', bar: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  emerald: { text: 'text-emerald-400', bar: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
};
const loadTone = (load: number) => (load > 100 ? LOAD_TONES.red : load >= 80 ? LOAD_TONES.amber : LOAD_TONES.emerald);

export default function Analytics() {
  const { employees, projects, domains } = useAppContext();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showAllMatrix, setShowAllMatrix] = useState(false);
  // Скрытые домены: по умолчанию показано всё, включая проекты с доменом вне справочника
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLDivElement>(null);

  // Период реально влияет на выборку: сервер пересчитывает динамику задач и загрузку
  useEffect(() => {
    let cancelled = false;
    api.get<AnalyticsData>('/projects/dashboard/', { params: { days } })
      .then(res => { if (!cancelled) { setData(res.data); setLoadError(false); } })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [days]);

  const domainOf = (value: string | null | undefined) => value || NO_DOMAIN;

  // Все домены: справочник + встречающиеся в проектах, у сотрудников и в статистике загрузки
  const allDomains = useMemo(() => {
    const names = new Set<string>(domains.map(d => d.name));
    projects.forEach(p => names.add(domainOf(p.domain)));
    employees.forEach(e => names.add(domainOf(e.domain)));
    data?.domain_stats.forEach(d => names.add(domainOf(d.domain)));
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [domains, projects, employees, data]);

  const visible = useCallback((domain: string | null | undefined) => !hiddenDomains.has(domainOf(domain)), [hiddenDomains]);
  const filteredProjects = useMemo(() => projects.filter(p => visible(p.domain)), [projects, visible]);
  const filteredEmployees = useMemo(() => employees.filter(e => visible(e.domain)), [employees, visible]);
  const activeProjects = useMemo(
    () => filteredProjects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK'),
    [filteredProjects],
  );

  const domainLoad = useMemo(
    () => (data?.domain_stats ?? [])
      .filter(d => visible(d.domain))
      .map(d => ({ name: domainOf(d.domain), load: Math.round(d.avg_load), emp_count: d.emp_count, overloaded: d.overloaded, free: d.free })),
    [data, visible],
  );

  // Статусы не пересекаются, поэтому сумма секторов всегда равна числу активных проектов
  const healthData = useMemo(() => {
    const counts: Record<Health, number> = { ok: 0, behind: 0, risk: 0, overdue: 0 };
    activeProjects.forEach(p => { counts[projectHealth(p)] += 1; });
    return (['ok', 'behind', 'risk', 'overdue'] as Health[])
      .map(h => ({ key: h, name: HEALTH_META[h].label, value: counts[h], color: HEALTH_META[h].color }))
      .filter(item => item.value > 0);
  }, [activeProjects]);

  const avgProgress = activeProjects.length
    ? Math.round(activeProjects.reduce((sum, p) => sum + p.progress_percentage, 0) / activeProjects.length)
    : null;

  const stats = [
    { label: 'Проектов', value: filteredProjects.length, hint: 'в выбранных областях', icon: Target, color: 'text-violet-400' },
    { label: 'Активных', value: activeProjects.length, hint: 'в работе или с рисками', icon: TrendingUp, color: 'text-emerald-400' },
    { label: 'Сотрудников', value: filteredEmployees.length, hint: 'в выбранных областях', icon: Users, color: 'text-blue-400' },
    { label: 'Ср. прогресс', value: avgProgress === null ? '—' : `${avgProgress}%`, hint: 'активных проектов', icon: BarChart3, color: 'text-amber-400' },
  ];

  // Закрываем выпадающий фильтр по клику снаружи
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleDomain = (name: string) => {
    setHiddenDomains(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (allDomains.length - next.size > 1) next.add(name);   // хотя бы одна область остаётся
      return next;
    });
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    // Give React time to re-render with fixed dimensions for capture
    setTimeout(async () => {
      try {
        await exportSectionsToPDF(
          ['analytics-kpi', 'analytics-charts', 'analytics-domain', 'analytics-staff', 'analytics-timeline', 'analytics-forecast', 'analytics-productivity', 'analytics-competency'],
          'analytics-report',
          `Аналитический отчёт — ${new Date().toLocaleDateString('ru-RU')}`
        );
      } catch (err) {
        console.error('Export failed:', err);
      } finally {
        setIsExporting(false);
      }
    }, 500);
  };

  const trend = data?.performance_trend ?? [];
  const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days} дн.`;
  const hiddenCount = hiddenDomains.size;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 size={24} className="text-violet-400" /> Аналитика
          </h1>
          <p className="text-sm text-slate-400 mt-1">Ключевые показатели эффективности и загрузка команды</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex" role="group" aria-label="Период динамики задач">
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setDays(p.days)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${days === p.days ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Filters dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilters(v => !v)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              <Filter size={16} /> Области{hiddenCount > 0 && <span className="text-violet-400">({allDomains.length - hiddenCount}/{allDomains.length})</span>}
              <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            {showFilters && (
              <div className="absolute right-0 top-full mt-2 w-60 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Области (домены)</p>
                  {hiddenCount > 0 && (
                    <button onClick={() => setHiddenDomains(new Set())} className="text-[10px] font-bold text-violet-400 hover:text-violet-300">Все</button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto mb-2 pr-1">
                  {allDomains.map(name => (
                    <label key={name} className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:text-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={!hiddenDomains.has(name)}
                        onChange={() => toggleDomain(name)}
                        className="w-4 h-4 rounded border-slate-600 text-violet-500 focus:ring-violet-500 bg-slate-700"
                      />
                      <span className="text-sm text-slate-300">{name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed">Фильтр применяется к проектам, сотрудникам и загрузке. Динамика задач считается по всем доступным проектам.</p>
              </div>
            )}
          </div>

          <button onClick={handleExportPDF}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg shadow-violet-500/20 transition-colors">
            <Download size={16} /> {isExporting ? 'Экспорт...' : 'Экспорт PDF'}
          </button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-8">
        <h1 className="text-2xl font-bold text-black border-b pb-2">
          Отчёт по аналитике — {periodLabel} ({new Date().toLocaleDateString('ru-RU')})
        </h1>
      </div>

      {loadError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300 flex items-center gap-2">
          <AlertTriangle size={14} /> Не удалось загрузить динамику задач и загрузку по областям. Остальные показатели рассчитаны по данным проектов.
        </div>
      )}

      {/* KPI cards */}
      <div id="analytics-kpi" className="space-y-3">
        <div className="grid grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors print:border-slate-300 print:bg-white">
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-xl bg-slate-800/50 flex items-center justify-center print:hidden`}>
                  <stat.icon size={20} className={stat.color} />
                </div>
              </div>
              <p className="text-2xl font-bold text-white print:text-black">{stat.value}</p>
              <p className="text-sm text-slate-300 mt-1 print:text-gray-600">{stat.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{stat.hint}</p>
            </div>
          ))}
        </div>
        {data && (
          <p className="text-xs text-slate-500 px-1">
            Задачи процессов (все доступные проекты): выполнено <b className="text-slate-300">{data.kpis.tasks_done}</b> из <b className="text-slate-300">{data.kpis.tasks_total}</b>
            {' · '}просрочено <b className={data.kpis.tasks_overdue > 0 ? 'text-red-400' : 'text-slate-300'}>{data.kpis.tasks_overdue}</b>
            {' · '}взвешенный прогресс <b className="text-slate-300">{data.kpis.avg_progress}%</b>
          </p>
        )}
      </div>

      {/* Charts */}
      <div id="analytics-charts" className="grid grid-cols-3 gap-6">
        {/* Area chart */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col print:border-slate-300 print:bg-white">
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-white print:text-black">Динамика выполнения задач · {periodLabel}</h2>
            <p className="text-xs text-slate-500 mt-1">
              План — задачи со сроком в этот {data?.period?.bucket === 'week' ? 'период (неделя)' : 'день'}, факт — завершённые
            </p>
          </div>
          <div className="flex-1 min-h-[300px] w-full">
            {trend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">Нет данных за выбранный период</div>
            ) : (
              <ResponsiveContainer width={isExporting ? 1200 : "100%"} height={isExporting ? 500 : "100%"}>
                <AreaChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorPlanned" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--slate-600)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="var(--slate-600)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="period" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                  <Area type="monotone" dataKey="planned" name="План" stroke="var(--slate-600)" strokeWidth={2} fillOpacity={1} fill="url(#colorPlanned)" />
                  <Area type="monotone" dataKey="actual" name="Факт" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorActual)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie chart */}
        <div className="col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col print:border-slate-300 print:bg-white">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-white print:text-black">Статус проектов</h2>
            <p className="text-xs text-slate-500 mt-1">Активные проекты по состоянию относительно плана</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center relative min-h-[300px]">
            {activeProjects.length === 0 ? (
              <p className="text-sm text-slate-500">Нет активных проектов</p>
            ) : (
              <>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
                  <span className="text-3xl font-bold text-white print:text-black">{activeProjects.length}</span>
                  <span className="text-xs text-slate-500">Всего</span>
                </div>
                <ResponsiveContainer width={isExporting ? 400 : "100%"} height={250}>
                  <PieChart>
                    <Pie data={healthData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" stroke="none">
                      {healthData.map(entry => <Cell key={entry.key} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="w-full space-y-2 mt-4 px-2">
                  {healthData.map(item => (
                    <div key={item.key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="block w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                        <span className="text-slate-300 print:text-gray-700">{item.name}</span>
                      </div>
                      <span className="font-semibold text-white print:text-black">{item.value} ({Math.round(item.value / activeProjects.length * 100)}%)</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Bar chart */}
        <div id="analytics-domain" className="col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-5 print:border-slate-300 print:bg-white mt-6 break-inside-avoid">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-sm font-semibold text-white print:text-black">Загрузка областей (доменов)</h2>
              <p className="text-xs text-slate-500 mt-1">
                Средняя текущая занятость сотрудников области, свободные тоже учтены · оптимум {IDEAL_LOAD}% · показано областей: {domainLoad.length}
              </p>
            </div>
          </div>
          <div className="h-[250px] w-full">
            {domainLoad.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">Нет сотрудников в выбранных областях</div>
            ) : (
              <ResponsiveContainer width={isExporting ? 1200 : "100%"} height={isExporting ? 300 : "100%"}>
                <BarChart data={domainLoad} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} domain={[0, (max: number) => Math.max(100, max)]} unit="%" />
                  <Tooltip content={<DomainTooltip />} cursor={{ fill: 'var(--slate-800)', opacity: 0.4 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                  <ReferenceLine y={IDEAL_LOAD} stroke="#64748b" strokeDasharray="5 4" label={{ value: `норма ${IDEAL_LOAD}%`, fill: '#64748b', fontSize: 11, position: 'insideTopRight' }} />
                  <Bar dataKey="load" name="Загрузка %" radius={[4, 4, 0, 0]}>
                    {domainLoad.map((entry, index) => (
                      <Cell key={index} fill={entry.load > 90 ? '#ef4444' : entry.load > IDEAL_LOAD ? '#f59e0b' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Competency report */}
      <div id="analytics-staff" className="bg-slate-900 border border-slate-800 rounded-xl p-6 print:border-slate-300 print:bg-white">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white print:text-black">Компетенции и доступность персонала</h2>
          <p className="text-xs text-slate-500 mt-0.5">Текущая загрузка и топ-навыки · сначала самые загруженные</p>
        </div>
        <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
          {[...filteredEmployees].sort((a, b) => b.current_workload_percentage - a.current_workload_percentage).map(emp => {
            const load = emp.current_workload_percentage;
            const tone = loadTone(load);
            const topSkills = emp.skills.slice(0, 3).map(s => s.skill.name);
            return (
              <div key={emp.id} className="flex items-center gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {emp.user.full_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{emp.user.full_name}</p>
                  <p className="text-xs text-slate-500 truncate">{emp.position || 'Должность не указана'} · {domainOf(emp.domain)}</p>
                </div>
                <div className="hidden md:flex gap-1 flex-wrap max-w-[200px]">
                  {topSkills.map(s => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 bg-violet-500/10 text-violet-400 rounded font-medium">{s}</span>
                  ))}
                  {emp.skills.length > 3 && <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">+{emp.skills.length - 3}</span>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="w-20">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-slate-500">Загрузка</span>
                      <span className={`font-semibold ${tone.text}`}>{load}%</span>
                    </div>
                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${tone.bar}`} style={{ width: `${Math.min(load, 100)}%` }} />
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${tone.badge}`}>
                    {load > 100 ? 'Перегружен' : load >= 80 ? 'Занят' : 'Доступен'}
                  </span>
                </div>
              </div>
            );
          })}
          {filteredEmployees.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Нет сотрудников в выбранных областях</p>
          )}
        </div>
      </div>

      {/* Timeline Deviations */}
      <div id="analytics-timeline" className="bg-slate-900 border border-slate-800 rounded-xl p-6 print:border-slate-300 print:bg-white">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white print:text-black">Отклонения по срокам</h2>
          <p className="text-xs text-slate-500 mt-0.5">Состояние активных проектов относительно срока и календарного плана</p>
        </div>
        <div className="space-y-3">
          {activeProjects.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Нет активных проектов</p>
          )}
          {activeProjects.map(p => {
            const health = projectHealth(p);
            const end = parseLocalDate(p.end_date);
            const daysLeft = end ? daysBetween(startOfToday(), end) : null;
            const meta = HEALTH_META[health];
            return (
              <div key={p.id} className="flex items-center gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-800">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {domainOf(p.domain)} · До {end ? formatDate(end) : 'не указано'}
                    {daysLeft !== null && p.progress_percentage < 100 && (
                      <span className={`ml-2 font-medium ${daysLeft < 0 ? 'text-red-400' : daysLeft < 7 ? 'text-red-400' : daysLeft < 30 ? 'text-amber-400' : 'text-slate-500'}`}>
                        ({daysLeft >= 0 ? `осталось ${daysLeft} дн.` : `просрочено на ${Math.abs(daysLeft)} дн.`})
                      </span>
                    )}
                  </p>
                </div>
                <div className="w-32 flex-shrink-0">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-slate-500">Прогресс</span>
                    <span className="text-slate-300 font-semibold">{p.progress_percentage}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${p.progress_percentage}%`, backgroundColor: health === 'ok' ? '#8b5cf6' : meta.color }} />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${meta.badge}`}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Project Forecast ─────────────────────────────────────────────────── */}
      <div id="analytics-forecast" className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white">Прогноз выполнения проектов</h2>
          <p className="text-xs text-slate-500 mt-0.5">Дата завершения при текущем темпе: прошедшие дни ÷ доля выполненной работы</p>
        </div>
        {activeProjects.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">Нет активных проектов</p>
        )}
        <div className="space-y-4">
          {activeProjects.map(p => {
            const expected = expectedProgress(p);
            const isBehind = expected !== null && p.progress_percentage < expected - 10;
            const forecast = forecastProject(p);

            return (
              <div key={p.id} className="p-4 bg-slate-800/30 rounded-xl border border-slate-800">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-sm font-bold text-white">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {expected !== null ? `По плану: ${expected}% · ` : ''}Факт: {p.progress_percentage}%
                    </p>
                  </div>
                  {expected !== null && (
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 ${
                      isBehind ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {isBehind && <AlertTriangle size={10} />}
                      {isBehind ? 'ОТСТАЁТ' : 'В ГРАФИКЕ'}
                    </span>
                  )}
                </div>
                <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden mb-2">
                  {expected !== null && <div className="absolute h-full bg-slate-600/80 rounded-full" style={{ width: `${expected}%` }} />}
                  <div className={`absolute h-full rounded-full transition-all ${isBehind ? 'bg-red-500' : 'bg-violet-500'}`} style={{ width: `${p.progress_percentage}%` }} />
                </div>
                <p className="text-[10px] text-slate-500">
                  {forecast.kind === 'estimate' && (
                    <>
                      Прогноз завершения: <span className="text-slate-300 font-medium">{formatDate(forecast.end)}</span>
                      {forecast.delayDays > 0 && <span className="text-red-400 ml-2 font-bold">+{forecast.delayDays} дн. задержки</span>}
                      {forecast.delayDays < 0 && <span className="text-emerald-400 ml-2 font-bold">{Math.abs(forecast.delayDays)} дн. опережения</span>}
                      {forecast.delayDays === 0 && <span className="text-emerald-400 ml-2 font-bold">точно в срок</span>}
                      {!forecast.reliable && (
                        <span className="ml-2 inline-flex items-center gap-1 text-slate-500"><Info size={10} /> оценка ненадёжна: мало данных</span>
                      )}
                    </>
                  )}
                  {forecast.kind === 'no-dates' && 'Прогноз недоступен: у проекта не заданы сроки'}
                  {forecast.kind === 'not-started' && 'Проект ещё не начался'}
                  {forecast.kind === 'no-data' && 'Прогноз недоступен: выполненной работы пока нет'}
                  {forecast.kind === 'done' && 'Проект выполнен'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Team Productivity ─────────────────────────────────────────────────── */}
      <div id="analytics-productivity" className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white">Выработка команды</h2>
          <p className="text-xs text-slate-500 mt-0.5">Доля выполненных задач от всех назначенных сотруднику</p>
        </div>
        {filteredEmployees.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">Нет данных о сотрудниках</p>
        )}
        <div className="grid grid-cols-1 gap-2">
          {filteredEmployees
            .filter(emp => emp.total_tasks > 0)
            .sort((a, b) => (b.completed_tasks / Math.max(1, b.total_tasks)) - (a.completed_tasks / Math.max(1, a.total_tasks)))
            .slice(0, 15)
            .map(emp => {
              const productivity = Math.round((emp.completed_tasks / Math.max(1, emp.total_tasks)) * 100);
              return (
                <div key={emp.id} className="flex items-center gap-3 p-2.5 bg-slate-800/20 rounded-lg">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {emp.full_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate">{emp.full_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            productivity > 80 ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                            : productivity > 50 ? 'bg-gradient-to-r from-violet-500 to-indigo-500'
                            : 'bg-gradient-to-r from-amber-500 to-orange-500'
                          }`}
                          style={{ width: `${productivity}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">
                        {emp.completed_tasks}/{emp.total_tasks}
                      </span>
                    </div>
                  </div>
                  <span className={`text-sm font-bold flex-shrink-0 ${
                    productivity > 80 ? 'text-emerald-400'
                    : productivity > 50 ? 'text-violet-400'
                    : 'text-amber-400'
                  }`}>
                    {productivity}%
                  </span>
                </div>
              );
            })}
          {filteredEmployees.filter(e => e.total_tasks === 0).length > 0 && (
            <p className="text-[10px] text-slate-600 text-center pt-2">
              +{filteredEmployees.filter(e => e.total_tasks === 0).length} сотрудников без задач
            </p>
          )}
        </div>
      </div>

      {/* ─── Competency Matrix ─────────────────────────────────────────────────── */}
      <div id="analytics-competency" className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white">Матрица компетенций</h2>
          <p className="text-xs text-slate-500 mt-0.5">Уровни навыков сотрудников (8 самых распространённых навыков)</p>
        </div>
        {filteredEmployees.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Нет данных</p>
        ) : (() => {
          const skillFreq: Record<number, { name: string; count: number }> = {};
          filteredEmployees.forEach(emp => {
            emp.skills.forEach(es => {
              if (!skillFreq[es.skill.id]) skillFreq[es.skill.id] = { name: es.skill.name, count: 0 };
              skillFreq[es.skill.id].count++;
            });
          });
          const topSkills = Object.entries(skillFreq)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 8)
            .map(([id, v]) => ({ id: Number(id), name: v.name }));
          const visibleEmps = showAllMatrix || isExporting ? filteredEmployees : filteredEmployees.slice(0, 12);

          return (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider">Сотрудник</th>
                    {topSkills.map(skill => (
                      <th key={skill.id} className="px-2 py-2 text-[9px] text-slate-500 uppercase text-center max-w-[60px]">
                        <span className="block truncate" title={skill.name}>{skill.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleEmps.map(emp => (
                    <tr key={emp.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                            {emp.full_name.charAt(0)}
                          </div>
                          <span className="text-xs text-white truncate max-w-[100px]" title={emp.full_name}>
                            {emp.full_name.split(' ')[0]}
                          </span>
                        </div>
                      </td>
                      {topSkills.map(skill => {
                        const es = emp.skills.find(s => s.skill.id === skill.id);
                        const level = es?.level_score ?? 0;
                        return (
                          <td key={skill.id} className="px-2 py-2 text-center">
                            {level > 0 ? (
                              <div className="flex gap-0.5 justify-center" title={`Уровень ${level} из 5`}>
                                {[1,2,3,4,5].map(i => (
                                  <div
                                    key={i}
                                    className={`w-2 h-2 rounded-sm transition-colors ${
                                      i <= level
                                        ? level >= 4 ? 'bg-emerald-500' : level >= 3 ? 'bg-violet-500' : 'bg-blue-500'
                                        : 'bg-slate-700'
                                    }`}
                                  />
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-700">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEmployees.length > 12 && !isExporting && (
                <button onClick={() => setShowAllMatrix(v => !v)} className="block mx-auto text-[11px] font-bold text-violet-400 hover:text-violet-300 mt-3">
                  {showAllMatrix ? 'Свернуть' : `Показать всех (ещё ${filteredEmployees.length - 12})`}
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

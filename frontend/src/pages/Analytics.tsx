import { useState, useRef, useEffect, useMemo } from 'react';
import {
  BarChart3, TrendingUp, Users,
  Target, Download, Filter, ChevronDown, AlertTriangle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, Cell, PieChart, Pie
} from 'recharts';
import { useAppContext } from '../context/AppContext';
import { exportSectionsToPDF } from '../utils/exportPdf';

// Time series data mock is removed as we now use real backend data from AppContext

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl">
        <p className="text-sm font-semibold text-white mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
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

export default function Analytics() {
  const { employees, projects, analytics, domains } = useAppContext();
  const [timeframe, setTimeframe] = useState('1M');
  const [isExporting, setIsExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  // Compute ALL_DOMAINS from global domains list, merged with backend stats
  const allDomainsData = useMemo(() => {
    const statsMap = new Map(analytics?.domain_stats?.map(d => [d.domain, d]) || []);
    
    return domains.map(d => {
      const stats = statsMap.get(d.name);
      return {
        name: d.name,
        load: stats ? Math.round(stats.avg_load ?? 0) : 0,
        ideal: 75
      };
    });
  }, [analytics?.domain_stats, domains]);

  const [activeDomainsFilter, setActiveDomainsFilter] = useState<Set<string>>(new Set(allDomainsData.map(d => d.name)));
  
  // Only init once
  useEffect(() => {
    if (activeDomainsFilter.size === 0 && allDomainsData.length > 0) {
      setActiveDomainsFilter(new Set(allDomainsData.map(d => d.name)));
    }
  }, [allDomainsData]);

  const filterRef = useRef<HTMLDivElement>(null);

  const performanceData = useMemo(() => analytics?.performance_trend ?? [], [analytics]);
  const domainLoad = useMemo(() => allDomainsData.filter(d => activeDomainsFilter.has(d.name)), [allDomainsData, activeDomainsFilter]);

  // Compute Project Health
  const activeProjects = useMemo(() => projects.filter(p => 
    (p.status === 'ACTIVE' || p.status === 'AT_RISK') &&
    activeDomainsFilter.has(p.domain)
  ), [projects, activeDomainsFilter]);
  
  const projectHealth = useMemo(() => {
    const onTrack = activeProjects.filter(p => p.status === 'ACTIVE').length;
    const atRisk = activeProjects.filter(p => p.status === 'AT_RISK').length;
    const delayed = activeProjects.filter(p => {
        const isOverdue = p.end_date ? new Date(p.end_date) < new Date() : false;
        return isOverdue && p.progress_percentage < 100;
    }).length;

    return [
      { name: 'В графике', value: onTrack || 0, color: '#10b981' },
      { name: 'Есть риски', value: atRisk || 0, color: '#f59e0b' },
      { name: 'Отстают', value: delayed || 0, color: '#ef4444' },
    ].filter(v => v.value > 0 || v.name === 'В графике');
  }, [activeProjects]);

  // Real KPI stats from backend
  const stats = useMemo(() => [
    { label: 'Всего проектов', value: analytics?.kpis?.total_projects ?? projects.length, icon: Target, color: 'text-violet-400' },
    { label: 'Активных', value: projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').length, icon: TrendingUp, color: 'text-emerald-400' },
    { label: 'Команда', value: analytics?.kpis?.total_employees ?? employees.length, icon: Users, color: 'text-blue-400' },
    { label: 'Ср. прогресс', value: `${analytics?.kpis?.avg_progress ?? 0}%`, icon: BarChart3, color: 'text-amber-400' },
  ], [analytics, projects, employees]);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 size={24} className="text-violet-400" /> Аналитика
          </h1>
          <p className="text-sm text-slate-400 mt-1">Ключевые показатели эффективности и загрузка компании</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Timeframe toggle */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex">
            {['1M', '6M'].map(t => (
              <button key={t} onClick={() => setTimeframe(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${timeframe === t ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {t}
              </button>
            ))}
          </div>

          {/* Filters dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setShowFilters(v => !v)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
            >
              <Filter size={16} /> Фильтры <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            {showFilters && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-xl z-20 p-3">
                <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Области (Домены)</p>
                <div className="max-h-60 overflow-y-auto mb-2 pr-1">
                  {allDomainsData.map(d => (
                    <label key={d.name} className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:text-slate-200 transition-colors">
                      <input
                        type="checkbox"
                        checked={activeDomainsFilter.has(d.name)}
                        onChange={() => {
                          setActiveDomainsFilter(prev => {
                            const next = new Set(prev);
                            if (next.has(d.name)) { if (next.size > 1) next.delete(d.name); }
                            else next.add(d.name);
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded border-slate-600 text-violet-500 focus:ring-violet-500 bg-slate-700"
                      />
                      <span className="text-sm text-slate-300">{d.name}</span>
                    </label>
                  ))}
                </div>
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
          Отчёт по аналитике — {timeframe} ({new Date().toLocaleDateString('ru-RU')})
        </h1>
      </div>

      {/* KPI cards */}
      <div id="analytics-kpi" className="grid grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors print:border-slate-300 print:bg-white">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-10 h-10 rounded-xl bg-slate-800/50 flex items-center justify-center print:hidden`}>
                <stat.icon size={20} className={stat.color} />
              </div>
            </div>
            <p className="text-2xl font-bold text-white print:text-black">{stat.value}</p>
            <p className="text-sm text-slate-300 mt-1 print:text-gray-600">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div id="analytics-charts" className="grid grid-cols-3 gap-6">
        {/* Area chart */}
        <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col print:border-slate-300 print:bg-white">
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-white print:text-black">Динамика выполнения задач</h2>
            <p className="text-xs text-slate-500 mt-1">Сравнение плановых и фактических показателей</p>
          </div>
          <div className="flex-1 min-h-[300px] w-full">
            <ResponsiveContainer width={isExporting ? 1200 : "100%"} height={isExporting ? 500 : "100%"}>
              <AreaChart data={performanceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPlanned" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#334155" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#334155" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="period" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                <Area type="monotone" dataKey="planned" name="План" stroke="#475569" strokeWidth={2} fillOpacity={1} fill="url(#colorPlanned)" />
                <Area type="monotone" dataKey="actual" name="Факт" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorActual)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie chart */}
        <div className="col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col print:border-slate-300 print:bg-white">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-white print:text-black">Статус проектов</h2>
            <p className="text-xs text-slate-500 mt-1">Распределение по уровню риска</p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center relative min-h-[300px]">
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
              <span className="text-3xl font-bold text-white print:text-black">{activeProjects.length}</span>
              <span className="text-xs text-slate-500">Всего</span>
            </div>
            <ResponsiveContainer width={isExporting ? 400 : "100%"} height={250}>
              <PieChart>
                <Pie data={projectHealth} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" stroke="none">
                  {projectHealth.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="w-full space-y-2 mt-4 px-2">
              {projectHealth.map(item => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="block w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                    <span className="text-slate-300 print:text-gray-700">{item.name}</span>
                  </div>
                  <span className="font-semibold text-white print:text-black">{item.value} ({Math.round(item.value / (activeProjects.length || 1) * 100)}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bar chart */}
        <div id="analytics-domain" className="col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-5 print:border-slate-300 print:bg-white mt-6 break-inside-avoid">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-sm font-semibold text-white print:text-black">Загрузка областей (Доменов)</h2>
              <p className="text-xs text-slate-500 mt-1">
                Относительно оптимальной нормы (75%) · {activeDomainsFilter.size} из {allDomainsData.length} областей
              </p>
            </div>
          </div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width={isExporting ? 1200 : "100%"} height={isExporting ? 300 : "100%"}>
              <BarChart data={domainLoad} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b', opacity: 0.4 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                <Bar dataKey="load" name="Загрузка %" radius={[4, 4, 0, 0]}>
                  {domainLoad.map((entry, index) => (
                    <Cell key={index} fill={entry.load > 90 ? '#ef4444' : entry.load > 75 ? '#f59e0b' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Competency report */}
      <div id="analytics-staff" className="bg-slate-900 border border-slate-800 rounded-xl p-6 print:border-slate-300 print:bg-white">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white print:text-black">Компетенции и доступность персонала</h2>
          <p className="text-xs text-slate-500 mt-0.5">Загрузка и топ-навыки каждого сотрудника</p>
        </div>
        <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
          {employees.map(emp => {
            const load = emp.current_workload_percentage;
            const available = load < 80;
            const topSkills = emp.skills.slice(0, 3).map(s => s.skill.name);
            return (
              <div key={emp.id} className="flex items-center gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {emp.user.full_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{emp.user.full_name}</p>
                  <p className="text-xs text-slate-500 truncate">{emp.position} · {emp.domain}</p>
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
                      <span className={`font-semibold ${load > 90 ? 'text-red-400' : load > 75 ? 'text-amber-400' : 'text-emerald-400'}`}>{load}%</span>
                    </div>
                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${load > 90 ? 'bg-red-500' : load > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(load, 100)}%` }} />
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                    available
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {available ? 'Доступен' : 'Занят'}
                  </span>
                </div>
              </div>
            );
          })}
          {employees.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Данные об авторах отсутствуют</p>
          )}
        </div>
      </div>

      {/* Timeline Deviations */}
      <div id="analytics-timeline" className="bg-slate-900 border border-slate-800 rounded-xl p-6 print:border-slate-300 print:bg-white">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white print:text-black">Отклонения по срокам</h2>
          <p className="text-xs text-slate-500 mt-0.5">Анализ прогресса активных проектов и прогноз выполнения</p>
        </div>
        <div className="space-y-3">
          {activeProjects.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">Нет активных проектов</p>
          )}
          {activeProjects.map(p => {
            const isOverdue = p.end_date ? new Date(p.end_date) < new Date() : false;
            const daysLeft = p.end_date
              ? Math.round((new Date(p.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null;
            const risk = p.status === 'AT_RISK' ? 'risk' : isOverdue ? 'delayed' : 'ok';
            return (
              <div key={p.id} className="flex items-center gap-4 p-3 bg-slate-800/30 rounded-lg border border-slate-800">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {p.domain} · До {p.end_date ?? 'не указано'}
                    {daysLeft !== null && (
                      <span className={`ml-2 font-medium ${daysLeft < 7 ? 'text-red-400' : daysLeft < 30 ? 'text-amber-400' : 'text-slate-500'}`}>
                        ({daysLeft > 0 ? `осталось ${daysLeft} дн.` : `просрочено на ${Math.abs(daysLeft)} дн.`})
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
                    <div
                      className={`h-full rounded-full transition-all ${risk === 'delayed' ? 'bg-red-500' : risk === 'risk' ? 'bg-amber-500' : 'bg-violet-500'}`}
                      style={{ width: `${p.progress_percentage}%` }}
                    />
                  </div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${
                  risk === 'delayed' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : risk === 'risk' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}>
                  {risk === 'delayed' ? 'Просрочен' : risk === 'risk' ? 'Есть риск' : 'В графике'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Project Forecast ─────────────────────────────────────────────────── */}
      <div id="analytics-forecast" className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white">Прогноз выполнения проектов</h2>
          <p className="text-xs text-slate-500 mt-0.5">Отставание план/факт и расчётная дата завершения</p>
        </div>
        {activeProjects.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">Нет активных проектов</p>
        )}
        <div className="space-y-4">
          {activeProjects.map(p => {
            const startDate = p.start_date ? new Date(p.start_date) : new Date();
            const endDate = p.end_date ? new Date(p.end_date) : new Date(Date.now() + 30 * 86400000);
            const totalDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / 86400000);
            const daysElapsed = (Date.now() - startDate.getTime()) / 86400000;
            const expectedProgress = Math.min(100, Math.max(0, Math.round((daysElapsed / totalDays) * 100)));
            const isBehind = p.progress_percentage < expectedProgress - 10;
            const ratio = p.progress_percentage > 0 ? totalDays / (p.progress_percentage / 100) : totalDays * 2;
            const forecastEnd = new Date(startDate.getTime() + ratio * 86400000);
            const delayDays = Math.round((forecastEnd.getTime() - endDate.getTime()) / 86400000);

            return (
              <div key={p.id} className="p-4 bg-slate-800/30 rounded-xl border border-slate-800">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-sm font-bold text-white">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      По плану: {expectedProgress}% · Факт: {p.progress_percentage}%
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 ${
                    isBehind ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  }`}>
                    {isBehind && <AlertTriangle size={10} />}
                    {isBehind ? 'ОТСТАЁТ' : 'В ГРАФИКЕ'}
                  </span>
                </div>
                <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden mb-2">
                  <div className="absolute h-full bg-slate-600/80 rounded-full" style={{ width: `${expectedProgress}%` }} />
                  <div className={`absolute h-full rounded-full transition-all ${
                    isBehind ? 'bg-red-500' : 'bg-violet-500'
                  }`} style={{ width: `${p.progress_percentage}%` }} />
                </div>
                <p className="text-[10px] text-slate-500">
                  Прогноз завершения: <span className="text-slate-300 font-medium">{forecastEnd.toLocaleDateString('ru-RU')}</span>
                  {delayDays > 0 && (
                    <span className="text-red-400 ml-2 font-bold">+{delayDays} дн. задержки</span>
                  )}
                  {delayDays < 0 && (
                    <span className="text-emerald-400 ml-2 font-bold">{Math.abs(delayDays)} дн. опережения</span>
                  )}
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
          <p className="text-xs text-slate-500 mt-0.5">Процент выполненных задач по каждому сотруднику</p>
        </div>
        {employees.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">Нет данных о сотрудниках</p>
        )}
        <div className="grid grid-cols-1 gap-2">
          {employees
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
          {employees.filter(e => e.total_tasks === 0).length > 0 && (
            <p className="text-[10px] text-slate-600 text-center pt-2">
              +{employees.filter(e => e.total_tasks === 0).length} сотрудников без задач
            </p>
          )}
        </div>
      </div>

      {/* ─── Competency Matrix ─────────────────────────────────────────────────── */}
      <div id="analytics-competency" className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-white">Матрица компетенций</h2>
          <p className="text-xs text-slate-500 mt-0.5">Уровни навыков сотрудников (топ-8 навыков)</p>
        </div>
        {employees.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Нет данных</p>
        ) : (() => {
          const skillFreq: Record<number, { name: string; count: number }> = {};
          employees.forEach(emp => {
            emp.skills.forEach(es => {
              if (!skillFreq[es.skill.id]) skillFreq[es.skill.id] = { name: es.skill.name, count: 0 };
              skillFreq[es.skill.id].count++;
            });
          });
          const topSkills = Object.entries(skillFreq)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 8)
            .map(([id, v]) => ({ id: Number(id), name: v.name }));
          const visibleEmps = employees.slice(0, 12);

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
                              <div className="flex gap-0.5 justify-center">
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
              {employees.length > 12 && (
                <p className="text-[10px] text-slate-600 text-center mt-3">+{employees.length - 12} сотрудников не показаны</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
import { useMemo, useState } from 'react';
import {
  Search, Package, ArrowRight, Clock, Plus, Eye, Trash2, X, ListTree,
  Users as UsersIcon, Link2, Timer, TrendingUp, Layers
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useAppContext, type PlanningBlock, type PlanningTask } from '../context/AppContext';
import TransferWizard from '../components/TransferWizard';
import { niceConfirm } from '../utils/confirm';

const COMPLEXITY: Record<string, { label: string; style: string }> = {
  LOW: { label: 'Низкая', style: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  MEDIUM: { label: 'Средняя', style: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  HIGH: { label: 'Высокая', style: 'bg-red-500/10 text-red-400 border-red-500/20' },
  CRITICAL: { label: 'Критическая', style: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

const hoursLabel = (h: number) => (h > 0 ? `${h % 1 === 0 ? h : h.toFixed(1)} ч` : 'не оценены');

/** Задача пакета со вложенными подзадачами */
function TaskTree({ tasks, depth = 0 }: { tasks: PlanningTask[]; depth?: number }) {
  return (
    <ul className="space-y-1.5">
      {tasks.map(task => (
        <li key={task.id}>
          <div className="flex items-start gap-3 p-2.5 bg-slate-800/30 border border-slate-800 rounded-lg" style={{ marginLeft: depth * 18 }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200">{task.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {task.duration_days} дн.
                {task.start_offset_days > 0 && ` · старт +${task.start_offset_days} дн.`}
                {' · '}{hoursLabel(task.estimated_hours || 0)}
                {(task.required_roles?.length ?? 0) > 0 && ` · ${task.required_roles!.map(r => r.role.name).join(', ')}`}
              </p>
            </div>
            {(task.incoming_dependencies?.length ?? 0) > 0 && (
              <span className="text-[9px] text-slate-500 flex items-center gap-1 flex-shrink-0" title="Зависит от других задач">
                <Link2 size={9} /> {task.incoming_dependencies!.length}
              </span>
            )}
          </div>
          {(task.subtasks?.length ?? 0) > 0 && <div className="mt-1.5"><TaskTree tasks={task.subtasks!} depth={depth + 1} /></div>}
        </li>
      ))}
    </ul>
  );
}

export default function PlanningCatalog() {
  const { planningBlocks, domains, projects, saveBlockAsTemplate, refreshData, extractError } = useAppContext();
  const [search, setSearch] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedComplexity, setSelectedComplexity] = useState('');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<PlanningBlock | null>(null);
  const [detailPackage, setDetailPackage] = useState<PlanningBlock | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const templates = useMemo(() => planningBlocks.filter(b => b.is_template && !b.parent), [planningBlocks]);
  // Сохранять в каталог можно корневые этапы проектов — вложенные войдут вместе с ними
  const projectBlocks = useMemo(() => planningBlocks.filter(b => !b.is_template && b.project && !b.parent), [planningBlocks]);

  // У пакетов свои домены (Backend, Mobile…), не обязательно совпадающие со справочником доменов проектов
  const domainOptions = useMemo(
    () => [...new Set([...templates.map(t => t.domain).filter(Boolean), ...domains.map(d => d.name)])].sort((a, b) => a.localeCompare(b, 'ru')),
    [templates, domains],
  );

  const filtered = useMemo(() => templates.filter(b => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || b.name.toLowerCase().includes(q) || (b.domain || '').toLowerCase().includes(q)
      || (b.stats?.roles ?? []).some(r => r.toLowerCase().includes(q));
    return matchesSearch
      && (!selectedDomain || b.domain === selectedDomain)
      && (!selectedComplexity || b.complexity === selectedComplexity);
  }), [templates, search, selectedDomain, selectedComplexity]);

  const handleUsePackage = (pkg: PlanningBlock) => {
    setSelectedPackage(pkg);
    setIsWizardOpen(true);
  };

  const handleSaveAsTemplate = async (block: PlanningBlock) => {
    setSaving(true);
    try {
      await saveBlockAsTemplate(block.id, newName.trim() || undefined);
      setIsCreateModalOpen(false);
      setNewName('');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg: PlanningBlock) => {
    const used = pkg.analytics?.usage_count ?? 0;
    const note = used > 0 ? `\n\nУже созданные из него этапы в проектах останутся, но потеряют связь с пакетом.` : '';
    if (!await niceConfirm(`Удалить пакет «${pkg.name}» из каталога?${note}`)) return;
    try {
      await api.delete(`/projects/blocks/${pkg.id}/`);
      toast.success('Пакет удалён из каталога');
      setDetailPackage(null);
      await refreshData();
    } catch (err) {
      toast.error(extractError(err, 'Не удалось удалить пакет'));
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Package className="text-violet-500" size={32} />
            Каталог пакетов планирования
          </h1>
          <p className="text-slate-400 mt-2">Библиотека готовых этапов и WBS-шаблонов для быстрого старта проектов</p>
        </div>
        <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-2 text-center">
          <p className="text-[10px] uppercase font-bold text-violet-400 tracking-wider">Всего шаблонов</p>
          <p className="text-xl font-bold text-white">{templates.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800 backdrop-blur-md">
        <div className="relative col-span-1 md:col-span-2">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск по названию, домену или роли..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition-all"
          />
        </div>
        <select
          value={selectedDomain}
          onChange={e => setSelectedDomain(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-violet-500"
        >
          <option value="">Все домены</option>
          {domainOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select
          value={selectedComplexity}
          onChange={e => setSelectedComplexity(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-violet-500"
        >
          <option value="">Любая сложность</option>
          <option value="LOW">Низкая</option>
          <option value="MEDIUM">Средняя</option>
          <option value="HIGH">Высокая</option>
          <option value="CRITICAL">Критическая</option>
        </select>
      </div>

      {filtered.length === 0 && templates.length > 0 && (
        <p className="text-center text-sm text-slate-500 py-6">По фильтрам ничего не найдено</p>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(pkg => {
          const stats = pkg.stats;
          const usage = pkg.analytics;
          const complexity = COMPLEXITY[pkg.complexity];
          const duration = stats?.span_days || pkg.avg_duration || 0;
          return (
            <div key={pkg.id} className="group bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-violet-500/50 transition-all duration-300 flex flex-col shadow-xl hover:shadow-violet-500/5">
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-violet-500/10 rounded-xl text-violet-400 group-hover:scale-110 transition-transform">
                    <Package size={24} />
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border uppercase ${complexity?.style ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                    Сложность: {complexity?.label ?? pkg.complexity}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-violet-400 transition-colors">{pkg.name}</h3>
                <p className="text-xs text-slate-500 mb-5">{pkg.domain || 'Без домена'}{(pkg.children?.length ?? 0) > 0 && ` · вложенных этапов: ${pkg.children!.length}`}</p>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Clock size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Длительность</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-200">{duration > 0 ? `${duration} дн.` : '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Timer size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Трудозатраты</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-200">{hoursLabel(stats?.estimated_hours ?? 0)}</p>
                  </div>
                </div>

                <div className="space-y-2.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Задач в пакете:</span>
                    <span className="text-slate-300 font-bold">{stats?.task_count ?? 0}{(stats?.dependency_count ?? 0) > 0 && <span className="text-slate-500 font-normal"> · связей {stats!.dependency_count}</span>}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Типичные риски:</span>
                    <span className="text-slate-300 font-bold">{pkg.typical_risks?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 flex items-center gap-1"><TrendingUp size={11} /> Использован в проектах:</span>
                    <span className="text-slate-300 font-bold">
                      {usage?.usage_count ?? 0} {(usage?.usage_count ?? 0) > 0 && usage?.completed_count !== undefined && (
                        <span className="text-slate-500 font-normal">· выполнено {usage.completed_count}</span>
                      )}
                    </span>
                  </div>
                  {usage?.avg_actual_duration != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Фактическая длительность:</span>
                      <span className="text-slate-300 font-bold">~{usage.avg_actual_duration} дн.</span>
                    </div>
                  )}
                </div>

                {(stats?.roles.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {stats!.roles.slice(0, 4).map(role => (
                      <span key={role} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">{role}</span>
                    ))}
                    {stats!.roles.length > 4 && <span className="text-[9px] text-slate-500">+{stats!.roles.length - 4}</span>}
                  </div>
                )}
              </div>

              <div className="p-4 bg-slate-800/30 border-t border-slate-800 flex items-center gap-2">
                <button
                  onClick={() => setDetailPackage(pkg)}
                  className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl transition-colors"
                  title="Состав пакета"
                >
                  <Eye size={16} />
                </button>
                <button
                  onClick={() => handleUsePackage(pkg)}
                  className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-violet-500/10 active:scale-[0.98]"
                >
                  Использовать пакет <ArrowRight size={16} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Create Custom Package Button */}
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="border-2 border-dashed border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center group hover:border-violet-500/30 transition-colors bg-transparent min-h-[280px]"
        >
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-4 group-hover:bg-violet-500/10 group-hover:text-violet-400 transition-colors">
            <Plus size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-300 mb-1">Создать свой пакет</h3>
          <p className="text-xs text-slate-500 px-4">Сохраните этап проекта (с подзадачами, ролями и зависимостями) как шаблон для будущего использования</p>
        </button>
      </div>

      {/* Состав пакета */}
      {detailPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setDetailPackage(null)}>
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2"><ListTree size={18} className="text-violet-400" /> {detailPackage.name}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {detailPackage.domain || 'Без домена'} · {detailPackage.stats?.task_count ?? 0} задач · {detailPackage.stats?.span_days ?? 0} дн. · {hoursLabel(detailPackage.stats?.estimated_hours ?? 0)}
                </p>
              </div>
              <button onClick={() => setDetailPackage(null)} className="text-slate-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
              {(detailPackage.stats?.roles.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><UsersIcon size={11} /> Нужные роли</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detailPackage.stats!.roles.map(role => (
                      <span key={role} className="text-xs px-2 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">{role}</span>
                    ))}
                  </div>
                </div>
              )}

              {(detailPackage.typical_risks?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Типичные риски</p>
                  <ul className="space-y-1">
                    {detailPackage.typical_risks!.map(risk => (
                      <li key={risk.id} className="text-xs text-slate-400">• {risk.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Задачи</p>
                {(detailPackage.tasks?.length ?? 0) > 0
                  ? <TaskTree tasks={detailPackage.tasks!} />
                  : <p className="text-sm text-slate-500">В пакете нет задач.</p>}
              </div>

              {(detailPackage.children?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Layers size={11} /> Вложенные этапы</p>
                  <div className="space-y-4">
                    {detailPackage.children!.map(child => (
                      <div key={child.id}>
                        <p className="text-xs font-bold text-slate-200 mb-1.5">{child.name}</p>
                        <TaskTree tasks={child.tasks ?? []} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
              <button
                onClick={() => handleDelete(detailPackage)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Trash2 size={14} /> Удалить пакет
              </button>
              <button
                onClick={() => { const pkg = detailPackage; setDetailPackage(null); handleUsePackage(pkg); }}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold px-6 py-2.5 rounded-xl transition-all"
              >
                Использовать пакет <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal to select a block from existing projects */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus size={20} className="text-violet-400" /> Сохранить как шаблон
              </h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <X size={22} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название пакета (по умолчанию — «Шаблон: имя этапа»)</label>
                <input
                  type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Например: Бэкенд-ядро"
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                />
              </div>
              <p className="text-sm text-slate-400">Выберите этап проекта. В пакет войдут его задачи с подзадачами, роли, зависимости и вложенные этапы.</p>

              <div className="space-y-2 max-h-[340px] overflow-y-auto custom-scrollbar pr-2">
                {projectBlocks.length === 0 ? (
                  <p className="text-center py-8 text-slate-600 italic text-sm">Нет доступных этапов в проектах</p>
                ) : (
                  projectBlocks.map(block => (
                    <button
                      key={block.id}
                      disabled={saving}
                      onClick={() => handleSaveAsTemplate(block)}
                      className="w-full flex items-center justify-between p-4 bg-slate-800/30 border border-slate-800 rounded-xl hover:border-violet-500/50 hover:bg-slate-800/50 transition-all text-left group disabled:opacity-50"
                    >
                      <div>
                        <p className="text-sm font-bold text-white group-hover:text-violet-400 transition-colors">{block.name}</p>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase font-semibold">
                          Проект: {projects.find(p => p.id === block.project)?.name || 'Неизвестен'}
                          {block.stats && ` · задач: ${block.stats.task_count}`}
                        </p>
                      </div>
                      <ArrowRight size={18} className="text-slate-600 group-hover:text-violet-400 group-hover:translate-x-1 transition-all" />
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-900/80 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="px-6 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {isWizardOpen && selectedPackage && (
        <TransferWizard
          source={selectedPackage}
          isOpen={isWizardOpen}
          onClose={() => { setIsWizardOpen(false); setSelectedPackage(null); }}
        />
      )}
    </div>
  );
}

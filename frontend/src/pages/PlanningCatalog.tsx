import { useState } from 'react';
import { Search, Package, ArrowRight, Clock, BarChart3,  Plus } from 'lucide-react';
import { useAppContext, type PlanningBlock } from '../context/AppContext';
import TransferWizard from '../components/TransferWizard';

export default function PlanningCatalog() {
  const { planningBlocks, domains, projects, saveBlockAsTemplate } = useAppContext();
  const [search, setSearch] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedComplexity, setSelectedComplexity] = useState('');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<PlanningBlock | null>(null);

  const templates = planningBlocks.filter(b => b.is_template);
  const projectBlocks = planningBlocks.filter(b => !b.is_template && b.project);
  
  const filtered = templates.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase());
    const matchesDomain = !selectedDomain || b.domain === selectedDomain;
    const matchesComplexity = !selectedComplexity || b.complexity === selectedComplexity;
    return matchesSearch && matchesDomain && matchesComplexity;
  });

  const complexityColors: Record<string, string> = {
    LOW: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    MEDIUM: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    HIGH: 'bg-red-500/10 text-red-400 border-red-500/20',
  };

  const handleUsePackage = (pkg: PlanningBlock) => {
    setSelectedPackage(pkg);
    setIsWizardOpen(true);
  };

  const handleSaveAsTemplate = async (blockId: number) => {
    await saveBlockAsTemplate(blockId);
    setIsCreateModalOpen(false);
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
        <div className="flex items-center gap-3">
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-2 text-center">
            <p className="text-[10px] uppercase font-bold text-violet-400 tracking-wider">Всего шаблонов</p>
            <p className="text-xl font-bold text-white">{templates.length}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800 backdrop-blur-md">
        <div className="relative col-span-1 md:col-span-2">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск по названию пакета..."
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
          {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
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
        </select>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(pkg => (
          <div key={pkg.id} className="group bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-violet-500/50 transition-all duration-300 flex flex-col shadow-xl hover:shadow-violet-500/5">
            <div className="p-6 flex-1">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-violet-500/10 rounded-xl text-violet-400 group-hover:scale-110 transition-transform">
                  <Package size={24} />
                </div>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${complexityColors[pkg.complexity] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                  {pkg.complexity === 'LOW' ? 'НИЗКАЯ' : pkg.complexity === 'MEDIUM' ? 'СРЕДНЯЯ' : 'ВЫСОКАЯ'} СЛОЖНОСТЬ
                </span>
              </div>
              
              <h3 className="text-lg font-bold text-white mb-2 group-hover:text-violet-400 transition-colors">{pkg.name}</h3>
              <p className="text-xs text-slate-500 mb-6 line-clamp-2">Стандартизированный этап для домена {pkg.domain}. Включает проверенный набор задач и ролей.</p>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Clock size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Длительность</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-200">~{pkg.avg_duration || 14} дней</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <BarChart3 size={12} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Успешность</span>
                  </div>
                  <p className="text-sm font-semibold text-emerald-400">{pkg.success_rate || 95}%</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Задач в пакете:</span>
                  <span className="text-slate-300 font-bold">{pkg.tasks?.length || 0}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Типичные риски:</span>
                  <span className="text-slate-300 font-bold">{pkg.typical_risks?.length || 0}</span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-800/30 border-t border-slate-800 flex items-center justify-between">
              <button 
                onClick={() => handleUsePackage(pkg)}
                className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-violet-500/10 active:scale-[0.98]"
              >
                Использовать пакет <ArrowRight size={16} />
              </button>
            </div>
          </div>
        ))}
        
        {/* Create Custom Package Button */}
        <button 
          onClick={() => setIsCreateModalOpen(true)}
          className="border-2 border-dashed border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center group hover:border-violet-500/30 transition-colors bg-transparent"
        >
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-4 group-hover:bg-violet-500/10 group-hover:text-violet-400 transition-colors">
            <Plus size={24} />
          </div>
          <h3 className="text-sm font-bold text-slate-300 mb-1">Создать свой пакет</h3>
          <p className="text-xs text-slate-500 px-4">Сохраните текущий этап проекта как шаблон для будущего использования</p>
        </button>
      </div>

      {/* Modal to select a block from existing projects */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus size={20} className="text-violet-400" /> Сохранить как шаблон
              </h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <Plus className="rotate-45" size={24} />
              </button>
            </div>
            
            <div className="p-6">
              <p className="text-sm text-slate-400 mb-4">Выберите этап из активных проектов, который вы хотите сохранить как стандартный шаблон.</p>
              
              <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {projectBlocks.length === 0 ? (
                  <p className="text-center py-8 text-slate-600 italic text-sm">Нет доступных этапов в проектах</p>
                ) : (
                  projectBlocks.map(block => (
                    <button
                      key={block.id}
                      onClick={() => handleSaveAsTemplate(block.id)}
                      className="w-full flex items-center justify-between p-4 bg-slate-800/30 border border-slate-800 rounded-xl hover:border-violet-500/50 hover:bg-slate-800/50 transition-all text-left group"
                    >
                      <div>
                        <p className="text-sm font-bold text-white group-hover:text-violet-400 transition-colors">{block.name}</p>
                        <p className="text-[10px] text-slate-500 mt-1 uppercase font-semibold">Проект: {projects.find(p => p.id === block.project)?.name || 'Неизвестен'}</p>
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

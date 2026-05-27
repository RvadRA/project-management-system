import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { projects, employees, processes } = useAppContext();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const results = [
    ...projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map(p => ({
      type: 'project' as const,
      id: p.id,
      name: p.name,
      action: () => { navigate('/projects'); setIsOpen(false); },
    })),
    ...employees.filter(e => e.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map(e => ({
      type: 'employee' as const,
      id: e.id,
      name: e.full_name,
      action: () => { navigate('/team'); setIsOpen(false); },
    })),
    ...processes.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map(p => ({
      type: 'process' as const,
      id: p.id,
      name: p.name,
      action: () => { navigate('/workflows'); setIsOpen(false); },
    })),
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
      <div 
        className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Search size={18} className="text-slate-500" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Поиск проектов, сотрудников, процессов..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-600"
          />
          <kbd className="text-[10px] font-bold text-slate-600 bg-slate-800 px-2 py-0.5 rounded">ESC</kbd>
        </div>
        
        <div className="max-h-80 overflow-y-auto custom-scrollbar">
          {results.length > 0 ? results.map((item, idx) => (
            <button
              key={`${item.type}-${item.id}-${idx}`}
              onClick={item.action}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
            >
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                item.type === 'project' ? 'bg-violet-500/10 text-violet-400' :
                item.type === 'employee' ? 'bg-emerald-500/10 text-emerald-400' :
                'bg-blue-500/10 text-blue-400'
              }`}>
                {item.type.toUpperCase()}
              </span>
              <span className="text-sm text-slate-200">{item.name}</span>
            </button>
          )) : query ? (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">
              Ничего не найдено
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">
              Начните вводить для поиска...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { toast } from 'react-hot-toast';
import { AlertTriangle, X, Check } from 'lucide-react';

/**
 * A modern, "comfortable" replacement for window.confirm()
 * uses react-hot-toast for a non-blocking but focused confirmation.
 */
export const niceConfirm = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    toast((t) => (
      <div className="flex flex-col gap-4 min-w-[280px] p-1">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 flex-shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 pt-1">
            <p className="text-sm font-semibold text-slate-200">Подтвердите действие</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => {
              toast.dismiss(t.id);
              resolve(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
          >
            <X size={14} /> Отмена
          </button>
          <button
            onClick={() => {
              toast.dismiss(t.id);
              resolve(true);
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-all shadow-lg shadow-violet-600/20 active:scale-95"
          >
            <Check size={14} /> Подтвердить
          </button>
        </div>
      </div>
    ), {
      duration: Infinity,
      position: 'top-center',
      style: {
        background: '#0f172a', // slate-900
        border: '1px solid #1e293b', // slate-800
        padding: '16px',
        borderRadius: '16px',
        boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1), 0 0 0 1px rgb(255 255 255 / 0.05)'
      }
    });
  });
};

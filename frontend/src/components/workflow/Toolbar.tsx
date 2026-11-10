import { useState } from 'react';
import { Plus, Play, Save, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, ArrowLeft, Loader2 } from 'lucide-react';
import { TASK_TYPE_CONFIG } from '../../types/workflowEditor';
import type { TaskNodeType } from '../../types/workflowEditor';

interface ToolbarProps {
  onAddNode: (type: TaskNodeType) => void;
  onSave: () => void;
  onValidate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onBack: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
}

const iconButton = 'p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400';

export function Toolbar({
  onAddNode, onSave, onValidate, onUndo, onRedo,
  onZoomIn, onZoomOut, onFitView, onBack, canUndo, canRedo, saving,
}: ToolbarProps) {
  const [showTaskTypes, setShowTaskTypes] = useState(false);

  return (
    <div className="flex items-center gap-3 p-3 bg-slate-900 border-b border-slate-800">
      <button onClick={onBack} className={iconButton} title="Назад к шаблонам" aria-label="Назад к шаблонам">
        <ArrowLeft size={16} />
      </button>

      {/* Добавление задачи */}
      <div className="relative z-10">
        <button
          onClick={() => setShowTaskTypes(!showTaskTypes)}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          Добавить задачу
        </button>

        {showTaskTypes && (
          <div className="absolute top-full left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            <div className="p-2">
              <p className="text-[10px] text-slate-500 font-bold uppercase px-3 py-2">Тип задачи</p>
              {(Object.entries(TASK_TYPE_CONFIG) as [TaskNodeType, typeof TASK_TYPE_CONFIG[TaskNodeType]][]).map(([type, config]) => (
                <button
                  key={type}
                  onClick={() => { onAddNode(type); setShowTaskTypes(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700 rounded-lg transition-colors text-left"
                >
                  <span className="text-lg">{config.icon}</span>
                  <span className="text-sm text-slate-200">{config.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-slate-700" />

      <button onClick={onUndo} disabled={!canUndo} className={iconButton} title="Отменить" aria-label="Отменить"><Undo2 size={16} /></button>
      <button onClick={onRedo} disabled={!canRedo} className={iconButton} title="Повторить" aria-label="Повторить"><Redo2 size={16} /></button>

      <div className="w-px h-6 bg-slate-700" />

      <button onClick={onZoomOut} className={iconButton} title="Уменьшить" aria-label="Уменьшить"><ZoomOut size={16} /></button>
      <button onClick={onZoomIn} className={iconButton} title="Увеличить" aria-label="Увеличить"><ZoomIn size={16} /></button>
      <button onClick={onFitView} className={iconButton} title="Показать всё" aria-label="Показать всё"><Maximize2 size={16} /></button>

      <p className="hidden xl:block text-[11px] text-slate-500 ml-2">
        Связь: потяните от нижней точки одной задачи к верхней точке другой. Чтобы удалить задачу или связь, выделите её и нажмите клавишу Delete.
      </p>

      <div className="flex-1" />

      <button
        onClick={onValidate}
        className="flex items-center gap-2 text-amber-400 hover:text-amber-300 text-sm font-medium px-4 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
      >
        <Play size={14} />
        Проверить
      </button>

      <button
        onClick={onSave} disabled={saving}
        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Сохранить шаблон
      </button>
    </div>
  );
}

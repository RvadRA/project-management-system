import { useState } from 'react';
import { 
  Plus, GitBranch, GitMerge, Play, Save, 
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize2 
} from 'lucide-react';
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
}

export function Toolbar({ 
  onAddNode, onSave, onValidate, onUndo, onRedo,
  onZoomIn, onZoomOut, onFitView 
}: ToolbarProps) {
  const [showTaskTypes, setShowTaskTypes] = useState(false);

  return (
    <div className="flex items-center gap-3 p-3 bg-slate-900 border-b border-slate-800">
      {/* Add task button */}
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
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 py-2">
                Тип задачи
              </p>
              {Object.entries(TASK_TYPE_CONFIG).map(([type, config]) => (
                <button
                  key={type}
                  onClick={() => {
                    onAddNode(type as TaskNodeType);
                    setShowTaskTypes(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-700 transition-colors text-left group"
                >
                  <span className="text-lg">{config.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-white group-hover:text-violet-400">
                      {config.label}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {type === 'TEXT_REPORT' && 'Текстовая отчётность'}
                      {type === 'FILE_UPLOAD' && 'Прикрепление файлов'}
                      {type === 'CHECKLIST' && 'Контрольный список'}
                      {type === 'APPROVAL' && 'Требует утверждения'}
                      {type === 'INTEGRATION' && 'Вызов внешнего API'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-slate-700" />

      {/* Flow control */}
      <button
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Добавить параллельную ветку"
      >
        <GitBranch size={16} />
      </button>
      
      <button
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Добавить условие перехода"
      >
        <GitMerge size={16} />
      </button>

      <div className="w-px h-6 bg-slate-700" />

      {/* Undo/Redo */}
      <button
        onClick={onUndo}
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Отменить"
      >
        <Undo2 size={16} />
      </button>
      
      <button
        onClick={onRedo}
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Повторить"
      >
        <Redo2 size={16} />
      </button>

      <div className="w-px h-6 bg-slate-700" />

      {/* Zoom controls */}
      <button
        onClick={onZoomOut}
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Уменьшить"
      >
        <ZoomOut size={16} />
      </button>
      
      <button
        onClick={onZoomIn}
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Увеличить"
      >
        <ZoomIn size={16} />
      </button>
      
      <button
        onClick={onFitView}
        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        title="Показать всё"
      >
        <Maximize2 size={16} />
      </button>

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={onValidate}
        className="flex items-center gap-2 text-amber-400 hover:text-amber-300 text-sm font-medium px-4 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
      >
        <Play size={14} />
        Проверить
      </button>

      <button
        onClick={onSave}
        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <Save size={14} />
        Сохранить шаблон
      </button>
    </div>
  );
}

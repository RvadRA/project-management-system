import { X } from 'lucide-react';
import type { Node } from 'reactflow';
import { TASK_TYPE_CONFIG } from '../../types/workflowEditor';
import type { TaskNodeData, TaskNodeType } from '../../types/workflowEditor';
import { useAppContext } from '../../context/AppContext';

interface PropertiesPanelProps {
  selectedNode: Node<TaskNodeData> | null;
  onUpdate: (nodeId: string, data: Partial<TaskNodeData>) => void;
  onClose: () => void;
}

export function PropertiesPanel({ selectedNode, onUpdate, onClose }: PropertiesPanelProps) {
  const { metadata } = useAppContext();
  if (!selectedNode) return null;

  const data = selectedNode.data;

  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-bold text-white">Свойства задачи</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        {/* Task name */}
        <div>
          <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">
            Название задачи
          </label>
          <input
            type="text"
            value={data.label}
            onChange={e => onUpdate(selectedNode.id, { label: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500"
          />
        </div>

        {/* Task type */}
        <div>
          <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">
            Тип задачи
          </label>
          <select
            value={data.taskType}
            onChange={e => onUpdate(selectedNode.id, { taskType: e.target.value as TaskNodeType })}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500"
          >
            {Object.entries(TASK_TYPE_CONFIG).map(([type, config]) => (
              <option key={type} value={type}>{config.label}</option>
            ))}
          </select>
        </div>

        {/* SLA */}
        <div>
          <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">
            SLA (часы)
          </label>
          <input
            type="number"
            value={data.slaHours}
            onChange={e => onUpdate(selectedNode.id, { slaHours: Number(e.target.value) })}
            min={1}
            max={720}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">
            Приоритет
          </label>
          <select
            value={data.priority}
            onChange={e => onUpdate(selectedNode.id, { priority: e.target.value as any })}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500"
          >
            <option value="LOW">Низкий</option>
            <option value="MEDIUM">Средний</option>
            <option value="HIGH">Высокий</option>
            <option value="URGENT">Срочный</option>
          </select>
        </div>

        {/* Assigned role */}
        <div>
          <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">
            Роль исполнителя
          </label>
          <select
            value={data.assignedRole || ''}
            onChange={e => onUpdate(selectedNode.id, { assignedRole: e.target.value })}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500"
          >
            <option value="">Не назначена</option>
            {metadata?.roles && Object.entries(metadata.roles).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">
            Описание
          </label>
          <textarea
            value={data.description || ''}
            onChange={e => onUpdate(selectedNode.id, { description: e.target.value })}
            rows={4}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500 resize-none"
          />
        </div>

        {/* Parallel execution */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={data.isParallel || false}
              onChange={e => onUpdate(selectedNode.id, { isParallel: e.target.checked })}
              className="w-4 h-4 rounded border-slate-600 text-violet-500"
            />
            <span className="text-sm text-slate-300">Параллельное выполнение</span>
          </label>
        </div>
      </div>
    </div>
  );
}

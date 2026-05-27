import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { 
  Clock, User, ChevronDown, ChevronUp,
  Edit2, Trash2, Copy
} from 'lucide-react';
import { TASK_TYPE_CONFIG } from '../../types/workflowEditor';
import type { TaskNodeData } from '../../types/workflowEditor';

const TaskNode = memo(({ data, selected }: NodeProps<TaskNodeData>) => {
  const [expanded, setExpanded] = useState(false);
  const config = TASK_TYPE_CONFIG[data.taskType];
  
  const priorityColors = {
    LOW: 'border-slate-500',
    MEDIUM: 'border-blue-400',
    HIGH: 'border-amber-400',
    URGENT: 'border-red-500',
  };

  return (
    <div 
      className={`
        relative bg-slate-800 border-2 rounded-xl min-w-[250px] max-w-[350px]
        transition-all duration-200 cursor-grab active:cursor-grabbing
        ${selected ? 'border-violet-500 shadow-lg shadow-violet-500/20' : 'border-slate-700'}
        ${priorityColors[data.priority]}
        hover:border-slate-600
      `}
    >
      {/* Priority indicator */}
      <div className={`absolute top-0 left-0 w-full h-1 rounded-t-xl ${
        data.priority === 'URGENT' ? 'bg-red-500' :
        data.priority === 'HIGH' ? 'bg-amber-500' :
        data.priority === 'MEDIUM' ? 'bg-blue-500' :
        'bg-slate-600'
      }`} />

      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-slate-600 !w-3 !h-3 !border-2 !border-slate-400 hover:!bg-violet-500"
      />

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{config.icon}</span>
            <span 
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{ backgroundColor: config.color + '20', color: config.color }}
            >
              {config.label}
            </span>
          </div>
          
          <div className="flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity">
            <button className="p-1 text-slate-500 hover:text-white rounded">
              <Edit2 size={12} />
            </button>
            <button className="p-1 text-slate-500 hover:text-red-400 rounded">
              <Trash2 size={12} />
            </button>
            <button className="p-1 text-slate-500 hover:text-white rounded">
              <Copy size={12} />
            </button>
          </div>
        </div>

        {/* Task name */}
        <div className="mb-3">
          <input
            type="text"
            defaultValue={data.label}
            className="w-full bg-transparent text-sm font-bold text-white border-none outline-none focus:ring-1 focus:ring-violet-500 rounded px-1 py-0.5"
            placeholder="Название задачи"
            onClick={e => e.stopPropagation()}
          />
        </div>

        {/* Task details */}
        <div className="flex items-center gap-3 text-[10px] text-slate-400 mb-2">
          <div className="flex items-center gap-1">
            <Clock size={10} />
            <span>{data.slaHours}ч SLA</span>
          </div>
          
          {data.assignedRole && (
            <div className="flex items-center gap-1">
              <User size={10} />
              <span>{data.assignedRole}</span>
            </div>
          )}
        </div>

        {/* Expand button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="w-full flex items-center justify-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 mt-2"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Свернуть' : 'Подробнее'}
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-700 space-y-3">
            {/* Description */}
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Описание</label>
              <textarea
                defaultValue={data.description}
                className="w-full bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg p-2 outline-none focus:border-violet-500 resize-none"
                rows={2}
                placeholder="Описание задачи..."
                onClick={e => e.stopPropagation()}
              />
            </div>

            {/* SLA */}
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">SLA (часы)</label>
              <input
                type="number"
                defaultValue={data.slaHours}
                className="w-20 bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-2 py-1 outline-none focus:border-violet-500"
                onClick={e => e.stopPropagation()}
              />
            </div>

            {/* Priority */}
            <div>
              <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Приоритет</label>
              <select
                defaultValue={data.priority}
                className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-2 py-1 outline-none focus:border-violet-500"
                onClick={e => e.stopPropagation()}
              >
                <option value="LOW">Низкий</option>
                <option value="MEDIUM">Средний</option>
                <option value="HIGH">Высокий</option>
                <option value="URGENT">Срочный</option>
              </select>
            </div>

            {/* Checklist (for CHECKLIST type) */}
            {data.taskType === 'CHECKLIST' && (
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Чек-лист</label>
                {data.checklist?.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 mb-1">
                    <input
                      type="text"
                      defaultValue={item}
                      className="flex-1 bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded px-2 py-1 outline-none"
                      onClick={e => e.stopPropagation()}
                    />
                    <button className="text-red-400 hover:text-red-300">×</button>
                  </div>
                ))}
                <button className="text-[10px] text-violet-400 hover:text-violet-300 mt-1">
                  + Добавить пункт
                </button>
              </div>
            )}

            {/* Integration URL (for INTEGRATION type) */}
            {data.taskType === 'INTEGRATION' && (
              <div>
                <label className="text-[10px] text-slate-500 font-bold uppercase mb-1 block">Webhook URL</label>
                <input
                  type="url"
                  defaultValue={data.integrationUrl}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-2 py-1 outline-none focus:border-violet-500"
                  placeholder="https://..."
                  onClick={e => e.stopPropagation()}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-slate-600 !w-3 !h-3 !border-2 !border-slate-400 hover:!bg-violet-500"
      />
    </div>
  );
});

TaskNode.displayName = 'TaskNode';

export default TaskNode;

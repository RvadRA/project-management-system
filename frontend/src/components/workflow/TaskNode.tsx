import { memo } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Clock, User, Trash2, Copy, Timer, ListChecks, Link2, FastForward } from 'lucide-react';
import { TASK_TYPE_CONFIG } from '../../types/workflowEditor';
import type { TaskNodeData } from '../../types/workflowEditor';
import { useAppContext } from '../../context/AppContext';

const PRIORITY_BORDER: Record<TaskNodeData['priority'], string> = {
  LOW: 'border-slate-600',
  MEDIUM: 'border-blue-400/60',
  HIGH: 'border-amber-400/70',
  URGENT: 'border-red-500/80',
};

const PRIORITY_DOT: Record<TaskNodeData['priority'], string> = {
  LOW: 'bg-slate-500',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-amber-500',
  URGENT: 'bg-red-500',
};

const PRIORITY_LABEL: Record<TaskNodeData['priority'], string> = {
  LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный',
};

/**
 * Карточка задачи на схеме шаблона. Только показывает данные: правка — в панели «Свойства задачи»
 * справа (она открывается по клику на карточку).
 */
const TaskNode = memo(({ id, data, selected, xPos, yPos }: NodeProps<TaskNodeData>) => {
  const { metadata } = useAppContext();
  const { deleteElements, addNodes } = useReactFlow();
  const config = TASK_TYPE_CONFIG[data.taskType] ?? TASK_TYPE_CONFIG.TEXT_REPORT;
  const roleName = data.assignedRole ? (metadata?.roles?.[data.assignedRole] ?? data.assignedRole) : null;
  const checklistSize = (data.checklist ?? []).filter(item => item.trim()).length;

  const duplicate = () => addNodes({
    id: `node_${Date.now()}`,
    type: 'taskNode',
    position: { x: xPos + 40, y: yPos + 60 },
    data: { ...data, label: `${data.label} (копия)` },
  });

  return (
    <div
      className={`group relative bg-slate-800 border-2 rounded-xl w-[260px] transition-shadow cursor-grab active:cursor-grabbing ${
        selected ? 'border-violet-500 shadow-lg shadow-violet-500/20' : PRIORITY_BORDER[data.priority]
      }`}
    >
      <Handle
        type="target" position={Position.Top}
        className="!bg-slate-600 !w-3 !h-3 !border-2 !border-slate-400 hover:!bg-violet-500"
      />

      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: config.color }}>
            <span className="text-sm">{config.icon}</span> {config.label}
          </span>
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity nodrag">
            <button onClick={e => { e.stopPropagation(); duplicate(); }} className="p-1 text-slate-500 hover:text-white rounded" title="Дублировать задачу" aria-label="Дублировать задачу">
              <Copy size={12} />
            </button>
            <button onClick={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }); }} className="p-1 text-slate-500 hover:text-red-400 rounded" title="Удалить задачу" aria-label="Удалить задачу">
              <Trash2 size={12} />
            </button>
          </span>
        </div>

        <p className={`text-sm font-bold leading-snug break-words ${data.label?.trim() ? 'text-white' : 'text-red-400'}`}>
          {data.label?.trim() || 'Без названия'}
        </p>
        {data.description && <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{data.description}</p>}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400 mt-2.5">
          <span className="flex items-center gap-1" title="Срок выполнения после старта задачи"><Clock size={10} /> {data.slaHours} ч</span>
          {(data.estimatedHours ?? 0) > 0 && (
            <span className="flex items-center gap-1" title="Трудозатраты"><Timer size={10} /> {data.estimatedHours} ч работы</span>
          )}
          <span className="flex items-center gap-1" title={`Приоритет: ${PRIORITY_LABEL[data.priority]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[data.priority]}`} /> {PRIORITY_LABEL[data.priority]}
          </span>
          {roleName && <span className="flex items-center gap-1" title="Роль исполнителя"><User size={10} /> {roleName}</span>}
          {data.taskType === 'CHECKLIST' && (
            <span className={`flex items-center gap-1 ${checklistSize === 0 ? 'text-amber-400' : ''}`}><ListChecks size={10} /> пунктов: {checklistSize}</span>
          )}
          {data.taskType === 'INTEGRATION' && (
            <span className={`flex items-center gap-1 ${data.integrationUrl?.trim() ? '' : 'text-amber-400'}`}>
              <Link2 size={10} /> {data.integrationUrl?.trim() ? 'вебхук задан' : 'без вебхука'}
            </span>
          )}
          {data.autoApprove && <span className="flex items-center gap-1 text-emerald-400" title="Закрывается без проверки менеджером"><FastForward size={10} /> без проверки</span>}
        </div>
      </div>

      <Handle
        type="source" position={Position.Bottom}
        className="!bg-slate-600 !w-3 !h-3 !border-2 !border-slate-400 hover:!bg-violet-500"
      />
    </div>
  );
});

TaskNode.displayName = 'TaskNode';

export default TaskNode;

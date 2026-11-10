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

const labelClass = 'text-[10px] text-slate-500 font-bold uppercase mb-1.5 block';
const inputClass = 'w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-violet-500';
const hintClass = 'text-[11px] text-slate-500 mt-1.5 leading-relaxed';

export function PropertiesPanel({ selectedNode, onUpdate, onClose }: PropertiesPanelProps) {
  const { metadata } = useAppContext();
  if (!selectedNode) return null;

  const data = selectedNode.data;
  const update = (patch: Partial<TaskNodeData>) => onUpdate(selectedNode.id, patch);

  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-sm font-bold text-white">Свойства задачи</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-white" aria-label="Закрыть свойства">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="node-name">Название задачи</label>
          <input id="node-name" type="text" value={data.label} maxLength={255} onChange={e => update({ label: e.target.value })} className={inputClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor="node-type">Тип задачи</label>
          <select id="node-type" value={data.taskType} onChange={e => update({ taskType: e.target.value as TaskNodeType })} className={inputClass}>
            {Object.entries(TASK_TYPE_CONFIG).map(([type, config]) => (
              <option key={type} value={type}>{config.label}</option>
            ))}
          </select>
        </div>

        {data.taskType === 'CHECKLIST' && (
          <div>
            <label className={labelClass} htmlFor="node-checklist">Пункты чек-листа</label>
            <textarea
              id="node-checklist" rows={5} className={`${inputClass} resize-none`}
              value={(data.checklist ?? []).join('\n')}
              placeholder={'Проверить договор\nСобрать подписи'}
              onChange={e => update({ checklist: e.target.value.split('\n') })}
            />
            <p className={hintClass}>Каждый пункт — с новой строки. Исполнитель отметит их при сдаче.</p>
          </div>
        )}

        {data.taskType === 'INTEGRATION' && (
          <div>
            <label className={labelClass} htmlFor="node-url">Адрес вебхука</label>
            <input
              id="node-url" type="url" className={inputClass} value={data.integrationUrl ?? ''}
              placeholder="https://example.com/hook" onChange={e => update({ integrationUrl: e.target.value })}
            />
            <p className={hintClass}>Когда задача перейдёт в работу, система отправит запрос по этому адресу. Без адреса задача выполняется вручную.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="node-sla">Нормативный срок, ч</label>
            <input
              id="node-sla" type="number" min={1} max={8760} className={inputClass} value={data.slaHours}
              onChange={e => update({ slaHours: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="node-hours">Трудозатраты, ч</label>
            <input
              id="node-hours" type="number" min={0} step={0.5} className={inputClass} value={data.estimatedHours ?? 0}
              onChange={e => update({ estimatedHours: Number(e.target.value) })}
            />
          </div>
        </div>
        <p className={`${hintClass} !mt-1`}>Срок — через сколько часов после старта задачу нужно сдать. Трудозатраты — сколько часов работы она требует.</p>

        <div>
          <label className={labelClass} htmlFor="node-priority">Приоритет</label>
          <select id="node-priority" value={data.priority} onChange={e => update({ priority: e.target.value as TaskNodeData['priority'] })} className={inputClass}>
            <option value="LOW">Низкий</option>
            <option value="MEDIUM">Средний</option>
            <option value="HIGH">Высокий</option>
            <option value="URGENT">Срочный</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="node-role">Роль исполнителя</label>
          <select id="node-role" value={data.assignedRole || ''} onChange={e => update({ assignedRole: e.target.value })} className={inputClass}>
            <option value="">Не назначена</option>
            {metadata?.roles && Object.entries(metadata.roles).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <p className={hintClass}>При запуске процесса задачу получит участник проекта с этой ролью — наименее загруженный.</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="node-description">Описание</label>
          <textarea id="node-description" value={data.description || ''} onChange={e => update({ description: e.target.value })} rows={4} className={`${inputClass} resize-none`} />
        </div>

        {data.taskType !== 'APPROVAL' && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox" checked={data.autoApprove || false} onChange={e => update({ autoApprove: e.target.checked })}
              className="w-4 h-4 mt-0.5 rounded border-slate-600 accent-violet-500"
            />
            <span>
              <span className="text-sm text-slate-300">Без проверки менеджером</span>
              <span className="block text-[11px] text-slate-500 leading-relaxed">Задача закрывается сразу, как исполнитель сдал результат.</span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

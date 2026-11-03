import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactFlow, {
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Panel,
  ReactFlowProvider,
} from 'reactflow';
import type {
  Connection,
  Node,
  Edge,
  EdgeChange,
  NodeChange,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Toolbar } from '../components/workflow/Toolbar';
import { PropertiesPanel } from '../components/workflow/PropertiesPanel';
import { CustomMinimap } from '../components/workflow/Minimap';
import TaskNode from '../components/workflow/TaskNode';
import type { TaskNodeData, TaskNodeType } from '../types/workflowEditor';
import { orderNodes, validateWorkflow, type ValidationError } from '../utils/workflowValidation';
import { useAppContext } from '../context/AppContext';
import { niceConfirm } from '../utils/confirm';
import { toast } from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

const nodeTypes = { taskNode: TaskNode };

const EDGE_STYLE = { markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#6366f1', strokeWidth: 2 } };

// Заготовка нового шаблона: две связанные задачи
const initialNodes: Node<TaskNodeData>[] = [
  {
    id: '1', type: 'taskNode', position: { x: 100, y: 100 },
    data: { label: 'Старт процесса', taskType: 'TEXT_REPORT', slaHours: 24, priority: 'HIGH', description: 'Начальная задача процесса' },
  },
  {
    id: '2', type: 'taskNode', position: { x: 100, y: 350 },
    data: { label: 'Завершение', taskType: 'APPROVAL', slaHours: 48, priority: 'HIGH', assignedRole: 'MANAGER', description: 'Финальное утверждение' },
  },
];
const initialEdges: Edge[] = [{ id: 'e1-2', source: '1', target: '2', ...EDGE_STYLE }];

/** Шаг шаблона в том виде, в каком его отдаёт сервер */
interface StoredStep {
  id: number;
  order: number;
  name: string;
  task_type: string;
  sla_hours: number;
  priority: string;
  description?: string;
  assigned_role?: string | null;
  checklist?: string[];
  integration_url?: string | null;
  is_parallel?: boolean;
  estimated_hours?: number;
  auto_approve?: boolean;
  depends_on?: number[];
}

interface Snapshot { nodes: Node<TaskNodeData>[]; edges: Edge[] }

const HISTORY_LIMIT = 50;

export default function WorkflowEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { createTemplate, updateTemplate, templates, loading, extractError } = useAppContext();
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[] | null>(null);
  const [templateName, setTemplateName] = useState('Новый шаблон');
  const [isPublished, setIsPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });

  // Шаблон загружается в редактор один раз. Список шаблонов в приложении обновляется в фоне
  // каждую минуту — если перечитывать его здесь, несохранённые правки пропадали бы.
  const editorKey = id ?? 'new';
  const storedTemplate = id ? templates.find(t => t.id === Number(id)) : undefined;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadedKey !== editorKey && (!id || storedTemplate)) {
    setLoadedKey(editorKey);
    if (!storedTemplate) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    } else {
      const steps = storedTemplate.task_templates as unknown as StoredStep[];
      const positions: Record<string, { x: number; y: number }> = storedTemplate.ui_config?.positions ?? {};
      const sorted = [...steps].sort((a, b) => a.order - b.order);
      setTemplateName(storedTemplate.name);
      setIsPublished(storedTemplate.is_published);
      setNodes(sorted.map((step, index) => ({
        id: String(step.id),
        type: 'taskNode',
        // У шагов, добавленных списком, сохранённой позиции нет — ставим их столбиком по порядку
        position: positions[String(step.id)] ?? { x: 100 + (index % 2) * 320, y: 100 + index * 170 },
        data: {
          label: step.name,
          taskType: step.task_type as TaskNodeType,
          slaHours: step.sla_hours,
          priority: step.priority as TaskNodeData['priority'],
          description: step.description ?? '',
          assignedRole: step.assigned_role ?? '',
          checklist: step.checklist ?? [],
          integrationUrl: step.integration_url ?? '',
          isParallel: step.is_parallel,
          estimatedHours: step.estimated_hours ?? 0,
          autoApprove: step.auto_approve ?? false,
        },
      })));
      const ids = new Set(steps.map(step => step.id));
      setEdges(steps.flatMap(step => (step.depends_on ?? []).filter(dep => ids.has(dep)).map(dep => ({
        id: `e${dep}-${step.id}`, source: String(dep), target: String(step.id), ...EDGE_STYLE,
      }))));
    }
  }

  // Шаблона с таким номером нет (удалён или неверная ссылка) — возвращаемся к списку
  const templateMissing = !!id && !storedTemplate && !loading && loadedKey !== editorKey;
  useEffect(() => {
    if (!templateMissing) return;
    toast.error('Шаблон не найден');
    navigate('/workflows', { state: { tab: 'catalog' } });
  }, [templateMissing, navigate]);

  // Закрытие вкладки с несохранёнными правками — браузер переспросит
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── Отмена / повтор ────────────────────────────────────────────────────────
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastEdit = useRef('');
  const syncHistory = () => setHistorySize({ past: past.current.length, future: future.current.length });

  /** Запоминает состояние схемы перед изменением */
  const remember = useCallback(() => {
    const last = past.current[past.current.length - 1];
    if (!last || last.nodes !== nodes || last.edges !== edges) {
      past.current.push({ nodes, edges });
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
    }
    future.current = [];
    setDirty(true);
    setHistorySize({ past: past.current.length, future: 0 });
  }, [nodes, edges]);

  const handleUndo = () => {
    const snapshot = past.current.pop();
    if (!snapshot) return;
    future.current.push({ nodes, edges });
    lastEdit.current = '';
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    syncHistory();
  };

  const handleRedo = () => {
    const snapshot = future.current.pop();
    if (!snapshot) return;
    past.current.push({ nodes, edges });
    lastEdit.current = '';
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    syncHistory();
  };

  // ── Изменения схемы ────────────────────────────────────────────────────────
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (changes.some(change => change.type === 'remove' || change.type === 'add')) {
      remember();
      if (changes.some(change => change.type === 'remove' && change.id === selectedNodeId)) setSelectedNodeId(null);
    }
    onNodesChange(changes);
  }, [onNodesChange, remember, selectedNodeId]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some(change => change.type === 'remove')) remember();
    onEdgesChange(changes);
  }, [onEdgesChange, remember]);

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target || params.source === params.target) return;
    // Повторная связь между теми же задачами не нужна
    if (edges.some(edge => edge.source === params.source && edge.target === params.target)) return;
    remember();
    setEdges(current => addEdge({ ...params, ...EDGE_STYLE }, current));
  }, [edges, setEdges, remember]);

  const addNode = useCallback((type: TaskNodeType) => {
    remember();
    // Новая задача появляется под самой нижней, а не в случайном месте
    const lowest = nodes.reduce<Node<TaskNodeData> | null>((low, node) => (!low || node.position.y > low.position.y ? node : low), null);
    const nodeId = `node_${Date.now()}`;
    setNodes(current => [...current, {
      id: nodeId,
      type: 'taskNode',
      position: lowest ? { x: lowest.position.x, y: lowest.position.y + 190 } : { x: 100, y: 100 },
      data: { label: 'Новая задача', taskType: type, slaHours: 24, priority: 'MEDIUM', estimatedHours: 0 },
    }]);
    setSelectedNodeId(nodeId);
  }, [nodes, setNodes, remember]);

  const updateNodeData = useCallback((nodeId: string, patch: Partial<TaskNodeData>) => {
    // Одна запись в истории на серию правок одного поля, а не на каждую букву
    const editKey = `${nodeId}:${Object.keys(patch).join(',')}`;
    if (lastEdit.current !== editKey) {
      remember();
      lastEdit.current = editKey;
    }
    setDirty(true);
    setNodes(current => current.map(node => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node)));
  }, [setNodes, remember]);

  const handleValidate = () => {
    const errors = validateWorkflow(nodes, edges);
    setValidationErrors(errors);
    if (errors.some(error => error.type === 'error')) toast.error('В шаблоне есть ошибки');
    else toast.success(errors.length > 0 ? 'Ошибок нет, есть замечания' : 'Шаблон в порядке');
  };

  const handleSave = async () => {
    const errors = validateWorkflow(nodes, edges);
    if (!templateName.trim()) errors.unshift({ type: 'error', message: 'Укажите название шаблона' });
    if (errors.some(error => error.type === 'error')) {
      setValidationErrors(errors);
      toast.error('Исправьте ошибки перед сохранением');
      return;
    }

    const nodeIds = new Set(nodes.map(node => node.id));
    const ordered = orderNodes(nodes, edges);
    const payload = {
      name: templateName.trim(),
      is_published: isPublished,
      // Раскладка схемы: сервер заменит временные идентификаторы новых задач настоящими
      ui_config: { ...(storedTemplate?.ui_config ?? {}), positions: Object.fromEntries(nodes.map(node => [node.id, node.position])) },
      task_templates: ordered.map((node, index) => ({
        // Для существующей задачи это её идентификатор: сервер обновит её, а не создаст заново
        frontend_id: node.id,
        name: node.data.label.trim(),
        task_type: node.data.taskType,
        sla_hours: node.data.slaHours,
        priority: node.data.priority,
        description: node.data.description ?? '',
        assigned_role: node.data.assignedRole || null,
        checklist: (node.data.checklist ?? []).map(item => item.trim()).filter(Boolean),
        integration_url: node.data.integrationUrl?.trim() || null,
        estimated_hours: node.data.estimatedHours ?? 0,
        auto_approve: !!node.data.autoApprove,
        order: index,
        depends_on_fids: [...new Set(edges.filter(edge => edge.target === node.id && nodeIds.has(edge.source)).map(edge => edge.source))],
      })),
    };

    setSaving(true);
    try {
      if (id) await updateTemplate(Number(id), payload);
      else await createTemplate({ ...payload, description: '' });
      setDirty(false);
      toast.success('Шаблон сохранён');
      navigate('/workflows', { state: { tab: 'catalog' } });
    } catch (err) {
      toast.error(extractError(err, 'Не удалось сохранить шаблон'));
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    if (dirty && !await niceConfirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
    navigate('/workflows', { state: { tab: 'catalog' } });
  };

  const selectedNode = nodes.find(node => node.id === selectedNodeId) || null;
  const errorCount = validationErrors?.filter(error => error.type === 'error').length ?? 0;

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      <div className="flex items-center gap-4 px-4 py-2 bg-slate-900 border-b border-slate-800">
        <input
          type="text" value={templateName} maxLength={255} aria-label="Название шаблона"
          onChange={e => { setTemplateName(e.target.value); setDirty(true); }}
          className="flex-1 min-w-0 max-w-xl bg-transparent text-lg font-bold text-white outline-none border-b-2 border-transparent focus:border-violet-500 px-1"
        />
        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{id ? 'Редактирование шаблона' : 'Новый шаблон'}</span>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer" title="Запускать процессы можно только по опубликованному шаблону">
          <input type="checkbox" checked={isPublished} onChange={e => { setIsPublished(e.target.checked); setDirty(true); }} className="w-4 h-4 accent-violet-500" />
          Опубликован
        </label>
        {dirty && <span className="text-[11px] text-amber-400">есть несохранённые изменения</span>}
      </div>

      <Toolbar
        onAddNode={addNode}
        onSave={() => void handleSave()}
        onValidate={handleValidate}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onZoomIn={() => reactFlowInstance?.zoomIn()}
        onZoomOut={() => reactFlowInstance?.zoomOut()}
        onFitView={() => reactFlowInstance?.fitView()}
        onBack={() => void handleBack()}
        canUndo={historySize.past > 0}
        canRedo={historySize.future > 0}
        saving={saving}
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              onNodeDragStart={() => { lastEdit.current = ''; remember(); }}
              onInit={setReactFlowInstance}
              nodeTypes={nodeTypes}
              fitView
              deleteKeyCode={['Backspace', 'Delete']}
              multiSelectionKeyCode="Shift"
              selectionKeyCode="Control"
              className="bg-slate-950"
              defaultEdgeOptions={{ type: 'smoothstep', animated: true, ...EDGE_STYLE }}
            >
              <Background color="var(--slate-700)" gap={20} size={1} />
              <Controls className="!bg-slate-900 !border-slate-700 !rounded-xl" />
              <CustomMinimap />

              {validationErrors && (
                <Panel position="top-right" className="!m-4">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-md shadow-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-white">Результаты проверки</h3>
                      <button onClick={() => setValidationErrors(null)} className="text-slate-500 hover:text-white" aria-label="Закрыть результаты проверки">✕</button>
                    </div>
                    <div className="space-y-2">
                      {validationErrors.map((error, index) => (
                        <button
                          key={index} type="button" disabled={!error.nodeId}
                          onClick={() => error.nodeId && setSelectedNodeId(error.nodeId)}
                          className={`w-full text-left flex items-start gap-2 p-2 rounded-lg text-xs ${
                            error.type === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                          } ${error.nodeId ? 'hover:brightness-125' : 'cursor-default'}`}
                        >
                          {error.type === 'error'
                            ? <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                            : <Info size={14} className="flex-shrink-0 mt-0.5" />}
                          <span>{error.message}</span>
                        </button>
                      ))}
                      {errorCount === 0 && (
                        <div className="flex items-start gap-2 p-2 rounded-lg text-xs bg-emerald-500/10 text-emerald-400">
                          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                          <span>Ошибок нет — шаблон можно сохранять.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        {selectedNode && (
          <PropertiesPanel
            selectedNode={selectedNode}
            onUpdate={updateNodeData}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

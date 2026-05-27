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
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { Toolbar } from '../components/workflow/Toolbar';
import { PropertiesPanel } from '../components/workflow/PropertiesPanel';
import { CustomMinimap } from '../components/workflow/Minimap';
import TaskNode from '../components/workflow/TaskNode';
import type { TaskNodeData, TaskNodeType } from '../types/workflowEditor';
import { validateWorkflow } from '../utils/workflowValidation';
import { useAppContext } from '../context/AppContext';
import { toast } from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

// Register custom node types
const nodeTypes = {
  taskNode: TaskNode,
};

// Initial nodes
const initialNodes: Node<TaskNodeData>[] = [
  {
    id: '1',
    type: 'taskNode',
    position: { x: 100, y: 100 },
    data: {
      label: 'Старт процесса',
      taskType: 'TEXT_REPORT',
      slaHours: 24,
      priority: 'HIGH',
      description: 'Начальная задача процесса',
    },
  },
  {
    id: '2',
    type: 'taskNode',
    position: { x: 100, y: 350 },
    data: {
      label: 'Завершение',
      taskType: 'APPROVAL',
      slaHours: 48,
      priority: 'HIGH',
      assignedRole: 'MANAGER',
      description: 'Финальное утверждение',
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#6366f1', strokeWidth: 2 },
  },
];

export default function WorkflowEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { createTemplate, updateTemplate, templates } = useAppContext();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [templateName, setTemplateName] = useState('Новый шаблон');

  // Load template if ID is provided
  useEffect(() => {
    if (id) {
      const template = templates.find(t => t.id === Number(id));
      if (template) {
        setTemplateName(template.name);
        
        // Reconstruct nodes
        const uiConfig = (template as any).ui_config || {};
        const loadedNodes: Node<TaskNodeData>[] = template.task_templates.map((tt: any) => ({
          id: tt.id.toString(),
          type: 'taskNode',
          position: uiConfig.positions?.[tt.id] || { x: 100, y: 100 + template.task_templates.indexOf(tt) * 150 },
          data: {
            label: tt.name,
            taskType: tt.task_type as TaskNodeType,
            slaHours: tt.sla_hours,
            priority: tt.priority,
            description: tt.description,
            assignedRole: tt.assigned_role,
            checklist: tt.checklist,
            integrationUrl: tt.integration_url,
            isParallel: tt.is_parallel
          }
        }));
        
        // Reconstruct edges
        const loadedEdges: Edge[] = [];
        template.task_templates.forEach((tt: any) => {
          if (tt.depends_on && Array.isArray(tt.depends_on)) {
            tt.depends_on.forEach((depId: number) => {
              loadedEdges.push({
                id: `e${depId}-${tt.id}`,
                source: depId.toString(),
                target: tt.id.toString(),
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: '#6366f1', strokeWidth: 2 },
              });
            });
          }
        });
        
        setNodes(loadedNodes);
        setEdges(loadedEdges);
      }
    } else {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [id, templates, setNodes, setEdges]);

  // History for undo/redo
  const history = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndex = useRef(-1);

  const saveToHistory = useCallback(() => {
    const snapshot = { nodes: [...nodes], edges: [...edges] };
    history.current = history.current.slice(0, historyIndex.current + 1);
    history.current.push(snapshot);
    historyIndex.current++;
  }, [nodes, edges]);

  const onConnect = useCallback((params: Connection) => {
    saveToHistory();
    setEdges(eds => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#6366f1', strokeWidth: 2 },
    }, eds));
  }, [setEdges, saveToHistory]);

  const addNode = useCallback((type: TaskNodeType) => {
    saveToHistory();
    
    const id = `node_${Date.now()}`;
    const newNode: Node<TaskNodeData> = {
      id,
      type: 'taskNode',
      position: { 
        x: 200 + Math.random() * 300, 
        y: 200 + Math.random() * 200 
      },
      data: {
        label: 'Новая задача',
        taskType: type,
        slaHours: 24,
        priority: 'MEDIUM',
      },
    };

    setNodes(nds => [...nds, newNode]);
  }, [setNodes, saveToHistory]);

  const updateNodeData = useCallback((nodeId: string, newData: Partial<TaskNodeData>) => {
    setNodes(nds =>
      nds.map(node =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...newData } }
          : node
      )
    );
  }, [setNodes]);

  const handleValidate = () => {
    const errors = validateWorkflow(nodes, edges);
    setValidationErrors(errors);

    if (errors.filter(e => e.type === 'error').length === 0) {
      toast.success('Workflow корректен!');
    } else {
      toast.error('Найдены ошибки в workflow');
    }
  };

  const handleSave = async () => {
    const errors = validateWorkflow(nodes, edges);
    if (errors.filter(e => e.type === 'error').length > 0) {
      toast.error('Исправьте ошибки перед сохранением');
      return;
    }

    try {
      
      // Map node positions for UI config
      const positions: Record<string, { x: number; y: number }> = {};
      nodes.forEach(node => {
        positions[node.id] = node.position;
      });

      const templateData = {
        name: templateName,
        description: 'Создано в редакторе',
        is_published: true,
        ui_config: { positions },
        task_templates: nodes.map(node => ({
          frontend_id: node.id,
          name: node.data.label,
          task_type: node.data.taskType,
          sla_hours: node.data.slaHours,
          priority: node.data.priority,
          description: node.data.description,
          assigned_role: node.data.assignedRole,
          checklist: node.data.checklist,
          integration_url: node.data.integrationUrl,
          is_parallel: node.data.isParallel,
          order: nodes.indexOf(node),
          depends_on_fids: edges
            .filter(e => e.target === node.id)
            .map(e => e.source)
        })),
      };

      if (id) {
        await updateTemplate(Number(id), templateData);
      } else {
        await createTemplate(templateData);
      }
      
      toast.success('Шаблон сохранён!');
      navigate('/workflows');
    } catch (err: any) {
      toast.error('Ошибка при сохранении');
    }
  };

  const handleUndo = () => {
    if (historyIndex.current > 0) {
      historyIndex.current--;
      const snapshot = history.current[historyIndex.current];
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    }
  };

  const handleRedo = () => {
    if (historyIndex.current < history.current.length - 1) {
      historyIndex.current++;
      const snapshot = history.current[historyIndex.current];
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    }
  };

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const selectedNode = nodes.find(n => n.id === selectedNodeId) || null;

  return (
    <div className="h-screen flex flex-col bg-slate-950">
      {/* Template name bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-slate-900 border-b border-slate-800">
        <input
          type="text"
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          className="bg-transparent text-lg font-bold text-white outline-none border-b-2 border-transparent focus:border-violet-500 px-1"
        />
        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
          Редактор шаблона
        </span>
      </div>

      {/* Toolbar */}
      <Toolbar
        onAddNode={addNode}
        onSave={handleSave}
        onValidate={handleValidate}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onZoomIn={() => reactFlowInstance?.zoomIn()}
        onZoomOut={() => reactFlowInstance?.zoomOut()}
        onFitView={() => reactFlowInstance?.fitView()}
      />

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onInit={setReactFlowInstance}
              nodeTypes={nodeTypes}
              fitView
              deleteKeyCode={['Backspace', 'Delete']}
              multiSelectionKeyCode="Shift"
              selectionKeyCode="Control"
              className="bg-slate-950"
              defaultEdgeOptions={{
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#6366f1', strokeWidth: 2 },
                markerEnd: { type: MarkerType.ArrowClosed },
              }}
            >
              <Background color="#1e293b" gap={20} size={1} />
              <Controls 
                className="!bg-slate-900 !border-slate-700 !rounded-xl"
                style={{ 
                  '--xy-controls-button-background': '#1e293b',
                  '--xy-controls-button-border': '#334155',
                  '--xy-controls-button-color': '#94a3b8',
                } as any}
              />
              <CustomMinimap />
              
              {/* Validation panel */}
              {validationErrors.length > 0 && (
                <Panel position="top-right" className="!m-4">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 max-w-md shadow-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-white">
                        Результаты проверки
                      </h3>
                      <button 
                        onClick={() => setValidationErrors([])}
                        className="text-slate-500 hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="space-y-2">
                      {validationErrors.map((error, idx) => (
                        <div 
                          key={idx}
                          className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
                            error.type === 'error' 
                              ? 'bg-red-500/10 text-red-400' 
                              : 'bg-amber-500/10 text-amber-400'
                          }`}
                        >
                          {error.type === 'error' 
                            ? <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                            : <Info size={14} className="flex-shrink-0 mt-0.5" />
                          }
                          <span>{error.message}</span>
                        </div>
                      ))}
                      {validationErrors.filter(e => e.type === 'error').length === 0 && (
                        <div className="flex items-start gap-2 p-2 rounded-lg text-xs bg-emerald-500/10 text-emerald-400">
                          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                          <span>Workflow готов к сохранению!</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        {/* Properties panel */}
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

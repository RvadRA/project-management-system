import type { Node, Edge } from 'reactflow';
import type { TaskNodeData } from '../types/workflowEditor';

export interface ValidationError {
  type: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  message: string;
}

/** Есть ли в схеме цикл: шаги, которые ждут друг друга по кругу */
const hasCycle = (nodes: Node<TaskNodeData>[], edges: Edge[]): boolean => {
  const waiting = new Map(nodes.map(n => [n.id, new Set(edges.filter(e => e.target === n.id).map(e => e.source))]));
  while (waiting.size > 0) {
    const ready = [...waiting].filter(([, deps]) => deps.size === 0).map(([id]) => id);
    if (ready.length === 0) return true;
    ready.forEach(id => waiting.delete(id));
    waiting.forEach(deps => ready.forEach(id => deps.delete(id)));
  }
  return false;
};

export function validateWorkflow(nodes: Node<TaskNodeData>[], edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = [];

  if (nodes.length === 0) {
    return [{ type: 'error', message: 'В шаблоне нет ни одной задачи — добавьте хотя бы одну' }];
  }

  nodes.forEach(node => {
    if (!node.data.label?.trim()) {
      errors.push({ type: 'error', nodeId: node.id, message: 'У одной из задач не указано название' });
    }
  });

  if (hasCycle(nodes, edges)) {
    errors.push({ type: 'error', message: 'Задачи ждут друг друга по кругу — такой процесс не сможет начаться. Уберите одну из связей.' });
  } else {
    const startNodes = nodes.filter(n => !edges.some(e => e.target === n.id));
    if (startNodes.length > 1 && edges.length > 0) {
      errors.push({
        type: 'warning',
        message: `Задач без входящих связей: ${startNodes.length} — они начнутся одновременно при запуске процесса`,
      });
    }
  }

  // Задачи без связей, когда остальные связаны
  nodes.forEach(node => {
    const hasConnections = edges.some(e => e.source === node.id || e.target === node.id);
    if (!hasConnections && nodes.length > 1 && edges.length > 0) {
      errors.push({ type: 'warning', nodeId: node.id, message: `Задача «${node.data.label}» не связана с другими` });
    }
  });

  if (edges.length === 0 && nodes.length > 1) {
    errors.push({ type: 'warning', message: 'Связей нет: задачи пойдут друг за другом в том порядке, в каком расположены сверху вниз' });
  }

  nodes.forEach(node => {
    if (!node.data.slaHours || node.data.slaHours <= 0) {
      errors.push({ type: 'error', nodeId: node.id, message: `У задачи «${node.data.label}» не указан срок (SLA)` });
    }
    if (node.data.taskType === 'APPROVAL' && !node.data.assignedRole) {
      errors.push({ type: 'warning', nodeId: node.id, message: `Для утверждения «${node.data.label}» не выбрана роль согласующего` });
    }
    if (node.data.taskType === 'CHECKLIST' && !(node.data.checklist ?? []).length) {
      errors.push({ type: 'warning', nodeId: node.id, message: `В чек-листе «${node.data.label}» нет ни одного пункта` });
    }
    if (node.data.taskType === 'INTEGRATION' && !node.data.integrationUrl?.trim()) {
      errors.push({ type: 'warning', nodeId: node.id, message: `У интеграции «${node.data.label}» не указан адрес — задача будет выполняться вручную` });
    }
  });

  return errors;
}

/**
 * Порядок шагов для сохранения: сначала те, что ни от кого не зависят, затем их последователи.
 * При равных условиях — сверху вниз и слева направо, как на схеме.
 */
export function orderNodes<T extends Node<TaskNodeData>>(nodes: T[], edges: Edge[]): T[] {
  const byPosition = (a: T, b: T) => a.position.y - b.position.y || a.position.x - b.position.x;
  const waiting = new Map(nodes.map(n => [n.id, new Set(edges.filter(e => e.target === n.id).map(e => e.source))]));
  const left = [...nodes];
  const ordered: T[] = [];
  while (left.length > 0) {
    const ready = left.filter(n => waiting.get(n.id)!.size === 0).sort(byPosition);
    // цикл сюда не попадает (его отсекает проверка), но на всякий случай не зависаем
    const next = ready.length > 0 ? ready : [...left].sort(byPosition).slice(0, 1);
    next.forEach(node => {
      ordered.push(node);
      left.splice(left.indexOf(node), 1);
      waiting.forEach(deps => deps.delete(node.id));
    });
  }
  return ordered;
}

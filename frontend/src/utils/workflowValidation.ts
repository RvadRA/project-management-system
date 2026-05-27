import type { Node, Edge } from 'reactflow';
import type { TaskNodeData } from '../types/workflowEditor';

interface ValidationError {
  type: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export function validateWorkflow(nodes: Node<TaskNodeData>[], edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for start node
  const startNodes = nodes.filter(n => n.type === 'input' || !edges.some(e => e.target === n.id));
  if (startNodes.length === 0) {
    errors.push({ type: 'error', message: 'Нет начальной задачи (нет входящих связей)' });
  }
  if (startNodes.length > 1) {
    errors.push({ type: 'warning', message: 'Несколько начальных точек. Рекомендуется одна точка входа' });
  }

  // Check for end node
  const endNodes = nodes.filter(n => !edges.some(e => e.source === n.id));
  if (endNodes.length === 0) {
    errors.push({ type: 'error', message: 'Нет конечной задачи (нет исходящих связей)' });
  }

  // Check for cycles
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const outgoing = edges.filter(e => e.source === nodeId);
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) {
        if (hasCycle(edge.target)) return true;
      } else if (recursionStack.has(edge.target)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      if (hasCycle(node.id)) {
        errors.push({ type: 'error', message: 'Обнаружен цикл в процессе' });
      }
    }
  });

  // Check for disconnected nodes
  nodes.forEach(node => {
    const hasConnections = edges.some(e => e.source === node.id || e.target === node.id);
    if (!hasConnections && nodes.length > 1) {
      errors.push({ 
        type: 'warning', 
        nodeId: node.id, 
        message: `Задача "${node.data.label}" не связана с другими` 
      });
    }
  });

  // Check for missing SLA
  nodes.forEach(node => {
    if (!node.data.slaHours || node.data.slaHours <= 0) {
      errors.push({
        type: 'warning',
        nodeId: node.id,
        message: `Задача "${node.data.label}" не имеет SLA`
      });
    }
  });

  // Check for APPROVAL tasks without approver
  nodes.forEach(node => {
    if (node.data.taskType === 'APPROVAL' && !node.data.assignedRole) {
      errors.push({
        type: 'warning',
        nodeId: node.id,
        message: `Задача утверждения "${node.data.label}" не имеет назначенной роли`
      });
    }
  });

  return errors;
}

import type { Node, Edge } from 'reactflow';

export type TaskNodeType = 'TEXT_REPORT' | 'FILE_UPLOAD' | 'CHECKLIST' | 'APPROVAL' | 'INTEGRATION';

export interface TaskNodeData {
  label: string;
  taskType: TaskNodeType;
  slaHours: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedRole?: string;
  description?: string;
  checklist?: string[];
  integrationUrl?: string;
  isParallel?: boolean;
}

export type WorkflowNode = Node<TaskNodeData> & {
  type: 'taskNode';
}

export type WorkflowEdge = Edge & {
  condition?: string;
  label?: string;
}

export const TASK_TYPE_CONFIG: Record<TaskNodeType, { label: string; color: string; icon: string }> = {
  TEXT_REPORT: { label: 'Отчёт', color: '#8b5cf6', icon: '📝' },
  FILE_UPLOAD: { label: 'Файлы', color: '#3b82f6', icon: '📎' },
  CHECKLIST: { label: 'Чек-лист', color: '#10b981', icon: '✅' },
  APPROVAL: { label: 'Утверждение', color: '#f59e0b', icon: '👍' },
  INTEGRATION: { label: 'Интеграция', color: '#ec4899', icon: '🔌' },
};

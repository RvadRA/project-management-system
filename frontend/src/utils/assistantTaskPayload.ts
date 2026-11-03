import { toDateKey, toEndOfDayIso } from './dates';

export const DEFAULT_SLA_HOURS = 24;

export interface AssistantTaskInput {
  title: string;
  description: string;
  priority: string;
  estimatedHours: number | null;
  dueDate: string | null;
  assignee: number | '';
}

export interface WorkflowTaskPayload {
  workflow: number;
  name: string;
  description: string;
  task_type: 'TEXT_REPORT';
  status: 'TODO';
  priority: string;
  sla_hours: number;
  due_date: string | null;
  estimated_hours: number;
  assigned_to: number | null;
}

export interface PlanTaskPayload {
  block: number;
  name: string;
  description: string;
  status: 'TODO';
  priority: string;
  estimated_hours: number;
  duration_days: number;
  assigned_to: number | null;
  create_workflow: boolean;
  start_date?: string;
  end_date?: string;
}

export function buildWorkflowTaskPayload(
  processId: number,
  input: AssistantTaskInput,
): WorkflowTaskPayload {
  return {
    workflow: processId,
    name: input.title.trim(),
    description: input.description.trim(),
    task_type: 'TEXT_REPORT',
    status: 'TODO',
    priority: input.priority,
    sla_hours: DEFAULT_SLA_HOURS,
    due_date: toEndOfDayIso(input.dueDate),
    estimated_hours: input.estimatedHours ?? 0,
    assigned_to: input.assignee || null,
  };
}

export function buildPlanTaskPayload(
  blockId: number,
  input: AssistantTaskInput,
  options: { startDate?: string; hasProcess?: boolean } = {},
): PlanTaskPayload {
  const hours = input.estimatedHours ?? 0;
  const payload: PlanTaskPayload = {
    block: blockId,
    name: input.title.trim(),
    description: input.description.trim(),
    status: 'TODO',
    priority: input.priority,
    estimated_hours: hours,
    duration_days: Math.max(1, Math.ceil(hours / 8)),
    assigned_to: input.assignee || null,
    create_workflow: Boolean(options.hasProcess),
  };
  if (input.dueDate) {
    payload.start_date = options.startDate ?? toDateKey(new Date());
    payload.end_date = input.dueDate;
  }
  return payload;
}

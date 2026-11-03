import { describe, expect, it } from 'vitest';
import { buildPlanTaskPayload, buildWorkflowTaskPayload } from './assistantTaskPayload';

const input = {
  title: 'Интеграция модели прогнозирования загрузки с SQL и Pandas',
  description: 'Интегрировать модель прогнозирования загрузки с использованием SQL и Pandas.',
  priority: 'MEDIUM',
  estimatedHours: 12,
  dueDate: '2027-03-22',
  assignee: 7,
};

describe('buildWorkflowTaskPayload', () => {
  it('keeps the calendar deadline separate from SLA', () => {
    const payload = buildWorkflowTaskPayload(42, input);
    expect(payload.sla_hours).toBe(24);
    expect(payload.due_date).not.toBeNull();
    const deadline = new Date(payload.due_date!);
    expect([deadline.getFullYear(), deadline.getMonth(), deadline.getDate()]).toEqual([2027, 2, 22]);
    expect(payload.description).toBe(input.description);
    expect(payload.description).not.toContain('Срок:');
  });

  it('does not derive SLA from a far deadline', () => {
    const payload = buildWorkflowTaskPayload(42, { ...input, dueDate: '2028-12-31' });
    expect(payload.sla_hours).toBe(24);
    expect(payload.due_date).not.toBeNull();
  });

  it('leaves the deadline empty when it is not set', () => {
    const payload = buildWorkflowTaskPayload(42, { ...input, dueDate: null });
    expect(payload.due_date).toBeNull();
    expect(payload.sla_hours).toBe(24);
  });
});

describe('buildPlanTaskPayload', () => {
  it('writes the deadline to end_date without changing the description', () => {
    const payload = buildPlanTaskPayload(9, input, { startDate: '2026-10-21', hasProcess: true });
    expect(payload.end_date).toBe('2027-03-22');
    expect(payload.start_date).toBe('2026-10-21');
    expect(payload.duration_days).toBe(2);
    expect(payload.create_workflow).toBe(true);
    expect(payload.description).toBe(input.description);
  });

  it('omits calendar fields when there is no deadline', () => {
    const payload = buildPlanTaskPayload(9, { ...input, dueDate: null });
    expect(payload.end_date).toBeUndefined();
    expect(payload.start_date).toBeUndefined();
  });
});

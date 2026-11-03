import { describe, expect, it } from 'vitest';
import {
  buildDraftCandidatePayload, compatibleProcessId, validDraftProjectId,
} from './assistantDraft';

describe('buildDraftCandidatePayload', () => {
  it('keeps project, skills and edited text for the Top-3 request', () => {
    expect(buildDraftCandidatePayload({
      projectId: 215,
      title: 'Интегрировать модель',
      description: 'SQL и Pandas',
      dueDate: '2027-03-22',
      skillIds: [3, 7],
      processName: 'Процесс',
      blockName: 'Этап',
    })).toEqual({
      project_id: 215,
      title: 'Интегрировать модель',
      description: 'SQL и Pandas',
      due_date: '2027-03-22',
      skill_ids: [3, 7],
      process_name: 'Процесс',
      block_name: 'Этап',
    });
  });

  it('does not call the API without a project', () => {
    expect(buildDraftCandidatePayload({
      projectId: null,
      title: 'T',
      description: '',
      dueDate: null,
      skillIds: [],
    })).toBeNull();
  });
});

describe('draft project and process selections', () => {
  const projects = [{ id: 1, name: '[SYNTHV2] TASKS Retail' }];
  const processes = [
    { id: 10, project_id: 1 },
    { id: 20, project_id: 2 },
  ];

  it('keeps only a project ID present in the backend project list', () => {
    expect(validDraftProjectId(1, projects)).toBe(1);
    expect(validDraftProjectId(null, projects)).toBeNull();
    expect(validDraftProjectId(undefined, projects)).toBeNull();
    expect(validDraftProjectId(999, projects)).toBeNull();
  });

  it('clears a process that does not belong to the selected project', () => {
    expect(compatibleProcessId(10, 1, processes)).toBe(10);
    expect(compatibleProcessId(20, 1, processes)).toBeNull();
    expect(compatibleProcessId(10, null, processes)).toBeNull();
  });
});

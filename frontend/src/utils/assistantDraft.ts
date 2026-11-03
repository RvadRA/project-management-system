export interface DraftCandidatePayload {
  project_id: number;
  title: string;
  description: string;
  due_date: string | null;
  skill_ids: number[];
  process_name: string;
  block_name: string;
}

export interface DraftCandidateInput {
  projectId: number | null;
  title: string;
  description: string;
  dueDate: string | null;
  skillIds: number[];
  processName?: string | null;
  blockName?: string | null;
}

export interface DraftProjectOption {
  id: number;
  name: string;
}

export interface DraftProcessOption {
  id: number;
  project_id: number;
}

export function validDraftProjectId(
  projectId: number | null | undefined,
  projects: DraftProjectOption[],
): number | null {
  return projectId != null && projects.some(project => project.id === projectId)
    ? projectId
    : null;
}

export function compatibleProcessId(
  processId: number | null,
  projectId: number | null,
  processes: DraftProcessOption[],
): number | null {
  return processId != null && processes.some(
    process => process.id === processId && process.project_id === projectId,
  ) ? processId : null;
}

export function buildDraftCandidatePayload(input: DraftCandidateInput): DraftCandidatePayload | null {
  if (!input.projectId) return null;
  return {
    project_id: input.projectId,
    title: input.title,
    description: input.description,
    due_date: input.dueDate,
    skill_ids: input.skillIds,
    process_name: input.processName ?? '',
    block_name: input.blockName ?? '',
  };
}

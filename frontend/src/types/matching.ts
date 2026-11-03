import type { Project } from '../context/AppContext';

export type ScoreWeights = Record<'w1' | 'w2' | 'w3' | 'w4' | 'w5', number>;

export interface ScoreDetails {
  competence?: {
    required: number;
    matched?: string[];
    below_minimum?: string[];
    missing?: string[];
    note?: string;
  };
  experience?: {
    domain: string | null;
    profile_domain?: string | null;
    profile_match?: boolean;
    domain_projects?: number;
    domain_done_tasks?: number;
    projects?: number;
    done_tasks?: number;
  };
  availability?: {
    avg_load_percent: number | null;
    peak_load_percent: number | null;
    free_percent: number | null;
    unavailable_days: number;
    period_days: number;
    working_days: number;
    available_hours: number;
    workload_known?: boolean;
    workload_source?: 'workload_entries' | 'none';
    current_workload_known?: boolean;
    open_task_hours?: number;
    unestimated_open_tasks?: number;
    task_estimate_complete?: boolean;
    task_estimated_load_percent?: number | null;
  };
  performance?: {
    done_on_time: number;
    done_late: number;
    overdue_open: number;
    manual_ratings: number;
    note?: string;
  };
  cost?: {
    hourly_rate: number | null;
    assumed_rate?: number;
    rate_limit: number | null;
    limit_source?: 'budget' | 'cheapest_candidate';
    note?: string;
  };
  weights?: ScoreWeights;
  semantic_similarity?: number | null;
  semantic_available?: boolean;
  deterministic_score?: number;
  explanation_source?: 'llm' | 'deterministic';
}

export interface ScoreResult {
  /** id профиля сотрудника (EmployeeProfile) */
  employee_id: number;
  user_id: number;
  full_name: string;
  position: string;
  current_workload: number;
  /** Оценка трудозатрат открытых задач, ч */
  active_task_hours: number;
  open_task_count: number;
  unestimated_task_count: number;
  already_member: boolean;
  data_gaps: string[];
  details: ScoreDetails;
  total_score: number;
  competence_fit: number;
  experience_similarity: number;
  availability: number;
  past_performance: number;
  cost_fit: number;
  conflicts: string[];
  explanation: string;
}

export type TaskPeriodSource = 'due_date' | 'sla';
export type TaskDeadlineStatus = 'future' | 'today' | 'overdue' | 'missing';

export interface TaskMatchContext {
  id: number;
  name: string;
  project: Project;
  start: string;
  end: string;
  dueDate: string | null;
  periodSource: TaskPeriodSource;
  deadlineStatus: TaskDeadlineStatus;
  assignedToId: number | null;
  assignedToName: string | null;
}

export interface AssignmentRequest {
  employeeId: number;
  employeeUserId: number;
  employeeName: string;
  employeePosition: string;
  projectId: number;
  projectName: string;
  taskId?: number;
  taskName?: string;
  role: string;
  roleRefId?: number;
  load: number;
  start: string;
  end: string;
  isTaskAssignment: boolean;
  alreadyMember: boolean;
  currentAssigneeId: number | null;
  currentAssigneeName: string | null;
  periodSource?: TaskPeriodSource;
  deadlineDate?: string | null;
  deadlineStatus?: TaskDeadlineStatus;
  competenceFilterApplied?: boolean;
  availabilityKnown?: boolean;
}

export interface RecommendationExclusionReason {
  code: string;
  skills?: string[];
  message: string;
}

export interface ExcludedCandidate {
  employee_id: number;
  full_name: string;
  position: string;
  reasons: RecommendationExclusionReason[];
}

export interface DraftRecommendationResponse {
  requirements: {
    skills: string[];
    skills_source: string;
    summary?: string;
    task_type?: string;
    complexity?: string;
  };
  scoring: {
    formula?: string;
    constraints?: string;
    semantic_status?: 'available' | 'partial' | 'unavailable' | 'not_applicable';
    competence_filter_applied: boolean;
    skills_source?: string;
    total_considered?: number;
    eligible_count?: number;
    excluded_count?: number;
    top_limit?: number;
    period_start?: string;
    period_end?: string;
  };
  excluded_candidates: ExcludedCandidate[];
  candidates: ScoreResult[];
  warnings: string[];
  degraded: boolean;
}

export type CandidateAssignmentState = 'assigned' | 'recommended' | 'candidate';

export interface RequiredSkillChip {
  label: string;
  state: 'matched' | 'below_minimum' | 'missing';
}

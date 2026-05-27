export type TaskType = 'TEXT_REPORT' | 'FILE_UPLOAD' | 'CHECKLIST' | 'APPROVAL' | 'INTEGRATION';

export interface BaseTaskData {
  name: string;
  description: string;
  task_type: TaskType;
  sla_hours: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  assigned_to: number | null;
  estimated_hours: number;
  depends_on: number[];
}

// Extended data for each type
export interface TextReportData extends BaseTaskData {
  task_type: 'TEXT_REPORT';
  report_template?: string; // Template for the report
  min_characters?: number; // Minimum text length
  require_attachments?: boolean;
}

export interface FileUploadData extends BaseTaskData {
  task_type: 'FILE_UPLOAD';
  allowed_file_types?: string[]; // ['pdf', 'docx', 'xlsx', 'jpg']
  max_file_size_mb?: number;
  min_files?: number;
  max_files?: number;
  template_files?: string[]; // URLs to template files
}

export interface ChecklistData extends BaseTaskData {
  task_type: 'CHECKLIST';
  checklist_items: ChecklistItem[];
  require_all_completed?: boolean;
  allow_partial_submit?: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  description?: string;
  is_required: boolean;
  order: number;
  category?: string;
}

export interface ApprovalData extends BaseTaskData {
  task_type: 'APPROVAL';
  approver_role: string; // Role required to approve
  approver_id?: number; // Specific person
  approval_criteria?: string[]; // What to check
  allow_reject_with_comment?: boolean;
  auto_approve_after_hours?: number; // Auto-approve if no action
  escalation_after_hours?: number;
}

export interface IntegrationData extends BaseTaskData {
  task_type: 'INTEGRATION';
  webhook_url: string;
  http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  request_body_template?: string; // JSON template
  expected_response_code?: number;
  expected_response_contains?: string;
  retry_count?: number;
  retry_delay_seconds?: number;
  timeout_seconds?: number;
  on_success_action?: 'COMPLETE' | 'TRANSITION';
  on_failure_action?: 'RETRY' | 'ESCALATE' | 'SKIP';
}

export type TaskData = TextReportData | FileUploadData | ChecklistData | ApprovalData | IntegrationData;

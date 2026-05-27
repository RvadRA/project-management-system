import { TextReportSubmission } from './TextReportSubmission';
import { FileUploadSubmission } from './FileUploadSubmission';
import { ChecklistSubmission } from './ChecklistSubmission';
import { ApprovalSubmission } from './ApprovalSubmission';
import { IntegrationSubmission } from './IntegrationSubmission';

interface TaskSubmissionRouterProps {
  task: any;
  onClose: () => void;
}

export function TaskSubmissionRouter({ task, onClose }: TaskSubmissionRouterProps) {
  switch (task.task_type) {
    case 'TEXT_REPORT':
      return <TextReportSubmission task={task} onClose={onClose} />;
    
    case 'FILE_UPLOAD':
      return <FileUploadSubmission task={task} onClose={onClose} />;
    
    case 'CHECKLIST':
      return <ChecklistSubmission task={task} onClose={onClose} />;
    
    case 'APPROVAL':
      return <ApprovalSubmission task={task} onClose={onClose} />;
    
    case 'INTEGRATION':
      return <IntegrationSubmission task={task} onClose={onClose} />;
    
    default:
      return (
        <div className="text-center py-8">
          <p className="text-slate-500">Неизвестный тип задачи: {task.task_type}</p>
        </div>
      );
  }
}

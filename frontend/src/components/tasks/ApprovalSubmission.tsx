import { useState } from 'react';
import { 
  ThumbsUp, ThumbsDown, Loader2,
  CheckCircle2, XCircle, MessageSquare, AlertTriangle, Clock
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppContext } from '../../context/AppContext';

interface ApprovalSubmissionProps {
  task: any;
  onClose: () => void;
}

export function ApprovalSubmission({ task, onClose }: ApprovalSubmissionProps) {
  const { submitTaskReport, approveTask } = useAppContext();
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const criteria = task.approval_criteria || [
    'Соответствие требованиям',
    'Качество исполнения',
    'Соблюдение сроков',
  ];

  const handleSubmit = async () => {
    if (!decision) {
      toast.error('Выберите решение: утвердить или отклонить');
      return;
    }

    if (decision === 'reject' && !comment.trim()) {
      toast.error('При отклонении необходимо указать причину');
      return;
    }

    setSubmitting(true);
    try {
      if (decision === 'approve') {
        await approveTask(task.id);
        toast.success('Задача утверждена!');
      } else {
        await submitTaskReport(task.id, {
          text_content: `ОТКЛОНЕНО\nПричина: ${comment}`,
        });
        toast.success('Задача отклонена с комментарием');
      }
      onClose();
    } catch (err: any) {
      toast.error('Ошибка при обработке решения');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Approval criteria */}
      <div>
        <h3 className="text-sm font-bold text-white mb-3">Критерии утверждения:</h3>
        <div className="space-y-2">
          {criteria.map((criterion: string, idx: number) => (
            <div key={idx} className="flex items-center gap-2 p-2 bg-slate-800/30 rounded-lg">
              <div className="w-5 h-5 rounded-full bg-violet-500/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-violet-400">{idx + 1}</span>
              </div>
              <span className="text-sm text-slate-300">{criterion}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Decision buttons */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setDecision('approve')}
          className={`p-4 rounded-xl border-2 transition-all ${
            decision === 'approve'
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-700 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
              decision === 'approve' ? 'bg-emerald-500/20' : 'bg-slate-800'
            }`}>
              <ThumbsUp size={24} className={decision === 'approve' ? 'text-emerald-400' : 'text-slate-500'} />
            </div>
            <span className={`text-sm font-bold ${decision === 'approve' ? 'text-emerald-400' : 'text-slate-400'}`}>
              Утвердить
            </span>
          </div>
        </button>

        <button
          onClick={() => setDecision('reject')}
          className={`p-4 rounded-xl border-2 transition-all ${
            decision === 'reject'
              ? 'border-red-500 bg-red-500/10'
              : 'border-slate-700 hover:border-red-500/50'
          }`}
        >
          <div className="flex flex-col items-center gap-2">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
              decision === 'reject' ? 'bg-red-500/20' : 'bg-slate-800'
            }`}>
              <ThumbsDown size={24} className={decision === 'reject' ? 'text-red-400' : 'text-slate-500'} />
            </div>
            <span className={`text-sm font-bold ${decision === 'reject' ? 'text-red-400' : 'text-slate-400'}`}>
              Отклонить
            </span>
          </div>
        </button>
      </div>

      {/* Reject reason */}
      {decision === 'reject' && (
        <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-red-400" />
            <p className="text-sm font-bold text-red-400">
              Укажите причину отклонения
            </p>
          </div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Опишите, что нужно исправить..."
            rows={4}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-red-500 transition-all resize-none"
          />
        </div>
      )}

      {/* Approve comment */}
      {decision === 'approve' && (
        <div>
          <label className="flex items-center gap-2 text-xs text-slate-400 mb-2">
            <MessageSquare size={12} />
            Комментарий (опционально)
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Комментарий к утверждению..."
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-all resize-none"
          />
        </div>
      )}

      {/* SLA warning */}
      {task.is_overdue && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2">
          <Clock size={14} className="text-amber-400" />
          <p className="text-xs text-amber-400">
            Внимание: задача просрочена! SLA: {task.sla_hours}ч
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg"
        >
          Отмена
        </button>

        <button
          onClick={handleSubmit}
          disabled={!decision || (decision === 'reject' && !comment.trim()) || submitting}
          className={`flex-1 flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-xl transition-all disabled:opacity-50 ${
            decision === 'approve'
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
              : decision === 'reject'
              ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20'
              : 'bg-slate-700 text-slate-400'
          }`}
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : decision === 'approve' ? (
            <CheckCircle2 size={16} />
          ) : (
            <XCircle size={16} />
          )}
          {submitting ? 'Обработка...' : decision === 'approve' ? 'Утвердить задачу' : 'Отклонить задачу'}
        </button>
      </div>
    </div>
  );
}

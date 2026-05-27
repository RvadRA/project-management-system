import { useState } from 'react';
import { 
  FileText, Send, Save, 
  Paperclip, Eye, Loader2 
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppContext } from '../../context/AppContext';

interface TextReportSubmissionProps {
  task: any; // KanbanTask
  onClose: () => void;
}

export function TextReportSubmission({ task, onClose }: TextReportSubmissionProps) {
  const { submitTaskReport } = useAppContext();
  const [report, setReport] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  
  const minChars = task.min_characters || 50;
  const isReportValid = report.length >= minChars;

  const handleSubmit = async () => {
    if (!isReportValid) {
      toast.error(`Отчёт должен содержать минимум ${minChars} символов`);
      return;
    }

    setSubmitting(true);
    try {
      await submitTaskReport(task.id, {
        text_content: report,
        files: attachments,
      });
      toast.success('Отчёт отправлен на проверку');
      onClose();
    } catch (err: any) {
      toast.error('Ошибка при отправке отчёта');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = () => {
    localStorage.setItem(`draft_report_${task.id}`, JSON.stringify({
      report,
      savedAt: new Date().toISOString(),
    }));
    toast.success('Черновик сохранён');
  };

  // Load draft
  useState(() => {
    const draft = localStorage.getItem(`draft_report_${task.id}`);
    if (draft) {
      const { report: savedReport } = JSON.parse(draft);
      setReport(savedReport);
      toast('Загружен сохранённый черновик', { icon: '📝' });
    }
  });

  if (previewMode) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Предпросмотр отчёта</h3>
          <button
            onClick={() => setPreviewMode(false)}
            className="text-xs text-violet-400 hover:text-violet-300"
          >
            Редактировать
          </button>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 min-h-[200px]">
          <div className="prose prose-invert text-sm text-slate-300 whitespace-pre-wrap">
            {report || 'Нет содержимого'}
          </div>
        </div>
        {attachments.length > 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">Прикреплённые файлы:</p>
            {attachments.map((file, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs text-slate-400">
                <Paperclip size={12} />
                {file.name}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <FileText size={14} className="text-violet-400" />
            Текстовый отчёт
          </label>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] ${isReportValid ? 'text-emerald-400' : 'text-amber-400'}`}>
              {report.length} / {minChars} символов
            </span>
            <button
              onClick={() => setPreviewMode(true)}
              disabled={!report}
              className="text-xs text-slate-500 hover:text-white disabled:opacity-30"
            >
              <Eye size={14} />
            </button>
          </div>
        </div>

        <textarea
          value={report}
          onChange={e => setReport(e.target.value)}
          placeholder="Опишите результаты выполнения задачи..."
          rows={12}
          className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 transition-all resize-none placeholder:text-slate-600"
        />

        {/* Progress bar */}
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
            <span>Прогресс</span>
            <span>{Math.min(100, Math.round((report.length / minChars) * 100))}%</span>
          </div>
          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                isReportValid ? 'bg-emerald-500' : 'bg-violet-500'
              }`}
              style={{ width: `${Math.min(100, (report.length / minChars) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Template hints */}
      {task.report_template && (
        <div className="p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
          <p className="text-[10px] text-violet-400 font-bold uppercase mb-2">Шаблон отчёта:</p>
          <p className="text-xs text-slate-400">{task.report_template}</p>
        </div>
      )}

      {/* Attachments */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">Прикреплённые файлы</label>
        <div className="space-y-2">
          {attachments.map((file, idx) => (
            <div key={idx} className="flex items-center justify-between p-2 bg-slate-800/30 border border-slate-800 rounded-lg">
              <div className="flex items-center gap-2">
                <Paperclip size={14} className="text-violet-400" />
                <span className="text-xs text-slate-300">{file.name}</span>
                <span className="text-[10px] text-slate-500">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <button
                onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                className="text-slate-500 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
          <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-violet-500/50 transition-all">
            <Paperclip size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">Прикрепить файл</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={e => {
                if (e.target.files) {
                  setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
                }
              }}
            />
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
        <button
          onClick={handleSaveDraft}
          disabled={!report}
          className="flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30"
        >
          <Save size={14} />
          Черновик
        </button>
        
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg"
        >
          Отмена
        </button>

        <button
          onClick={handleSubmit}
          disabled={!isReportValid || submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-all shadow-lg shadow-violet-600/20"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
          {submitting ? 'Отправка...' : 'Отправить на проверку'}
        </button>
      </div>
    </div>
  );
}

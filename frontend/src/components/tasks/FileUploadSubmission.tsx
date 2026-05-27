import { useState, useRef } from 'react';
import {
  Upload, File, X, CheckCircle2, AlertTriangle,
  Download, Loader2
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppContext } from '../../context/AppContext';

interface FileUploadSubmissionProps {
  task: any;
  onClose: () => void;
}

interface UploadedFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  preview?: string;
}

export function FileUploadSubmission({ task, onClose }: FileUploadSubmissionProps) {
  const { submitTaskReport } = useAppContext();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const maxFiles = task.max_files || 10;
  const minFiles = task.min_files || 1;
  const maxSize = (task.max_file_size_mb || 10) * 1024 * 1024;
  const allowedTypes = task.allowed_file_types || ['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'png', 'zip'];

  const validateFile = (file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && !allowedTypes.includes(ext)) {
      return `Недопустимый тип файла: .${ext}. Разрешены: ${allowedTypes.join(', ')}`;
    }
    if (file.size > maxSize) {
      return `Файл слишком большой: ${(file.size / 1024 / 1024).toFixed(1)}MB. Максимум: ${maxSize / 1024 / 1024}MB`;
    }
    return null;
  };

  const addFiles = (newFiles: FileList) => {
    const validFiles: UploadedFile[] = [];
    const errors: string[] = [];

    if (files.length + newFiles.length > maxFiles) {
      toast.error(`Максимум ${maxFiles} файлов`);
      return;
    }

    Array.from(newFiles).forEach(file => {
      const error = validateFile(file);
      if (error) {
        errors.push(`${file.name}: ${error}`);
      } else {
        validFiles.push({
          id: `file_${Date.now()}_${Math.random()}`,
          file,
          progress: 0,
          status: 'pending',
        });
      }
    });

    if (errors.length > 0) {
      errors.forEach(e => toast.error(e));
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = async () => {
    if (files.length < minFiles) {
      toast.error(`Необходимо загрузить минимум ${minFiles} файл(ов)`);
      return;
    }

    setSubmitting(true);
    try {
      const fileObjects = files.map(f => f.file);
      await submitTaskReport(task.id, {
        text_content: comment,
        files: fileObjects,
      });
      toast.success('Файлы отправлены на проверку');
      onClose();
    } catch (err: any) {
      toast.error('Ошибка при отправке файлов');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center hover:border-violet-500/50 transition-all cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center">
            <Upload size={28} className="text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white mb-1">
              Перетащите файлы сюда или нажмите для выбора
            </p>
            <p className="text-xs text-slate-500">
              {allowedTypes.join(', ').toUpperCase()} · До {maxSize / 1024 / 1024}MB каждый
            </p>
            <p className="text-xs text-slate-500">
              Минимум: {minFiles} · Максимум: {maxFiles} файлов
            </p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => e.target.files && addFiles(e.target.files)}
          accept={allowedTypes.map(t => `.${t}`).join(',')}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400 font-bold uppercase">
              Выбранные файлы ({files.length}/{maxFiles})
            </p>
            <button
              onClick={() => setFiles([])}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Очистить всё
            </button>
          </div>

          {files.map(uploadedFile => (
            <div
              key={uploadedFile.id}
              className="flex items-center gap-3 p-3 bg-slate-800/30 border border-slate-800 rounded-xl group"
            >
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                <File size={18} className="text-violet-400" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{uploadedFile.file.name}</p>
                <p className="text-[10px] text-slate-500">
                  {(uploadedFile.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                
                {uploadedFile.status === 'uploading' && (
                  <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all"
                      style={{ width: `${uploadedFile.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {uploadedFile.status === 'done' && (
                <CheckCircle2 size={16} className="text-emerald-400" />
              )}

              {uploadedFile.status === 'error' && (
                <AlertTriangle size={16} className="text-red-400" />
              )}

              <button
                onClick={() => removeFile(uploadedFile.id)}
                className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Template files download */}
      {task.template_files?.length > 0 && (
        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <p className="text-[10px] text-blue-400 font-bold uppercase mb-2">
            Шаблоны для скачивания:
          </p>
          <div className="space-y-2">
            {task.template_files.map((url: string, idx: number) => (
              <a
                key={idx}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300"
              >
                <Download size={12} />
                Шаблон {idx + 1}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Comment */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">
          Комментарий к файлам
        </label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Опишите, что было сделано и какие файлы прикреплены..."
          rows={4}
          className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 resize-none"
        />
      </div>

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
          disabled={files.length < minFiles || submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Upload size={16} />
          )}
          {submitting ? 'Отправка...' : 'Отправить файлы'}
        </button>
      </div>
    </div>
  );
}

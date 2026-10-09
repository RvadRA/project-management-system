import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Paperclip, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api, { downloadFile, fetchAllPages } from '../api/client';
import { useAppContext } from '../context/AppContext';
import { niceConfirm } from '../utils/confirm';
import {
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_STYLE, formatFileSize, materialDownloadUrl,
  type KnowledgeMaterial as ProjectFile,
} from '../utils/materials';

/** Файловое хранилище проекта: ТЗ, документы, инструкции. Доступ проверяет сервер. */
export default function ProjectFiles({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const { extractError } = useAppContext();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('DOC');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    () => fetchAllPages<ProjectFile>(`/projects/knowledge-materials/?project=${projectId}`),
    [projectId],
  );

  useEffect(() => {
    let cancelled = false;
    load()
      .then(items => { if (!cancelled) setFiles(items); })
      .catch(() => { if (!cancelled) toast.error('Не удалось загрузить файлы проекта'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !file) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim() || file!.name);
      formData.append('category', category);
      formData.append('description', description.trim());
      formData.append('project', projectId.toString());
      formData.append('tags', JSON.stringify([]));
      if (file) formData.append('file', file);
      await api.post('/projects/knowledge-materials/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Файл добавлен в проект');
      setTitle(''); setDescription(''); setFile(null); setCategory('DOC'); setShowForm(false);
      setFiles(await load());
    } catch (err) {
      toast.error(extractError(err, 'Ошибка при загрузке файла'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: ProjectFile) => {
    if (!await niceConfirm(`Удалить «${item.title}»?`)) return;
    try {
      await api.delete(`/projects/knowledge-materials/${item.id}/`);
      setFiles(prev => prev.filter(f => f.id !== item.id));
    } catch (err) {
      toast.error(extractError(err, 'Ошибка при удалении файла'));
    }
  };

  const handleDownload = async (item: ProjectFile) => {
    try {
      await downloadFile(materialDownloadUrl(item.id), item.file_name || item.title);
    } catch {
      toast.error('Не удалось скачать файл');
    }
  };

  const query = search.trim().toLowerCase();
  const visible = files.filter(f =>
    !query
    || f.title.toLowerCase().includes(query)
    || (f.description || '').toLowerCase().includes(query)
    || (f.file_name || '').toLowerCase().includes(query)
    || (f.tags || []).some(t => t.toLowerCase().includes(query)),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию, описанию, тегам..."
            className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all"
          >
            {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? 'Отмена' : 'Добавить файл'}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form onSubmit={handleUpload} className="bg-slate-800/40 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Название (по умолчанию — имя файла)"
              className="col-span-2 bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
            />
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500"
            >
              {Object.entries(MATERIAL_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Краткое описание (необязательно)"
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
          />
          <label className="relative flex items-center justify-center gap-2 border-2 border-dashed border-slate-700 hover:border-violet-500/50 rounded-lg p-4 cursor-pointer text-xs text-slate-400">
            <input
              type="file"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <UploadCloud size={18} className="text-slate-500" />
            {file
              ? <span className="text-emerald-400 font-semibold">{file.name} ({formatFileSize(file.size)})</span>
              : 'Выберите файл'}
          </label>
          <button
            type="submit"
            disabled={submitting || (!title.trim() && !file)}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-lg transition-all"
          >
            {submitting ? 'Загрузка...' : 'Сохранить в проект'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-10 bg-slate-800/20 rounded-2xl border border-dashed border-slate-800">
          <Paperclip size={28} className="mx-auto text-slate-600 mb-2" />
          <p className="text-sm text-slate-500">
            {files.length === 0 ? 'В проекте пока нет файлов' : 'Ничего не найдено'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(item => (
            <div key={item.id} className="p-3 bg-slate-800/20 border border-slate-800/50 rounded-xl group/file hover:bg-slate-800/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center text-violet-400 flex-shrink-0">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-200 truncate">{item.title}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider flex-shrink-0 ${MATERIAL_CATEGORY_STYLE[item.category] ?? MATERIAL_CATEGORY_STYLE.OTHER}`}>
                      {item.category_display}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">
                    {item.file_name ? `${item.file_name} · ${formatFileSize(item.file_size)} · ` : ''}
                    {item.created_by_name || 'Система'} · {new Date(item.created_at).toLocaleDateString('ru-RU')}
                  </p>
                </div>
                {(item.description || item.text_instruction) && (
                  <button
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="text-[10px] font-bold text-slate-400 hover:text-violet-300 px-2 py-1 rounded bg-slate-800 border border-slate-700"
                  >
                    {expandedId === item.id ? 'Скрыть' : 'Открыть'}
                  </button>
                )}
                {item.file && (
                  <button
                    onClick={() => handleDownload(item)}
                    className="p-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
                    title="Скачать файл"
                  >
                    <Download size={13} />
                  </button>
                )}
                {item.can_edit && (
                  <button
                    onClick={() => handleDelete(item)}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover/file:opacity-100"
                    title="Удалить"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {expandedId === item.id && (
                <div className="mt-3 ml-12 space-y-2">
                  {item.description && <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>}
                  {item.text_instruction && (
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                      {item.text_instruction}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

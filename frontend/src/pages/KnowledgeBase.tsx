import React, { useState, useEffect } from 'react';
import { 
  BookOpen, Search, Plus, Tag, FileText, Download, Eye, X, 
  UploadCloud, FolderOpen, User, Calendar, Trash2, Edit2 
} from 'lucide-react';
import api, { downloadFile, fetchAllPages } from '../api/client';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import { niceConfirm } from '../utils/confirm';
import { isStaff, projectPerms } from '../utils/roles';
import {
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_STYLE, formatFileSize, materialDownloadUrl,
  type KnowledgeMaterial,
} from '../utils/materials';

export default function KnowledgeBase() {
  const { projects, extractError } = useAppContext();
  const { user } = useAuth();
  
  const [materials, setMaterials] = useState<KnowledgeMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // 'all' — всё доступное, 'global' — общая база знаний, число — файлы конкретного проекта
  const [scope, setScope] = useState<'all' | 'global' | number>('all');

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<KnowledgeMaterial | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<KnowledgeMaterial | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openAddModal = () => {
    setEditingMaterial(null);
    setTitle('');
    setDescription('');
    setTextInstruction('');
    setTags([]);
    setCategory('DOC');
    // Без прав на общую базу материал можно добавить только в свой проект
    setProjectId(canAddGlobal ? (typeof scope === 'number' && uploadableProjects.some(p => p.id === scope) ? scope : '') : (uploadableProjects[0]?.id ?? ''));
    setSelectedFile(null);
    setIsAddModalOpen(true);
  };

  const handleEditClick= (m: KnowledgeMaterial) => {
    setEditingMaterial(m);
    setTitle(m.title);
    setDescription(m.description || '');
    setTextInstruction(m.text_instruction || '');
    setTags(m.tags || []);
    setCategory(m.category || 'DOC');
    setProjectId(m.project || '');
    setSelectedFile(null);
    setIsAddModalOpen(true);
  };
  
  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [textInstruction, setTextInstruction] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [category, setCategory] = useState('DOC');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Общую базу знаний пополняют менеджеры и администраторы,
  // файлы проекта — участники с правом «Файлы: правка»
  const canAddGlobal = isStaff(user);
  const uploadableProjects = projects.filter(p => projectPerms(p).can_edit_files);
  const canAdd = canAddGlobal || uploadableProjects.length > 0;

  const fetchMaterials = async () => {
    setLoading(true);
    try {
      setMaterials(await fetchAllPages<KnowledgeMaterial>('/projects/knowledge-materials/'));
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при загрузке базы знаний'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaterials();
  }, []);

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = tagInput.trim().toLowerCase();
      if (tag && !tags.includes(tag)) {
        setTags([...tags, tag]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('Введите название материала');
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', description.trim());
      formData.append('text_instruction', textInstruction.trim());
      formData.append('tags', JSON.stringify(tags));
      formData.append('category', category);
      if (projectId) {
        formData.append('project', projectId.toString());
      } else {
        formData.append('project', '');
      }
      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      if (editingMaterial) {
        await api.patch(`/projects/knowledge-materials/${editingMaterial.id}/`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        toast.success('Материал успешно обновлен');
      } else {
        await api.post('/projects/knowledge-materials/', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
        toast.success('Материал успешно добавлен');
      }
      
      setIsAddModalOpen(false);
      fetchMaterials();
      
      // Reset form
      setTitle('');
      setDescription('');
      setTextInstruction('');
      setTags([]);
      setProjectId('');
      setSelectedFile(null);
      setEditingMaterial(null);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при добавлении материала'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (materialId: number) => {
    if (!await niceConfirm('Вы уверены, что хотите удалить этот материал?')) return;
    try {
      await api.delete(`/projects/knowledge-materials/${materialId}/`);
      toast.success('Материал удален');
      fetchMaterials();
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при удалении материала'));
    }
  };

  // Get all unique tags from all materials
  const allUniqueTags = Array.from(
    new Set(materials.flatMap(m => m.tags || []))
  );

  const handleDownload = async (m: KnowledgeMaterial) => {
    try {
      await downloadFile(materialDownloadUrl(m.id), m.file_name || m.title);
    } catch {
      toast.error('Не удалось скачать файл');
    }
  };

  // Проекты, по которым пользователю доступны материалы
  const projectsWithMaterials = projects.filter(p => materials.some(m => m.project === p.id));

  // Filter materials based on search query, selected tag and scope
  const filteredMaterials = materials.filter(m => {
    const q = search.toLowerCase();
    const matchSearch = m.title.toLowerCase().includes(q) ||
                        (m.description || '').toLowerCase().includes(q) ||
                        (m.text_instruction || '').toLowerCase().includes(q) ||
                        (m.file_name || '').toLowerCase().includes(q) ||
                        (m.tags || []).some(t => t.toLowerCase().includes(q));

    const matchTag = selectedTag ? (m.tags || []).includes(selectedTag) : true;
    const matchScope = scope === 'all' ? true : scope === 'global' ? m.project === null : m.project === scope;

    return matchSearch && matchTag && matchScope;
  });

  return (
    <div className="p-8 space-y-6 h-full overflow-y-auto custom-scrollbar bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <BookOpen size={24} className="text-violet-400" /> База знаний
          </h1>
          <p className="text-sm text-slate-400 mt-1">Общая база знаний и файлы проектов, к которым у вас есть доступ</p>
        </div>
        {canAdd && (
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-lg shadow-violet-600/25"
          >
            <Plus size={16} /> Добавить материал
          </button>
        )}
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск по названию, тексту, файлу или тегам..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all"
          />
        </div>

        <select
          value={scope}
          onChange={e => setScope(e.target.value === 'all' || e.target.value === 'global' ? e.target.value : Number(e.target.value))}
          className="bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-violet-500"
        >
          <option value="all">Все материалы</option>
          <option value="global">Общая база знаний</option>
          {projectsWithMaterials.length > 0 && (
            <optgroup label="Файлы проектов">
              {projectsWithMaterials.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
        </select>
        
        {/* Tags Quick Filters */}
        <div className="flex items-center gap-2 flex-wrap max-w-xl">
          <button
            onClick={() => setSelectedTag(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              selectedTag === null
                ? 'bg-violet-600/20 text-violet-400 border-violet-600/40 shadow-[0_0_10px_rgba(139,92,246,0.1)]'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            Все теги
          </button>
          {allUniqueTags.map(tag => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize flex items-center gap-1 ${
                selectedTag === tag
                  ? 'bg-violet-600/20 text-violet-400 border-violet-600/40 shadow-[0_0_10px_rgba(139,92,246,0.1)]'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Tag size={10} />
              {tag}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Загрузка базы знаний...</p>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-slate-900/35 border border-slate-850 border-dashed rounded-2xl text-center">
          <BookOpen size={40} className="text-slate-700 mb-3" />
          <p className="text-sm font-semibold text-slate-400">Материалы не найдены</p>
          <p className="text-xs text-slate-650 mt-1">Попробуйте изменить поисковый запрос или выбрать другой тег</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMaterials.map(m => (
            <div 
              key={m.id} 
              className="bg-slate-900 border border-slate-850 hover:border-violet-500/40 rounded-2xl p-5 hover:shadow-xl hover:shadow-violet-500/5 transition-all duration-300 flex flex-col group relative"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center text-violet-400">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white leading-snug group-hover:text-violet-300 transition-colors line-clamp-1">{m.title}</h3>
                    <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                      <User size={10} /> {m.created_by_name || 'Система'}
                    </p>
                  </div>
                </div>
                {m.can_edit && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 absolute top-4 right-4 transition-all">
                    <button 
                      onClick={() => handleEditClick(m)}
                      className="p-1 text-slate-500 hover:text-violet-400 hover:bg-slate-800 rounded-lg transition-all"
                      title="Редактировать"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button 
                      onClick={() => handleDelete(m.id)}
                      className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
                      title="Удалить"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider w-fit mb-2 ${MATERIAL_CATEGORY_STYLE[m.category] ?? MATERIAL_CATEGORY_STYLE.OTHER}`}>
                {m.category_display}
              </span>
              <p className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-3 flex-1">{m.description || 'Нет описания'}</p>

              {/* Tags list */}
              {m.tags && m.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {m.tags.map(t => (
                    <span 
                      key={t} 
                      onClick={() => setSelectedTag(t)}
                      className="text-[9px] font-bold bg-slate-850 text-slate-400 px-2 py-0.5 rounded border border-slate-800 uppercase tracking-wider cursor-pointer hover:bg-violet-500/10 hover:text-violet-300 hover:border-violet-500/20 transition-all"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Footer info & Buttons */}
              <div className="pt-4 border-t border-slate-850 flex items-center justify-between text-[11px] text-slate-500">
                <div className="flex flex-col gap-1">
                  {m.project_name && (
                    <span className="flex items-center gap-1 text-[10px] text-violet-400 bg-violet-400/5 px-2 py-0.5 rounded border border-violet-500/10 w-fit max-w-[150px] truncate">
                      <FolderOpen size={10} className="flex-shrink-0" />
                      {m.project_name}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[9px] text-slate-500">
                    <Calendar size={10} />
                    {new Date(m.created_at).toLocaleDateString('ru-RU')}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {(m.text_instruction || m.file) && (
                    <button
                      onClick={() => {
                        setPreviewMaterial(m);
                        setIsPreviewModalOpen(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-lg border border-slate-700 transition-colors"
                      title="Просмотреть"
                    >
                      <Eye size={12} /> Просмотр
                    </button>
                  )}
                  {m.file && (
                    <button
                      onClick={() => handleDownload(m)}
                      className="flex items-center justify-center p-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors border border-violet-500 shadow-sm"
                      title={`Скачать файл${m.file_size ? ` (${formatFileSize(m.file_size)})` : ''}`}
                    >
                      <Download size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Add Material */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <BookOpen size={20} className="text-violet-400" /> {editingMaterial ? 'Редактировать материал' : 'Добавить материал в базу'}
              </h2>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Название материала *</label>
                  <input
                    type="text" required autoFocus
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    placeholder="Например: Регламент проведения код-ревью"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Краткое описание</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500 resize-none"
                    placeholder="Опишите кратко, о чем этот документ"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Размещение</label>
                    <select
                      value={projectId}
                      onChange={e => setProjectId(e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    >
                      {canAddGlobal && <option value="">Общая база знаний (видна всем)</option>}
                      {uploadableProjects.map(p => <option key={p.id} value={p.id}>Проект: {p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Тип материала</label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    >
                      {Object.entries(MATERIAL_CATEGORIES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Текстовая инструкция / Методика</label>
                  <textarea
                    rows={6}
                    value={textInstruction}
                    onChange={e => setTextInstruction(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500 resize-y font-sans leading-relaxed"
                    placeholder="Здесь вы можете написать подробную инструкцию (поддерживается обычный текст)..."
                  />
                </div>
                
                {/* File Upload */}
                <div>
                  <label className="block text-xs text-slate-400 mb-2">Файл / Документ</label>
                  <div className="relative border-2 border-dashed border-slate-800 hover:border-violet-500/50 rounded-xl p-6 transition-all group flex flex-col items-center justify-center gap-2 cursor-pointer bg-slate-900/30">
                    <input 
                      type="file" 
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <UploadCloud size={28} className="text-slate-500 group-hover:text-violet-400 transition-colors" />
                    {selectedFile ? (
                      <p className="text-xs font-semibold text-emerald-400 text-center">{selectedFile.name} ({(selectedFile.size/1024/1024).toFixed(2)} MB)</p>
                    ) : (
                      <>
                        <p className="text-xs text-slate-400 group-hover:text-slate-350 transition-colors font-medium">Кликните или перетащите файл сюда</p>
                        <p className="text-[10px] text-slate-600">PDF, DOCX, PNG, JPG, XLS и др. до 10MB</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Tags Management */}
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Теги (нажмите Enter для добавления)</label>
                  <div className="flex flex-wrap gap-2 p-2 bg-slate-850 border border-slate-750 rounded-xl">
                    {tags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-300 text-xs px-2.5 py-1 rounded-lg border border-violet-500/20 capitalize font-medium">
                        {tag}
                        <button type="button" onClick={() => handleRemoveTag(tag)} className="text-violet-400 hover:text-red-400 transition-colors">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={handleAddTag}
                      className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500 px-1 py-0.5"
                      placeholder="Например: регламент, QA, чек-лист..."
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-800 flex items-center justify-end gap-3 flex-shrink-0">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="px-5 py-2 text-sm text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button 
                  type="submit" 
                  disabled={submitting}
                  className="px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-650/30 flex items-center justify-center gap-2"
                >
                  {submitting ? 'Сохранение...' : editingMaterial ? 'Сохранить изменения' : 'Создать материал'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Preview Material */}
      {isPreviewModalOpen && previewMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-100">{previewMaterial.title}</h2>
                <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-3">
                  <span className="flex items-center gap-1"><User size={10} /> Автор: {previewMaterial.created_by_name || 'Администратор'}</span>
                  {previewMaterial.project_name && <span className="flex items-center gap-1"><FolderOpen size={10} /> Проект: {previewMaterial.project_name}</span>}
                  <span className="flex items-center gap-1"><Calendar size={10} /> Дата: {new Date(previewMaterial.created_at).toLocaleDateString('ru-RU')}</span>
                </p>
              </div>
              <button onClick={() => setIsPreviewModalOpen(false)} className="text-slate-500 hover:text-white transition-colors p-1 bg-slate-800 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              {previewMaterial.description && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Описание</h4>
                  <p className="text-xs text-slate-350 leading-relaxed bg-slate-850/30 p-3 rounded-lg border border-slate-850">{previewMaterial.description}</p>
                </div>
              )}

              {previewMaterial.text_instruction && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Текстовая инструкция / Регламент</h4>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-850 text-slate-350 text-sm whitespace-pre-wrap leading-relaxed font-sans max-h-96 overflow-y-auto thin-scrollbar">
                    {previewMaterial.text_instruction}
                  </div>
                </div>
              )}

              {previewMaterial.file && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Вложенный файл</h4>
                  <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-850 rounded-xl">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center text-violet-400">
                        <FileText size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate max-w-[300px]">
                          {previewMaterial.file_name}
                        </p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">
                          {previewMaterial.category_display} · {formatFileSize(previewMaterial.file_size)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownload(previewMaterial)}
                      className="flex items-center gap-1 px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded-lg border border-violet-500 transition-colors shadow shadow-violet-650/30"
                    >
                      <Download size={12} /> Скачать файл
                    </button>
                  </div>
                  
                  {/* Embedded File Preview (Images only for now) */}
                  {/\.(jpe?g|png|gif|svg)$/i.test(previewMaterial.file) && (
                    <div className="mt-4 border border-slate-850 rounded-xl overflow-hidden bg-slate-950 flex justify-center p-4">
                      <img src={previewMaterial.file} alt="Preview" className="max-h-60 object-contain rounded-lg" />
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-800 flex justify-end flex-shrink-0">
              <button 
                onClick={() => setIsPreviewModalOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-750 transition-colors"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Материалы файлового хранилища / базы знаний (KnowledgeMaterial на бэкенде)

export interface KnowledgeMaterial {
  id: number;
  title: string;
  category: string;
  category_display: string;
  description: string;
  text_instruction: string;
  file: string | null;
  file_name: string | null;
  file_size: number | null;
  tags: string[];
  project: number | null;
  project_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  /** Может ли текущий пользователь изменить или удалить материал */
  can_edit: boolean;
}

export const MATERIAL_CATEGORIES: Record<string, string> = {
  SPEC: 'Техническое задание',
  DOC: 'Документ',
  INSTRUCTION: 'Инструкция / регламент',
  OTHER: 'Прочее',
};

export const MATERIAL_CATEGORY_STYLE: Record<string, string> = {
  SPEC: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  DOC: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  INSTRUCTION: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  OTHER: 'bg-slate-700/40 text-slate-400 border-slate-600/30',
};

export const formatFileSize = (bytes: number | null | undefined) => {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
};

export const materialDownloadUrl = (id: number) => `/projects/knowledge-materials/${id}/download/`;

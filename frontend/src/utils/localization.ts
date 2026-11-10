const SKILL_CATEGORY_LABELS: Record<string, string> = {
  Frontend: 'Разработка интерфейсов',
  Backend: 'Разработка серверной части',
  DevOps: 'Разработка и эксплуатация (DevOps)',
  Design: 'Дизайн',
  Analytics: 'Аналитика',
  Management: 'Управление',
  Database: 'Базы данных',
  Data: 'Данные',
  Tools: 'Инструменты',
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  CRITICAL: 'Критический',
};

const RISK_PROBABILITY_LABELS: Record<string, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
};

const RISK_IMPACT_LABELS: Record<string, string> = {
  LOW: 'Низкое',
  MEDIUM: 'Среднее',
  HIGH: 'Высокое',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};

const COMPLEXITY_LABELS: Record<string, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
  CRITICAL: 'Критическая',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  TEXT_REPORT: 'Текстовый отчёт',
  FILE_UPLOAD: 'Загрузка файлов',
  CHECKLIST: 'Чек-лист',
  APPROVAL: 'Утверждение',
  INTEGRATION: 'Интеграция',
};

export const skillCategoryLabel = (value: string) => SKILL_CATEGORY_LABELS[value] ?? value;
export const riskLevelLabel = (value: string) => RISK_LEVEL_LABELS[value] ?? value;
export const riskProbabilityLabel = (value: string) => RISK_PROBABILITY_LABELS[value] ?? value;
export const riskImpactLabel = (value: string) => RISK_IMPACT_LABELS[value] ?? value;
export const priorityLabel = (value: string) => PRIORITY_LABELS[value] ?? value;
export const complexityLabel = (value: string) => COMPLEXITY_LABELS[value] ?? value;
export const taskTypeLabel = (value: string) => TASK_TYPE_LABELS[value] ?? value;

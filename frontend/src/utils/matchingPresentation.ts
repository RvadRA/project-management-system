import type {
  CandidateAssignmentState,
  RequiredSkillChip,
  ScoreDetails,
  ScoreResult,
  ScoreWeights,
  TaskDeadlineStatus,
  TaskPeriodSource,
} from '../types/matching';
import { addDays, startOfToday, toDateKey } from './dates';

export interface SemanticPresentationDetails {
  semantic_similarity?: number | null;
  semantic_available?: boolean;
}

/** Text for the semantic block: never renders an unavailable score as 0%. */
export const formatSemanticSimilarity = (details?: SemanticPresentationDetails | null): string => {
  if (!details || details.semantic_available === false || details.semantic_similarity == null) {
    return 'Семантическая оценка не рассчитана';
  }
  return `Семантическое сходство: ${Math.round(details.semantic_similarity * 100)}%`;
};

export const isSemanticAvailable = (details?: SemanticPresentationDetails | null): boolean =>
  Boolean(details && details.semantic_available !== false && details.semantic_similarity != null);

export const explanationText = (explanation?: string | null): string =>
  explanation?.trim() || 'Объяснение недоступно.';

export const explanationSourceLabel = (source?: string | null): string =>
  source === 'llm' ? 'Объяснение qwen3:4b' : 'Детерминированное объяснение';

export const AVATAR_GRADIENTS = [
  'from-violet-500 to-indigo-500',
  'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-blue-500 to-cyan-500',
  'from-purple-500 to-violet-500',
];

export const getInitials = (name: string) => {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.substring(0, 2).toUpperCase();
};

export const getGradient = (id: number) => AVATAR_GRADIENTS[id % AVATAR_GRADIENTS.length];

export const money = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽/ч`;

/** Пояснения к оценкам: из каких фактических данных сложился каждый компонент. */
export const explainScore = (details: ScoreDetails): Record<string, string> => {
  const out: Record<string, string> = {};
  const c = details.competence;
  if (c) {
    out.competence = c.note ?? [
      c.matched?.length ? `Есть: ${c.matched.join(', ')}` : '',
      c.below_minimum?.length ? `Ниже требуемого: ${c.below_minimum.join(', ')}` : '',
      c.missing?.length ? `Нет: ${c.missing.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
  }
  const e = details.experience;
  if (e) {
    out.experience = e.domain
      ? `Домен проекта: ${e.domain} · домен профиля: ${e.profile_domain || 'не указан'} (${e.profile_match ? 'совпадает' : 'не совпадает'}) · проектов в домене: ${e.domain_projects ?? 0} · выполнено задач в домене: ${e.domain_done_tasks ?? 0}`
      : `Домен не задан · проектов: ${e.projects ?? 0} · выполнено задач: ${e.done_tasks ?? 0}`;
  }
  const a = details.availability;
  if (a) {
    const taskHours = a.open_task_hours ?? 0;
    const unestimated = a.unestimated_open_tasks ?? 0;
    const taskNote = taskHours > 0 || unestimated > 0
      ? ` Оценка открытых задач: ${taskHours} ч${unestimated ? `; без оценки: ${unestimated}` : ''}.`
      : '';
    if (a.workload_known === false) {
      out.availability = `Подтверждённых записей о загрузке за период нет; фактическая загрузка и свободное время не рассчитаны.${taskNote}`;
    } else {
      const avg = a.avg_load_percent ?? 0;
      const peak = a.peak_load_percent ?? 0;
      const free = a.free_percent ?? 0;
      out.availability = `Средняя загрузка за период: ${avg}% (пик ${peak}%) · свободно ≈ ${free}% = ${Math.round(a.available_hours * free / 100)} ч из ${a.available_hours} ч`
        + (a.unavailable_days ? ` · отпуск/больничный: ${a.unavailable_days} из ${a.working_days} раб. дн.` : '')
        + taskNote;
    }
  }
  const p = details.performance;
  if (p) {
    out.performance = p.note ?? `Задач в срок: ${p.done_on_time} · с опозданием: ${p.done_late} · просрочено сейчас: ${p.overdue_open}`
      + (p.manual_ratings ? ` · оценок по проектам: ${p.manual_ratings}` : '');
  }
  const k = details.cost;
  if (k) {
    const rate = k.hourly_rate ? money(k.hourly_rate) : k.assumed_rate ? `не указана, взята средняя ${money(k.assumed_rate)}` : 'не указана';
    const limit = k.rate_limit
      ? (k.limit_source === 'budget' ? `допустимо по бюджету проекта: ${money(k.rate_limit)}` : `минимальная среди кандидатов: ${money(k.rate_limit)}`)
      : '';
    out.cost = k.note ?? [`Ставка: ${rate}`, limit].filter(Boolean).join(' · ');
  }
  return out;
};

/** Сколько процентов времени можно предложить: свободная доля за период, кратно 5. */
export const suggestLoad = (availability: number, details?: ScoreDetails['availability']) => {
  const conservative = (freePercent: number) =>
    Math.min(100, Math.max(5, Math.round((freePercent * 100) / 5) * 5));
  if (details?.workload_known === false) {
    // Без подтверждённых записей о загрузке не предлагаем 100%: учитываем только известные часы задач.
    const estimated = details.task_estimated_load_percent;
    return estimated == null ? 5 : conservative(Math.max(0, 1 - estimated / 100));
  }
  return conservative(availability);
};

export const isAvailabilityKnown = (details?: ScoreDetails | null): boolean =>
  details?.availability?.workload_known !== false;

/** Показывает числовой балл только когда загрузка за период действительно известна. */
export const formatAvailabilityScore = (value: number, details?: ScoreDetails | null): string =>
  isAvailabilityKnown(details) ? `${Math.round(value * 100)}%` : 'н/д';

export const formatDateKey = (value?: string | null): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
};

export interface TaskPeriodInfo {
  start: string;
  end: string;
  dueDate: string | null;
  source: TaskPeriodSource;
  deadlineStatus: TaskDeadlineStatus;
  overdue: boolean;
  slaDays: number;
}

export const taskMatchPeriod = (
  task: { due_date?: string | null; sla_hours?: number | null },
  today = startOfToday(),
): TaskPeriodInfo => {
  const start = toDateKey(today);
  const dueMatch = /^(\d{4}-\d{2}-\d{2})/.exec(task.due_date ?? '');
  const dueDate = dueMatch?.[1] ?? null;
  const deadlineStatus: TaskDeadlineStatus = !dueDate
    ? 'missing'
    : dueDate > start
      ? 'future'
      : dueDate === start
        ? 'today'
        : 'overdue';
  const slaHours = Number(task.sla_hours) > 0 ? Number(task.sla_hours) : 8;
  const slaDays = Math.max(1, Math.ceil(slaHours / 8));
  const source: TaskPeriodSource = deadlineStatus === 'future' ? 'due_date' : 'sla';
  const end = source === 'due_date' && dueDate ? dueDate : toDateKey(addDays(today, slaDays));
  return {
    start,
    end,
    dueDate,
    source,
    deadlineStatus,
    overdue: deadlineStatus === 'overdue',
    slaDays,
  };
};

export const taskPeriodSourceLabel = (
  source: TaskPeriodSource,
  deadlineStatus: TaskDeadlineStatus,
): string => {
  if (source === 'due_date') return 'до дедлайна задачи';
  if (deadlineStatus === 'missing') return 'SLA: дедлайн не задан';
  if (deadlineStatus === 'today') return 'SLA: дедлайн сегодня';
  return 'SLA: дедлайн просрочен';
};

export const effectiveWeightPercent = (
  weights: ScoreWeights | undefined,
  key: keyof ScoreWeights,
): number | null => weights?.[key] == null ? null : Math.round(weights[key] * 100);

export const isCompetenceEvaluated = (
  details: ScoreDetails | null | undefined,
  competenceFilterApplied: boolean,
): boolean => {
  if (!competenceFilterApplied) return false;
  if (!details?.competence) return false;
  if (details.weights && details.weights.w1 <= 0) return false;
  return (details.competence.required ?? 0) > 0;
};

export const isPerformanceNeutral = (details?: ScoreDetails | null): boolean => {
  const performance = details?.performance;
  if (!performance) return false;
  if ((performance.note ?? '').toLowerCase().includes('нет истории')) return true;
  return performance.done_on_time === 0
    && performance.done_late === 0
    && performance.overdue_open === 0
    && performance.manual_ratings === 0;
};

export const isCostNeutral = (details?: ScoreDetails | null): boolean =>
  !details?.cost || details.cost.note === 'Ставки не указаны';

export const isCostAssumed = (details?: ScoreDetails | null): boolean =>
  details?.cost?.assumed_rate != null;

export const dataQualityIssues = (
  result: Pick<ScoreResult, 'details'>,
  competenceFilterApplied: boolean,
): string[] => {
  const issues: string[] = [];
  if (!competenceFilterApplied) {
    issues.push('Компетенции не оценивались: обязательные навыки не заданы или не извлечены.');
  }
  if (isPerformanceNeutral(result.details)) {
    issues.push('Результативность: нет истории задач — в итоговом балле использовано нейтральное значение.');
  }
  if (isCostNeutral(result.details)) {
    issues.push('Бюджет: ставка не указана — в итоговом балле использовано нейтральное значение.');
  } else if (isCostAssumed(result.details)) {
    issues.push('Бюджет: ставка не указана, взята медианная ставка кандидатов — оценка косвенная.');
  }
  return issues;
};

export const currentWorkloadLabel = (
  result: Pick<ScoreResult, 'current_workload' | 'active_task_hours' | 'details'>,
): string => {
  if (result.details?.availability?.current_workload_known === false) {
    return `${result.active_task_hours} ч задач / загрузка н/д`;
  }
  return `${result.current_workload}%`;
};

const AVAILABILITY_WARNING = /загруз|занят|недоступ|отпуск|больнич|workloadentry/i;
const UNAVAILABILITY_WARNING = /недоступ|отпуск|больнич/i;

export const availabilityWarnings = (conflicts: string[]): string[] =>
  conflicts.filter(conflict => conflict.trim() && AVAILABILITY_WARNING.test(conflict));

export const unavailabilityWarnings = (conflicts: string[]): string[] =>
  conflicts.filter(conflict => conflict.trim() && UNAVAILABILITY_WARNING.test(conflict));

export const requiredSkillChips = (details?: ScoreDetails | null): RequiredSkillChip[] => {
  const competence = details?.competence;
  if (!competence) return [];
  return [
    ...(competence.matched ?? []).map(label => ({ label, state: 'matched' as const })),
    ...(competence.below_minimum ?? []).map(label => ({ label, state: 'below_minimum' as const })),
    ...(competence.missing ?? []).map(label => ({ label, state: 'missing' as const })),
  ];
};

interface AssignmentStateOptions {
  isTaskMode: boolean;
  assignedUserId?: number | null;
  isTopThree: boolean;
}

export const getCandidateAssignmentState = (
  result: Pick<ScoreResult, 'user_id' | 'already_member'>,
  options: AssignmentStateOptions,
): CandidateAssignmentState => {
  if (options.isTaskMode && options.assignedUserId != null && options.assignedUserId === result.user_id) {
    return 'assigned';
  }
  if (!options.isTaskMode && result.already_member) {
    return 'assigned';
  }
  return options.isTopThree ? 'recommended' : 'candidate';
};

export const assignmentStateLabel = (
  state: CandidateAssignmentState,
  isTaskMode: boolean,
): string => {
  if (state === 'assigned') return isTaskMode ? 'Назначен на задачу' : 'В команде проекта';
  return state === 'recommended' ? 'Рекомендован' : 'Кандидат';
};

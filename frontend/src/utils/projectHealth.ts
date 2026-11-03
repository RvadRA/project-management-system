import type { Project } from '../context/AppContext';
import { addDays, daysBetween, parseLocalDate, startOfToday } from './dates';

/**
 * Состояние проекта относительно плана. Категории не пересекаются — порядок проверок важен:
 *   overdue — срок вышел, а проект не завершён;
 *   risk    — менеджер или система пометили «В зоне риска»;
 *   behind  — прогресс отстаёт от календарного плана больше чем на 10 пунктов;
 *   ok      — идёт по плану.
 */
export type Health = 'overdue' | 'risk' | 'behind' | 'ok';

export const HEALTH_META: Record<Health, { label: string; badge: string; color: string }> = {
  overdue: { label: 'Просрочен', badge: 'bg-red-500/10 text-red-400 border-red-500/20', color: '#ef4444' },
  risk: { label: 'Есть риски', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', color: '#f59e0b' },
  behind: { label: 'Отстаёт', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20', color: '#f97316' },
  ok: { label: 'В графике', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', color: '#10b981' },
};

/** Какую долю проекта по календарю уже следовало выполнить (0–100); null — сроков нет. */
export const expectedProgress = (project: Project): number | null => {
  const start = parseLocalDate(project.start_date);
  const end = parseLocalDate(project.end_date);
  if (!start || !end) return null;
  const total = Math.max(1, daysBetween(start, end));
  const elapsed = daysBetween(start, startOfToday());
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
};

export const projectHealth = (project: Project): Health => {
  const end = parseLocalDate(project.end_date);
  if (end && end < startOfToday() && project.progress_percentage < 100) return 'overdue';
  if (project.status === 'AT_RISK') return 'risk';
  const expected = expectedProgress(project);
  if (expected !== null && expected - project.progress_percentage > 10) return 'behind';
  return 'ok';
};

export type Forecast =
  | { kind: 'done' }
  | { kind: 'no-dates' }
  | { kind: 'not-started' }
  | { kind: 'no-data' }
  | { kind: 'estimate'; end: Date; delayDays: number; reliable: boolean };

/**
 * Прогноз завершения: если за прошедшие дни выполнено p% работы, вся работа займёт
 * elapsed / p дней от старта. (Раньше вместо прошедших дней подставлялась плановая длительность,
 * поэтому прогноз не зависел от реального темпа.)
 */
export const forecastProject = (project: Project): Forecast => {
  if (project.progress_percentage >= 100) return { kind: 'done' };
  const start = parseLocalDate(project.start_date);
  const end = parseLocalDate(project.end_date);
  if (!start || !end) return { kind: 'no-dates' };
  const elapsed = daysBetween(start, startOfToday());
  if (elapsed <= 0) return { kind: 'not-started' };
  if (project.progress_percentage <= 0) return { kind: 'no-data' };
  const totalDays = elapsed / (project.progress_percentage / 100);
  const forecastEnd = addDays(start, Math.round(totalDays));
  return {
    kind: 'estimate',
    end: forecastEnd,
    delayDays: daysBetween(end, forecastEnd),
    // При малом прогрессе или коротком сроке экстраполяция даёт нереальные даты
    reliable: project.progress_percentage >= 10 && elapsed >= 7,
  };
};

// Отсчёт SLA задачи процесса.
// Срок идёт с момента, когда задача перешла в работу (started_at), до due_date.
// Пока задача ждёт своей очереди, срока у неё нет — сервер проставляет его при активации.

interface SlaTask {
  status: string;
  sla_hours: number;
  due_date: string | null;
  started_at?: string | null;
  is_blocked?: boolean;
}

/**
 * Доля израсходованного времени: 0 — только начали, 1 — срок вышел, больше 1 — просрочка.
 * null — отсчёт не идёт (задача в очереди, без срока или уже закрыта).
 */
export const slaRatio = (task: SlaTask, now = Date.now()): number | null => {
  if (!task.due_date || task.status === 'DONE' || task.status === 'TODO') return null;
  const end = new Date(task.due_date).getTime();
  // У старых задач started_at мог не сохраниться — восстанавливаем начало из срока и SLA
  const start = task.started_at
    ? new Date(task.started_at).getTime()
    : end - (task.sla_hours || 24) * 3600000;
  if (end <= start) return now > end ? 1 : 0;
  return Math.max(0, (now - start) / (end - start));
};

/** «осталось 3 ч», «просрочено на 2 дн.» */
export const slaLabel = (task: SlaTask, now = Date.now()): string => {
  if (task.status === 'DONE') return 'Выполнено';
  if (task.is_blocked) return 'Ждёт предыдущий этап';
  if (!task.due_date) return task.status === 'TODO' ? 'Не начата' : 'Без срока';
  if (task.status === 'TODO') return 'Не начата';
  const diffHours = (new Date(task.due_date).getTime() - now) / 3600000;
  const abs = Math.abs(diffHours);
  const text = abs >= 48 ? `${Math.round(abs / 24)} дн.` : abs >= 1 ? `${Math.round(abs)} ч` : `${Math.max(1, Math.round(abs * 60))} мин`;
  if (task.status === 'REVIEW') return 'На проверке';
  return diffHours >= 0 ? `Осталось ${text}` : `Просрочено на ${text}`;
};

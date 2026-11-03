// Работа с датами без сдвига часовых поясов.
// Строка «2026-10-13» из API — это календарная дата. new Date('2026-10-13') разбирает её как полночь
// по UTC, и в часовом поясе восточнее UTC первый день отпуска, срока и т.п. «съезжал» на соседний.

/** «2026-10-13» → локальная полночь этого дня. */
export const parseLocalDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Date → «2026-10-13» по локальным компонентам (toISOString сдвигает день в поясах восточнее UTC). */
export const toDateKey = (date: Date): string => {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
};

export const startOfToday = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** «2027-03-22» → ISO-момент конца этого дня по локальному времени. */
export const toEndOfDayIso = (dateKey: string | null | undefined): string | null => {
  const date = parseLocalDate(dateKey);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
};

export const DAY_MS = 86_400_000;

/** Целое число дней между датами (b − a); переход на летнее время не влияет. */
export const daysBetween = (a: Date, b: Date): number =>
  Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const formatDate = (date: Date): string => date.toLocaleDateString('ru-RU');

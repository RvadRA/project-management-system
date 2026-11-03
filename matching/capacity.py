"""
Модель загрузки сотрудников — единые правила для подбора, назначения и аналитики.

  • Рабочий день = WORKDAY_HOURS часов (настройка, по умолчанию 8).
    Рабочие дни — будни без праздников производственного календаря.
  • «Загрузка на проект, %» — доля рабочего времени сотрудника, закреплённая за проектом
    на период [start, end]. 100% = полный рабочий день. Часы за период = % × рабочие часы периода.
  • Занятость сотрудника на дату — сумма загрузок по его активным записям (проекты
    завершены или отменены — запись не учитывается). Допустимо не более 100%.
  • Отпуск и больничный уменьшают доступные рабочие часы периода.
  • Трудозатраты задач (часы) — оценка задач, это отдельная величина и с процентами не смешивается.
"""
import datetime
from typing import Iterable, Optional, Set

# Записи загрузки по проектам в этих статусах не занимают сотрудника
INACTIVE_PROJECT_STATUSES = ('COMPLETED', 'CANCELLED')
DEFAULT_WORKDAY_HOURS = 8.0
MAX_PERIOD_DAYS = 3660


def workday_hours() -> float:
    """Длина рабочего дня в часах (Настройки → Система → WORKDAY_HOURS)."""
    from projects.models import GlobalSetting
    try:
        value = float(GlobalSetting.get_value('WORKDAY_HOURS', str(DEFAULT_WORKDAY_HOURS)))
    except (TypeError, ValueError):
        return DEFAULT_WORKDAY_HOURS
    return value if 0 < value <= 24 else DEFAULT_WORKDAY_HOURS


def holidays_for(calendar=None) -> Set[datetime.date]:
    """Праздники указанного календаря; без календаря — календаря по умолчанию."""
    from plans.models import CalendarHoliday, WorkCalendar
    if calendar is None:
        calendar = WorkCalendar.objects.filter(is_default=True).first()
    if calendar is None:
        return set()
    return set(CalendarHoliday.objects.filter(calendar=calendar).values_list('date', flat=True))


def _days(start: datetime.date, end: datetime.date):
    day = start
    while day <= end:
        yield day
        day += datetime.timedelta(days=1)


def is_working_day(day: datetime.date, holidays: Iterable[datetime.date] = ()) -> bool:
    return day.weekday() < 5 and day not in holidays


def period_capacity(entries, leaves, start: datetime.date, end: datetime.date,
                    holidays: Iterable[datetime.date] = (), hours_per_day: float = DEFAULT_WORKDAY_HOURS) -> dict:
    """
    Загрузка и свободное время сотрудника за период.

    entries — записи загрузки (start_date, end_date, load_percent);
    leaves  — отпуска / больничные (start_date, end_date).
    """
    if end < start:
        start, end = end, start
    end = min(end, start + datetime.timedelta(days=MAX_PERIOD_DAYS))
    holidays = set(holidays)
    all_days = list(_days(start, end))
    working = [d for d in all_days if is_working_day(d, holidays)]
    # Период целиком из выходных: считаем по календарным дням, часов при этом нет
    basis = working or all_days

    entries = list(entries)
    leave_days = set()
    for leave in leaves:
        for day in _days(max(leave.start_date, start), min(leave.end_date, end)):
            leave_days.add(day)

    load_by_day = {
        day: sum(e.load_percent for e in entries if e.start_date <= day <= e.end_date)
        for day in basis
    }
    avg_load = sum(load_by_day.values()) / len(basis)
    peak_load = max(load_by_day.values())
    present = [d for d in basis if d not in leave_days]
    available_hours = len(present) * hours_per_day if working else 0.0

    return {
        'period_days': len(all_days),
        'working_days': len(working),
        'unavailable_days': len(basis) - len(present),
        'present_share': len(present) / len(basis),
        'available_hours': round(available_hours, 1),
        'avg_load_percent': round(avg_load, 1),
        'peak_load_percent': round(peak_load, 1),
        # Гарантированно свободно на весь период (по самому загруженному дню)
        'free_percent': round(max(0.0, 100.0 - peak_load), 1),
        'avg_free_percent': round(max(0.0, 100.0 - avg_load), 1),
    }


def hours_to_percent(hours: float, available_hours: float) -> Optional[float]:
    return round(hours / available_hours * 100, 1) if available_hours > 0 else None


def percent_to_hours(percent: float, available_hours: float) -> float:
    return round(percent / 100.0 * available_hours, 1)

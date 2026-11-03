"""
Движок матчинга сотрудников на проект.

Формула скоринга:
  Score = w1*competence_fit + w2*experience_similarity + w3*availability + w4*past_performance + w5*cost_fit

Все компоненты нормированы в диапазоне [0, 1], веса нормируются к сумме 1,
поэтому итоговый балл тоже лежит в [0, 1].

Каждый компонент считается по фактическим данным системы:
  competence_fit        – уровни навыков сотрудника против требуемых;
  experience_similarity – домен профиля, проекты и выполненные задачи в этом домене;
  availability          – средняя загрузка и отпуска за запрошенный период (см. capacity.py);
  past_performance      – доля задач, сданных в срок, просрочки, ручные оценки по проектам;
  cost_fit              – ставка сотрудника против допустимой ставки по бюджету проекта.
"""
import datetime
import re
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from django.utils import timezone

from .capacity import INACTIVE_PROJECT_STATUSES, holidays_for, period_capacity, workday_hours
from .models import (
    EmployeeProfile, EmployeeSkill, EmployeeUnavailability, ProjectParticipation, Skill, WorkloadEntry,
)


# ── Веса по умолчанию (могут переопределяться для конкретного проекта) ──────
DEFAULT_WEIGHTS = dict(
    w1=0.35,  # competence_fit
    w2=0.20,  # experience_similarity
    w3=0.25,  # availability
    w4=0.15,  # past_performance
    w5=0.05,  # cost_fit
)

# Сколько проектов / задач в домене считается «полным» опытом
EXPERIENCE_PROJECTS_CAP = 3
EXPERIENCE_TASKS_CAP = 10
GENERAL_PROJECTS_CAP = 5
GENERAL_TASKS_CAP = 20

# Сглаживание результативности: при малом числе задач оценка тянется к нейтральным 0.5,
# чтобы одна сданная в срок задача не давала 100%
PERFORMANCE_PRIOR_TASKS = 2
# Ручная оценка руководителя по завершённому проекту весит как столько задач
MANUAL_RATING_TASKS = 5
NEUTRAL = 0.5
HOURS_PER_DAY = 8


@dataclass
class RequiredSkill:
    skill_id: int
    min_level: int = 1          # 1-5
    preferred_level: int = 3    # 1-5


@dataclass
class CandidateScore:
    employee: EmployeeProfile
    total_score: float
    competence_fit: float
    experience_similarity: float
    availability: float
    past_performance: float
    cost_fit: float
    conflicts: List[str] = field(default_factory=list)
    explanation: str = ""
    # Из чего сложилась каждая оценка — для объяснимости в интерфейсе
    details: Dict[str, dict] = field(default_factory=dict)
    # Каких данных не хватило (компонент посчитан по нейтральному значению)
    data_gaps: List[str] = field(default_factory=list)
    already_member: bool = False
    current_workload: float = 0.0
    active_task_hours: float = 0.0
    open_task_count: int = 0
    unestimated_task_count: int = 0


def normalize_weights(weights: Optional[dict], disabled: Iterable[str] = ()) -> Dict[str, float]:
    """
    Приводит веса к сумме 1. Нечисловые и отрицательные значения отбрасываются.
    disabled — компоненты, для которых нет входных данных (их вес обнуляется,
    остальные перераспределяются пропорционально).
    """
    result = {}
    for key, default in DEFAULT_WEIGHTS.items():
        raw = (weights or {}).get(key, default)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            value = default
        result[key] = max(value, 0.0)
    for key in disabled:
        result[key] = 0.0
    total = sum(result.values())
    if total <= 0:
        result = {k: (0.0 if k in disabled else v) for k, v in DEFAULT_WEIGHTS.items()}
        total = sum(result.values()) or 1.0
    return {k: v / total for k, v in result.items()}


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _same(a: Optional[str], b: Optional[str]) -> bool:
    return bool(a and b and a.strip().lower() == b.strip().lower())


def _overlap_days(a_start, a_end, b_start, b_end) -> int:
    start, end = max(a_start, b_start), min(a_end, b_end)
    return (end - start).days + 1 if end >= start else 0


def _working_hours(start: datetime.date, end: datetime.date, calendar=None) -> int:
    from projects.services import get_working_days_delta
    days = get_working_days_delta(start, end + datetime.timedelta(days=1), calendar)
    return max(days, 1) * HOURS_PER_DAY


# ── Компоненты формулы ───────────────────────────────────────────────────────

def _competence_fit(skills: Dict[int, EmployeeSkill], required: List[RequiredSkill], skill_names: Dict[int, str]):
    """Насколько навыки сотрудника соответствуют требованиям."""
    if not required:
        return NEUTRAL, {'required': 0, 'note': 'Требуемые навыки не заданы'}
    score_sum = 0.0
    matched, weak, missing = [], [], []
    for req in required:
        name = skill_names.get(req.skill_id, f'#{req.skill_id}')
        min_level = max(1, min(5, req.min_level))
        preferred = max(min_level, min(5, req.preferred_level))
        es = skills.get(req.skill_id)
        if es is None:
            missing.append(name)
        elif es.level < min_level:
            # Ниже минимума — частичный балл
            score_sum += es.level / min_level * 0.5
            weak.append(f'{name} ({es.level} из {min_level})')
        else:
            # Минимум выполнен — половина балла, остальное по близости к желаемому уровню
            score_sum += 0.5 + min(es.level / preferred, 1.0) * 0.5
            matched.append(f'{name} ({es.level})')
    return score_sum / len(required), {
        'required': len(required), 'matched': matched, 'below_minimum': weak, 'missing': missing,
    }


def _experience_similarity(profile, domain, project_domains: Dict[int, str], done_task_domains: List[str], exclude_project_id):
    """
    Опыт в домене проекта: домен профиля, проекты сотрудника в этом домене
    (участие в командах и история завершённых проектов), выполненные там задачи.
    """
    projects = {pid: d for pid, d in project_domains.items() if pid != exclude_project_id}
    if not domain:
        # Домен не задан — общая «опытность» по числу проектов и выполненных задач
        score = (
            0.6 * min(len(projects) / GENERAL_PROJECTS_CAP, 1.0)
            + 0.4 * min(len(done_task_domains) / GENERAL_TASKS_CAP, 1.0)
        )
        return score, {'projects': len(projects), 'done_tasks': len(done_task_domains), 'domain': None}

    profile_match = _same(profile.domain, domain)
    domain_projects = sum(1 for d in projects.values() if _same(d, domain))
    domain_tasks = sum(1 for d in done_task_domains if _same(d, domain))
    score = (
        0.5 * (1.0 if profile_match else 0.0)
        + 0.3 * min(domain_projects / EXPERIENCE_PROJECTS_CAP, 1.0)
        + 0.2 * min(domain_tasks / EXPERIENCE_TASKS_CAP, 1.0)
    )
    return score, {
        'domain': domain, 'profile_domain': profile.domain or None, 'profile_match': profile_match,
        'domain_projects': domain_projects, 'domain_done_tasks': domain_tasks,
    }


def _availability(entries, unavailability, start: datetime.date, end: datetime.date, exclude_project_id,
                  holidays, hours_per_day):
    """
    Доступность в запрошенный период: свободная доля рабочего времени
    (100% минус средняя загрузка) за вычетом дней отпуска / болезни.
    Считается по рабочим дням календаря (без выходных и праздников).
    """
    # Загрузка по самому целевому проекту не должна штрафовать его участников
    workload_known = bool(entries)
    entries = [e for e in entries if not (exclude_project_id and e.project_id == exclude_project_id)]
    cap = period_capacity(entries, unavailability, start, end, holidays, hours_per_day)
    free_share = _clamp(1.0 - cap['avg_load_percent'] / 100.0)
    availability = (
        _clamp(free_share * cap['present_share'])
        if workload_known else NEUTRAL * cap['present_share']
    )
    return availability, cap


def _past_performance(task_stats: dict, manual_scores: List[float]):
    """
    Результативность по фактам: задачи, сданные в срок (1 балл), с опозданием (0.5),
    просроченные и эскалированные незакрытые (0). Ручная оценка по завершённому проекту
    (ProjectParticipation.performance_score) учитывается как MANUAL_RATING_TASKS задач,
    чтобы одна старая оценка не перекрывала десяток свежих просрочек.
    """
    on_time, late, overdue = task_stats['on_time'], task_stats['late'], task_stats['overdue_open']
    judged = on_time + late + overdue
    details = {
        'done_on_time': on_time, 'done_late': late, 'overdue_open': overdue,
        'manual_ratings': len(manual_scores),
    }
    if not judged and not manual_scores:
        details['note'] = 'Нет истории задач и оценок'
        return NEUTRAL, details

    points = on_time * 1.0 + late * 0.5 + sum(manual_scores) * MANUAL_RATING_TASKS
    evidence = judged + len(manual_scores) * MANUAL_RATING_TASKS
    # Сглаживание к нейтральным 0.5 при малом числе наблюдений
    score = (PERFORMANCE_PRIOR_TASKS * NEUTRAL + points) / (PERFORMANCE_PRIOR_TASKS + evidence)
    return _clamp(score), details


def _cost_fit(rate: float, rate_limit: Optional[float], pool_min_rate: Optional[float], pool_median_rate: Optional[float]):
    """
    Соответствие стоимости: ставка сотрудника против допустимой ставки по бюджету проекта.
    Без бюджета сравниваем с самой низкой ставкой среди кандидатов (дешевле — лучше).
    Если ставка не указана, берём медианную по кандидатам — отсутствие данных не должно давать преимущество.
    """
    details = {'hourly_rate': rate or None}
    effective = rate
    if effective <= 0:
        if not pool_median_rate:
            details['note'] = 'Ставки не указаны'
            return NEUTRAL, details
        effective = pool_median_rate
        details['assumed_rate'] = round(pool_median_rate, 2)

    limit = rate_limit if rate_limit and rate_limit > 0 else pool_min_rate
    details['rate_limit'] = round(limit, 2) if limit else None
    details['limit_source'] = 'budget' if rate_limit and rate_limit > 0 else 'cheapest_candidate'
    if not limit:
        return NEUTRAL, details
    return _clamp(limit / effective), details


# ── Загрузка данных пачкой (без запроса на каждого сотрудника) ───────────────

def task_timeliness(status, due, completed_at, report_submitted_at, now=None):
    """
    Как задача выполнена относительно срока — единое правило для подбора и карточки сотрудника:
      on_time — выполнена в срок;  late — выполнена с опозданием;
      overdue — не выполнена, срок вышел (или эскалирована);
      review  — сдана и ждёт проверки;  open — в работе или в очереди.
    """
    now = now or timezone.now()
    if status == 'DONE':
        # Срок оцениваем по моменту сдачи отчёта: ожидание проверки менеджером — не вина исполнителя
        finished = min(filter(None, [completed_at, report_submitted_at]), default=None)
        return 'late' if due and finished and finished > due else 'on_time'
    if status == 'REVIEW':
        # Задача на проверке уже сдана исполнителем — просрочкой не считаем
        return 'review'
    if status == 'ESCALATED' or (due and due < now):
        return 'overdue'
    return 'open'


def _load_task_stats(user_ids):
    """По каждому пользователю: задачи в срок / с опозданием / просроченные и домены выполненных задач."""
    from workflows.models import WorkflowTask

    now = timezone.now()
    stats = defaultdict(lambda: {
        'on_time': 0, 'late': 0, 'overdue_open': 0, 'done_domains': [],
        'active_hours': 0.0, 'open_tasks': 0, 'unestimated': 0,
    })
    rows = WorkflowTask.objects.filter(assigned_to_id__in=user_ids).values(
        'assigned_to_id', 'status', 'due_date', 'completed_at', 'estimated_hours',
        'report__submitted_at', 'workflow__project__domain',
    )
    for row in rows:
        s = stats[row['assigned_to_id']]
        due = row['due_date']
        kind = task_timeliness(row['status'], due, row['completed_at'], row['report__submitted_at'], now)
        if row['status'] == 'DONE':
            s['done_domains'].append(row['workflow__project__domain'] or '')
            s[kind] += 1
        else:
            # Нагрузка задачами — по оценке трудозатрат; SLA (срок выполнения) часами работы не является
            s['open_tasks'] += 1
            if row['estimated_hours'] and row['estimated_hours'] > 0:
                s['active_hours'] += row['estimated_hours']
            else:
                s['unestimated'] += 1
            if kind == 'overdue':
                s['overdue_open'] += 1
    return stats


def _project_rate_limit(project, start, end):
    """
    Допустимая средняя ставка по бюджету проекта:
      бюджет / (FTE команды с учётом кандидата × рабочие часы проекта).
    """
    if not project or not project.budget or project.budget <= 0:
        return None, None
    p_start = project.start_date or start
    p_end = project.end_date or end
    if p_end < p_start:
        p_start, p_end = start, end
    hours = _working_hours(p_start, p_end, project.calendar)
    team_fte = sum(m.allocation_percentage for m in project.members.all()) / 100.0
    limit = float(project.budget) / ((team_fte + 1.0) * hours)
    return limit, {'budget': float(project.budget), 'team_fte': round(team_fte, 2), 'project_hours': hours}


# ── Публичный API движка ─────────────────────────────────────────────────────

def rank_candidates(
    project_start: datetime.date,
    project_end: datetime.date,
    required_skills: List[RequiredSkill],
    domain: Optional[str] = None,
    max_hourly_rate: Optional[float] = None,
    weights: Optional[dict] = None,
    employee_ids: Optional[List[int]] = None,
    project=None,
    warn_about_membership: bool = True,
) -> List[CandidateScore]:
    """
    Возвращает отсортированный список CandidateScore.

    Args:
        project_start / project_end – период, на который нужен сотрудник
        required_skills             – список RequiredSkill
        domain                      – домен проекта для experience_similarity
        max_hourly_rate             – явная предельная ставка (иначе выводится из бюджета project)
        weights                     – кастомные веса (нормируются к сумме 1)
        employee_ids                – если задан, ранжировать только этих сотрудников
        project                     – целевой проект: бюджет, домен по умолчанию, состав команды
        warn_about_membership       – предупреждать, что кандидат уже в команде проекта
                                      (при подборе на задачу это не конфликт, а плюс)
    """
    if project_end < project_start:
        project_start, project_end = project_end, project_start
    if project is not None and not domain:
        domain = project.domain
    project_id = project.id if project is not None else None

    # Без требуемых навыков компонент «Компетенции» у всех одинаков — исключаем его из суммы
    w = normalize_weights(weights, disabled=() if required_skills else ('w1',))

    # Кандидаты — действующие сотрудники; учётные записи администраторов системы в подбор не входят
    profiles = EmployeeProfile.objects.select_related('user').filter(user__is_active=True).exclude(user__role='ADMIN')
    if employee_ids:
        profiles = profiles.filter(id__in=employee_ids)
    profiles = list(profiles)
    if not profiles:
        return []
    profile_ids = [p.id for p in profiles]
    user_ids = [p.user_id for p in profiles]
    today = datetime.date.today()

    skills_by_emp = defaultdict(dict)
    for es in EmployeeSkill.objects.filter(employee_id__in=profile_ids):
        skills_by_emp[es.employee_id][es.skill_id] = es
    skill_names = dict(Skill.objects.filter(id__in=[r.skill_id for r in required_skills]).values_list('id', 'name'))

    entries_by_emp = defaultdict(list)
    current_load = defaultdict(float)
    current_load_known = set()
    for entry in WorkloadEntry.objects.filter(employee_id__in=profile_ids).exclude(
        project__status__in=INACTIVE_PROJECT_STATUSES,
    ):
        if entry.start_date <= today <= entry.end_date:
            current_load[entry.employee_id] += entry.load_percent
            current_load_known.add(entry.employee_id)
        if entry.start_date <= project_end and entry.end_date >= project_start:
            entries_by_emp[entry.employee_id].append(entry)

    unavail_by_emp = defaultdict(list)
    for item in EmployeeUnavailability.objects.filter(
        employee_id__in=profile_ids, start_date__lte=project_end, end_date__gte=project_start,
    ):
        unavail_by_emp[item.employee_id].append(item)

    # Проекты сотрудника: текущие команды + история завершённых проектов
    from projects.models import ProjectMember
    projects_by_user = defaultdict(dict)
    members_of_target = set()
    for user_id, pid, pdomain in ProjectMember.objects.filter(user_id__in=user_ids).values_list(
        'user_id', 'project_id', 'project__domain',
    ):
        projects_by_user[user_id][pid] = pdomain or ''
        if pid == project_id:
            members_of_target.add(user_id)
    manual_scores = defaultdict(list)
    profile_user = {p.id: p.user_id for p in profiles}
    for emp_id, pid, pdomain, score in ProjectParticipation.objects.filter(employee_id__in=profile_ids).values_list(
        'employee_id', 'project_id', 'project__domain', 'performance_score',
    ):
        projects_by_user[profile_user[emp_id]][pid] = pdomain or ''
        if score and score > 0:
            manual_scores[emp_id].append(min(float(score), 1.0))

    task_stats = _load_task_stats(user_ids)
    holidays = holidays_for(project.calendar if project is not None else None)
    hours_per_day = workday_hours()

    budget_details = None
    rate_limit = None
    if max_hourly_rate is not None:
        try:
            rate_limit = float(max_hourly_rate)
        except (TypeError, ValueError):
            rate_limit = None
    if not rate_limit or rate_limit <= 0:
        rate_limit, budget_details = _project_rate_limit(project, project_start, project_end)
    known_rates = [float(p.hourly_rate) for p in profiles if p.hourly_rate and p.hourly_rate > 0]
    pool_min_rate = min(known_rates) if known_rates else None
    pool_median_rate = statistics.median(known_rates) if known_rates else None

    results: List[CandidateScore] = []
    for emp in profiles:
        stats = task_stats[emp.user_id]
        gaps = []

        cf, cf_d = _competence_fit(skills_by_emp[emp.id], required_skills, skill_names)
        es, es_d = _experience_similarity(emp, domain, projects_by_user[emp.user_id], stats['done_domains'], project_id)
        period_entries = entries_by_emp[emp.id]
        counted_entries = [
            entry for entry in period_entries
            if not (project_id and entry.project_id == project_id)
        ]
        av, av_d = _availability(
            period_entries, unavail_by_emp[emp.id], project_start, project_end, project_id,
            holidays, hours_per_day,
        )
        av_d = dict(av_d)
        workload_known = bool(period_entries)
        av_d.update({
            'workload_known': workload_known,
            'workload_source': 'workload_entries' if workload_known else 'none',
            'workload_records': len(period_entries),
            'workload_records_counted': len(counted_entries),
            'target_project_load_excluded': bool(period_entries and not counted_entries and project_id),
            'current_workload_known': emp.id in current_load_known,
            'open_task_hours': round(stats['active_hours'], 1),
            'unestimated_open_tasks': stats['unestimated'],
            'task_estimate_complete': stats['unestimated'] == 0,
        })
        if not workload_known:
            # No WorkloadEntry is not evidence of zero load or 100% free time.
            av_d['free_percent'] = None
        if stats['active_hours'] > 0 and av_d.get('available_hours'):
            av_d['task_estimated_load_percent'] = round(
                stats['active_hours'] / av_d['available_hours'] * 100, 1,
            )
        else:
            av_d['task_estimated_load_percent'] = None

        pp, pp_d = _past_performance(stats, manual_scores[emp.id])
        ct, ct_d = _cost_fit(float(emp.hourly_rate or 0), rate_limit, pool_min_rate, pool_median_rate)
        if budget_details and ct_d.get('limit_source') == 'budget':
            ct_d.update(budget_details)

        if not skills_by_emp[emp.id]:
            gaps.append('Навыки не заполнены')
        if 'note' in pp_d:
            gaps.append('Нет истории задач')
        if not emp.hourly_rate or emp.hourly_rate <= 0:
            gaps.append('Ставка не указана')
        if domain and not emp.domain:
            gaps.append('Домен в профиле не указан')
        if not workload_known:
            gaps.append('Нет записей загрузки за период')
        if stats['unestimated']:
            gaps.append(f'Трудозатраты не указаны у {stats["unestimated"]} открытых задач')

        total = w['w1'] * cf + w['w2'] * es + w['w3'] * av + w['w4'] * pp + w['w5'] * ct

        already_member = emp.user_id in members_of_target
        conflicts = _build_conflicts(
            entries_by_emp[emp.id], unavail_by_emp[emp.id], av_d, cf_d, stats,
            already_member and warn_about_membership, project_id,
        )
        explanation = (
            f"Компетенции {cf:.0%}, Опыт {es:.0%}, "
            f"Доступность {av:.0%}, Результативность {pp:.0%}, "
            f"Бюджет {ct:.0%}"
        )

        results.append(CandidateScore(
            employee=emp,
            total_score=round(total, 4),
            competence_fit=round(cf, 4),
            experience_similarity=round(es, 4),
            availability=round(av, 4),
            past_performance=round(pp, 4),
            cost_fit=round(ct, 4),
            conflicts=conflicts,
            explanation=explanation,
            details={
                'competence': cf_d, 'experience': es_d, 'availability': av_d,
                'performance': pp_d, 'cost': ct_d,
                'weights': {k: round(v, 4) for k, v in w.items()},
            },
            data_gaps=gaps,
            already_member=already_member,
            current_workload=round(current_load[emp.id], 1),
            active_task_hours=round(stats['active_hours'], 1),
            open_task_count=stats['open_tasks'],
            unestimated_task_count=stats['unestimated'],
        ))

    results.sort(key=lambda x: x.total_score, reverse=True)
    return results


def _build_conflicts(entries, unavailability, availability_details, competence_details, stats, already_member, project_id):
    conflicts = []
    if already_member:
        conflicts.append("Уже состоит в команде этого проекта")
    avg_load = availability_details['avg_load_percent']
    peak_load = availability_details['peak_load_percent']
    if avg_load >= 100:
        conflicts.append(f"Полностью занят в этот период (средняя загрузка {avg_load:.0f}%)")
    elif avg_load >= 80:
        conflicts.append(f"Высокая средняя загрузка за период: {avg_load:.0f}%")
    elif peak_load >= 100:
        conflicts.append("В отдельные дни периода полностью занят (пик 100%)")
    for o in entries:
        if o.load_percent >= 80 and o.project_id != project_id:
            conflicts.append(
                f"Загрузка {o.load_percent}% с {o.start_date} по {o.end_date}"
                + (f" ({o.note})" if o.note else "")
            )
    for u in unavailability:
        conflicts.append(
            f"Недоступен: {u.get_type_display()} с {u.start_date} по {u.end_date}"
            + (f" ({u.note})" if u.note else "")
        )
    if competence_details.get('missing'):
        conflicts.append("Нет навыков: " + ", ".join(competence_details['missing']))
    if not entries and stats['open_tasks']:
        conflicts.append("Нет записей загрузки; фактическая занятость по проектам неизвестна")
    if stats['unestimated']:
        conflicts.append(f"Трудозатраты не указаны у {stats['unestimated']} открытых задач")
    if stats['overdue_open']:
        conflicts.append(f"Просроченных задач сейчас: {stats['overdue_open']}")
    return conflicts


# ── Подбор под конкретную задачу процесса ────────────────────────────────────

def skills_from_text(*texts: Optional[str]) -> List[Skill]:
    """Навыки из справочника, названия которых встречаются в тексте задачи."""
    text = ' '.join(t for t in texts if t).lower()
    if not text.strip():
        return []
    found = []
    for skill in Skill.objects.all():
        name = skill.name.strip().lower()
        if name and re.search(r'(?<![\w+#])' + re.escape(name) + r'(?![\w+#])', text):
            found.append(skill)
    return found


def rank_for_task(task, weights: Optional[dict] = None, required_skills: Optional[List[RequiredSkill]] = None) -> List[CandidateScore]:
    """
    Подбор исполнителя на задачу процесса тем же движком, что и общий подбор:
    навыки берутся из текста задачи, домен и бюджет — из проекта, период — до дедлайна задачи.
    """
    project = task.workflow.project
    today = datetime.date.today()
    if task.due_date and task.due_date.date() > today:
        end = task.due_date.date()
    else:
        end = today + datetime.timedelta(days=max(1, -(-(task.sla_hours or HOURS_PER_DAY) // HOURS_PER_DAY)))

    wbs = task.linked_wbs_task
    skills = skills_from_text(
        task.name, task.description, task.workflow.name,
        wbs.name if wbs else None, wbs.description if wbs else None,
    )
    required = required_skills if required_skills is not None else [
        RequiredSkill(skill_id=s.id, min_level=2, preferred_level=3) for s in skills
    ]
    return rank_candidates(
        project_start=today,
        project_end=end,
        required_skills=required,
        domain=project.domain if project else None,
        weights=weights,
        project=project,
        warn_about_membership=False,
    )

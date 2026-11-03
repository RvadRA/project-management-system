"""Pure-Python rule baseline for synthetic experiments.

This module mirrors the *meaning* of the production deterministic components,
but it does not import ``matching.scoring`` because that module requires ORM
objects and the experiment must never touch PostgreSQL.

Availability policy (experiment-only; production scoring is unchanged):

* The working calendar is Monday-Friday, inclusive, with no holiday calendar.
  Weekends are not working days.
* The task period is inclusive: ``[assigned_at, deadline]``.  If the deadline
  precedes the assignment date, the two dates are swapped.
* Unavailability intervals are inclusive and are unioned as working-day leave.
* Known workload: ``(1 - avg_load / 100) * present_share``.
* Unknown workload: ``0.5 * present_share``; known leave still reduces the
  neutral value.  With no leave this remains 0.5.
* ``present_share`` is the share of working days not covered by leave.  If the
  period contains no working days, availability is zero and the candidate is
  excluded.  A full leave period therefore always gives score 0.
"""
from __future__ import annotations

import datetime
import statistics
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .schema import Employee, HistoryTask, RequiredSkill, Task, parse_date

WEIGHTS = {
    "competence": 0.35,
    "experience": 0.20,
    "availability": 0.25,
    "performance": 0.15,
    "cost": 0.05,
}
MIN_SKILL_LEVEL = 2
UNKNOWN_AVAILABILITY = 0.5
NEUTRAL = 0.5
PERFORMANCE_PRIOR_TASKS = 2
MANUAL_RATING_TASKS = 5
EXPERIENCE_PROJECT_CAP = 3
EXPERIENCE_TASK_CAP = 10
GENERAL_PROJECT_CAP = 5
GENERAL_TASK_CAP = 20
HOURS_PER_DAY = 8


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _clamp_level(value: int) -> int:
    return max(1, min(5, int(value)))


def overlap_days(start_a: datetime.date, end_a: datetime.date,
                 start_b: datetime.date, end_b: datetime.date) -> int:
    start, end = max(start_a, start_b), min(end_a, end_b)
    return (end - start).days + 1 if end >= start else 0


def _working_days(start: datetime.date, end: datetime.date) -> List[datetime.date]:
    """Return inclusive Mon-Fri working days; weekends are never working days."""
    days = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            days.append(current)
        current += datetime.timedelta(days=1)
    return days


def availability_for(employee: Employee, task: Task) -> Dict[str, object]:
    start, end = parse_date(task.assigned_at), parse_date(task.deadline)
    if end < start:
        start, end = end, start
    entries = [
        item for item in employee.workload
        if overlap_days(parse_date(item.start_date), parse_date(item.end_date), start, end) > 0
    ]
    working = _working_days(start, end)
    leave_working_days = set()
    leave_types = set()
    for item in employee.unavailability:
        leave_start, leave_end = parse_date(item.start_date), parse_date(item.end_date)
        hit = False
        for day in working:
            if leave_start <= day <= leave_end:
                leave_working_days.add(day)
                hit = True
        if hit:
            leave_types.add(item.type)

    if not working:
        return {
            "score": 0.0,
            "available": False,
            "workload_known": bool(entries),
            "workload_records": len(entries),
            "avg_load_percent": None,
            "peak_load_percent": None,
            "free_percent": None,
            "present_share": 0.0,
            "leave_days": 0,
            "leave_types": sorted(leave_types),
            "policy": "no_working_days",
        }

    present_share = (len(working) - len(leave_working_days)) / len(working)
    present_share = round(present_share, 6)
    if not entries:
        score = round(UNKNOWN_AVAILABILITY * present_share, 6)
        return {
            "score": score,
            "available": score > 0.0,
            "workload_known": False,
            "workload_records": 0,
            "avg_load_percent": None,
            "peak_load_percent": None,
            "free_percent": None,
            "present_share": present_share,
            "leave_days": len(leave_working_days),
            "leave_types": sorted(leave_types),
            "policy": "neutral_0.5_scaled_by_present_share",
        }

    load_by_day = {}
    for day in working:
        load_by_day[day] = sum(
            item.load_percent for item in entries
            if parse_date(item.start_date) <= day <= parse_date(item.end_date)
        )
    avg_load = sum(load_by_day.values()) / len(working)
    peak_load = max(load_by_day.values()) if load_by_day else 0.0
    score = round(clamp((1.0 - avg_load / 100.0) * present_share), 6)
    return {
        "score": score,
        "available": score > 0.0,
        "workload_known": True,
        "workload_records": len(entries),
        "avg_load_percent": round(avg_load, 1),
        "peak_load_percent": round(peak_load, 1),
        "free_percent": round(max(0.0, 100.0 - peak_load), 1),
        "present_share": present_share,
        "leave_days": len(leave_working_days),
        "leave_types": sorted(leave_types),
        "policy": "workload_entries_scaled_by_present_share",
    }


def history_at(employee: Employee, assigned_at: str,
               excluded_task_ids: Iterable[str] = ()) -> List[HistoryTask]:
    """Only completed tasks strictly before assignment, never the target task."""
    excluded = set(excluded_task_ids)
    cutoff = parse_date(assigned_at)
    rows = []
    for item in employee.history:
        if item.id in excluded:
            continue
        if parse_date(item.completed_at) < cutoff:
            rows.append(item)
    return rows


def skill_match(employee: Employee, required: Sequence[RequiredSkill]) -> Dict[str, object]:
    skill_map = employee.skill_map
    score_sum = 0.0
    matched, below_minimum, missing = [], [], []
    for req in required:
        min_level = _clamp_level(req.min_level)
        preferred = _clamp_level(max(req.preferred_level, min_level))
        skill = skill_map.get(req.name)
        if skill is None:
            missing.append(req.name)
            continue
        if skill.level < min_level:
            score_sum += skill.level / min_level * 0.5
            below_minimum.append(f"{req.name} ({skill.level} из {min_level})")
            continue
        score_sum += 0.5 + min(skill.level / preferred, 1.0) * 0.5
        matched.append(f"{req.name} ({skill.level})")
    score = score_sum / len(required) if required else NEUTRAL
    return {
        "score": clamp(score),
        "matched": matched,
        "below_minimum": below_minimum,
        "missing": missing,
        "required": len(required),
    }


def experience_similarity(employee: Employee, task: Task,
                          history: Sequence[HistoryTask]) -> Dict[str, object]:
    history_domains = [item.domain for item in history if item.domain]
    active_projects = {
        item.project_id for item in employee.workload
        if parse_date(item.start_date) <= parse_date(task.assigned_at)
    }
    project_domains = {
        item.domain for item in employee.workload
        if parse_date(item.start_date) <= parse_date(task.assigned_at)
    }
    if not task.domain:
        score = (
            0.6 * min(len(active_projects) / GENERAL_PROJECT_CAP, 1.0)
            + 0.4 * min(len(history_domains) / GENERAL_TASK_CAP, 1.0)
        )
        return {
            "score": clamp(score), "domain": None, "projects": len(active_projects),
            "done_tasks": len(history_domains),
        }
    profile_match = bool(employee.domain and employee.domain.lower() == task.domain.lower())
    domain_projects = sum(1 for item in project_domains if item.lower() == task.domain.lower())
    domain_tasks = sum(1 for item in history_domains if item.lower() == task.domain.lower())
    score = (
        0.5 * (1.0 if profile_match else 0.0)
        + 0.3 * min(domain_projects / EXPERIENCE_PROJECT_CAP, 1.0)
        + 0.2 * min(domain_tasks / EXPERIENCE_TASK_CAP, 1.0)
    )
    return {
        "score": clamp(score),
        "domain": task.domain,
        "profile_domain": employee.domain or None,
        "profile_match": profile_match,
        "domain_projects": domain_projects,
        "domain_done_tasks": domain_tasks,
    }


def past_performance(employee: Employee, history: Sequence[HistoryTask],
                     assigned_at: str) -> Dict[str, object]:
    on_time = sum(1 for item in history if item.on_time)
    late = sum(1 for item in history if not item.on_time)
    manual_scores = [
        item.score for item in employee.manual_ratings
        if parse_date(item.rated_at) < parse_date(assigned_at)
    ]
    judged = on_time + late
    details = {
        "done_on_time": on_time,
        "done_late": late,
        "manual_ratings": len(manual_scores),
        "judged": judged,
    }
    if not judged and not manual_scores:
        details["note"] = "Нет истории задач и оценок"
        return {"score": NEUTRAL, "details": details}
    points = on_time * 1.0 + late * 0.5 + sum(manual_scores) * MANUAL_RATING_TASKS
    evidence = judged + len(manual_scores) * MANUAL_RATING_TASKS
    score = (PERFORMANCE_PRIOR_TASKS * NEUTRAL + points) / (PERFORMANCE_PRIOR_TASKS + evidence)
    return {"score": clamp(score), "details": details}


def cost_fit(employee: Employee, task: Task, pool: Sequence[Employee]) -> Dict[str, object]:
    rates = [float(item.hourly_rate) for item in pool if item.hourly_rate and item.hourly_rate > 0]
    median_rate = statistics.median(rates) if rates else None
    min_rate = min(rates) if rates else None
    effective = float(employee.hourly_rate) if employee.hourly_rate and employee.hourly_rate > 0 else median_rate
    if not effective:
        return {"score": NEUTRAL, "note": "Ставки не указаны", "hourly_rate": None}
    limit = task.max_hourly_rate if task.max_hourly_rate and task.max_hourly_rate > 0 else min_rate
    if not limit:
        return {"score": NEUTRAL, "note": "Предельная ставка не задана", "hourly_rate": effective}
    return {
        "score": clamp(limit / effective),
        "hourly_rate": round(effective, 2),
        "rate_limit": round(float(limit), 2),
        "limit_source": "task" if task.max_hourly_rate else "cheapest_candidate",
        "assumed_rate": None if employee.hourly_rate else round(median_rate, 2),
    }


@dataclass
class ScoredCandidate:
    employee: Employee
    total_score: float
    competence: float
    experience: float
    availability: float
    performance: float
    cost: float
    details: Dict[str, object] = field(default_factory=dict)
    data_gaps: List[str] = field(default_factory=list)
    explanation: str = ""

    @property
    def employee_id(self) -> str:
        return self.employee.id

    def to_dict(self) -> Dict[str, object]:
        return {
            "employee_id": self.employee.id,
            "name": self.employee.name,
            "total_score": round(self.total_score, 4),
            "components": {
                "competence": round(self.competence, 4),
                "experience": round(self.experience, 4),
                "availability": round(self.availability, 4),
                "performance": round(self.performance, 4),
                "cost": round(self.cost, 4),
            },
            "details": self.details,
            "data_gaps": list(self.data_gaps),
            "explanation": self.explanation,
        }


def _explanation(employee: Employee, task: Task, details: Dict[str, object],
                 gaps: List[str]) -> str:
    competence = details["competence"]
    availability = details["availability"]
    performance = details["performance"]
    matched = ", ".join(competence.get("matched") or [])
    parts = []
    if matched:
        parts.append(f"Совпадают обязательные навыки: {matched}.")
    else:
        parts.append("Обязательные навыки не подтверждены.")
    if availability.get("workload_known"):
        parts.append(
            "Доступность {:.0%}; средняя загрузка {}%.".format(
                float(availability["score"]), availability.get("avg_load_percent"),
            )
        )
    else:
        parts.append("Загрузка неизвестна; применена нейтральная оценка доступности 50%.")
    history = performance.get("details", {})
    parts.append(
        "История: {} задач, {} в срок.".format(
            history.get("judged", 0), history.get("done_on_time", 0),
        )
    )
    if gaps:
        parts.append("Пробелы в данных: " + "; ".join(gaps) + ".")
    return " ".join(parts)


def score_candidate(employee: Employee, task: Task, pool: Sequence[Employee],
                    excluded_task_ids: Iterable[str] = ()) -> ScoredCandidate:
    history = history_at(employee, task.assigned_at, excluded_task_ids)
    competence = skill_match(employee, task.required_skills)
    experience = experience_similarity(employee, task, history)
    availability = availability_for(employee, task)
    performance = past_performance(employee, history, task.assigned_at)
    cost = cost_fit(employee, task, pool)
    total = (
        WEIGHTS["competence"] * float(competence["score"])
        + WEIGHTS["experience"] * float(experience["score"])
        + WEIGHTS["availability"] * float(availability["score"])
        + WEIGHTS["performance"] * float(performance["score"])
        + WEIGHTS["cost"] * float(cost["score"])
    )
    gaps = []
    if not employee.skill_map:
        gaps.append("Навыки не заполнены")
    if not history and not any(parse_date(item.rated_at) < parse_date(task.assigned_at)
                               for item in employee.manual_ratings):
        gaps.append("Нет истории задач")
    if not employee.hourly_rate:
        gaps.append("Ставка не указана")
    if not availability["workload_known"]:
        gaps.append("Нет записей загрузки за период")
    details = {
        "competence": competence,
        "experience": experience,
        "availability": availability,
        "performance": performance,
        "cost": cost,
        "weights": dict(WEIGHTS),
    }
    candidate = ScoredCandidate(
        employee=employee,
        total_score=round(total, 6),
        competence=float(competence["score"]),
        experience=float(experience["score"]),
        availability=float(availability["score"]),
        performance=float(performance["score"]),
        cost=float(cost["score"]),
        details=details,
        data_gaps=gaps,
    )
    candidate.explanation = _explanation(employee, task, details, gaps)
    return candidate


def hard_filter_reasons(candidate: ScoredCandidate) -> List[Dict[str, object]]:
    reasons = []
    competence = candidate.details["competence"]
    missing = list(competence.get("missing") or [])
    below = list(competence.get("below_minimum") or [])
    if missing:
        reasons.append({
            "code": "missing_required_skills",
            "skills": missing,
            "message": "Нет обязательных навыков: " + ", ".join(missing),
        })
    if below:
        reasons.append({
            "code": "below_minimum_skills",
            "skills": below,
            "message": "Навыки ниже минимального уровня: " + ", ".join(below),
        })
    if candidate.availability <= 0:
        reasons.append({
            "code": "zero_availability",
            "message": "Нет доступности в выбранном периоде.",
        })
    return reasons


@dataclass
class FilteredCandidates:
    scored: List[ScoredCandidate]
    eligible: List[ScoredCandidate]
    excluded: List[Dict[str, object]]


def filter_candidates(task: Task, employees: Sequence[Employee],
                      excluded_task_ids: Iterable[str] = ()) -> FilteredCandidates:
    scored = [score_candidate(employee, task, employees, excluded_task_ids)
              for employee in employees]
    eligible, excluded = [], []
    for candidate in scored:
        reasons = hard_filter_reasons(candidate)
        if reasons:
            excluded.append({
                "employee_id": candidate.employee.id,
                "name": candidate.employee.name,
                "reasons": reasons,
            })
        else:
            eligible.append(candidate)
    eligible.sort(key=lambda item: item.total_score, reverse=True)
    return FilteredCandidates(scored=scored, eligible=eligible, excluded=excluded)


def rule_rank(task: Task, employees: Sequence[Employee],
              excluded_task_ids: Iterable[str] = ()) -> FilteredCandidates:
    return filter_candidates(task, employees, excluded_task_ids)

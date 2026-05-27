"""
Движок матчинга сотрудников на проект.

Формула скоринга:
  Score = w1*competence_fit + w2*experience_similarity + w3*availability + w4*past_performance + w5*cost_fit

Все компоненты нормированы в диапазоне [0, 1].
"""
import datetime
from dataclasses import dataclass, field
from typing import List, Optional

from .models import EmployeeProfile, EmployeeSkill, WorkloadEntry, EmployeeUnavailability


# ── Веса по умолчанию (могут переопределяться для конкретного проекта) ──────
DEFAULT_WEIGHTS = dict(
    w1=0.35,  # competence_fit
    w2=0.20,  # experience_similarity
    w3=0.25,  # availability
    w4=0.15,  # past_performance
    w5=0.05,  # cost_fit
)


@dataclass
class RequiredSkill:
    skill_id: int
    min_level: int           # 1-5
    preferred_level: int     # 1-5


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


# ── Компоненты формулы ───────────────────────────────────────────────────────

def _competence_fit(employee: EmployeeProfile, required: List[RequiredSkill]) -> float:
    """Насколько навыки сотрудника соответствуют требованиям задачи."""
    if not required:
        return 1.0
    skill_map = {
        es.skill_id: es
        for es in EmployeeSkill.objects.filter(employee=employee)
    }
    score_sum = 0.0
    for req in required:
        es = skill_map.get(req.skill_id)
        if es is None:
            # Навыка нет совсем — 0
            score_sum += 0.0
        elif es.level < req.min_level:
            # Ниже минимума — частичный балл
            score_sum += es.level / req.min_level * 0.5
        else:
            # Выше минимума, прицел на preferred
            ratio = min(es.level / req.preferred_level, 1.0)
            score_sum += 0.5 + ratio * 0.5
    return score_sum / len(required)


def _experience_similarity(employee: EmployeeProfile, domain: Optional[str]) -> float:
    """Опыт в похожих доменах через профиль и историю участия в проектах."""
    score = 0.0
    
    if not domain:
        # Если домен проекта не задан, возвращаем общую "опытность"
        # Базируется на количестве завершенных проектов (1 проект = 0.2 балла)
        return min(employee.participations.count() / 5, 1.0)

    # 1. Проверка основного домена сотрудника (из его профиля)
    if employee.domain and domain.strip().lower() == employee.domain.strip().lower():
        score += 0.7  # Основной домен — это сильный сигнал (70% соответствия)
    
    # 2. Проверка истории проектов (каждый подходящий проект добавляет веса)
    # Используем prefetch_related в rank_candidates, поэтому тут просто итерируемся
    participations = employee.participations.all()
    domain_hits = 0
    for p in participations:
        # Пытаемся получить доступ к проекту. 
        # Если это ProjectParticipation, у него есть поле project
        try:
            proj = p.project
            if proj.domain and domain.strip().lower() == proj.domain.strip().lower():
                domain_hits += 1.0
            elif domain.strip().lower() in (proj.name or '').lower() or domain.strip().lower() in (proj.description or '').lower():
                domain_hits += 0.3
        except:
            continue
            
    score += domain_hits * 0.2 # Каждый проект в тему дает +20%
    
    return min(score, 1.0)


def _availability(
    employee: EmployeeProfile,
    start_date: datetime.date,
    end_date: datetime.date,
) -> float:
    """
    Доступность сотрудника. 
    Базируется на текущей динамической загрузке.
    """
    load = float(employee.current_workload_percentage)
    
    # Check for unavailability overlaps
    unavailability_overlap = EmployeeUnavailability.objects.filter(
        employee=employee,
        start_date__lte=end_date,
        end_date__gte=start_date
    ).exists()
    
    base_score = (100 - load) / 100
    if unavailability_overlap:
        base_score -= 0.5  # Significant penalty for explicit unavailability

    if load >= 100:
        penalty = (load - 100) * 0.05
        return max(-1.0, base_score - penalty)
        
    return max(0.0, base_score)


def _past_performance(employee: EmployeeProfile) -> float:
    """Средняя оценка результативности по прошлым проектам."""
    scores = [p.performance_score for p in employee.participations.all() if p.performance_score > 0]
    return sum(scores) / len(scores) if scores else 0.5  # нейтральный балл если история пуста


def _cost_fit(employee: EmployeeProfile, budget: Optional[float], duration_months: float = 1.0) -> float:
    """Соответствие стоимости сотрудника бюджету проекта."""
    if not budget or budget <= 0:
        return 1.0
    rate = float(employee.hourly_rate)
    if rate <= 0:
        return 1.0
    
    # Estimate cost: rate * 160 hours/month * duration
    estimated_cost = rate * 160 * duration_months
    if estimated_cost <= budget:
        return 1.0
    
    ratio = budget / estimated_cost
    return max(0.0, ratio)


# ── Публичный API движка ─────────────────────────────────────────────────────

def _build_conflicts(
    employee: EmployeeProfile,
    start_date: datetime.date,
    end_date: datetime.date,
) -> List[str]:
    conflicts = []
    overloads = WorkloadEntry.objects.filter(
        employee=employee,
        start_date__lte=end_date,
        end_date__gte=start_date,
        load_percent__gte=80,
    )
    for o in overloads:
        conflicts.append(
            f"Высокая загрузка {o.load_percent}% с {o.start_date} по {o.end_date}"
            + (f" ({o.note})" if o.note else "")
        )
    
    # Check for unavailability
    unavail_list = EmployeeUnavailability.objects.filter(
        employee=employee,
        start_date__lte=end_date,
        end_date__gte=start_date,
    )
    for u in unavail_list:
        conflicts.append(
            f"Недоступен: {u.get_type_display()} с {u.start_date} по {u.end_date}"
            + (f" ({u.note})" if u.note else "")
        )
    return conflicts


def rank_candidates(
    project_start: datetime.date,
    project_end: datetime.date,
    required_skills: List[RequiredSkill],
    domain: Optional[str] = None,
    max_hourly_rate: Optional[float] = None,
    weights: Optional[dict] = None,
    employee_ids: Optional[List[int]] = None,
) -> List[CandidateScore]:
    """
    Возвращает отсортированный список CandidateScore для всех подходящих сотрудников.

    Args:
        project_start / project_end – период проекта
        required_skills             – список RequiredSkill
        domain                      – домен проекта для experience_similarity
        max_hourly_rate             – максимальная ставка (бюджет)
        weights                     – кастомные веса (переопределяют DEFAULT_WEIGHTS)
        employee_ids                – если задан, ранжировать только этих сотрудников
    """
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    qs = EmployeeProfile.objects.prefetch_related('employee_skills', 'participations', 'workload_entries')
    if employee_ids:
        qs = qs.filter(id__in=employee_ids)

    results: List[CandidateScore] = []
    for emp in qs:
        cf = _competence_fit(emp, required_skills)
        es = _experience_similarity(emp, domain)
        av = _availability(emp, project_start, project_end)
        pp = _past_performance(emp)
        
        # Calculate duration in months for cost estimate
        days = (project_end - project_start).days or 30
        months = max(1.0, days / 30.0)
        ct = _cost_fit(emp, max_hourly_rate, months)

        total = (
            w['w1'] * cf +
            w['w2'] * es +
            w['w3'] * av +
            w['w4'] * pp +
            w['w5'] * ct
        )

        conflicts = _build_conflicts(emp, project_start, project_end)
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
        ))

    results.sort(key=lambda x: x.total_score, reverse=True)
    return results

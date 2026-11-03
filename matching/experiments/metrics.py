"""Ranking and secondary metrics for matching experiments."""
from __future__ import annotations

import math
import re
import statistics
from typing import Dict, Iterable, List, Optional, Sequence

from .catalog import SKILL_NAMES

TARGET_METHODS_WITH_EXPLANATION = ("rule", "embedding", "hybrid", "direct_llm")


def rank_of(target_id: Optional[str], ranking: Sequence[str]) -> Optional[int]:
    if not target_id:
        return None
    try:
        return ranking.index(target_id) + 1
    except ValueError:
        return None


def ndcg_at_3(target_id: Optional[str], ranking: Sequence[str]) -> Optional[float]:
    rank = rank_of(target_id, ranking)
    if rank is None or rank > 3:
        return 0.0
    return 1.0 / math.log2(rank + 1)


def percentile(values: Sequence[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    index = (len(ordered) - 1) * ratio
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return round(ordered[int(index)], 2)
    value = ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
    return round(value, 2)


def _mean(values: Sequence[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def _mean_optional(values: Sequence[float]) -> Optional[float]:
    return round(sum(values) / len(values), 4) if values else None


def _rate(values: Sequence[bool]) -> float:
    return round(sum(1 for value in values if value) / len(values), 4) if values else 0.0


def _rate_optional(values: Sequence[bool]) -> Optional[float]:
    return round(sum(1 for value in values if value) / len(values), 4) if values else None


def _explanation_applicable(method: str) -> bool:
    return method in TARGET_METHODS_WITH_EXPLANATION


def _mentions(text: str, skill: str) -> bool:
    pattern = rf"(?<![A-Za-z0-9+#/]){re.escape(skill.lower())}(?![A-Za-z0-9+#/])"
    return re.search(pattern, text) is not None


def explanation_factuality(row: Dict[str, object]) -> Optional[bool]:
    if not _explanation_applicable(str(row["method"])):
        return None
    text = str(row.get("top1_explanation") or "")
    if not text.strip():
        return False
    lowered = text.lower()
    unknown = bool(row.get("top1_unknown_workload"))
    claims_free = any(phrase in lowered for phrase in (
        "полностью свобод", "100% свобод", "загрузка 0%", "занятость 0%",
    ))
    negated = any(phrase in lowered for phrase in (
        "не полностью", "не свобод", "нельзя", "не указано", "неизвест",
    ))
    if unknown and claims_free and not negated:
        return False
    matched = list(row.get("top1_matched_skills") or [])
    if matched and not any(
        _mentions(lowered, skill.split(" (", 1)[0]) for skill in matched
    ):
        return False
    candidate_skills = {
        name.lower() for name in (row.get("top1_employee_skills") or [])
    }
    allowed = {name.split(" (", 1)[0].lower() for name in matched}
    allowed.update(candidate_skills)
    for skill in SKILL_NAMES:
        if _mentions(lowered, skill) and skill.lower() not in allowed:
            return False
    return True


def _balance_metrics(rows: Sequence[Dict[str, object]], employee_count: int) -> Dict[str, object]:
    hours: Dict[str, float] = {}
    for row in rows:
        if row.get("error"):
            continue
        top1 = row.get("top1_employee_id")
        if not top1:
            continue
        hours[str(top1)] = hours.get(str(top1), 0.0) + float(row.get("estimated_hours") or 0)
    values = list(hours.values())
    if len(values) >= 2 and sum(values) > 0:
        mean = statistics.mean(values)
        cv = statistics.pstdev(values) / mean if mean else 0.0
    else:
        cv = 0.0
    return {
        "assigned_employees": len(hours),
        "zero_assignment_share": round(
            max(0, employee_count - len(hours)) / employee_count, 4
        ) if employee_count else 0.0,
        "assigned_hours_cv": round(cv, 4),
        "max_assigned_hours": round(max(values), 2) if values else 0.0,
        "min_assigned_hours": round(min(values), 2) if values else 0.0,
    }


def calculate_metrics(rows: Sequence[Dict[str, object]],
                      employee_count: int) -> Dict[str, object]:
    target_rows = [row for row in rows if row.get("target_employee_id")]
    no_target_rows = [row for row in rows if not row.get("target_employee_id")]
    coverage_ratios = [
        float(row.get("eligible_count") or 0) / employee_count
        for row in rows if employee_count
    ]
    coverage_with_target = [
        float(row.get("eligible_count") or 0) / employee_count
        for row in target_rows if employee_count
    ]
    coverage_without_target = [
        float(row.get("eligible_count") or 0) / employee_count
        for row in no_target_rows if employee_count
    ]
    target_covered = [
        bool(row.get("target_employee_id") in (row.get("eligible_ids") or []))
        for row in target_rows
    ]
    top1 = [
        row.get("target_employee_id") is not None
        and row.get("top1_employee_id") == row.get("target_employee_id")
        for row in target_rows
    ]
    top3 = [
        row.get("target_employee_id") in (row.get("top3_ids") or [])
        for row in target_rows
    ]
    rr = [
        (1.0 / row["target_rank"]) if row.get("target_rank") else 0.0
        for row in target_rows
    ]
    ndcg = [
        ndcg_at_3(row.get("target_employee_id"), row.get("ranking_ids") or []) or 0.0
        for row in target_rows
    ]
    latencies = [float(row.get("latency_ms") or 0) for row in rows if not row.get("error")]
    explanation_rows = [
        row for row in target_rows
        if row.get("top1_employee_id")
        and _explanation_applicable(str(row["method"]))
    ]
    explanation_pass = [
        result for result in (explanation_factuality(row) for row in explanation_rows)
        if result is not None
    ]
    errors = [row for row in rows if row.get("error")]
    return {
        "tasks": len(rows),
        "target_tasks": len(target_rows),
        "no_target_tasks": len(no_target_rows),
        "top1": _rate_optional(top1),
        "top3": _rate_optional(top3),
        "mrr": _mean_optional(rr),
        "ndcg3": _mean_optional(ndcg),
        "false_exclusion_rate": (
            round(1.0 - _rate(target_covered), 4) if target_covered else None
        ),
        "candidate_coverage": _mean_optional(coverage_ratios),
        "candidate_coverage_with_target": _mean_optional(coverage_with_target),
        "candidate_coverage_without_target": _mean_optional(coverage_without_target),
        "task_coverage": _rate_optional([
            bool(row.get("eligible_count")) for row in rows
        ]),
        "task_coverage_with_target": _rate_optional([
            bool(row.get("eligible_count")) for row in target_rows
        ]),
        "task_coverage_without_target": _rate_optional([
            bool(row.get("eligible_count")) for row in no_target_rows
        ]),
        "excluded_candidates_mean": _mean_optional([
            float(row.get("excluded_count") or 0) for row in rows
        ]),
        "explanation_present_rate": _rate_optional([
            bool(str(row.get("top1_explanation") or "").strip())
            for row in explanation_rows
        ]),
        "explanation_factuality_pass_rate": (
            _rate(explanation_pass) if explanation_pass else None
        ),
        "explanation_checked": len(explanation_rows),
        "latency_p50_ms": percentile(latencies, 0.50),
        "latency_p95_ms": percentile(latencies, 0.95),
        "errors": len(errors),
        "error_rate": _rate([bool(row.get("error")) for row in rows]),
        "balance": _balance_metrics(rows, employee_count),
    }


def calculate_by_scenario(rows: Sequence[Dict[str, object]],
                          employee_count: int) -> Dict[str, Dict[str, object]]:
    scenarios = sorted({str(row["scenario"]) for row in rows})
    return {
        scenario: calculate_metrics(
            [row for row in rows if row["scenario"] == scenario], employee_count,
        )
        for scenario in scenarios
    }

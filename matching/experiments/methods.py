"""Experiment method adapters.

All methods receive the same 30-employee pool and the same mandatory filters:
required skills at level 2+ and availability > 0.  Unknown workload is not a
hard exclusion by itself; neutral 0.5 availability is scaled by the share of
working days not covered by known leave.  Full-period leave is excluded.
"""
from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence

from .embeddings import EmbeddingProvider, cosine, employee_text, task_text
from .llm import PROMPT_VERSION, LLMUnavailable, rank_with_llm
from .rules import ScoredCandidate, filter_candidates, history_at
from .schema import Employee, Task


METHOD_RULES: Dict[str, str] = {
    "rule": (
        "Rule-based: hard filter (all required skills level 2+, availability > 0); "
        "score = .35 competence + .20 domain/history + .25 availability + "
        ".15 past performance + .05 cost. Unknown workload = neutral 0.5 "
        "scaled by present working-day share; full leave is excluded."
    ),
    "embedding": (
        "Embedding-based: same hard filter; rank eligible candidates by cosine "
        "similarity between task text and employee profile/history text. "
        "Provider is recorded per run; hashing vectors are synthetic."
    ),
    "hybrid": (
        "Hybrid: same hard filter; score = .80 * rule score + .20 * embedding cosine. "
        "Only eligible candidates are ranked."
    ),
    "random": (
        "Random baseline: same hard filter, deterministic per-task shuffle using "
        "seed and task ID."
    ),
    "popularity": (
        "Popularity baseline: same hard filter, rank by number of completed history "
        "tasks before assignment; ties by on-time rate."
    ),
    "direct_llm": (
        "Direct LLM: same hard filter, then local qwen3:4b receives the task and "
        "anonymized eligible candidate facts and must return a complete JSON ranking."
    ),
}


class MethodUnavailable(Exception):
    pass


@dataclass
class RankedCandidate:
    employee_id: str
    score: float
    explanation: str
    details: Dict[str, object] = field(default_factory=dict)
    source: str = ""

    def to_dict(self) -> Dict[str, object]:
        return {
            "employee_id": self.employee_id,
            "score": round(self.score, 6),
            "explanation": self.explanation,
            "details": self.details,
            "source": self.source,
        }


@dataclass
class MethodResult:
    method: str
    ranked: List[RankedCandidate] = field(default_factory=list)
    eligible: List[str] = field(default_factory=list)
    excluded: List[Dict[str, object]] = field(default_factory=list)
    latency_ms: float = 0.0
    error: Optional[str] = None
    meta: Dict[str, object] = field(default_factory=dict)

    def ids(self) -> List[str]:
        return [item.employee_id for item in self.ranked]


def _semantic_note(provider: EmbeddingProvider, similarity: float) -> str:
    if provider.synthetic_vectors:
        return (
            "Семантическая близость: {:.0%} (детерминированные синтетические векторы; "
            "не результат языковой модели).".format(similarity)
        )
    return "Семантическая близость: {:.0%} (локальная модель Ollama {}).".format(
        similarity, provider.model,
    )


class BaseMethod:
    name = "base"

    def __init__(self, seed: int = 42):
        self.seed = seed

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        raise NotImplementedError

    def _excluded(self, task: Task, excluded_task_ids: Iterable[str]) -> tuple[str, ...]:
        return tuple(excluded_task_ids) or (task.id,)


class RuleMethod(BaseMethod):
    name = "rule"

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        started = time.perf_counter()
        excluded = self._excluded(task, excluded_task_ids)
        filtered = filter_candidates(task, employees, excluded)
        ranked = [
            RankedCandidate(
                employee_id=item.employee.id,
                score=item.total_score,
                explanation=item.explanation,
                details=item.to_dict(),
                source="rule",
            )
            for item in filtered.eligible
        ]
        return MethodResult(
            method=self.name,
            ranked=ranked,
            eligible=[item.employee.id for item in filtered.eligible],
            excluded=filtered.excluded,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            meta={"weights": {"competence": .35, "experience": .20, "availability": .25,
                              "performance": .15, "cost": .05},
                  "unknown_load_policy": "neutral_0.5_scaled_by_present_share"},
        )


class RandomMethod(BaseMethod):
    name = "random"

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        started = time.perf_counter()
        excluded = self._excluded(task, excluded_task_ids)
        filtered = filter_candidates(task, employees, excluded)
        ids = [item.employee.id for item in filtered.eligible]
        rng = random.Random(f"{self.seed}:{task.id}:random")
        rng.shuffle(ids)
        ranked = [
            RankedCandidate(
                employee_id=employee_id,
                score=round(1.0 - index / max(len(ids), 1), 6),
                explanation="Случайный baseline; обязательные фильтры применены.",
                source="random",
            )
            for index, employee_id in enumerate(ids)
        ]
        return MethodResult(
            method=self.name,
            ranked=ranked,
            eligible=ids,
            excluded=filtered.excluded,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            meta={"seed": self.seed, "deterministic_per_task": True},
        )


class PopularityMethod(BaseMethod):
    name = "popularity"

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        started = time.perf_counter()
        excluded = self._excluded(task, excluded_task_ids)
        filtered = filter_candidates(task, employees, excluded)
        max_history = max((len(history_at(item.employee, task.assigned_at, excluded))
                           for item in filtered.eligible), default=1) or 1
        ranked = []
        for item in filtered.eligible:
            history = history_at(item.employee, task.assigned_at, excluded)
            on_time = sum(1 for row in history if row.on_time)
            score = len(history) / max_history
            explanation = (
                f"Popularity baseline: {len(history)} завершённых задач, "
                f"{on_time} в срок; обязательные фильтры применены."
            )
            ranked.append(RankedCandidate(
                employee_id=item.employee.id,
                score=round(score, 6),
                explanation=explanation,
                source="popularity",
            ))
        ranked.sort(key=lambda row: (row.score, row.employee_id), reverse=True)
        return MethodResult(
            method=self.name,
            ranked=ranked,
            eligible=[item.employee.id for item in filtered.eligible],
            excluded=filtered.excluded,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            meta={"max_history": max_history},
        )


class EmbeddingMethod(BaseMethod):
    name = "embedding"

    def __init__(self, provider: EmbeddingProvider, seed: int = 42):
        super().__init__(seed)
        self.provider = provider

    def _vectors(self, task: Task, candidates: Sequence[ScoredCandidate],
                 excluded: Iterable[str]):
        task_vector = self.provider.embed(task_text(task))
        values = []
        for item in candidates:
            history = history_at(item.employee, task.assigned_at, excluded)
            vector = self.provider.embed(employee_text(item.employee, history))
            values.append((item.employee, history, cosine(task_vector, vector)))
        return values

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        started = time.perf_counter()
        excluded = self._excluded(task, excluded_task_ids)
        filtered = filter_candidates(task, employees, excluded)
        if not filtered.eligible:
            return MethodResult(
                method=self.name, eligible=[], excluded=filtered.excluded,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
                meta=self.provider.metadata(),
            )
        try:
            vectors = self._vectors(task, filtered.eligible, excluded)
        except Exception as exc:
            raise MethodUnavailable(f"{self.name}: {exc}") from exc
        by_id = {item.employee.id: item for item in filtered.eligible}
        ranked = []
        for employee, _history, similarity in vectors:
            base = by_id[employee.id]
            ranked.append(RankedCandidate(
                employee_id=employee.id,
                score=round(similarity, 6),
                explanation=(
                    base.explanation + " " + _semantic_note(self.provider, similarity)
                ),
                details={
                    "semantic_similarity": round(similarity, 6),
                    "rule_score": round(base.total_score, 6),
                    "embedding": self.provider.metadata(),
                },
                source="embedding",
            ))
        ranked.sort(key=lambda row: (row.score, row.employee_id), reverse=True)
        return MethodResult(
            method=self.name,
            ranked=ranked,
            eligible=[item.employee.id for item in filtered.eligible],
            excluded=filtered.excluded,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            meta=self.provider.metadata(),
        )


class HybridMethod(BaseMethod):
    name = "hybrid"

    def __init__(self, provider: EmbeddingProvider, seed: int = 42):
        super().__init__(seed)
        self.provider = provider

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        started = time.perf_counter()
        excluded = self._excluded(task, excluded_task_ids)
        filtered = filter_candidates(task, employees, excluded)
        if not filtered.eligible:
            return MethodResult(
                method=self.name, eligible=[], excluded=filtered.excluded,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
                meta={"embedding": self.provider.metadata(), "formula": "0.8*rule+0.2*semantic"},
            )
        try:
            task_vector = self.provider.embed(task_text(task))
        except Exception as exc:
            raise MethodUnavailable(f"{self.name}: {exc}") from exc
        ranked = []
        for item in filtered.eligible:
            history = history_at(item.employee, task.assigned_at, excluded)
            try:
                vector = self.provider.embed(employee_text(item.employee, history))
            except Exception as exc:
                raise MethodUnavailable(f"{self.name}: {exc}") from exc
            similarity = cosine(task_vector, vector)
            total = 0.8 * item.total_score + 0.2 * similarity
            ranked.append(RankedCandidate(
                employee_id=item.employee.id,
                score=round(total, 6),
                explanation=item.explanation + " " + _semantic_note(self.provider, similarity),
                details={
                    "rule_score": round(item.total_score, 6),
                    "semantic_similarity": round(similarity, 6),
                    "formula": "0.8*rule+0.2*semantic",
                    "embedding": self.provider.metadata(),
                },
                source="hybrid",
            ))
        ranked.sort(key=lambda row: (row.score, row.employee_id), reverse=True)
        return MethodResult(
            method=self.name,
            ranked=ranked,
            eligible=[item.employee.id for item in filtered.eligible],
            excluded=filtered.excluded,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            meta={"embedding": self.provider.metadata(), "formula": "0.8*rule+0.2*semantic"},
        )


class DirectLLMMethod(BaseMethod):
    name = "direct_llm"

    def __init__(self, model: str, timeout: int = 180, seed: int = 42):
        super().__init__(seed)
        self.model = model
        self.timeout = timeout

    def _task_payload(self, task: Task) -> Dict[str, object]:
        return {
            "title": task.title,
            "description": task.description,
            "task_type": task.task_type,
            "priority": task.priority,
            "deadline": task.deadline,
            "estimated_hours": task.estimated_hours,
            "domain": task.domain,
            "required_skills": [
                {"name": item.name, "min_level": item.min_level,
                 "preferred_level": item.preferred_level}
                for item in task.required_skills
            ],
        }

    def run(self, task: Task, employees: Sequence[Employee],
            excluded_task_ids: Iterable[str] = ()) -> MethodResult:
        started = time.perf_counter()
        excluded = self._excluded(task, excluded_task_ids)
        filtered = filter_candidates(task, employees, excluded)
        if not filtered.eligible:
            return MethodResult(
                method=self.name, eligible=[], excluded=filtered.excluded,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
                meta={"model": self.model, "calls": 0, "prompt_version": PROMPT_VERSION},
            )
        # Scores are not passed to the model: it sees facts, not the rule ranking.
        payloads = []
        for item in filtered.eligible:
            history = history_at(item.employee, task.assigned_at, excluded)
            availability = item.details["availability"]
            payloads.append({
                "id": item.employee.id,
                "position": item.employee.position,
                "domain": item.employee.domain,
                "skills": [
                    {"name": skill.name, "level": skill.level}
                    for skill in item.employee.skills
                ],
                "matched_skills": item.details["competence"].get("matched", []),
                "availability_percent": round(float(availability["score"]) * 100, 1),
                "workload_known": bool(availability.get("workload_known")),
                "avg_load_percent": availability.get("avg_load_percent"),
                "completed_tasks": len(history),
                "on_time_tasks": sum(1 for row in history if row.on_time),
                "hourly_rate": item.employee.hourly_rate,
            })
        try:
            result = rank_with_llm(
                self._task_payload(task), payloads,
                [item.employee.id for item in filtered.eligible],
                model=self.model, timeout=self.timeout, seed=self.seed,
            )
        except LLMUnavailable as exc:
            raise MethodUnavailable(str(exc)) from exc
        by_id = {item.employee.id: item for item in filtered.eligible}
        ranked = []
        for index, employee_id in enumerate(result.ranking):
            item = by_id[employee_id]
            explanation = result.reasons.get(employee_id) or item.explanation
            ranked.append(RankedCandidate(
                employee_id=employee_id,
                score=round(1.0 - index / max(len(result.ranking), 1), 6),
                explanation=explanation,
                details={
                    "rule_score_for_reference": round(item.total_score, 6),
                    "llm_reason": result.reasons.get(employee_id),
                },
                source="direct_llm",
            ))
        return MethodResult(
            method=self.name,
            ranked=ranked,
            eligible=[item.employee.id for item in filtered.eligible],
            excluded=filtered.excluded,
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            meta={
                "model": self.model,
                "calls": result.calls,
                "prompt_version": PROMPT_VERSION,
                "raw_samples": result.raw_samples[:1],
                "reason_count": len(result.reasons),
            },
        )

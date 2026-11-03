"""Experiment runner: one dataset snapshot, one candidate pool, one run_id."""
from __future__ import annotations

import datetime
import random
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

from .embeddings import build_provider
from .io import make_run_id, sha256_bytes, write_csv, write_json, write_jsonl
from .llm import PROMPT_VERSION
from .methods import (
    METHOD_RULES, BaseMethod, DirectLLMMethod, EmbeddingMethod, HybridMethod,
    MethodResult, MethodUnavailable, PopularityMethod, RandomMethod, RuleMethod,
)
from .metrics import calculate_by_scenario, calculate_metrics, explanation_factuality, rank_of, ndcg_at_3
from .rules import filter_candidates
from .schema import Dataset, Employee, Task
from .snapshot import all_task_ids, assert_no_label, method_task


PER_TASK_FIELDS = [
    "run_id", "task_id", "scenario", "method", "synthetic",
    "target_employee_id", "target_eligible", "eligible_ids", "eligible_count",
    "excluded_count", "ranking_ids", "top1_employee_id", "top3_ids", "target_rank",
    "top1", "top3", "mrr", "ndcg3", "latency_ms", "error",
    "top1_explanation", "explanation_factuality", "top1_matched_skills",
    "top1_unknown_workload", "estimated_hours", "employee_count",
    "embedding_provider", "embedding_synthetic_vectors", "embedding_model",
    "llm_model", "prompt_version",
]
SUMMARY_FIELDS = [
    "run_id", "method", "tasks", "target_tasks", "no_target_tasks",
    "top1", "top3", "mrr", "ndcg3", "false_exclusion_rate",
    "candidate_coverage", "candidate_coverage_with_target",
    "candidate_coverage_without_target", "task_coverage",
    "task_coverage_with_target", "task_coverage_without_target",
    "excluded_candidates_mean",
    "explanation_present_rate", "explanation_factuality_pass_rate",
    "explanation_checked", "latency_p50_ms", "latency_p95_ms",
    "errors", "error_rate", "assigned_hours_cv", "zero_assignment_share",
    "max_assigned_hours", "min_assigned_hours", "top1_changed_vs_rule",
    "top1_agreement_with_rule",
]


def _build_methods(methods: Sequence[str], seed: int, provider_name: str,
                   llm_model: str, llm_timeout: int) -> Dict[str, BaseMethod]:
    provider = None
    if "embedding" in methods or "hybrid" in methods:
        provider = build_provider(provider_name)
    registry: Dict[str, BaseMethod] = {}
    for method in methods:
        if method == "rule":
            registry[method] = RuleMethod(seed)
        elif method == "random":
            registry[method] = RandomMethod(seed)
        elif method == "popularity":
            registry[method] = PopularityMethod(seed)
        elif method == "embedding":
            registry[method] = EmbeddingMethod(provider, seed)
        elif method == "hybrid":
            registry[method] = HybridMethod(provider, seed)
        elif method == "direct_llm":
            registry[method] = DirectLLMMethod(llm_model, timeout=llm_timeout, seed=seed)
        else:
            raise ValueError(f"Unknown method: {method}")
    return registry


def _select_tasks(dataset: Dataset, limit: int | None, seed: int) -> List[Task]:
    tasks = list(dataset.tasks)
    if limit is None or limit >= len(tasks):
        return sorted(tasks, key=lambda item: item.id)
    rng = random.Random(seed + 991)
    selected = rng.sample(tasks, limit)
    return sorted(selected, key=lambda item: item.id)


def _candidate_snapshot(task: Task, employees: Sequence[Employee],
                        excluded: Iterable[str]):
    return {
        item.employee.id: item
        for item in filter_candidates(task, employees, excluded).eligible
    }


def _row_for(task: Task, method: str, result: MethodResult, run_id: str,
             employees: Sequence[Employee], excluded: Iterable[str],
             embedding_meta: Dict[str, object], llm_model: str) -> Dict[str, object]:
    target = task.target_employee_id
    ranking = result.ids()
    top1 = ranking[0] if ranking else None
    top3 = ranking[:3]
    target_rank = rank_of(target, ranking)
    rule_candidates = _candidate_snapshot(task, employees, excluded)
    top1_candidate = rule_candidates.get(top1) if top1 else None
    top1_details = top1_candidate.details if top1_candidate else {}
    top1_availability = top1_details.get("availability", {}) if top1_details else {}
    top1_matched = top1_details.get("competence", {}).get("matched", []) if top1_details else []
    top1_employee = next((item for item in employees if item.id == top1), None) if top1 else None
    row = {
        "run_id": run_id,
        "task_id": task.id,
        "scenario": task.scenario,
        "method": method,
        "synthetic": True,
        "target_employee_id": target,
        "target_eligible": (bool(target in result.eligible) if target else None),
        "eligible_ids": result.eligible,
        "eligible_count": len(result.eligible),
        "excluded_count": len(result.excluded),
        "ranking_ids": ranking,
        "top1_employee_id": top1,
        "top3_ids": top3,
        "target_rank": target_rank,
        "top1": (top1 == target) if target else None,
        "top3": (target in top3) if target else None,
        "mrr": ((1.0 / target_rank) if target_rank else 0.0) if target else None,
        "ndcg3": (ndcg_at_3(target, ranking) or 0.0) if target else None,
        "latency_ms": result.latency_ms,
        "error": result.error,
        "top1_explanation": result.ranked[0].explanation if result.ranked else "",
        "explanation_factuality": None,
        "top1_matched_skills": top1_matched,
        "top1_employee_skills": (
            [item.name for item in top1_employee.skills] if top1_employee else []
        ),
        "top1_unknown_workload": (
            not bool(top1_availability.get("workload_known"))
            if top1_availability else None
        ),
        "estimated_hours": task.estimated_hours,
        "employee_count": len(employees),
        "embedding_provider": embedding_meta.get("provider"),
        "embedding_synthetic_vectors": embedding_meta.get("synthetic_vectors"),
        "embedding_model": embedding_meta.get("model"),
        "llm_model": llm_model if method == "direct_llm" else None,
        "prompt_version": PROMPT_VERSION if method == "direct_llm" else None,
    }
    row["explanation_factuality"] = explanation_factuality(row) if target else None
    return row


def _pairwise_agreement(rows: Sequence[Dict[str, object]]) -> Dict[str, Dict[str, object]]:
    by_task: Dict[str, Dict[str, object]] = {}
    for row in rows:
        by_task.setdefault(str(row["task_id"]), {})[str(row["method"])] = row
    methods = sorted({str(row["method"]) for row in rows})
    baseline_available = "rule" in methods
    result = {}
    for method in methods:
        if method == "rule":
            continue
        same = total = 0
        for task_id, values in by_task.items():
            if "rule" not in values or method not in values:
                continue
            rule_top = values["rule"].get("top1_employee_id")
            other_top = values[method].get("top1_employee_id")
            if rule_top is None or other_top is None:
                continue
            total += 1
            same += int(rule_top == other_top)
        result[method] = {
            "baseline_available": baseline_available,
            "same_top1_as_rule": same if baseline_available else None,
            "compared_tasks": total,
            "agreement": (
                round(same / total, 4) if baseline_available and total else None
            ),
        }
    return result


def run_experiment(dataset: Dataset, dataset_dir: Path, methods: Sequence[str],
                   seed: int = 42, limit: int | None = None,
                   output_root: Path = Path("experiments/results"),
                   run_id: str | None = None,
                   embedding_provider: str = "hashing",
                   llm_model: str = "qwen3:4b",
                   llm_timeout: int = 180) -> Dict[str, object]:
    run_id = run_id or make_run_id(seed, prefix="synthetic" if dataset.synthetic else "real")
    output_dir = Path(output_root) / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    tasks = _select_tasks(dataset, limit, seed)
    excluded = all_task_ids(dataset)
    registry = _build_methods(methods, seed, embedding_provider, llm_model, llm_timeout)
    embedding_meta = {}
    if "embedding" in methods or "hybrid" in methods:
        provider = registry["embedding"].provider if "embedding" in methods else registry["hybrid"].provider
        embedding_meta = provider.metadata()

    rows: List[Dict[str, object]] = []
    ranking_rows: List[Dict[str, object]] = []
    for task in tasks:
        safe_task = method_task(task)
        assert_no_label(safe_task)
        for method in methods:
            method_impl = registry[method]
            try:
                result = method_impl.run(safe_task, dataset.employees, excluded)
            except MethodUnavailable as exc:
                result = MethodResult(method=method, error=str(exc))
            except Exception as exc:
                result = MethodResult(method=method, error=f"{type(exc).__name__}: {exc}")
            row = _row_for(
                task, method, result, run_id, dataset.employees, excluded,
                embedding_meta, llm_model,
            )
            rows.append(row)
            ranking_rows.append({
                "run_id": run_id, "task_id": task.id, "scenario": task.scenario,
                "method": method, "target_employee_id": task.target_employee_id,
                "ranking": [item.to_dict() for item in result.ranked],
                "eligible_ids": result.eligible, "excluded": result.excluded,
                "latency_ms": result.latency_ms, "error": result.error,
                "meta": result.meta,
            })

    metrics_by_method = {}
    for method in methods:
        method_rows = [row for row in rows if row["method"] == method]
        metrics_by_method[method] = {
            "overall": calculate_metrics(method_rows, len(dataset.employees)),
            "by_scenario": calculate_by_scenario(method_rows, len(dataset.employees)),
        }
    agreement = _pairwise_agreement(rows)
    for method, values in metrics_by_method.items():
        rule_agreement = agreement.get(method, {})
        comparable = (
            method != "rule"
            and rule_agreement.get("baseline_available")
            and rule_agreement.get("compared_tasks", 0) > 0
        )
        values["overall"]["top1_changed_vs_rule"] = (
            rule_agreement.get("compared_tasks", 0)
            - rule_agreement.get("same_top1_as_rule", 0)
            if comparable else None
        )
        values["overall"]["top1_agreement_with_rule"] = (
            rule_agreement.get("agreement") if comparable else None
        )

    summary_rows = []
    for method, values in metrics_by_method.items():
        overall = dict(values["overall"])
        balance = overall.pop("balance", {})
        overall.update(balance)
        overall.update({"run_id": run_id, "method": method})
        summary_rows.append(overall)
    summary_rows.sort(key=lambda item: item["method"])

    manifest_path = Path(dataset_dir) / "manifest.json"
    manifest_files = dataset.manifest.get("files", {})
    run_config = {
        "run_id": run_id,
        "synthetic": dataset.synthetic,
        "dataset_id": dataset.manifest.get("dataset_id"),
        "dataset_version": dataset.manifest.get("dataset_version"),
        "dataset_seed": dataset.manifest.get("seed"),
        "dataset_sha256": manifest_files.get("dataset_sha256_canonical",
                                            manifest_files.get("dataset_sha256")),
        "dataset_sha256_canonical": manifest_files.get(
            "dataset_sha256_canonical", manifest_files.get("dataset_sha256")
        ),
        "employees_sha256_canonical": manifest_files.get(
            "employees_sha256_canonical", manifest_files.get("employees_sha256")
        ),
        "tasks_sha256_canonical": manifest_files.get(
            "tasks_sha256_canonical", manifest_files.get("tasks_sha256")
        ),
        "employees_sha256_file": manifest_files.get("employees_sha256_file"),
        "tasks_sha256_file": manifest_files.get("tasks_sha256_file"),
        "dataset_sha256_file": manifest_files.get("dataset_sha256_file"),
        "manifest_sha256_file": (
            sha256_bytes(manifest_path.read_bytes()) if manifest_path.exists() else None
        ),
        "dataset_dir": str(dataset_dir),
        "label_profiles_serialized": False,
        "seed": seed,
        "methods": list(methods),
        "limit": limit,
        "task_ids": [task.id for task in tasks],
        "employee_count": len(dataset.employees),
        "task_count": len(tasks),
        "target_task_count": sum(1 for task in tasks if task.target_employee_id),
        "no_target_task_count": sum(1 for task in tasks if not task.target_employee_id),
        "embedding_provider": embedding_meta or None,
        "llm_model": llm_model if "direct_llm" in methods else None,
        "llm_prompt_version": PROMPT_VERSION if "direct_llm" in methods else None,
        "method_rules": {method: METHOD_RULES[method] for method in methods},
        "unknown_workload_policy": "neutral_0.5_scaled_by_present_share",
        "production_scoring_modified": False,
        "database_writes": False,
        "created_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    write_json(output_dir / "run_config.json", run_config)
    write_csv(output_dir / "per_task.csv", rows, PER_TASK_FIELDS)
    write_csv(output_dir / "summary.csv", summary_rows, SUMMARY_FIELDS)
    write_jsonl(output_dir / "rankings.jsonl", ranking_rows)
    write_json(output_dir / "metrics.json", {
        "run_id": run_id,
        "synthetic": dataset.synthetic,
        "methods": metrics_by_method,
        "pairwise_top1_agreement": agreement,
    })
    write_json(output_dir / "errors.json", [
        {
            "task_id": row["task_id"], "method": row["method"],
            "scenario": row["scenario"], "error": row["error"],
        }
        for row in rows if row.get("error")
    ])
    return {
        "run_id": run_id,
        "output_dir": str(output_dir),
        "rows": len(rows),
        "summary": summary_rows,
        "metrics": metrics_by_method,
        "pairwise_top1_agreement": agreement,
    }

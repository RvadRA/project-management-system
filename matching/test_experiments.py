from __future__ import annotations

import datetime
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from matching.scoring import NEUTRAL, _availability
from matching.experiments.embeddings import HashingEmbeddingProvider, hashing_embedding
from matching.experiments.generator import generate_dataset
from matching.experiments.io import (
    load_dataset, save_dataset, sha256_bytes, write_csv, write_jsonl,
)
from matching.experiments.llm import LLMUnavailable, rank_with_llm
from matching.experiments.methods import RuleMethod
from matching.experiments.metrics import (
    calculate_by_scenario, calculate_metrics, explanation_factuality,
)
from matching.experiments.rules import (
    availability_for, filter_candidates, hard_filter_reasons, history_at,
    score_candidate, skill_match,
)
from matching.experiments.runner import _pairwise_agreement, run_experiment
from matching.experiments.schema import (
    Employee, HistoryTask, RequiredSkill, SkillLevel, Task, Unavailability, Workload,
)
from matching.experiments.snapshot import all_task_ids, method_task


FIXTURES = Path(__file__).resolve().parent / "experiments" / "fixtures"
V1_FIXTURE = FIXTURES / "synthetic_seed42"
FIXTURE = FIXTURES / "synthetic_v2_seed42"


def make_task(task_id="T900", target=None, skills=("Python",), domain="EdTech",
              deadline="2026-02-01", assigned_at="2026-01-01"):
    return Task(
        id=task_id, title=f"Task {task_id}", description="Build a service",
        task_type="backend", priority="MEDIUM", deadline=deadline,
        estimated_hours=8.0,
        required_skills=tuple(RequiredSkill(name=item, min_level=2, preferred_level=3)
                              for item in skills),
        target_employee_id=target, assigned_at=assigned_at, domain=domain,
        max_hourly_rate=100.0, scenario="standard", synthetic=True,
    )


def make_employee(employee_id="E90", skills=(("Python", 3),), workload=(),
                  domain="EdTech", rate=50.0, history=(), unavailability=()):
    return Employee(
        id=employee_id, name=f"Name {employee_id}", position="Developer",
        domain=domain, summary="developer", synthetic=True,
        skills=tuple(SkillLevel(name=name, level=level, years_experience=2.0)
                     for name, level in skills),
        history=tuple(history),
        unavailability=tuple(unavailability),
        workload=tuple(workload), hourly_rate=rate,
    )


class AvailabilityScoringTests(SimpleTestCase):
    def test_missing_workload_is_neutral_not_confirmed_full_availability(self):
        day = datetime.date(2026, 10, 22)

        score, details = _availability(
            [], [], day, day, None, set(), 8,
        )

        self.assertEqual(score, NEUTRAL)
        self.assertEqual(details['free_percent'], 100)

    def test_known_unavailability_reduces_neutral_score_when_workload_is_unknown(self):
        day = datetime.date(2026, 10, 22)
        leave = SimpleNamespace(start_date=day, end_date=day)

        score, details = _availability(
            [], [leave], day, day, None, set(), 8,
        )

        self.assertEqual(score, 0)
        self.assertEqual(details['present_share'], 0)


class FixtureGenerationTests(SimpleTestCase):
    def test_fixture_has_expected_counts_and_synthetic_flags(self):
        dataset = load_dataset(FIXTURE)
        self.assertTrue(dataset.synthetic)
        self.assertEqual(dataset.manifest["dataset_version"], "synthetic-v2")
        self.assertEqual(len(dataset.employees), 30)
        self.assertEqual(len(dataset.tasks), 300)
        self.assertTrue(all(item.synthetic for item in dataset.employees))
        self.assertTrue(all(item.synthetic for item in dataset.tasks))
        self.assertEqual(sum(1 for task in dataset.tasks if task.target_employee_id), 290)
        self.assertEqual(sum(1 for task in dataset.tasks
                             if task.scenario == "no_suitable_candidate"), 10)
        self.assertEqual(len({task.id for task in dataset.tasks}), 300)

    def test_generator_is_deterministic(self):
        first = generate_dataset(seed=42)
        second = generate_dataset(seed=42)
        self.assertEqual(
            [item.to_dict() for item in first.employees],
            [item.to_dict() for item in second.employees],
        )
        self.assertEqual(
            [item.to_dict() for item in first.tasks],
            [item.to_dict() for item in second.tasks],
        )

    def test_no_suitable_tasks_have_no_target_and_no_eligible_candidate(self):
        dataset = load_dataset(FIXTURE)
        ids = all_task_ids(dataset)
        for task in dataset.tasks:
            if task.scenario != "no_suitable_candidate":
                continue
            self.assertIsNone(task.target_employee_id)
            filtered = filter_candidates(task, dataset.employees, ids)
            self.assertEqual(filtered.eligible, [])

    def test_target_tasks_satisfy_skills_and_availability(self):
        dataset = load_dataset(FIXTURE)
        for task in dataset.tasks:
            if not task.target_employee_id:
                continue
            # Legacy v1 predates the fixed leave policy; T286 is covered by a
            # dedicated regression test below.
            if task.id == "T286":
                continue
            target = next(item for item in dataset.employees
                          if item.id == task.target_employee_id)
            match = skill_match(target, task.required_skills)
            self.assertFalse(match["missing"], task.id)
            self.assertFalse(match["below_minimum"], task.id)
            self.assertTrue(availability_for(target, task)["available"], task.id)

    def test_legacy_t125_e10_is_excluded_after_leave_fix(self):
        dataset = load_dataset(V1_FIXTURE)
        task = next(item for item in dataset.tasks if item.id == "T125")
        employee = next(item for item in dataset.employees if item.id == "E10")
        availability = availability_for(employee, task)
        self.assertEqual(availability["score"], 0.0)
        self.assertFalse(availability["available"])
        filtered = filter_candidates(task, dataset.employees, all_task_ids(dataset))
        self.assertNotIn("E10", [item.employee.id for item in filtered.eligible])
        result = RuleMethod(seed=42).run(task, dataset.employees, all_task_ids(dataset))
        self.assertNotEqual(result.ids()[0], "E10")

    def test_legacy_t286_target_is_unavailable_after_leave_fix(self):
        dataset = load_dataset(V1_FIXTURE)
        task = next(item for item in dataset.tasks if item.id == "T286")
        employee = next(item for item in dataset.employees if item.id == "E01")
        availability = availability_for(employee, task)
        self.assertEqual(availability["score"], 0.0)
        self.assertFalse(availability["available"])
        self.assertEqual(availability["present_share"], 0.0)
        self.assertEqual(availability["leave_days"], 5)
        filtered = filter_candidates(task, dataset.employees, all_task_ids(dataset))
        self.assertNotIn("E01", [item.employee.id for item in filtered.eligible])


class RuleBehaviourTests(SimpleTestCase):
    def test_required_skills_match_and_missing_skill_exclusion(self):
        task = make_task(skills=("Python", "Django"))
        good = make_employee("E01", skills=(("Python", 3), ("Django", 4)))
        bad = make_employee("E02", skills=(("Python", 3), ("React", 4)))
        filtered = filter_candidates(task, [good, bad], (task.id,))
        self.assertEqual([item.employee.id for item in filtered.eligible], ["E01"])
        codes = {reason["code"] for reason in filtered.excluded[0]["reasons"]}
        self.assertIn("missing_required_skills", codes)

    def test_below_minimum_skill_is_excluded(self):
        task = make_task(skills=("Python",))
        weak = make_employee("E01", skills=(("Python", 1),))
        filtered = filter_candidates(task, [weak], (task.id,))
        self.assertEqual(filtered.eligible, [])
        codes = {reason["code"] for reason in filtered.excluded[0]["reasons"]}
        self.assertIn("below_minimum_skills", codes)

    def test_unavailable_candidate_is_excluded(self):
        task = make_task(skills=("Python",))
        employee = make_employee(
            "E01", skills=(("Python", 3),),
            workload=(Workload("P1", "EdTech", "2026-01-01", "2026-03-01", 100),),
        )
        candidate = score_candidate(employee, task, [employee], (task.id,))
        self.assertEqual(candidate.availability, 0.0)
        self.assertIn("zero_availability",
                      {reason["code"] for reason in hard_filter_reasons(candidate)})

    def test_higher_skill_level_improves_score(self):
        task = make_task(skills=("Python",))
        low = make_employee("E01", skills=(("Python", 2),))
        high = make_employee("E02", skills=(("Python", 5),))
        low_score = score_candidate(low, task, [low, high], (task.id,))
        high_score = score_candidate(high, task, [low, high], (task.id,))
        self.assertGreater(high_score.total_score, low_score.total_score)
        self.assertGreater(high_score.competence, low_score.competence)

    def test_unknown_workload_is_neutral_and_not_excluded(self):
        task = make_task(skills=("Python",))
        employee = make_employee("E01", skills=(("Python", 3),), workload=())
        candidate = score_candidate(employee, task, [employee], (task.id,))
        availability = candidate.details["availability"]
        self.assertFalse(availability["workload_known"])
        self.assertEqual(availability["present_share"], 1.0)
        self.assertEqual(candidate.availability, 0.5)
        self.assertEqual(availability["policy"], "neutral_0.5_scaled_by_present_share")
        self.assertNotIn("zero_availability",
                         {reason["code"] for reason in hard_filter_reasons(candidate)})

    def test_unknown_workload_with_full_leave_is_excluded(self):
        task = make_task(skills=("Python",), assigned_at="2026-01-05",
                         deadline="2026-01-09")
        employee = make_employee(
            "E01", skills=(("Python", 3),), workload=(),
            unavailability=(Unavailability("VACATION", "2026-01-05", "2026-01-09"),),
        )
        candidate = score_candidate(employee, task, [employee], (task.id,))
        availability = candidate.details["availability"]
        self.assertEqual(availability["score"], 0.0)
        self.assertEqual(availability["present_share"], 0.0)
        self.assertEqual(availability["leave_days"], 5)
        self.assertFalse(availability["available"])
        self.assertIn("zero_availability",
                      {reason["code"] for reason in hard_filter_reasons(candidate)})

    def test_unknown_workload_with_partial_leave_scales_neutral_score(self):
        task = make_task(skills=("Python",), assigned_at="2026-01-05",
                         deadline="2026-01-09")
        employee = make_employee(
            "E01", skills=(("Python", 3),), workload=(),
            unavailability=(Unavailability("SICK_LEAVE", "2026-01-06", "2026-01-07"),),
        )
        availability = availability_for(employee, task)
        self.assertEqual(availability["present_share"], 0.6)
        self.assertEqual(availability["score"], 0.3)
        self.assertTrue(availability["available"])
        self.assertEqual(availability["leave_days"], 2)

    def test_workload_and_leave_are_combined(self):
        task = make_task(skills=("Python",), assigned_at="2026-01-05",
                         deadline="2026-01-09")
        workload = (Workload("P1", "EdTech", "2026-01-01", "2026-01-31", 40),)
        no_leave = make_employee("E01", skills=(("Python", 3),), workload=workload)
        with_leave = make_employee(
            "E02", skills=(("Python", 3),), workload=workload,
            unavailability=(Unavailability("VACATION", "2026-01-08", "2026-01-09"),),
        )
        base = availability_for(no_leave, task)
        reduced = availability_for(with_leave, task)
        self.assertGreater(base["score"], reduced["score"])
        self.assertEqual(reduced["present_share"], 0.6)
        self.assertAlmostEqual(reduced["score"], base["score"] * 0.6, places=6)

    def test_weekend_only_period_has_no_working_days_and_is_excluded(self):
        task = make_task(skills=("Python",), assigned_at="2026-01-03",
                         deadline="2026-01-04")
        employee = make_employee("E01", skills=(("Python", 3),), workload=())
        availability = availability_for(employee, task)
        self.assertEqual(availability["present_share"], 0.0)
        self.assertEqual(availability["score"], 0.0)
        self.assertFalse(availability["available"])
        self.assertEqual(availability["policy"], "no_working_days")

    def test_task_period_boundaries_are_inclusive_and_reversed_dates_are_swapped(self):
        task = make_task(skills=("Python",), assigned_at="2026-01-09",
                         deadline="2026-01-05")
        employee = make_employee(
            "E01", skills=(("Python", 3),), workload=(),
            unavailability=(Unavailability("VACATION", "2026-01-05", "2026-01-05"),),
        )
        availability = availability_for(employee, task)
        self.assertEqual(availability["leave_days"], 1)
        self.assertEqual(availability["present_share"], 0.8)
        self.assertEqual(availability["score"], 0.4)

    def test_top3_is_returned_when_enough_candidates(self):
        task = make_task(skills=("Python",))
        employees = [make_employee(f"E0{index}", skills=(("Python", 3),))
                     for index in range(1, 6)]
        result = RuleMethod(seed=42).run(task, employees, (task.id,))
        self.assertEqual(len(result.ranked), 5)
        self.assertEqual(len(result.ranked[:3]), 3)
        self.assertEqual(len(set(item.employee_id for item in result.ranked)), 5)

    def test_no_target_label_is_stripped_from_method_input(self):
        task = make_task(target="E01")
        safe = method_task(task)
        self.assertIsNone(safe.target_employee_id)
        self.assertEqual(safe.scenario, "")
        self.assertEqual(safe.notes, ())

    def test_target_task_is_excluded_from_history(self):
        task = make_task(task_id="T777", target="E01")
        employee = make_employee(
            "E01", skills=(("Python", 3),),
            history=(
                HistoryTask("T777", "target", "2025-01-01", "EdTech", True),
                HistoryTask("H1", "past", "2025-02-01", "EdTech", True),
                HistoryTask("H2", "future", "2026-02-01", "EdTech", True),
            ),
        )
        rows = history_at(employee, task.assigned_at, all_task_ids(type(
            "D", (), {"tasks": [task]})()))
        self.assertEqual([item.id for item in rows], ["H1"])


class MethodsAndMetricsTests(SimpleTestCase):
    def test_hashing_embedding_is_normalized_and_marked_synthetic(self):
        vector = hashing_embedding("Python Django API", 64)
        self.assertEqual(len(vector), 64)
        self.assertAlmostEqual(sum(item * item for item in vector), 1.0, places=5)
        provider = HashingEmbeddingProvider()
        self.assertTrue(provider.metadata()["synthetic_vectors"])

    def test_metrics_only_use_target_tasks_for_topk(self):
        base = {
            "method": "rule", "scenario": "standard", "eligible_count": 2,
            "excluded_count": 0, "target_rank": 1, "top1_employee_id": "E01",
            "target_employee_id": "E01", "top3_ids": ["E01", "E02"],
            "eligible_ids": ["E01", "E02"], "ranking_ids": ["E01", "E02"],
            "latency_ms": 1.0, "estimated_hours": 8.0, "error": None,
            "top1_explanation": "Совпадают обязательные навыки: Python (3).",
            "top1_matched_skills": ["Python (3)"],
            "top1_employee_skills": ["Python"], "top1_unknown_workload": False,
        }
        no_target = dict(base, target_employee_id=None, top1_employee_id=None,
                         eligible_ids=[], eligible_count=0, ranking_ids=[],
                         target_rank=None, scenario="no_suitable_candidate")
        metrics = calculate_metrics([base, no_target], 30)
        self.assertEqual(metrics["target_tasks"], 1)
        self.assertEqual(metrics["no_target_tasks"], 1)
        self.assertEqual(metrics["top1"], 1.0)
        self.assertEqual(metrics["top3"], 1.0)
        self.assertEqual(metrics["mrr"], 1.0)
        self.assertEqual(metrics["candidate_coverage_with_target"], round(2 / 30, 4))
        self.assertEqual(metrics["candidate_coverage_without_target"], 0.0)
        self.assertEqual(metrics["task_coverage_with_target"], 1.0)
        self.assertEqual(metrics["task_coverage_without_target"], 0.0)

    def test_no_target_metrics_are_none_not_zero(self):
        row = {
            "method": "rule", "scenario": "no_suitable_candidate",
            "eligible_count": 0, "excluded_count": 30, "target_employee_id": None,
            "target_rank": None, "top1_employee_id": None, "top3_ids": [],
            "eligible_ids": [], "ranking_ids": [], "latency_ms": 1.0,
            "estimated_hours": 8.0, "error": None, "top1_explanation": "",
        }
        metrics = calculate_metrics([row], 30)
        self.assertIsNone(metrics["top1"])
        self.assertIsNone(metrics["top3"])
        self.assertIsNone(metrics["mrr"])
        self.assertIsNone(metrics["ndcg3"])
        self.assertIsNone(metrics["false_exclusion_rate"])
        self.assertIsNone(metrics["explanation_present_rate"])
        self.assertIsNone(metrics["explanation_factuality_pass_rate"])
        by_scenario = calculate_by_scenario([row], 30)
        self.assertIsNone(by_scenario["no_suitable_candidate"]["top1"])

    def test_csv_writes_na_and_jsonl_writes_lf(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            csv_path = root / "rows.csv"
            write_csv(csv_path, [{"value": None, "count": 1}], ["value", "count"])
            self.assertIn("N/A", csv_path.read_text(encoding="utf-8"))
            jsonl_path = root / "rows.jsonl"
            digest = write_jsonl(jsonl_path, [{"value": None}])
            raw = jsonl_path.read_bytes()
            self.assertNotIn(b"\r\n", raw)
            self.assertEqual(digest, sha256_bytes(raw))

    def test_dataset_hashes_distinguish_canonical_and_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = save_dataset(generate_dataset(seed=42), root)
            files = manifest["files"]
            employee_bytes = (root / "employees.jsonl").read_bytes()
            task_bytes = (root / "tasks.jsonl").read_bytes()
            self.assertEqual(
                files["employees_sha256_file"], sha256_bytes(employee_bytes)
            )
            self.assertEqual(files["tasks_sha256_file"], sha256_bytes(task_bytes))
            self.assertEqual(
                files["employees_sha256_canonical"], sha256_bytes(employee_bytes)
            )
            self.assertEqual(
                files["dataset_sha256_canonical"], files["dataset_sha256"]
            )
            self.assertNotIn(b"\r\n", employee_bytes + task_bytes)

    def test_pairwise_agreement_is_na_without_rule_baseline(self):
        rows = [
            {"task_id": "T1", "method": "random", "top1_employee_id": "E01"},
            {"task_id": "T2", "method": "random", "top1_employee_id": "E02"},
        ]
        agreement = _pairwise_agreement(rows)
        self.assertFalse(agreement["random"]["baseline_available"])
        self.assertIsNone(agreement["random"]["same_top1_as_rule"])
        self.assertIsNone(agreement["random"]["agreement"])

    def test_explanation_factuality_rejects_unknown_load_claim(self):
        row = {
            "method": "rule", "top1_explanation": "Кандидат полностью свободен.",
            "top1_unknown_workload": True, "top1_matched_skills": ["Python (3)"],
            "top1_employee_skills": ["Python"],
        }
        self.assertFalse(explanation_factuality(row))

    def test_explanation_factuality_accepts_explicit_unknown_load_negation(self):
        row = {
            "method": "direct_llm",
            "top1_explanation": "Django (3) совпадает; workload_known=false, "
                                "не указано, что кандидат полностью свободен.",
            "top1_unknown_workload": True, "top1_matched_skills": ["Django (3)"],
            "top1_employee_skills": ["Django"],
        }
        self.assertTrue(explanation_factuality(row))

    def test_explanation_factuality_ignores_substring_skill_names(self):
        row = {
            "method": "rule",
            "top1_explanation": "Совпадают обязательные навыки: Django (3).",
            "top1_unknown_workload": False, "top1_matched_skills": ["Django (3)"],
            "top1_employee_skills": ["Django"],
        }
        self.assertTrue(explanation_factuality(row))

    def test_runner_marks_rule_agreement_na_without_rule_and_records_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dataset = load_dataset(FIXTURE)
            result = run_experiment(
                dataset=dataset, dataset_dir=FIXTURE, methods=["random"],
                seed=42, limit=4, output_root=Path(tmp), run_id="test_random_only",
                embedding_provider="hashing",
            )
            agreement = result["pairwise_top1_agreement"]["random"]
            self.assertFalse(agreement["baseline_available"])
            self.assertIsNone(agreement["agreement"])
            self.assertIsNone(result["summary"][0]["top1_changed_vs_rule"])
            output = Path(result["output_dir"])
            config = json.loads((output / "run_config.json").read_text(encoding="utf-8"))
            manifest = json.loads((FIXTURE / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(
                config["employees_sha256_canonical"],
                manifest["files"]["employees_sha256_canonical"],
            )
            self.assertEqual(
                config["manifest_sha256_file"],
                sha256_bytes((FIXTURE / "manifest.json").read_bytes()),
            )

    def test_direct_llm_rejects_unknown_candidate_id(self):
        with mock.patch("matching.experiments.llm._post") as post:
            post.return_value = {"message": {"content": json.dumps({
                "ranking": ["E99"], "reasons": {},
            })}}
            with self.assertRaises(LLMUnavailable):
                rank_with_llm(
                    {"title": "Task"}, [{"id": "E01"}], ["E01"],
                    model="qwen3:4b", timeout=1, seed=42,
                )

    def test_runner_writes_csv_json_and_ranking_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            dataset = load_dataset(FIXTURE)
            result = run_experiment(
                dataset=dataset, dataset_dir=FIXTURE,
                methods=["rule", "embedding", "hybrid", "random"],
                seed=42, limit=8, output_root=Path(tmp),
                run_id="test_run", embedding_provider="hashing",
            )
            output = Path(result["output_dir"])
            for name in ("run_config.json", "per_task.csv", "summary.csv",
                         "metrics.json", "rankings.jsonl", "errors.json"):
                self.assertTrue((output / name).exists(), name)
            config = json.loads((output / "run_config.json").read_text(encoding="utf-8"))
            self.assertTrue(config["synthetic"])
            self.assertFalse(config["database_writes"])
            self.assertIn("rule", config["methods"])
            self.assertEqual(result["rows"], 8 * 4)


class GuardTests(SimpleTestCase):
    def test_fixture_manifest_is_explicitly_synthetic(self):
        manifest = json.loads((FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["synthetic"])
        self.assertEqual(manifest["dataset_version"], "synthetic-v2")
        self.assertEqual(manifest["seed"], 42)
        self.assertEqual(manifest["counts"], {"employees": 30, "tasks": 300})
        self.assertIn("target_rules", manifest)

    def test_v2_manifest_documents_hidden_labels_and_limitations(self):
        manifest = json.loads((FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        self.assertFalse(manifest["label_policy"]["serialized"])
        self.assertTrue(manifest["label_policy"]["independent_rng"])
        self.assertIn("not objective ground truth", manifest["label_policy"]["caveat"])
        self.assertIn("rule score", manifest["target_rules"]["target_selection"])

    def test_v2_fixture_file_hashes_match_manifest(self):
        manifest = json.loads((FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        files = manifest["files"]
        for name in ("employees.jsonl", "tasks.jsonl"):
            key = name.split(".", 1)[0]
            raw = (FIXTURE / name).read_bytes()
            self.assertEqual(files[f"{key}_sha256_file"], sha256_bytes(raw))
            self.assertEqual(files[f"{key}_sha256_canonical"], sha256_bytes(raw))
            self.assertNotIn(b"\r\n", raw)

    def test_v2_hidden_labels_are_not_serialized(self):
        rows = []
        for name in ("employees.jsonl", "tasks.jsonl"):
            rows.extend(json.loads(line) for line in
                        (FIXTURE / name).read_text(encoding="utf-8").splitlines())
        manifest = json.loads((FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        for field in ("preference", "domain_affinity", "task_type_affinity"):
            self.assertNotIn(field, manifest)
            for row in rows:
                self.assertNotIn(field, row)

    def test_v2_target_is_not_forced_to_rule_top1(self):
        dataset = load_dataset(FIXTURE)
        ids = all_task_ids(dataset)
        target_count = 0
        top1_count = 0
        for task in dataset.tasks:
            if not task.target_employee_id:
                continue
            target_count += 1
            eligible = filter_candidates(task, dataset.employees, ids).eligible
            if eligible and eligible[0].employee.id == task.target_employee_id:
                top1_count += 1
        self.assertEqual(target_count, 290)
        self.assertLess(top1_count, target_count)

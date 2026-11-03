"""Run matching experiments from file-based datasets only."""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from matching.experiments.io import load_dataset
from matching.experiments.runner import run_experiment


class Command(BaseCommand):
    help = "Run rule/embedding/hybrid/baseline/LLM matching experiments."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dataset", default="matching/experiments/fixtures/synthetic_v2_seed42",
            help="Directory with manifest.json, employees.jsonl and tasks.jsonl.",
        )
        parser.add_argument(
            "--methods", default="rule,embedding,hybrid,random,popularity",
            help="Comma-separated methods: rule, embedding, hybrid, random, popularity, direct_llm.",
        )
        parser.add_argument("--limit", type=int, default=None,
                            help="Deterministic task sample size; omit for all tasks.")
        parser.add_argument("--seed", type=int, default=42)
        parser.add_argument("--output-dir", default="experiments/results")
        parser.add_argument("--run-id", default=None)
        parser.add_argument(
            "--embedding-provider", choices=["hashing", "ollama"], default="hashing",
            help="hashing = synthetic vectors; ollama = real local embedding model.",
        )
        parser.add_argument("--llm-model", default=None)
        parser.add_argument("--llm-timeout", type=int, default=180)

    def handle(self, *args, **options):
        dataset_dir = Path(options["dataset"])
        if not (dataset_dir / "manifest.json").exists():
            raise CommandError(f"Dataset manifest not found in {dataset_dir}")
        methods = [item.strip() for item in options["methods"].split(",") if item.strip()]
        if not methods:
            raise CommandError("At least one method is required.")
        from django.conf import settings
        llm_model = options["llm_model"] or settings.OLLAMA_CHAT_MODEL
        dataset = load_dataset(dataset_dir)
        result = run_experiment(
            dataset=dataset,
            dataset_dir=dataset_dir,
            methods=methods,
            seed=options["seed"],
            limit=options["limit"],
            output_root=Path(options["output_dir"]),
            run_id=options["run_id"],
            embedding_provider=options["embedding_provider"],
            llm_model=llm_model,
            llm_timeout=options["llm_timeout"],
        )
        self.stdout.write(self.style.SUCCESS(
            f"Run {result['run_id']} completed: {result['rows']} task-method rows."
        ))
        self.stdout.write(f"Output: {Path(result['output_dir']).resolve()}")

        def fmt(value):
            return "N/A" if value is None else f"{value:.3f}"

        for row in result["summary"]:
            self.stdout.write(
                "  {method}: Top-1={top1} Top-3={top3} MRR={mrr} "
                "NDCG@3={ndcg3} errors={errors} p95={p95:.1f}ms".format(
                    method=row["method"], top1=fmt(row["top1"]),
                    top3=fmt(row["top3"]), mrr=fmt(row["mrr"]),
                    ndcg3=fmt(row["ndcg3"]), errors=row["errors"],
                    p95=row["latency_p95_ms"],
                )
            )

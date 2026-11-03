"""Generate synthetic experiment fixtures without touching PostgreSQL."""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from matching.experiments.generator import generate_dataset, write_fixture


class Command(BaseCommand):
    help = "Generate deterministic synthetic matching fixtures (no database writes)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output", default="matching/experiments/fixtures/synthetic_v2_seed42",
            help="Directory for manifest.json, employees.jsonl and tasks.jsonl.",
        )
        parser.add_argument("--seed", type=int, default=42)
        parser.add_argument("--tasks", type=int, default=300)
        parser.add_argument("--employees", type=int, default=30)
        parser.add_argument(
            "--force", action="store_true",
            help="Overwrite existing fixture files in the output directory.",
        )

    def handle(self, *args, **options):
        output = Path(options["output"])
        if output.exists() and any(output.iterdir()) and not options["force"]:
            raise CommandError(
                f"{output} already contains files; pass --force to overwrite."
            )
        dataset = generate_dataset(
            seed=options["seed"], tasks=options["tasks"],
            employees=options["employees"],
        )
        manifest = write_fixture(dataset, output)
        self.stdout.write(self.style.SUCCESS(
            f"Generated synthetic dataset: {len(dataset.tasks)} tasks, "
            f"{len(dataset.employees)} employees, seed={options['seed']}."
        ))
        self.stdout.write(f"Output: {output.resolve()}")
        self.stdout.write(f"Dataset SHA-256: {manifest['files']['dataset_sha256']}")
        self.stdout.write(
            "Scenario counts: " + ", ".join(
                f"{key}={value}" for key, value in manifest["scenario_counts"].items()
            )
        )
        self.stdout.write("Synthetic only; no database rows were written.")

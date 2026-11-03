"""Archive matching experiment outputs into a Git-tracked directory.

`experiments/results/` is intentionally ignored by Git. This script creates a
self-contained snapshot in `experiments/reported_results/`: all small artifacts
are copied as-is, while large `rankings.jsonl` files are gzipped. A manifest
with SHA-256 hashes makes the snapshot verifiable against the working copy.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
from datetime import date
from pathlib import Path


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def archive_run(source: Path, destination: Path) -> dict:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    files: dict[str, dict] = {}
    for item in sorted(source.iterdir()):
        if not item.is_file():
            continue
        if item.name == "rankings.jsonl":
            data = item.read_bytes()
            archived = destination / "rankings.jsonl.gz"
            archived.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
            files[item.name] = {
                "archived_as": archived.name,
                "source_bytes": len(data),
                "archived_bytes": archived.stat().st_size,
                "source_sha256": sha256_bytes(data),
                "archived_sha256": sha256_file(archived),
            }
        else:
            archived = destination / item.name
            shutil.copy2(item, archived)
            files[item.name] = {
                "archived_as": archived.name,
                "source_bytes": item.stat().st_size,
                "archived_bytes": archived.stat().st_size,
                "source_sha256": sha256_file(item),
                "archived_sha256": sha256_file(archived),
            }
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="experiments/results", type=Path)
    parser.add_argument("--destination", default="experiments/reported_results", type=Path)
    args = parser.parse_args()

    if not args.source.is_dir():
        parser.error(f"source directory does not exist: {args.source}")

    runs = sorted(item for item in args.source.iterdir() if item.is_dir())
    if not runs:
        parser.error(f"no run directories found in: {args.source}")

    args.destination.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_on": date.today().isoformat(),
        "source": str(args.source),
        "destination": str(args.destination),
        "runs": {},
    }

    for run in runs:
        destination = args.destination / run.name
        manifest["runs"][run.name] = {
            "stale": (run / "STALE.json").exists(),
            "files": archive_run(run, destination),
        }
        print(f"archived {run.name}")

    manifest_path = args.destination / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""File I/O and hashing for experiment fixtures/results."""
from __future__ import annotations

import csv
import datetime
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .schema import Dataset


def _json_line(data: Dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> str:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(_json_line(row) + "\n" for row in rows)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(payload)
    return sha256_bytes(payload.encode("utf-8"))


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({
                key: (
                    json.dumps(value, ensure_ascii=False)
                    if isinstance(value, (list, dict, tuple))
                    else ("N/A" if value is None else value)
                )
                for key, value in row.items()
            })


def save_dataset(dataset: Dataset, directory: Path) -> Dict[str, Any]:
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    employee_hash = write_jsonl(
        directory / "employees.jsonl",
        (item.to_dict() for item in dataset.employees),
    )
    task_hash = write_jsonl(
        directory / "tasks.jsonl",
        (item.to_dict() for item in dataset.tasks),
    )
    employee_file_hash = sha256_bytes((directory / "employees.jsonl").read_bytes())
    task_file_hash = sha256_bytes((directory / "tasks.jsonl").read_bytes())
    combined = hashlib.sha256()
    combined.update(employee_hash.encode("ascii"))
    combined.update(task_hash.encode("ascii"))
    combined_file = hashlib.sha256()
    combined_file.update(employee_file_hash.encode("ascii"))
    combined_file.update(task_file_hash.encode("ascii"))
    manifest = dict(dataset.manifest)
    manifest.setdefault("files", {})
    manifest["files"].update({
        "employees": "employees.jsonl",
        "tasks": "tasks.jsonl",
        "employees_sha256_canonical": employee_hash,
        "tasks_sha256_canonical": task_hash,
        "dataset_sha256_canonical": combined.hexdigest(),
        "employees_sha256_file": employee_file_hash,
        "tasks_sha256_file": task_file_hash,
        "dataset_sha256_file": combined_file.hexdigest(),
        # Legacy aliases kept for older readers; they mean canonical hashes.
        "employees_sha256": employee_hash,
        "tasks_sha256": task_hash,
        "dataset_sha256": combined.hexdigest(),
    })
    write_json(directory / "manifest.json", manifest)
    return manifest


def load_dataset(directory: Path) -> Dataset:
    directory = Path(directory)
    manifest = read_json(directory / "manifest.json")
    employees = read_jsonl(directory / "employees.jsonl")
    tasks = read_jsonl(directory / "tasks.jsonl")
    return Dataset.from_dict(manifest, employees, tasks)


def utc_stamp() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def make_run_id(seed: int, prefix: str = "run") -> str:
    return f"{prefix}_{utc_stamp()}_seed{seed}"

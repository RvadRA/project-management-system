"""Serializable schema for synthetic experiment data.

Dates are ISO strings in JSON files, so fixtures can be inspected without a
running Django process.  Runtime helpers convert them to ``datetime.date``.
"""
from __future__ import annotations

import datetime
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Tuple

DATASET_VERSION_DEFAULT = "synthetic-v2"
DATASET_VERSION_V1 = "synthetic-v1"


def iso_date(value: datetime.date) -> str:
    return value.isoformat()


def parse_date(value: str) -> datetime.date:
    return datetime.date.fromisoformat(value)


def parse_dt(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value)


@dataclass(frozen=True)
class SkillLevel:
    name: str
    level: int
    years_experience: float = 0.0


@dataclass(frozen=True)
class HistoryTask:
    id: str
    title: str
    completed_at: str
    domain: str
    on_time: bool
    skills: Tuple[str, ...] = ()


@dataclass(frozen=True)
class Unavailability:
    type: str
    start_date: str
    end_date: str


@dataclass(frozen=True)
class Workload:
    project_id: str
    domain: str
    start_date: str
    end_date: str
    load_percent: int


@dataclass(frozen=True)
class ManualRating:
    score: float
    rated_at: str


@dataclass(frozen=True)
class Employee:
    id: str
    name: str
    position: str
    domain: str
    summary: str
    synthetic: bool
    skills: Tuple[SkillLevel, ...]
    history: Tuple[HistoryTask, ...]
    unavailability: Tuple[Unavailability, ...] = ()
    workload: Tuple[Workload, ...] = ()
    hourly_rate: Optional[float] = None
    manual_ratings: Tuple[ManualRating, ...] = ()

    @property
    def skill_map(self) -> Dict[str, SkillLevel]:
        return {item.name: item for item in self.skills}

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["skills"] = [asdict(item) for item in self.skills]
        data["history"] = [asdict(item) for item in self.history]
        data["unavailability"] = [asdict(item) for item in self.unavailability]
        data["workload"] = [asdict(item) for item in self.workload]
        data["manual_ratings"] = [asdict(item) for item in self.manual_ratings]
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Employee":
        return cls(
            id=data["id"], name=data["name"], position=data["position"],
            domain=data["domain"], summary=data.get("summary", ""),
            synthetic=bool(data.get("synthetic", False)),
            skills=tuple(SkillLevel(**item) for item in data.get("skills", [])),
            history=tuple(
                HistoryTask(
                    id=item["id"], title=item["title"], completed_at=item["completed_at"],
                    domain=item["domain"], on_time=bool(item["on_time"]),
                    skills=tuple(item.get("skills", [])),
                )
                for item in data.get("history", [])
            ),
            unavailability=tuple(
                Unavailability(**item) for item in data.get("unavailability", [])
            ),
            workload=tuple(Workload(**item) for item in data.get("workload", [])),
            hourly_rate=data.get("hourly_rate"),
            manual_ratings=tuple(
                ManualRating(**item) for item in data.get("manual_ratings", [])
            ),
        )


@dataclass(frozen=True)
class RequiredSkill:
    name: str
    min_level: int = 2
    preferred_level: int = 3


@dataclass(frozen=True)
class Task:
    id: str
    title: str
    description: str
    task_type: str
    priority: str
    deadline: str
    estimated_hours: float
    required_skills: Tuple[RequiredSkill, ...]
    target_employee_id: Optional[str]
    assigned_at: str
    domain: str
    max_hourly_rate: Optional[float]
    scenario: str
    synthetic: bool
    notes: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["required_skills"] = [asdict(item) for item in self.required_skills]
        data["notes"] = list(self.notes)
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Task":
        return cls(
            id=data["id"], title=data["title"], description=data["description"],
            task_type=data["task_type"], priority=data["priority"],
            deadline=data["deadline"], estimated_hours=float(data["estimated_hours"]),
            required_skills=tuple(
                RequiredSkill(**item) for item in data.get("required_skills", [])
            ),
            target_employee_id=data.get("target_employee_id"),
            assigned_at=data["assigned_at"], domain=data["domain"],
            max_hourly_rate=data.get("max_hourly_rate"),
            scenario=data["scenario"], synthetic=bool(data.get("synthetic", False)),
            notes=tuple(data.get("notes", [])),
        )


@dataclass
class Dataset:
    manifest: Dict[str, Any]
    employees: List[Employee]
    tasks: List[Task]

    @property
    def synthetic(self) -> bool:
        return bool(self.manifest.get("synthetic"))

    def employee_by_id(self) -> Dict[str, Employee]:
        return {item.id: item for item in self.employees}

    def target_tasks(self) -> Iterable[Task]:
        return (task for task in self.tasks if task.target_employee_id)

    @classmethod
    def from_dict(cls, manifest: Dict[str, Any], employees: List[Dict[str, Any]],
                  tasks: List[Dict[str, Any]]) -> "Dataset":
        return cls(
            manifest=manifest,
            employees=[Employee.from_dict(item) for item in employees],
            tasks=[Task.from_dict(item) for item in tasks],
        )

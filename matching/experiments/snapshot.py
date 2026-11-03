"""Leakage guards for method inputs.

The target label and scenario are evaluation metadata.  Methods receive a task
copy with both removed, and histories are filtered to tasks completed strictly
before the assignment date.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Dict, Iterable, List

from .schema import Dataset, Employee, HistoryTask, Task
from .rules import history_at


def method_task(task: Task) -> Task:
    """Task copy without the target label or scenario tag."""
    return replace(task, target_employee_id=None, scenario="", notes=())


def all_task_ids(dataset: Dataset) -> set[str]:
    return {item.id for item in dataset.tasks}


def histories_at(dataset: Dataset, task: Task, employee: Employee,
                 excluded_task_ids: Iterable[str] | None = None) -> List[HistoryTask]:
    return history_at(
        employee,
        task.assigned_at,
        excluded_task_ids if excluded_task_ids is not None else all_task_ids(dataset),
    )


def assert_no_label(task: Task) -> None:
    if task.target_employee_id is not None or task.scenario or task.notes:
        raise AssertionError("Method input still contains evaluation metadata.")

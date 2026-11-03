"""Import the synthetic-v2 fixture into PostgreSQL with a reversible prefix."""
from __future__ import annotations

import datetime
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from matching.experiments.io import load_dataset
from matching.models import (
    EmployeeProfile,
    EmployeeSkill,
    EmployeeUnavailability,
    ProjectParticipation,
    Skill,
    WorkloadEntry,
)
from plans.models import WorkCalendar
from projects.models import Project, ProjectMember
from workflows.models import WorkflowInstance, WorkflowTask

DEFAULT_FIXTURE = "matching/experiments/fixtures/synthetic_v2_seed42"
DEFAULT_PREFIX = "SYNTHV2"
DEFAULT_SHIFT_MONTHS = 12

PRIORITY_MAP = {
    "LOW": "LOW",
    "MEDIUM": "MEDIUM",
    "HIGH": "HIGH",
    "CRITICAL": "URGENT",
}


def _parse_date(value: str) -> datetime.date:
    return datetime.date.fromisoformat(value)


def _shift(value: str, months: int) -> datetime.date:
    return _parse_date(value) + relativedelta(months=months)


def _aware(day: datetime.date, hour: int = 18) -> datetime.datetime:
    return timezone.make_aware(datetime.datetime.combine(day, datetime.time(hour)))


def _stable_index(employee_id: str, key: str) -> int:
    digest = hashlib.sha256(f"{employee_id}:{key}".encode("utf-8")).digest()
    return digest[0] % 2


def _member_role(position: str) -> str:
    value = (position or "").lower()
    if "qa" in value or "test" in value:
        return "QA"
    if "design" in value or "ux" in value:
        return "DESIGNER"
    if "analyst" in value or value.startswith("bi "):
        return "ANALYST"
    if "manager" in value or "scrum" in value or "delivery" in value:
        return "MANAGER"
    return "DEVELOPER"


def _username(prefix: str, value: str) -> str:
    return f"{prefix.lower()}_{value.lower()}"


class Command(BaseCommand):
    help = "Import synthetic-v2 employees, workload, history and matching tasks."

    def add_arguments(self, parser):
        parser.add_argument("--fixture", default=DEFAULT_FIXTURE)
        parser.add_argument("--prefix", default=DEFAULT_PREFIX)
        parser.add_argument("--shift-months", type=int, default=DEFAULT_SHIFT_MONTHS)
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--rollback", action="store_true")
        parser.add_argument("--yes", action="store_true")
        parser.add_argument("--manifest", default="")

    def handle(self, *args, **options):
        prefix = options["prefix"].strip().upper()
        if not prefix or not prefix.replace("_", "").isalnum():
            raise CommandError("Prefix must contain only letters, digits or underscores.")
        if options["shift_months"] < 0:
            raise CommandError("--shift-months cannot be negative.")

        if options["rollback"]:
            self._rollback(prefix, options)
            return

        fixture = Path(options["fixture"])
        if not fixture.is_absolute():
            fixture = settings.BASE_DIR / fixture
        if not fixture.is_dir():
            raise CommandError(f"Fixture directory not found: {fixture}")

        dataset = load_dataset(fixture)
        if not dataset.synthetic:
            raise CommandError("Fixture manifest does not mark the dataset as synthetic.")

        if options["dry_run"]:
            self._print_plan(dataset, prefix, options["shift_months"])
            return

        with transaction.atomic():
            counts = self._import(dataset, prefix, options["shift_months"])

        manifest_path = self._write_manifest(fixture, dataset, prefix, options, counts)
        self.stdout.write(self.style.SUCCESS(
            f"Imported {counts['employees']} employees and {counts['target_tasks']} target tasks."
        ))
        self.stdout.write(
            f"Projects={counts['projects']}, history_tasks={counts['history_tasks']}, "
            f"workload_entries={counts['workload_entries']}, unavailability={counts['unavailability']}."
        )
        self.stdout.write(f"Manifest: {manifest_path}")

    def _print_plan(self, dataset, prefix, shift_months):
        workload_projects = {(w.project_id, w.domain) for e in dataset.employees for w in e.workload}
        history_domains = {h.domain for e in dataset.employees for h in e.history}
        task_domains = {t.domain for t in dataset.tasks}
        ratings = sum(len(e.manual_ratings) for e in dataset.employees)
        self.stdout.write(f"Fixture: {len(dataset.employees)} employees, {len(dataset.tasks)} tasks")
        self.stdout.write(f"Shift: +{shift_months} months")
        self.stdout.write(f"Planned users: {len(dataset.employees) + 1}")
        self.stdout.write(f"Planned workload projects: {len(workload_projects)}")
        self.stdout.write(f"Planned history projects: {len(history_domains) * 2}")
        self.stdout.write(f"Planned task projects: {len(task_domains)}")
        self.stdout.write(f"Planned workload entries: {sum(len(e.workload) for e in dataset.employees)}")
        self.stdout.write(f"Planned unavailability: {sum(len(e.unavailability) for e in dataset.employees)}")
        self.stdout.write(f"Planned history tasks: {sum(len(e.history) for e in dataset.employees)}")
        self.stdout.write(f"Planned manual ratings: {ratings}")
        self.stdout.write(f"Planned target tasks: {len(dataset.tasks)}")
        existing_users = get_user_model().objects.filter(username__startswith=f"{prefix.lower()}_").count()
        existing_projects = Project.objects.filter(name__startswith=f"[{prefix}]").count()
        existing_tasks = WorkflowTask.objects.filter(
            Q(name__startswith=f"[{prefix}]") | Q(name__startswith=f"[{prefix}-HIST]")
        ).count()
        self.stdout.write(
            f"Existing prefixed rows: users={existing_users}, projects={existing_projects}, tasks={existing_tasks}"
        )
        self.stdout.write("Dry run: no database rows were written.")

    def _import(self, dataset, prefix, shift_months):
        User = get_user_model()
        manager = self._upsert_user(
            User, _username(prefix, "manager"), "Synthetic Manager",
            "ADMIN", "", f"{prefix.lower()}_manager@example.invalid",
        )
        default_calendar = WorkCalendar.objects.filter(is_default=True).first()

        users = {}
        profiles = {}
        for employee in dataset.employees:
            user = self._upsert_user(
                User, _username(prefix, employee.id), employee.name,
                "EMPLOYEE", employee.domain,
                f"{prefix.lower()}_{employee.id.lower()}@example.invalid",
            )
            profile, _ = EmployeeProfile.objects.update_or_create(
                user=user,
                defaults={
                    "position": employee.position,
                    "domain": employee.domain,
                    "hourly_rate": Decimal(str(employee.hourly_rate or 0)),
                    "bio": employee.summary,
                },
            )
            users[employee.id] = user
            profiles[employee.id] = profile
            for item in employee.skills:
                skill, _ = Skill.objects.get_or_create(name=item.name, defaults={"category": ""})
                EmployeeSkill.objects.update_or_create(
                    employee=profile, skill=skill,
                    defaults={"level": item.level, "years_experience": item.years_experience},
                )

        workload_by_project = defaultdict(list)
        for employee in dataset.employees:
            for item in employee.workload:
                workload_by_project[(item.project_id, item.domain)].append((employee, item))

        workload_projects = {}
        for (project_id, domain), items in sorted(workload_by_project.items()):
            start = min(_shift(item.start_date, shift_months) for _, item in items)
            end = max(_shift(item.end_date, shift_months) for _, item in items)
            project = self._upsert_project(
                prefix, f"WORKLOAD {project_id} {domain}",
                domain=domain, status="ACTIVE", start=start, end=end,
                manager=manager, calendar=default_calendar,
            )
            workload_projects[(project_id, domain)] = project
            self._upsert_member(project, manager, "MANAGER", 100)
            for employee, item in items:
                WorkloadEntry.objects.filter(
                    employee=profiles[employee.id], project=project,
                ).delete()
                WorkloadEntry.objects.create(
                    employee=profiles[employee.id], project=project,
                    start_date=_shift(item.start_date, shift_months),
                    end_date=_shift(item.end_date, shift_months),
                    load_percent=item.load_percent,
                    note=f"[{prefix}] {project_id} {domain}",
                )
                self._upsert_member(
                    project, users[employee.id], _member_role(employee.position), item.load_percent,
                )

        history_domains = sorted({h.domain for e in dataset.employees for h in e.history})
        history_projects = {}
        history_instances = {}
        history_project_ids = []
        for domain in history_domains:
            dates = [
                _parse_date(h.completed_at)
                for e in dataset.employees for h in e.history if h.domain == domain
            ]
            for index in (0, 1):
                project = self._upsert_project(
                    prefix, f"HISTORY {domain} {index + 1}",
                    domain=domain, status="ACTIVE",
                    start=min(dates), end=max(dates),
                    manager=manager, calendar=default_calendar,
                )
                history_projects[(domain, index)] = project
                history_project_ids.append(project.pk)
                self._upsert_member(project, manager, "MANAGER", 100)
                instance, _ = WorkflowInstance.objects.update_or_create(
                    name=f"[{prefix}-HIST] {domain} {index + 1}",
                    defaults={
                        "project": project,
                        "template": None,
                        "status": "COMPLETED",
                        "started_at": _aware(min(dates), 9),
                        "completed_at": _aware(max(dates), 18),
                        "created_by": manager,
                    },
                )
                history_instances[(domain, index)] = instance

        history_task_count = 0
        for employee in dataset.employees:
            by_domain = defaultdict(list)
            for item in employee.history:
                by_domain[item.domain].append(item)
            for domain, items in by_domain.items():
                index = _stable_index(employee.id, domain)
                project = history_projects[(domain, index)]
                instance = history_instances[(domain, index)]
                dates = [_parse_date(item.completed_at) for item in items]
                self._upsert_member(project, users[employee.id], _member_role(employee.position), 100)
                ProjectParticipation.objects.update_or_create(
                    employee=profiles[employee.id], project=project,
                    defaults={
                        "role": employee.position,
                        "performance_score": 0,
                        "comment": "",
                        "rated_by": None,
                        "rated_at": None,
                        "joined_at": min(dates),
                        "left_at": max(dates),
                    },
                )
                for item in items:
                    completed = _aware(_parse_date(item.completed_at), 18)
                    due = completed + datetime.timedelta(days=2 if item.on_time else -3)
                    self._upsert_task(
                        instance,
                        f"[{prefix}-HIST] {item.id} {item.title}",
                        {
                            "assigned_to": users[employee.id],
                            "status": "DONE",
                            "task_type": "TEXT_REPORT",
                            "description": (
                                f"[{prefix}] fixture_history_id={item.id}; "
                                f"domain={item.domain}; on_time={item.on_time}; "
                                f"skills={', '.join(item.skills)}"
                            ),
                            "due_date": due,
                            "sla_hours": 24,
                            "priority": "MEDIUM",
                            "estimated_hours": 8,
                            "started_at": completed - datetime.timedelta(days=1),
                            "completed_at": completed,
                            "created_at": completed - datetime.timedelta(days=2),
                            "risk_level": "LOW",
                            "weight": 1,
                        },
                        order=history_task_count,
                    )
                    history_task_count += 1
                WorkflowInstance.objects.filter(pk=instance.pk).update(
                    status="COMPLETED",
                    started_at=_aware(min(dates), 9),
                    completed_at=_aware(max(dates), 18),
                )

        for employee in dataset.employees:
            EmployeeUnavailability.objects.filter(employee=profiles[employee.id]).delete()
            for item in employee.unavailability:
                EmployeeUnavailability.objects.create(
                    employee=profiles[employee.id],
                    type=item.type,
                    start_date=_shift(item.start_date, shift_months),
                    end_date=_shift(item.end_date, shift_months),
                    note=f"[{prefix}] fixture",
                )

        for employee in dataset.employees:
            if not employee.manual_ratings:
                continue
            domains = sorted({h.domain for h in employee.history})
            primary = employee.domain if employee.domain in domains else domains[0]
            dates = [
                _parse_date(h.completed_at)
                for h in employee.history if h.domain == primary
            ]
            for index, rating in enumerate(employee.manual_ratings):
                project = history_projects[(primary, index % 2)]
                self._upsert_member(
                    project, users[employee.id], _member_role(employee.position), 100,
                )
                ProjectParticipation.objects.update_or_create(
                    employee=profiles[employee.id], project=project,
                    defaults={
                        "role": employee.position,
                        "performance_score": rating.score,
                        "comment": f"[{prefix}] manual rating",
                        "rated_by": manager,
                        "rated_at": _aware(_parse_date(rating.rated_at), 12),
                        "joined_at": min(dates) if dates else project.start_date,
                        "left_at": max(dates) if dates else project.end_date,
                    },
                )

        tasks_by_domain = defaultdict(list)
        for task in dataset.tasks:
            tasks_by_domain[task.domain].append(task)

        task_projects = {}
        task_instances = {}
        for domain, items in sorted(tasks_by_domain.items()):
            start = min(_shift(item.assigned_at, shift_months) for item in items)
            end = max(_shift(item.deadline, shift_months) for item in items) + datetime.timedelta(days=1)
            project = self._upsert_project(
                prefix, f"TASKS {domain}",
                domain=domain, status="ACTIVE", start=start, end=end,
                manager=manager, calendar=default_calendar,
            )
            task_projects[domain] = project
            self._upsert_member(project, manager, "MANAGER", 100)
            instance, _ = WorkflowInstance.objects.update_or_create(
                name=f"[{prefix}] TASKS {domain}",
                defaults={
                    "project": project,
                    "template": None,
                    "status": "IN_PROGRESS",
                    "started_at": timezone.now(),
                    "completed_at": None,
                    "created_by": manager,
                },
            )
            task_instances[domain] = instance

        for order, task in enumerate(dataset.tasks):
            instance = task_instances[task.domain]
            skills = ", ".join(item.name for item in task.required_skills)
            description = (
                f"{task.description}\n\n"
                f"[{prefix}] fixture_task_id={task.id}; scenario={task.scenario}; "
                f"target_employee_id={task.target_employee_id or 'none'}; "
                f"required_skills={skills}; max_hourly_rate={task.max_hourly_rate}"
            )
            self._upsert_task(
                instance,
                f"[{prefix}] {task.id} [{task.scenario}] {task.title}",
                {
                    "assigned_to": None,
                    "status": "TODO",
                    "task_type": "TEXT_REPORT",
                    "description": description,
                    "due_date": _aware(_shift(task.deadline, shift_months), 18),
                    "sla_hours": 24,
                    "priority": PRIORITY_MAP.get(task.priority, "MEDIUM"),
                    "estimated_hours": task.estimated_hours,
                    "started_at": None,
                    "completed_at": None,
                    "created_at": _aware(_shift(task.assigned_at, shift_months), 9),
                    "risk_level": "LOW",
                    "weight": 1,
                },
                order=order,
            )

        for instance in task_instances.values():
            WorkflowInstance.objects.filter(pk=instance.pk).update(
                status="IN_PROGRESS", completed_at=None,
            )
        Project.objects.filter(pk__in=history_project_ids).update(status="COMPLETED")

        return self._counts(prefix)

    def _upsert_user(self, User, username, name, role, domain, email):
        user, created = User.objects.update_or_create(
            username=username,
            defaults={
                "first_name": name[:150],
                "last_name": "",
                "email": email,
                "role": role,
                "domain": domain,
                "is_active": True,
            },
        )
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        return user

    def _upsert_project(self, prefix, label, domain, status, start, end, manager, calendar):
        return Project.objects.update_or_create(
            name=f"[{prefix}] {label}"[:255],
            defaults={
                "description": (
                    f"[{prefix}] synthetic-v2 fixture project. "
                    f"label={label}; domain={domain}; synthetic=true"
                ),
                "domain": domain,
                "status": status,
                "start_date": start,
                "end_date": end,
                "manager": manager,
                "calendar": calendar,
                "budget": None,
            },
        )[0]

    def _upsert_member(self, project, user, role, allocation):
        return ProjectMember.objects.update_or_create(
            project=project, user=user,
            defaults={"role": role, "allocation_percentage": allocation},
        )[0]

    def _upsert_task(self, instance, name, defaults, order):
        task, _ = WorkflowTask.objects.update_or_create(
            workflow=instance,
            name=name[:255],
            defaults={**defaults, "order": order},
        )
        WorkflowTask.objects.filter(pk=task.pk).update(
            due_date=defaults.get("due_date"),
            priority=defaults.get("priority", "MEDIUM"),
            order=order,
            created_at=defaults.get("created_at"),
        )
        return task

    def _counts(self, prefix):
        User = get_user_model()
        user_prefix = f"{prefix.lower()}_"
        task_prefix = f"[{prefix}]"
        hist_prefix = f"[{prefix}-HIST]"
        return {
            "employees": EmployeeProfile.objects.filter(user__username__startswith=user_prefix).exclude(
                user__username=user_prefix + "manager",
            ).count(),
            "users": User.objects.filter(username__startswith=user_prefix).count(),
            "projects": Project.objects.filter(name__startswith=task_prefix).count(),
            "workload_entries": WorkloadEntry.objects.filter(
                employee__user__username__startswith=user_prefix,
            ).count(),
            "unavailability": EmployeeUnavailability.objects.filter(
                employee__user__username__startswith=user_prefix,
            ).count(),
            "participations": ProjectParticipation.objects.filter(
                employee__user__username__startswith=user_prefix,
            ).count(),
            "history_tasks": WorkflowTask.objects.filter(name__startswith=hist_prefix).count(),
            "target_tasks": WorkflowTask.objects.filter(name__startswith=task_prefix).count(),
            "workflow_tasks": WorkflowTask.objects.filter(
                Q(name__startswith=task_prefix) | Q(name__startswith=hist_prefix)
            ).count(),
        }

    def _write_manifest(self, fixture, dataset, prefix, options, counts):
        stamp = timezone.now().strftime("%Y%m%dT%H%M%SZ")
        path = Path(options["manifest"]) if options["manifest"] else (
            settings.BASE_DIR / "backups" / f"synthv2_import_{stamp}.json"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "imported_at": timezone.now().isoformat(),
            "prefix": prefix,
            "shift_months": options["shift_months"],
            "fixture": str(fixture),
            "dataset_id": dataset.manifest.get("dataset_id"),
            "dataset_sha256": dataset.manifest.get("files", {}).get("dataset_sha256"),
            "counts": counts,
            "rollback": f"python manage.py import_synthetic_v2 --rollback --prefix {prefix} --yes",
        }
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return path

    def _rollback(self, prefix, options):
        User = get_user_model()
        user_prefix = f"{prefix.lower()}_"
        project_prefix = f"[{prefix}]"
        task_prefix = f"[{prefix}]"
        hist_prefix = f"[{prefix}-HIST]"
        users = User.objects.filter(username__startswith=user_prefix)
        projects = Project.objects.filter(name__startswith=project_prefix)
        tasks = WorkflowTask.objects.filter(
            Q(name__startswith=task_prefix) | Q(name__startswith=hist_prefix)
        )
        instances = WorkflowInstance.objects.filter(
            Q(name__startswith=task_prefix) | Q(name__startswith=hist_prefix)
        )
        counts = {
            "users": users.count(),
            "projects": projects.count(),
            "workflow_tasks": tasks.count(),
            "workflow_instances": instances.count(),
        }
        self.stdout.write(
            f"Rollback scope: users={counts['users']}, projects={counts['projects']}, "
            f"tasks={counts['workflow_tasks']}, instances={counts['workflow_instances']}"
        )
        if options["dry_run"]:
            self.stdout.write("Dry run: no database rows were deleted.")
            return
        if not options["yes"]:
            raise CommandError("Pass --yes to confirm rollback.")
        with transaction.atomic():
            tasks.delete()
            instances.delete()
            projects.delete()
            users.delete()
        self.stdout.write(self.style.SUCCESS("Rollback complete."))

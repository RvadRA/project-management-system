import datetime
from .models import Project, PlanningBlock, Task, TaskDependency, ProjectMember
from matching.models import EmployeeProfile
from django.db.models import Q
from rest_framework.exceptions import ValidationError


def default_allocation_period(project):
    """Период загрузки по умолчанию — сроки проекта (без сроков — 90 дней от сегодня)."""
    today = datetime.date.today()
    start = project.start_date or today
    end = project.end_date or (start + datetime.timedelta(days=90))
    if end < start:
        end = start + datetime.timedelta(days=90)
    return start, end


def employee_capacity(profile, project, start, end):
    """
    Свободное время сотрудника на период без учёта его загрузки по этому проекту
    (запись по проекту как раз и редактируется).
    """
    from matching.capacity import holidays_for, period_capacity, workday_hours
    entries = [e for e in profile.active_entries() if e.project_id != project.id]
    cap = period_capacity(
        entries, profile.unavailability.all(), start, end,
        holidays_for(project.calendar), workday_hours(),
    )
    cap.pop('present_share', None)
    return cap


def auto_allocation(profile, project, start=None, end=None):
    """
    Загрузка «по умолчанию» для нового участника: всё гарантированно свободное время,
    округлённое вниз до 5%. 0 — сотрудник в этот период полностью занят.
    """
    default_start, default_end = default_allocation_period(project)
    cap = employee_capacity(profile, project, start or default_start, end or default_end)
    return int(min(100, (cap['free_percent'] // 5) * 5)), cap


def sync_workload_entry(project, user, allocation, start=None, end=None):
    """
    Запись загрузки сотрудника на проект. Даты переопределяются только если заданы явно:
    раньше любая смена роли сбрасывала период на сроки проекта.
    """
    from matching.models import WorkloadEntry
    from matching.services import ensure_profile
    profile = ensure_profile(user)
    # Use filter().first() and manual update/create to avoid MultipleObjectsReturned (500 error)
    entry = WorkloadEntry.objects.filter(employee=profile, project=project).first()
    default_start, default_end = default_allocation_period(project)
    if entry:
        entry.load_percent = allocation
        if start:
            entry.start_date = start
        if end:
            entry.end_date = end
        if entry.end_date < entry.start_date:
            entry.end_date = entry.start_date
        entry.save()
    else:
        WorkloadEntry.objects.create(
            employee=profile, project=project, load_percent=allocation,
            start_date=start or default_start, end_date=end or default_end,
        )


class AssignmentService:
    @staticmethod
    def validate_assignment(task, user, allow_auto_add=False, role='DEVELOPER', role_ref_id=None, allocation_percentage=None):
        """
        Validate if a user can be assigned to a task.
        Returns (member, error_message)
        """
        if not user:
            return None, None

        # 1. Check workload
        from matching.models import EmployeeProfile, WorkloadEntry
        try:
            profile = EmployeeProfile.objects.get(user=user)
            # Мы позволяем назначение, но предупреждаем или блокируем при сильном перегрузе (>120%)
            if profile.current_workload_percentage > 120:
                return None, f"Сотрудник перегружен ({profile.current_workload_percentage}%)"
        except EmployeeProfile.DoesNotExist:
            profile = None

        # 2. Check project membership
        if hasattr(task, 'block'):
            project = task.block.project
        elif hasattr(task, 'workflow'):
            project = task.workflow.project
        else:
            project = None

        if project:
            member = ProjectMember.objects.filter(project=project, user=user).first()
            
            if not member:
                if allow_auto_add:
                    from matching.services import ensure_profile
                    profile = profile or ensure_profile(user)
                    if allocation_percentage is None:
                        # Загрузка не задана — берём доступное свободное время сотрудника
                        allocation_percentage, _ = auto_allocation(profile, project)
                        if allocation_percentage <= 0:
                            return None, "Сотрудник полностью занят в период проекта — добавить его в команду нельзя"
                    member = ProjectMember.objects.create(
                        project=project,
                        user=user,
                        role=role,
                        role_ref_id=role_ref_id,
                        allocation_percentage=allocation_percentage,
                    )

                    # Если роль MANAGER и в проекте не назначен основной менеджер — назначаем
                    if role == 'MANAGER' and not project.manager:
                        project.manager = user
                        project.save(update_fields=['manager'])

                    sync_workload_entry(project, user, allocation_percentage)
                else:
                    return None, "Пользователь не является участником проекта"
            elif allocation_percentage is not None:
                # Update existing member allocation if explicitly provided
                member.allocation_percentage = allocation_percentage
                member.save(update_fields=['allocation_percentage'])
                if profile:
                    from matching.models import WorkloadEntry
                    WorkloadEntry.objects.filter(employee=profile, project=project).update(load_percent=allocation_percentage)

        return member, None

    # Ключевые слова в названии задачи -> по чему искать исполнителя в должности участника
    ROLE_KEYWORDS = {
        'QA': (['TEST', 'QA', 'BUG', 'VERIFY', 'CHECK', 'ТЕСТ', 'ПРОВЕР'], ['QA', 'ТЕСТ']),
        'DESIGNER': (['DESIGN', 'UI', 'UX', 'MOCKUP', 'BRAND', 'ДИЗАЙН', 'МАКЕТ'], ['DESIGN', 'ДИЗАЙН']),
        'ANALYST': (['REQUIREMENT', 'SPEC', 'ANALYSIS', 'RESEARCH', 'АНАЛИЗ', 'ТРЕБОВАН', 'ИССЛЕД'], ['ANALY', 'АНАЛИТ']),
        'DEVELOPER': (['CODE', 'DEV', 'BUILD', 'IMPLEMENT', 'DEPLOY', 'FIX', 'РАЗРАБОТ', 'РЕАЛИЗ', 'ДЕПЛОЙ'], ['DEVELOP', 'РАЗРАБОТ', 'DEVOPS']),
        'MANAGER': (['MEETING', 'KICKOFF', 'BRIEFING', 'PLAN', 'APPROVAL', 'ВСТРЕЧ', 'ПЛАН', 'СОГЛАСОВ'], []),
    }

    @staticmethod
    def open_task_counts(project_members):
        """Сколько незакрытых задач процессов сейчас у каждого участника (user_id -> количество)."""
        from django.db.models import Count
        from workflows.models import WorkflowTask
        user_ids = [m.user_id for m in project_members]
        counts = {uid: 0 for uid in user_ids}
        rows = WorkflowTask.objects.filter(assigned_to_id__in=user_ids).exclude(status='DONE').values(
            'assigned_to_id').annotate(n=Count('id'))
        for row in rows:
            counts[row['assigned_to_id']] = row['n']
        return counts

    @staticmethod
    def _members_with_role(project_members, role_code, title_parts=()):
        """Участники с указанной ролью: по коду роли либо по названию должности."""
        role_code = (role_code or '').upper()
        result = []
        for m in project_members:
            title = (m.role_ref.name if m.role_ref_id else m.role or '').upper()
            if role_code == 'MANAGER':
                matched = m.role == 'MANAGER'
            else:
                matched = m.role.upper() == role_code or title == role_code or any(part in title for part in title_parts)
            if matched:
                result.append(m)
        return result

    @staticmethod
    def auto_assign(task_template, project_members, task_counts):
        """
        Автоназначение исполнителя на задачу процесса:
          1. роль, заданная в шаблоне задачи (assigned_role);
          2. иначе роль, угаданная по ключевым словам в названии;
          3. иначе любой участник, кроме менеджеров.
        Среди подходящих выбирается наименее загруженный задачами — раньше все задачи
        процесса доставались первому участнику команды.

        task_counts (user_id -> открытых задач) обновляется при каждом назначении.
        """
        if not project_members:
            return None

        candidates = []
        if task_template.assigned_role:
            candidates = AssignmentService._members_with_role(project_members, task_template.assigned_role)
        if not candidates:
            name = (task_template.name or '').upper()
            for role_code, (keywords, title_parts) in AssignmentService.ROLE_KEYWORDS.items():
                if any(kw in name for kw in keywords):
                    candidates = AssignmentService._members_with_role(project_members, role_code, title_parts)
                    if candidates:
                        break
        if not candidates:
            candidates = [m for m in project_members if m.role != 'MANAGER'] or list(project_members)

        chosen = min(candidates, key=lambda m: (task_counts.get(m.user_id, 0), m.id))
        task_counts[chosen.user_id] = task_counts.get(chosen.user_id, 0) + 1
        return chosen.user

    @staticmethod
    def assign_user(task, user, allow_auto_add=False, role='DEVELOPER', role_ref_id=None, allocation_percentage=None):
        """
        Assign a user to a task with validation.
        """
        member, error = AssignmentService.validate_assignment(task, user, allow_auto_add, role, role_ref_id, allocation_percentage)
        if error:
            raise ValidationError(error)
        
        task.assigned_to = user
        task.save(update_fields=['assigned_to'])
        
        # Notify user (in-app + email/telegram)
        project = task.block.project
        from notifications.utils import notify
        notify(
            recipient=user,
            title=f"Новая задача: {task.name}",
            body=f"Вы были назначены исполнителем задачи '{task.name}'"
                 + (f" в проекте '{project.name}'." if project else "."),
            notif_type='TASK_ASSIGNED',
            project_id=project.id if project else None,
        )

        return task


def add_working_days(start_date: datetime.date, days: int, calendar=None) -> datetime.date:
    """
    Add days to a date skipping weekends (Sat, Sun) and optional calendar holidays.
    """
    if days == 0:
        return start_date
    
    current_date = start_date
    added_days = 0
    step = 1 if days > 0 else -1
    target_days = abs(days)
    
    # Pre-fetch holidays if calendar is provided to avoid N+1
    holidays = set()
    if calendar:
        from plans.models import CalendarHoliday
        holidays = set(CalendarHoliday.objects.filter(calendar=calendar).values_list('date', flat=True))
    
    while added_days < target_days:
        current_date += datetime.timedelta(days=step)
        # Check if weekend (Sat=5, Sun=6) or holiday
        if current_date.weekday() < 5 and current_date not in holidays:
            added_days += 1
    return current_date


def get_working_days_delta(start_date: datetime.date, end_date: datetime.date, calendar=None) -> int:
    """
    Get number of working days between two dates.
    """
    if start_date > end_date:
        return -get_working_days_delta(end_date, start_date, calendar)
    
    days = 0
    curr = start_date
    holidays = set()
    if calendar:
        from plans.models import CalendarHoliday
        holidays = set(CalendarHoliday.objects.filter(calendar=calendar).values_list('date', flat=True))

    while curr < end_date:
        if curr.weekday() < 5 and curr not in holidays:
            days += 1
        curr += datetime.timedelta(days=1)
    return days


class PlanningImportService:

    # ── Копирование задач ────────────────────────────────────────────────────

    @staticmethod
    def _copy_tasks(source_block, new_block, *, start_date=None, scaling_factor=1.0, calendar=None,
                    task_ids=None, as_template=False, spawn_workflows=False):
        """
        Копирует задачи этапа вместе с подзадачами (иерархия сохраняется), ролями и зависимостями.

        task_ids        – копировать только выбранные задачи; их подзадачи берутся автоматически;
        as_template     – для шаблона даты не считаются (остаются смещения и длительности);
        spawn_workflows – для задач с шаблоном процесса сразу запустить процесс.
        Возвращает словарь {id исходной задачи: новая задача}.
        """
        from collections import defaultdict
        from plans.models import TaskRequiredRole

        tasks = list(source_block.tasks.prefetch_related('required_roles', 'outgoing_dependencies'))
        if task_ids:
            children = defaultdict(list)
            for t in tasks:
                children[t.parent_id].append(t.id)
            selected, stack = set(), list(task_ids)
            while stack:
                tid = stack.pop()
                if tid not in selected:
                    selected.add(tid)
                    stack.extend(children.get(tid, []))
            tasks = [t for t in tasks if t.id in selected]

        mapping = {}
        for t in sorted(tasks, key=lambda t: (t.order, t.id)):
            duration = max(1, round(t.duration_days * scaling_factor))
            offset = round(t.start_offset_days * scaling_factor)
            fields = dict(
                block=new_block, name=t.name, description=t.description,
                duration_days=duration, start_offset_days=offset, status='TODO',
                weight=t.weight, priority=t.priority, risk_level=t.risk_level, order=t.order,
                estimated_hours=round(t.estimated_hours * scaling_factor, 1),
                process_template=t.process_template,
            )
            if not as_template:
                task_start = add_working_days(start_date, offset, calendar=calendar)
                fields.update(start_date=task_start, end_date=add_working_days(task_start, duration, calendar=calendar))
            new_task = Task.objects.create(**fields)
            for rr in t.required_roles.all():
                TaskRequiredRole.objects.create(task=new_task, role=rr.role)
            mapping[t.id] = new_task

        # Иерархия и зависимости — вторым проходом, когда уже созданы все задачи
        for t in tasks:
            new_task = mapping[t.id]
            if t.parent_id in mapping:
                new_task.parent = mapping[t.parent_id]
                new_task.save(update_fields=['parent'])
            for dep in t.outgoing_dependencies.all():
                if dep.to_task_id in mapping:
                    TaskDependency.objects.create(from_task=new_task, to_task=mapping[dep.to_task_id], type=dep.type)

        if spawn_workflows:
            from workflows.services import WorkflowService
            for new_task in mapping.values():
                if new_task.process_template:
                    WorkflowService.create_process_from_template(
                        new_task.process_template, new_block.project,
                        wbs_task=new_task, creator=new_block.project.manager,
                    )
        return mapping

    @staticmethod
    def block_span_days(tasks) -> int:
        """Длительность этапа в днях: по датам задач, а у шаблона (дат нет) — по смещениям и срокам."""
        tasks = list(tasks)
        if not tasks:
            return 0
        starts = [t.start_date for t in tasks if t.start_date]
        ends = [t.end_date for t in tasks if t.end_date]
        if len(starts) == len(tasks) and len(ends) == len(tasks):
            return max(1, (max(ends) - min(starts)).days)
        return max(t.start_offset_days + t.duration_days for t in tasks)

    # ── Перенос и клонирование этапов ────────────────────────────────────────

    @staticmethod
    def import_template_to_project(
        template_block: PlanningBlock,
        project: Project,
        start_date: datetime.date,
        scaling_factor: float = 1.0,
        task_ids: list = None,
    ) -> PlanningBlock:
        """
        Import a planning block template (WBS) into a real project with date scaling.
        Supports partial import via task_ids.
        """
        if not template_block.is_template:
            raise ValueError('Блок не является шаблоном.')

        new_block = PlanningBlock.objects.create(
            name=template_block.name,
            domain=template_block.domain,
            is_template=False,
            project=project,
            calendar=project.calendar or template_block.calendar,
            avg_duration=template_block.avg_duration,
            complexity=template_block.complexity,
            success_rate=template_block.success_rate,
            process_template=template_block.process_template,
            source_template=template_block,
        )
        new_block.typical_risks.set(template_block.typical_risks.all())
        PlanningImportService._copy_tasks(
            template_block, new_block, start_date=start_date, scaling_factor=scaling_factor,
            calendar=new_block.calendar, task_ids=task_ids,
        )

        # Trigger process if template exists
        if template_block.process_template:
            PlanningImportService.create_process_from_block(new_block)

        return new_block

    @staticmethod
    def clone_block_recursive(
        source_block: PlanningBlock,
        project: Project,
        start_date: datetime.date,
        parent: PlanningBlock = None,
        scaling_factor: float = 1.0
    ) -> PlanningBlock:
        """
        Recursively clone a block and its children into a project.
        """
        new_block = PlanningBlock.objects.create(
            name=source_block.name,
            domain=source_block.domain,
            is_template=False,
            project=project,
            parent=parent,
            order=source_block.order,
            process_template=source_block.process_template,
            calendar=project.calendar or source_block.calendar,
            avg_duration=source_block.avg_duration,
            complexity=source_block.complexity,
            success_rate=source_block.success_rate,
            source_template=source_block if source_block.is_template else source_block.source_template,
        )
        new_block.typical_risks.set(source_block.typical_risks.all())
        PlanningImportService._copy_tasks(
            source_block, new_block, start_date=start_date, scaling_factor=scaling_factor,
            calendar=new_block.calendar, spawn_workflows=True,
        )

        # Trigger process if template exists
        if new_block.process_template:
            PlanningImportService.create_process_from_block(new_block)

        # Recurse for children
        for child in source_block.children.all():
            PlanningImportService.clone_block_recursive(child, project, start_date, parent=new_block, scaling_factor=scaling_factor)

        return new_block

    @staticmethod
    def save_block_as_template(block: PlanningBlock, name: str = None, parent: PlanningBlock = None) -> PlanningBlock:
        """
        Сохраняет этап проекта (вместе с вложенными этапами, подзадачами, ролями и зависимостями)
        как шаблон каталога. Длительность пакета берётся из реального плана этапа.
        """
        tasks = list(block.tasks.all())
        template = PlanningBlock.objects.create(
            name=name or f"Шаблон: {block.name}",
            domain=block.domain,
            is_template=True,
            project=None,
            parent=parent,
            order=block.order,
            process_template=block.process_template,
            calendar=block.calendar,
            avg_duration=PlanningImportService.block_span_days(tasks) or block.avg_duration,
            complexity=block.complexity,
            success_rate=block.success_rate,
        )
        template.typical_risks.set(block.typical_risks.all())
        PlanningImportService._copy_tasks(block, template, as_template=True)
        for child in block.children.all():
            PlanningImportService.save_block_as_template(child, name=child.name, parent=template)
        return template

    @staticmethod
    def create_process_from_block(block: PlanningBlock):
        """
        Instantiate a WorkflowInstance from a block's process_template.
        """
        if not block.process_template or not block.project:
            return None
        
        from workflows.services import WorkflowService
        return WorkflowService.create_process_from_template(
            template=block.process_template,
            project=block.project,
            creator=block.project.manager
        )

    @staticmethod
    def calculate_critical_path(block: PlanningBlock):
        """
        Calculates Early Start/Finish, Late Start/Finish, and identifies tasks on the Critical Path.
        """
        tasks = list(block.tasks.all().prefetch_related('incoming_dependencies', 'outgoing_dependencies'))
        if not tasks:
            return

        # 1. Forward Pass (Early Start/Finish)
        # Sort tasks topologically if possible, or just iterate until stable (since dependencies are FS mostly)
        # For simplicity in this demo, we'll use a multiple-pass approach or simple FS chain
        by_id = {t.id: t for t in tasks}
        # Учитываем только FS-зависимости внутри блока; считаем по объектам из by_id,
        # т.к. dep.from_task / dep.to_task — отдельные экземпляры без рассчитанных полей
        predecessors = {t.id: [] for t in tasks}
        successors = {t.id: [] for t in tasks}
        for t in tasks:
            for dep in t.outgoing_dependencies.all():
                if dep.type == 'FS' and dep.to_task_id in by_id:
                    successors[t.id].append(by_id[dep.to_task_id])
                    predecessors[dep.to_task_id].append(t)

        for t in tasks:
            t.es = 0
            t.ef = t.duration_days

        # Stability pass: цепочка длиной N сходится не более чем за N итераций
        # (ограничение защищает от зацикливания при циклических зависимостях)
        for _ in range(len(tasks)):
            changed = False
            for t in tasks:
                if predecessors[t.id]:
                    max_ef = max(p.ef for p in predecessors[t.id])
                    if t.es != max_ef:
                        t.es = max_ef
                        t.ef = t.es + t.duration_days
                        changed = True
            if not changed: break

        # 2. Backward Pass (Late Start/Finish)
        max_project_ef = max(t.ef for t in tasks) if tasks else 0
        for t in tasks:
            t.lf = max_project_ef
            t.ls = t.lf - t.duration_days

        for _ in range(len(tasks)):
            changed = False
            for t in tasks:
                if successors[t.id]:
                    min_ls = min(n.ls for n in successors[t.id])
                    if t.lf != min_ls:
                        t.lf = min_ls
                        t.ls = t.lf - t.duration_days
                        changed = True
            if not changed: break

        # 3. Identify Critical Path (Float = 0)
        critical_ids = []
        for t in tasks:
            slack = t.ls - t.es
            is_critical = slack <= 0
            if is_critical:
                critical_ids.append(t.id)
        
        # Update DB
        Task.objects.filter(block=block).update(is_critical=False)
        Task.objects.filter(id__in=critical_ids).update(is_critical=True)

    @staticmethod
    def recalculate_block_schedule(block: PlanningBlock, start_date: datetime.date = None):
        """
        Recalculate all tasks in a block based on offsets and duration.
        """
        tasks = block.tasks.all().order_by('start_offset_days', 'id')
        if not tasks.exists():
            return
            
        calendar = block.calendar or (block.project.calendar if block.project else None)
        first = tasks.first()
        if start_date:
            base_date = start_date
        elif first.start_date:
            # Старт блока = дата первой задачи минус её смещение
            base_date = add_working_days(first.start_date, -first.start_offset_days, calendar=calendar)
        else:
            base_date = (block.project.start_date if block.project else None) or datetime.date.today()

        for t in tasks:
            t.start_date = add_working_days(base_date, t.start_offset_days, calendar=calendar)
            t.end_date = add_working_days(t.start_date, t.duration_days, calendar=calendar)
            t.save(update_fields=['start_date', 'end_date'])

    @staticmethod
    def shift_task_with_propagation(task: Task, new_start_date: datetime.date):
        """
        Experimental 'What-if': Shift a task and propagate to all downstream dependents.
        """
        if not task.start_date:
            return
            
        # Calculate delta in working days
        working_days_delta = get_working_days_delta(task.start_date, new_start_date)
        if working_days_delta == 0:
            # Might still be a shift if it landed on a weekend
            if task.start_date == new_start_date:
                return
            
        # BFS to find all affected tasks within the same block
        affected = {task.id}
        queue = [task]
        
        while queue:
            curr = queue.pop(0)
            for dep in curr.outgoing_dependencies.filter(type='FS'):
                child = dep.to_task
                if child.id not in affected:
                    affected.add(child.id)
                    queue.append(child)
        
        # Apply shift in working days
        tasks_to_shift = Task.objects.filter(id__in=affected)
        calendar = task.block.calendar or (task.block.project.calendar if task.block.project else None)
        
        for t in tasks_to_shift:
            if t.start_date:
                t.start_date = add_working_days(t.start_date, working_days_delta, calendar=calendar)
                t.end_date = add_working_days(t.start_date, t.duration_days, calendar=calendar)
                # Update offset based on a fixed project start or relative to block
                # For simplicity, we just add the delta to the current offset
                t.start_offset_days += working_days_delta
                t.save(update_fields=['start_date', 'end_date', 'start_offset_days'])
        
        # Recalculate Critical Path
        PlanningImportService.calculate_critical_path(task.block)

    @staticmethod
    def import_block_to_project(
        source_block: PlanningBlock,
        project: Project,
        start_date: datetime.date,
        scaling_factor: float = 1.0,
        task_ids: list = None,
    ) -> PlanningBlock:
        """
        Copy a non-template planning block from one project into another project.
        """
        new_block = PlanningBlock.objects.create(
            name=source_block.name,
            domain=source_block.domain,
            is_template=False,
            project=project,
            calendar=project.calendar or source_block.calendar,
            avg_duration=source_block.avg_duration,
            complexity=source_block.complexity,
            success_rate=source_block.success_rate,
            source_template=source_block.source_template,
        )
        new_block.typical_risks.set(source_block.typical_risks.all())
        PlanningImportService._copy_tasks(
            source_block, new_block, start_date=start_date, scaling_factor=scaling_factor,
            calendar=new_block.calendar, task_ids=task_ids,
        )
        return new_block

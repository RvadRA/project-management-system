import datetime
from .models import Project, PlanningBlock, Task, TaskDependency, ProjectMember
from matching.models import EmployeeProfile
from django.db.models import Q
from rest_framework.exceptions import ValidationError


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
                    member = ProjectMember.objects.create(
                        project=project,
                        user=user,
                        role=role,
                        role_ref_id=role_ref_id,
                        allocation_percentage=allocation_percentage if allocation_percentage is not None else 100
                    )
                    
                    # Если роль MANAGER и в проекте не назначен основной менеджер — назначаем
                    if role == 'MANAGER' and not project.manager:
                        project.manager = user
                        project.save(update_fields=['manager'])
                    
                    # Синхронизируем нагрузку
                    if profile:
                        from matching.models import WorkloadEntry
                        WorkloadEntry.objects.update_or_create(
                            employee=profile,
                            project=project,
                            defaults={
                                'load_percent': allocation_percentage if allocation_percentage is not None else 100,
                                'start_date': project.start_date or datetime.date.today(),
                                'end_date': project.end_date or (datetime.date.today() + datetime.timedelta(days=30))
                            }
                        )
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

    @staticmethod
    def auto_assign_heuristic(task_name, project_members):
        """
        Simple heuristic for auto-assigning tasks based on roles and task names.
        """
        if not project_members:
            return None
            
        task_name_upper = task_name.upper()
        
        # Role mapping
        role_map = {
            'DEVELOPER': ['CODE', 'DEV', 'BUILD', 'IMPLEMENT', 'SETUP', 'WORKSTATION', 'FIX'],
            'QA': ['TEST', 'QA', 'BUG', 'VERIFY', 'CHECK'],
            'DESIGNER': ['DESIGN', 'UI', 'UX', 'ASSET', 'MOCKUP', 'BRAND'],
            'ANALYST': ['REQUIREMENT', 'SPEC', 'ANALYSIS', 'DATA', 'DOCUMENTATION', 'RESEARCH'],
            'MANAGER': ['MEETING', 'INTRO', 'BRIEFING', 'PACKAGE', 'PLAN'],
        }
        
        for role, keywords in role_map.items():
            if any(kw in task_name_upper for kw in keywords):
                # Find first member with this role
                member = next((m for m in project_members if m.role == role), None)
                if member:
                    return member.user
        
        # Fallback: assign to the first non-manager member or manager if no others
        others = [m for m in project_members if m.role != 'MANAGER']
        if others:
            return others[0].user
        return project_members[0].user if project_members else None

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
        
        # Notify user
        from notifications.tasks import send_notification_async
        send_notification_async.delay(
            user_id=user.id,
            title=f"Новая задача: {task.name}",
            body=f"Вы были назначены исполнителем задачи '{task.name}' в проекте '{task.block.project.name}'.",
            channels=('email', 'telegram')
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
        )
        
        # Copy typical risks
        new_block.typical_risks.set(template_block.typical_risks.all())

        calendar = new_block.calendar
        old_to_new_task_map = {}
        
        tasks_to_import = template_block.tasks.all()
        if task_ids:
            tasks_to_import = tasks_to_import.filter(id__in=task_ids)

        for t_task in tasks_to_import:
            scaled_duration = max(1, round(t_task.duration_days * scaling_factor))
            
            # Use working days for offset and duration
            computed_start = add_working_days(
                start_date, 
                round(t_task.start_offset_days * scaling_factor),
                calendar=calendar
            )
            computed_end = add_working_days(computed_start, scaled_duration, calendar=calendar)

            new_task = Task.objects.create(
                block=new_block,
                name=t_task.name,
                description=t_task.description,
                duration_days=scaled_duration,
                start_offset_days=round(t_task.start_offset_days * scaling_factor),
                start_date=computed_start,
                end_date=computed_end,
                status='TODO',
                weight=t_task.weight,
                priority=t_task.priority,
                estimated_hours=t_task.estimated_hours * scaling_factor,
                risk_level=t_task.risk_level,
            )
            
            # Copy required roles
            from plans.models import TaskRequiredRole
            for rr in t_task.required_roles.all():
                TaskRequiredRole.objects.create(task=new_task, role=rr.role)

            old_to_new_task_map[t_task.id] = new_task

        # Copy dependencies
        for t_task in tasks_to_import:
            for dep in t_task.outgoing_dependencies.all():
                if dep.to_task.id in old_to_new_task_map:
                    TaskDependency.objects.create(
                        from_task=old_to_new_task_map[t_task.id],
                        to_task=old_to_new_task_map[dep.to_task.id],
                        type=dep.type,
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
        # Create the new block
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
        )
        
        # Copy risks
        new_block.typical_risks.set(source_block.typical_risks.all())

        # Copy tasks (using existing logic for tasks within this block)
        calendar = new_block.calendar
        old_to_new_task_map = {}
        for t_task in source_block.tasks.all():
            scaled_duration = max(1, round(t_task.duration_days * scaling_factor))
            computed_start = add_working_days(
                start_date, 
                round(t_task.start_offset_days * scaling_factor),
                calendar=calendar
            )
            computed_end = add_working_days(computed_start, scaled_duration, calendar=calendar)

            new_task = Task.objects.create(
                block=new_block,
                name=t_task.name,
                description=t_task.description,
                duration_days=scaled_duration,
                start_offset_days=round(t_task.start_offset_days * scaling_factor),
                start_date=computed_start,
                end_date=computed_end,
                status='TODO',
                weight=t_task.weight,
                priority=t_task.priority,
                estimated_hours=t_task.estimated_hours * scaling_factor,
                risk_level=t_task.risk_level,
                order=t_task.order,
                process_template=t_task.process_template
            )
            
            # Trigger process if task has template
            if new_task.process_template:
                from workflows.services import WorkflowService
                WorkflowService.create_process_from_template(
                    new_task.process_template, 
                    new_block.project, 
                    wbs_task=new_task,
                    creator=new_block.project.manager
                )
            
            # Copy roles
            from plans.models import TaskRequiredRole
            for rr in t_task.required_roles.all():
                TaskRequiredRole.objects.create(task=new_task, role=rr.role)
            old_to_new_task_map[t_task.id] = new_task

        # Copy dependencies (internal to block)
        for t_task in source_block.tasks.all():
            for dep in t_task.outgoing_dependencies.all():
                if dep.to_task.id in old_to_new_task_map:
                    TaskDependency.objects.create(
                        from_task=old_to_new_task_map[t_task.id],
                        to_task=old_to_new_task_map[dep.to_task.id],
                        type=dep.type,
                    )

        # Trigger process if template exists
        if new_block.process_template:
            PlanningImportService.create_process_from_block(new_block)

        # Recurse for children
        for child in source_block.children.all():
            PlanningImportService.clone_block_recursive(child, project, start_date, parent=new_block, scaling_factor=scaling_factor)

        return new_block

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
        for t in tasks:
            t.es = 0
            t.ef = t.duration_days
        
        # Stability pass (max 10 iterations for safety or use topological sort)
        for _ in range(10):
            changed = False
            for t in tasks:
                incoming = t.incoming_dependencies.filter(type='FS')
                if incoming.exists():
                    max_ef = max(dep.from_task.ef for dep in incoming)
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

        for _ in range(10):
            changed = False
            for t in tasks:
                outgoing = t.outgoing_dependencies.filter(type='FS')
                if outgoing.exists():
                    min_ls = min(dep.to_task.ls for dep in outgoing)
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
            
        base_date = start_date or tasks.first().start_date or datetime.date.today()
        calendar = block.calendar or (block.project.calendar if block.project else None)
        
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
        )
        
        # Copy typical risks
        new_block.typical_risks.set(source_block.typical_risks.all())

        calendar = new_block.calendar
        old_to_new_task_map = {}
        
        tasks_to_import = source_block.tasks.all()
        if task_ids:
            tasks_to_import = tasks_to_import.filter(id__in=task_ids)

        for t_task in tasks_to_import:
            scaled_duration = max(1, round(t_task.duration_days * scaling_factor))
            computed_start = add_working_days(
                start_date, 
                round(t_task.start_offset_days * scaling_factor),
                calendar=calendar
            )
            computed_end = add_working_days(computed_start, scaled_duration, calendar=calendar)

            new_task = Task.objects.create(
                block=new_block,
                name=t_task.name,
                description=t_task.description,
                duration_days=scaled_duration,
                start_offset_days=round(t_task.start_offset_days * scaling_factor),
                start_date=computed_start,
                end_date=computed_end,
                status='TODO',
                weight=t_task.weight,
                priority=t_task.priority,
                estimated_hours=t_task.estimated_hours * scaling_factor,
                risk_level=t_task.risk_level,
            )
            
            # Copy required roles
            from plans.models import TaskRequiredRole
            for rr in t_task.required_roles.all():
                TaskRequiredRole.objects.create(task=new_task, role=rr.role)

            old_to_new_task_map[t_task.id] = new_task

        for t_task in tasks_to_import:
            for dep in t_task.outgoing_dependencies.all():
                if dep.to_task.id in old_to_new_task_map:
                    TaskDependency.objects.create(
                        from_task=old_to_new_task_map[t_task.id],
                        to_task=old_to_new_task_map[dep.to_task.id],
                        type=dep.type,
                    )

        return new_block
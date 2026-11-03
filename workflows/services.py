from django.utils import timezone
from .models import WorkflowTask, WorkflowInstance


class WorkflowService:
    """
    Жизненный цикл задачи процесса:

        TODO ──(предшественники выполнены)──▶ IN_PROGRESS ──(отчёт)──▶ REVIEW ──(утверждение)──▶ DONE
                                                  │   ▲                    │
                                 (SLA истёк)      ▼   └──(возврат на доработку)
                                              ESCALATED ──(отчёт)──▶ REVIEW

    Завершение задачи активирует следующие по зависимостям; когда выполнены все — процесс завершён.
    """

    # ── Зависимости и активация ──────────────────────────────────────────────

    @staticmethod
    def is_blocked(task):
        """Задача заблокирована, пока не выполнены все её предшественники."""
        return any(dep.status != 'DONE' for dep in task.depends_on.all())

    @staticmethod
    def start_task(task, notify_assignee=True):
        """
        Переводит задачу в работу. Отсчёт SLA начинается с этого момента:
        пока задача ждала своей очереди, срок не шёл.
        """
        now = timezone.now()
        task.status = 'IN_PROGRESS'
        task.started_at = task.started_at or now
        task.completed_at = None
        if task.sla_hours:
            task.due_date = now + timezone.timedelta(hours=task.sla_hours)
        task.save()

        if notify_assignee and task.assigned_to_id:
            from notifications.utils import notify
            notify(
                recipient=task.assigned_to,
                title='Задача готова к выполнению',
                body=f'Задача «{task.name}» в процессе «{task.workflow.name}» перешла в работу.'
                     + (f' Срок: {task.sla_hours} ч.' if task.sla_hours else ''),
                notif_type='TASK_ASSIGNED',
                task_id=task.id,
                project_id=task.workflow.project_id,
            )
        return task

    @staticmethod
    def activate_next_tasks(task):
        """
        Проверяет зависимые задачи и активирует их (переводит в IN_PROGRESS),
        если все их предшественники выполнены (DONE).
        """
        if task.status != 'DONE':
            return []
        activated = []
        for dep_task in task.dependent_tasks.filter(status='TODO').prefetch_related('depends_on'):
            if not WorkflowService.is_blocked(dep_task):
                activated.append(WorkflowService.start_task(dep_task))
        return activated

    @staticmethod
    def activate_ready_tasks(instance):
        """Запускает все задачи процесса, у которых нет невыполненных предшественников."""
        activated = []
        # Цикл нужен для задач, которые завершаются сразу при запуске (интеграции):
        # после них могут открыться следующие
        while True:
            ready = [
                t for t in instance.tasks.filter(status='TODO').prefetch_related('depends_on')
                if not WorkflowService.is_blocked(t)
            ]
            if not ready:
                return activated
            for task in ready:
                activated.append(WorkflowService.start_task(task))

    @staticmethod
    def refresh_instance_status(instance):
        """Процесс завершён, когда выполнены все его задачи; иначе он снова в работе."""
        if instance.status == 'CANCELLED':
            return
        statuses = set(instance.tasks.values_list('status', flat=True))
        all_done = bool(statuses) and statuses == {'DONE'}
        if all_done and instance.status != 'COMPLETED':
            instance.status = 'COMPLETED'
            instance.completed_at = timezone.now()
            instance.save(update_fields=['status', 'completed_at'])
        elif not all_done and instance.status == 'COMPLETED':
            # Задачу вернули в работу или добавили новую — процесс больше не завершён
            instance.status = 'IN_PROGRESS'
            instance.completed_at = None
            instance.save(update_fields=['status', 'completed_at'])

    # ── Правила переходов ────────────────────────────────────────────────────

    @staticmethod
    def validate_transition(task, user, new_status):
        """
        Проверяет, разрешен ли переход в новый статус для данного пользователя.
        """
        condition = task.transition_condition
        if not condition:
            return True, ""

        if new_status == 'DONE':
            # Пример условия: нужна проверка менеджером
            if condition.get('type') == 'approval_required':
                from projects import access
                required_role = condition.get('role', 'MANAGER')
                project = task.workflow.project
                allowed = (
                    access.has_global_access(user)
                    or user.role == required_role
                    # менеджер конкретного проекта тоже вправе утвердить задачу
                    or (required_role == 'MANAGER' and project and access.is_project_manager(user, project))
                )
                if not allowed:
                    return False, f"Для завершения этой задачи требуется утверждение пользователем с ролью {required_role}"

        return True, ""

    @staticmethod
    def complete_task(task):
        """Закрывает задачу и запускает следующие этапы."""
        task.complete()
        return WorkflowService.activate_next_tasks(task)

    # ── Связь с планом (WBS) ─────────────────────────────────────────────────

    @staticmethod
    def aggregate_status(statuses):
        """Сводный статус набора задач процесса для отображения в плане."""
        statuses = set(statuses)
        if not statuses:
            return None
        if statuses == {'DONE'}:
            return 'DONE'
        if statuses == {'TODO'}:
            return 'TODO'
        if statuses <= {'DONE', 'REVIEW'}:
            return 'REVIEW'
        return 'IN_PROGRESS'

    @staticmethod
    def sync_wbs_status(workflow_task):
        """
        Синхронизирует статус в WBS плане (если есть связь).
        """
        wbs_task = workflow_task.linked_wbs_task
        if not wbs_task:
            return
        # К одной задаче плана привязан весь процесс (несколько WorkflowTask),
        # поэтому статус WBS — агрегат, а не статус последней сохранённой задачи
        new_status = WorkflowService.aggregate_status(
            wbs_task.execution_tasks.values_list('status', flat=True)
        )
        # Only sync if the status actually changed to prevent loops
        if new_status and wbs_task.status != new_status:
            wbs_task.status = new_status
            wbs_task.save(update_fields=['status'])

    # ── Запуск процесса по шаблону ───────────────────────────────────────────

    @staticmethod
    def create_process_from_template(template, project, wbs_task=None, creator=None, existing_instance=None):
        """
        Создает экземпляр процесса и задачи по шаблону.
        """
        if existing_instance:
            instance = existing_instance
            if not instance.template:
                instance.template = template
                instance.save(update_fields=['template'])
        else:
            instance = WorkflowInstance.objects.create(
                template=template,
                project=project,
                name=f"{template.name}: {wbs_task.name if wbs_task else project.name if project else 'Standalone'}",
                status='IN_PROGRESS',
                created_by=creator,
                started_at=timezone.now()
            )

        # Get project members for auto-assignment if project exists
        project_members = []
        if project:
            project_members = list(project.members.select_related('user', 'role_ref').all())

        from projects.services import AssignmentService

        task_templates = list(template.task_templates.all().order_by('order', 'id'))
        # template_id -> [template_id предшественников]
        predecessors = {t.id: list(t.depends_on.values_list('id', flat=True)) for t in task_templates}
        if len(task_templates) > 1 and not any(predecessors.values()):
            # Зависимости в шаблоне не заданы: задачи идут последовательно по order,
            # а помеченные is_parallel выполняются параллельно с предыдущей
            group_predecessors = []
            current_group = []
            for t_template in task_templates:
                if current_group and not t_template.is_parallel:
                    group_predecessors = current_group
                    current_group = []
                predecessors[t_template.id] = list(group_predecessors)
                current_group.append(t_template.id)

        # Все задачи создаются в очереди (TODO) без срока: SLA начинает отсчитываться при активации.
        # Запуск — отдельным шагом после расстановки зависимостей, иначе задача, которая
        # завершается мгновенно (интеграция), не увидела бы своих последователей.
        tasks_map = {}  # template_id -> WorkflowTask
        # user_id -> открытых задач: исполнители выбираются с учётом текущей загрузки
        assigned_counts = AssignmentService.open_task_counts(project_members)
        for t_template in task_templates:
            # Инициализируем чек-лист из шаблона
            initial_checklist = [{"text": item, "is_done": False} for item in t_template.checklist] if t_template.checklist else []
            assignee = AssignmentService.auto_assign(t_template, project_members, assigned_counts)

            wt = WorkflowTask.objects.create(
                workflow=instance,
                task_template=t_template,
                name=t_template.name,
                description=t_template.description,
                task_type=t_template.task_type,
                status='TODO',
                sla_hours=t_template.sla_hours,
                priority=t_template.priority,
                estimated_hours=t_template.estimated_hours,
                risk_level=t_template.risk_level,
                order=t_template.order,
                weight=t_template.weight,
                checklist=initial_checklist,
                linked_wbs_task=wbs_task,
                integration_url=t_template.integration_url,
                integration_config=t_template.integration_config,
                transition_condition=t_template.transition_condition or {},
                auto_approve=t_template.auto_approve,
                assigned_to=assignee,
            )
            tasks_map[t_template.id] = wt

        # save() проставляет срок при создании — для задач в очереди он не нужен
        WorkflowTask.objects.filter(id__in=[t.id for t in tasks_map.values()]).update(due_date=None)

        # Устанавливаем зависимости
        for t_template in task_templates:
            wt = tasks_map[t_template.id]
            dep_tasks = [tasks_map[dep_id] for dep_id in predecessors[t_template.id] if dep_id in tasks_map]
            if dep_tasks:
                wt.depends_on.add(*dep_tasks)

        WorkflowService.activate_ready_tasks(instance)
        return instance

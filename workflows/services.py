from django.utils import timezone
from .models import WorkflowTask, WorkflowInstance, TaskReport

class WorkflowService:
    @staticmethod
    def activate_next_tasks(task):
        """
        Проверяет зависимые задачи и активирует их (переводит в IN_PROGRESS),
        если все их предшественники выполнены (DONE).
        """
        if task.status != 'DONE':
            return
            
        # Находим задачи, которые зависят от текущей
        dependent_tasks = task.dependent_tasks.all()
        
        for dep_task in dependent_tasks:
            # Проверяем, все ли предшественники dep_task выполнены
            predecessors_done = not dep_task.depends_on.exclude(status='DONE').exists()
            
            if predecessors_done and dep_task.status == 'TODO':
                dep_task.status = 'IN_PROGRESS'
                dep_task.started_at = timezone.now()
                dep_task.save(update_fields=['status', 'started_at'])
                # Логируем активацию (в идеале через AuditLog, но пока просто сохраняем)

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
                required_role = condition.get('role', 'MANAGER')
                if user.role != required_role and user.role != 'ADMIN':
                    return False, f"Для завершения этой задачи требуется утверждение пользователем с ролью {required_role}"
                    
        return True, ""

    @staticmethod
    def sync_wbs_status(workflow_task):
        """
        Синхронизирует статус в WBS плане (если есть связь).
        """
        if workflow_task.linked_wbs_task:
            wbs_task = workflow_task.linked_wbs_task
            # Only sync if the status actually changed to prevent loops
            if wbs_task.status != workflow_task.status:
                wbs_task.status = workflow_task.status
                wbs_task.save(update_fields=['status'])

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
            project_members = list(project.members.select_related('user').all())
        
        from projects.services import AssignmentService
        
        tasks_map = {} # template_id -> WorkflowTask
        for t_template in template.task_templates.all().order_by('order'):
            # Активируем задачи без зависимостей или с order=0
            is_start = t_template.order == 0 or not t_template.depends_on.exists()
            
            # Инициализируем чек-лист из шаблона
            initial_checklist = [{"text": item, "is_done": False} for item in t_template.checklist] if t_template.checklist else []

            wt = WorkflowTask.objects.create(
                workflow=instance,
                task_template=t_template,
                name=t_template.name,
                description=t_template.description,
                task_type=t_template.task_type,
                status='IN_PROGRESS' if is_start else 'TODO',
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
                due_date=timezone.now() + timezone.timedelta(hours=t_template.sla_hours or 24),
                assigned_to=AssignmentService.auto_assign_heuristic(t_template.name, project_members) if project_members else None,
                started_at=timezone.now() if is_start else None
            )
            
            # Notify auto-assigned user
            if wt.assigned_to:
                from notifications.utils import notify
                notify(
                    recipient=wt.assigned_to,
                    title='Автоматическое назначение задачи',
                    body=f'Вы были автоматически назначены на задачу "{wt.name}" в рамках нового процесса "{instance.name}".',
                    notif_type='TASK_ASSIGNED',
                    task_id=wt.id,
                    project_id=instance.project.id if instance.project else None
                )

            tasks_map[t_template.id] = wt
            
        # Устанавливаем зависимости
        for t_template in template.task_templates.all():
            wt = tasks_map.get(t_template.id)
            if wt:
                for dep_template in t_template.depends_on.all():
                    dep_task = tasks_map.get(dep_template.id)
                    if dep_task:
                        wt.depends_on.add(dep_task)
            
        return instance

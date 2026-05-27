from celery import shared_task
from django.utils import timezone
from .models import WorkflowTask
from notifications.utils import notify

@shared_task
def check_all_tasks_sla():
    """
    Periodic task to check SLA and escalate overdue tasks.
    Runs via Celery Beat.
    """
    # Only check tasks that are not finished
    tasks = WorkflowTask.objects.exclude(status__in=['DONE', 'CANCELLED'])
    count = 0
    for task in tasks:
        if task.is_overdue:
            # check_sla() updates status and sends notifications
            task.check_sla()
            count += 1

    return f"Checked SLA for {tasks.count()} tasks. {count} tasks escalated."

@shared_task
def execute_integration_task(task_id):
    """
    Asynchronously execute integration webhook and update task status.
    """
    from .models import WorkflowTask
    from .services import WorkflowService
    
    try:
        task = WorkflowTask.objects.get(id=task_id)
    except WorkflowTask.DoesNotExist:
        return "Task not found"

    if task.task_type != 'INTEGRATION':
        return "Not an integration task"

    # Set flag to prevent signal recursion during internal saves
    task._integration_running = True
    success, message = task.execute_integration()
    
    new_status = 'DONE' if success else 'ESCALATED'
    task.status = new_status
    if success:
        task.completed_at = timezone.now()
    task.save()

    # Create report
    from .models import TaskReport
    TaskReport.objects.create(
        task=task,
        text_content=f"Celery Integration {'Success' if success else 'Error'}: {message}",
        submitted_at=timezone.now()
    )

    if success:
        WorkflowService.activate_next_tasks(task)

    # Notify assignee/manager about integration result
    try:
        from notifications.tasks import send_rich_task_notification
        recipients = set()
        if task.assigned_to: recipients.add(task.assigned_to.id)
        if task.workflow.project and task.workflow.project.manager: recipients.add(task.workflow.project.manager.id)
        
        for uid in recipients:
            send_rich_task_notification.delay(
                user_id=uid,
                task_id=task.id,
                event_type='APPROVED' if success else 'ESCALATED',
                changer_name="System (Integration)"
            )
    except Exception:
        pass

    return f"Integration {'completed' if success else 'failed'}: {message}"

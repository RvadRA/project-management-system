import requests
from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail

User = get_user_model()

def get_task_progress(task):
    if task.status in ('REVIEW', 'DONE'):
        return 100
    if not task.checklist:
        return 0
    total = len(task.checklist)
    done = sum(1 for item in task.checklist if item.get('is_done'))
    return int((done / total) * 100)

def format_progress_bar(progress):
    filled = progress // 10
    bar = "█" * filled + "░" * (10 - filled)
    return f"<code>{bar} {progress}%</code>"

@shared_task
def send_notification_async(user_id, title, body, channels=('email', 'telegram', 'slack')):
    """
    Asynchronously send notification via multiple channels.
    """
    try:
        user = User.objects.get(id=user_id)
        profile = getattr(user, 'profile', None)
    except User.DoesNotExist:
        return

    # 1. Email
    if 'email' in channels and user.email:
        # Check preference
        if profile and not profile.notify_email:
            pass # Skip if disabled
        else:
            send_mail(
                subject=title,
                message=body,
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@pms.local'),
                recipient_list=[user.email],
                fail_silently=True,
            )

    # 2. Telegram
    if 'telegram' in channels:
        token = getattr(settings, 'TELEGRAM_BOT_TOKEN', None)
        chat_id = profile.telegram_chat_id if profile and profile.telegram_chat_id else getattr(settings, 'TELEGRAM_CHANNEL_ID', None)
            
        if token and chat_id:
            # Check preference
            if profile and not profile.notify_telegram:
                return # Skip if disabled
                
            try:
                url = f"https://api.telegram.org/bot{token}/sendMessage"
                text = f"<b>{title}</b>\n\n{body}" if title else body
                requests.post(url, json={
                    "chat_id": chat_id,
                    "text": text,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": False
                }, timeout=5)
            except Exception:
                pass

@shared_task
def send_rich_task_notification(user_id, task_id, event_type, changer_name=None):
    """
    Sends a beautifully formatted task notification.
    event_type: 'STATUS_CHANGED', 'ASSIGNED', 'APPROVED', 'ESCALATED'
    """
    from workflows.models import WorkflowTask
    try:
        user = User.objects.get(id=user_id)
        task = WorkflowTask.objects.select_related('workflow__project', 'assigned_to', 'workflow__project__manager').get(id=task_id)
    except (User.DoesNotExist, WorkflowTask.DoesNotExist):
        return

    project_name = task.workflow.project.name if task.workflow.project else "Личный процесс"
    manager_name = task.workflow.project.manager.get_full_name() or task.workflow.project.manager.username if task.workflow.project and task.workflow.project.manager else "Не назначен"
    assignee_name = task.assigned_to.get_full_name() or task.assigned_to.username if task.assigned_to else "Не назначен"
    
    progress = get_task_progress(task)
    progress_bar = format_progress_bar(progress)
    
    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5175')
    task_url = f"{frontend_url}/workflows/tasks/{task.id}"
    
    status_emojis = {'TODO': '📋', 'IN_PROGRESS': '⚡', 'REVIEW': '🔍', 'DONE': '✅', 'ESCALATED': '🚨'}
    emoji = status_emojis.get(task.status, '🔄')
    
    header = "🔄 <b>Статус задачи изменен</b>"
    if event_type == 'ASSIGNED': header = "👤 <b>Новая задача назначена</b>"
    elif event_type == 'APPROVED': header = "✅ <b>Результат утвержден</b>"
    elif event_type == 'ESCALATED': header = "🚨 <b>Критическая просрочка (SLA)</b>"
    
    body = f"""{header}

📌 <b>Задача:</b> {task.name}
📊 <b>Статус:</b> {emoji} {task.get_status_display()}
📈 <b>Прогресс:</b> {progress_bar}
📁 <b>Проект:</b> {project_name}

👤 <b>Менеджер:</b> {manager_name}
👨‍💻 <b>Исполнитель:</b> {assignee_name}
"""
    if changer_name:
        body += f"✍️ <b>Изменил:</b> {changer_name}\n"
        
    body += f'\n📎 <a href="{task_url}">Открыть задачу</a>'
    
    # Save to database for in-app bell
    from .models import Notification
    Notification.objects.create(
        recipient=user,
        title=header.replace('<b>', '').replace('</b>', '').split(' ')[1] if ' ' in header else header,
        body=f"Задача: {task.name}. Статус: {task.get_status_display()}",
        type='TASK_ASSIGNED' if event_type == 'ASSIGNED' else 'INFO',
        task_id=task.id,
        project_id=task.workflow.project.id if task.workflow.project else None
    )
    
    send_notification_async(user_id, "", body, channels=('email', 'telegram'))

@shared_task
def daily_summary_digest():
    """
    Daily morning summary for all users with active tasks.
    """
    from workflows.models import WorkflowTask
    from django.utils import timezone
    
    users = User.objects.filter(is_active=True).select_related('profile')
    for user in users:
        # Check user preference
        profile = getattr(user, 'profile', None)
        if profile and not profile.notify_daily_digest:
            continue

        tasks = WorkflowTask.objects.filter(assigned_to=user).exclude(status='DONE')
        if not tasks.exists():
            continue
            
        todo_count = tasks.filter(status='TODO').count()
        progress_count = tasks.filter(status='IN_PROGRESS').count()
        review_count = tasks.filter(status='REVIEW').count()
        overdue_count = sum(1 for t in tasks if t.is_overdue)
        
        body = f"""📅 <b>Ежедневный дайджест: {timezone.now().strftime('%d.%m.%Y')}</b>

У вас на сегодня {tasks.count()} активных задач:

📋 К выполнению: {todo_count}
⚡ В работе: {progress_count}
🔍 На проверке: {review_count}
🚨 Просрочено: <b>{overdue_count}</b>

💡 Успешного рабочего дня!
"""
        send_notification_async(user.id, "", body, channels=('telegram',))

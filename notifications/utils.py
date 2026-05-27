from .models import Notification
from .tasks import send_notification_async

def notify(recipient, title, body='', notif_type='INFO', link='', task_id=None, project_id=None):
    """Create a single in-app notification and trigger async delivery."""
    Notification.objects.create(
        recipient=recipient,
        title=title,
        body=body,
        type=notif_type,
        link=link or '',
        task_id=task_id,
        project_id=project_id,
    )
    # Trigger async notification (email, telegram, slack)
    send_notification_async.delay(recipient.id, title, body)


def notify_many(recipients, title, body='', notif_type='INFO', link=''):
    """Create the same notification for multiple users + trigger async delivery."""
    Notification.objects.bulk_create([
        Notification(
            recipient=r,
            title=title,
            body=body,
            type=notif_type,
            link=link or '',
        )
        for r in recipients
    ])
    for r in recipients:
        send_notification_async.delay(r.id, title, body)
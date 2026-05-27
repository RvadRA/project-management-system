from django.db import models
from django.conf import settings


class Notification(models.Model):
    TYPE_CHOICES = [
        ('INFO', 'Info'),
        ('SUCCESS', 'Success'),
        ('WARNING', 'Warning'),
        ('ERROR', 'Error'),
        ('TASK_ASSIGNED', 'Task Assigned'),
        ('TASK_DEADLINE', 'Task Deadline'),
        ('ESCALATION', 'Escalation'),
    ]
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES, default='INFO')
    is_read = models.BooleanField(default=False)
    link = models.CharField(max_length=500, blank=True, null=True)
    task_id = models.PositiveIntegerField(null=True, blank=True)
    project_id = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Уведомление'
        verbose_name_plural = 'Уведомления'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.recipient.username}: {self.title}'
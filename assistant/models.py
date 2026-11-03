from django.conf import settings
from django.db import models


class AIRequestLog(models.Model):
    """
    Журнал обращений к ИИ: кто, какая функция, какой провайдер ответил.
    Текст запросов и ответов не сохраняется — только факт обращения.
    """
    FEATURE_CHOICES = [
        ('transcribe', 'Распознавание речи'),
        ('task_draft', 'Черновик задачи'),
        ('ask', 'Вопрос по базе знаний'),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='ai_requests')
    feature = models.CharField(max_length=20, choices=FEATURE_CHOICES)
    # Пусто — ни один провайдер не ответил, сработал резервный режим без нейросети
    provider = models.CharField(max_length=80, blank=True)
    duration_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.feature} via {self.provider or "fallback"} @ {self.created_at:%Y-%m-%d %H:%M}'

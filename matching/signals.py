from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile_for_new_user(sender, instance, created, raw=False, **kwargs):
    """
    Пользователь, созданный в «Настройках», раньше оставался без профиля сотрудника
    и поэтому не участвовал в подборе команды. Администраторам профиль не создаём.
    """
    if raw or not created or instance.role == 'ADMIN':
        return
    from .services import ensure_profile
    ensure_profile(instance)


@receiver(post_save, sender='projects.Project')
def record_participations_on_completion(sender, instance, raw=False, **kwargs):
    """При завершении проекта сохраняем участие команды в историю сотрудников."""
    if raw or instance.status != 'COMPLETED':
        return
    from .services import sync_project_participations
    sync_project_participations(instance)

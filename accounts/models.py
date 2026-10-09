from django.db import models
from django.contrib.auth.models import AbstractUser


class CustomUser(AbstractUser):
    ROLE_ADMIN = 'ADMIN'
    ROLE_GENERAL_MANAGER = 'GENERAL_MANAGER'
    ROLE_MANAGER = 'MANAGER'
    ROLE_EMPLOYEE = 'EMPLOYEE'

    ROLE_CHOICES = (
        (ROLE_ADMIN, 'Администратор'),
        (ROLE_GENERAL_MANAGER, 'Руководитель проектов'),
        (ROLE_MANAGER, 'Менеджер проекта'),
        (ROLE_EMPLOYEE, 'Исполнитель'),
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_EMPLOYEE)
    phone = models.CharField(max_length=30, blank=True)
    domain = models.CharField(max_length=100, blank=True)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

    def save(self, *args, **kwargs):
        # createsuperuser не задаёт role — без этого суперпользователь остаётся «Исполнителем»
        if self.is_superuser:
            self.role = self.ROLE_ADMIN
        super().save(*args, **kwargs)

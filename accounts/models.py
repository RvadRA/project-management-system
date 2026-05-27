from django.db import models
from django.contrib.auth.models import AbstractUser


class CustomUser(AbstractUser):
    ROLE_CHOICES = (
        ('ADMIN', 'Administrator'),
        ('MANAGER', 'Manager'),
        ('EMPLOYEE', 'Employee'),
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='EMPLOYEE')
    phone = models.CharField(max_length=30, blank=True)
    domain = models.CharField(max_length=100, blank=True)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

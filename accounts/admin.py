from django.contrib import admin
from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = ['username', 'email', 'role', 'domain', 'is_active']
    list_filter = ['role', 'is_active', 'domain']
    search_fields = ['username', 'email', 'first_name', 'last_name']

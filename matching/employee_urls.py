"""
Employee-facing URL prefix: /api/employees/
Maps to matching app's EmployeeProfileViewSet and SkillViewSet.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .employee_views import EmployeeProfileViewSet, SkillViewSet

router = DefaultRouter()
router.register(r'profiles', EmployeeProfileViewSet, basename='employee-profile')
router.register(r'skills', SkillViewSet, basename='skill')

urlpatterns = [
    path('', include(router.urls)),
]

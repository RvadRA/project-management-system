from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ProjectViewSet, PlanningBlockViewSet, ImportPlanningView,
    AuditLogViewSet, TaskViewSet, TaskDependencyViewSet, AnalyticsViewSet,
    GlobalSettingViewSet,
)

router = DefaultRouter()
router.register(r'list', ProjectViewSet, basename='project')
router.register(r'blocks', PlanningBlockViewSet, basename='planning-block')
router.register(r'settings', GlobalSettingViewSet, basename='global-setting')
router.register(r'audit-logs', AuditLogViewSet, basename='audit-log')
router.register(r'tasks', TaskViewSet, basename='project-task')
router.register(r'dependencies', TaskDependencyViewSet, basename='task-dependency')
router.register(r'dashboard', AnalyticsViewSet, basename='analytics')

urlpatterns = [
    path('', include(router.urls)),
    path('import-planning/', ImportPlanningView.as_view({'post': 'create'}), name='import-planning'),
]
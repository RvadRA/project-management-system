from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    WorkCalendarViewSet, CalendarHolidayViewSet, RiskViewSet, ProjectRoleViewSet,
    ProjectDomainViewSet, PlanningBlockRiskViewSet, TaskRequiredRoleViewSet,
    get_risk_profile
)

router = DefaultRouter()
router.register(r'calendars', WorkCalendarViewSet, basename='work-calendar')
router.register(r'holidays', CalendarHolidayViewSet, basename='calendar-holiday')
router.register(r'risks', RiskViewSet, basename='risk')
router.register(r'roles', ProjectRoleViewSet, basename='project-role')
router.register(r'domains', ProjectDomainViewSet, basename='project-domain')
router.register(r'block-risks', PlanningBlockRiskViewSet, basename='planning-block-risk')
router.register(r'task-roles', TaskRequiredRoleViewSet, basename='task-required-role')

urlpatterns = [
    path('', include(router.urls)),
    path('project-risk-profile/<int:project_id>/', get_risk_profile, name='project-risk-profile'),
]
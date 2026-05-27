from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import WorkCalendar, CalendarHoliday, Risk, ProjectRole, ProjectDomain, PlanningBlockRisk, TaskRequiredRole
from .serializers import (
    WorkCalendarSerializer, CalendarHolidaySerializer, RiskSerializer, 
    ProjectRoleSerializer, ProjectDomainSerializer, PlanningBlockRiskSerializer, TaskRequiredRoleSerializer
)
from .services import RiskService


class WorkCalendarViewSet(viewsets.ModelViewSet):
    queryset = WorkCalendar.objects.all()
    serializer_class = WorkCalendarSerializer
    permission_classes = [IsAuthenticated]


class CalendarHolidayViewSet(viewsets.ModelViewSet):
    queryset = CalendarHoliday.objects.all()
    serializer_class = CalendarHolidaySerializer
    permission_classes = [IsAuthenticated]


class RiskViewSet(viewsets.ModelViewSet):
    queryset = Risk.objects.all()
    serializer_class = RiskSerializer
    permission_classes = [IsAuthenticated]


class ProjectRoleViewSet(viewsets.ModelViewSet):
    queryset = ProjectRole.objects.all()
    serializer_class = ProjectRoleSerializer
    permission_classes = [IsAuthenticated]


class PlanningBlockRiskViewSet(viewsets.ModelViewSet):
    queryset = PlanningBlockRisk.objects.all()
    serializer_class = PlanningBlockRiskSerializer
    permission_classes = [IsAuthenticated]


class TaskRequiredRoleViewSet(viewsets.ModelViewSet):
    queryset = TaskRequiredRole.objects.all()
    serializer_class = TaskRequiredRoleSerializer
    permission_classes = [IsAuthenticated]


class ProjectDomainViewSet(viewsets.ModelViewSet):
    queryset = ProjectDomain.objects.all()
    serializer_class = ProjectDomainSerializer
    permission_classes = [IsAuthenticated]


def get_risk_profile(request, project_id):
    """
    Get risk profile for a project.
    """
    from projects.models import Project
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        return Response({'error': 'Project not found'}, status=404)
    
    profile = RiskService.get_project_risk_profile(project)
    return Response(profile)
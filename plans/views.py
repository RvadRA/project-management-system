from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from projects import access
from projects.permissions import IsAdminOrReadOnly, CanManageLibraryOrReadOnly
from .models import WorkCalendar, CalendarHoliday, Risk, ProjectRole, ProjectDomain, PlanningBlockRisk, TaskRequiredRole
from .serializers import (
    WorkCalendarSerializer, CalendarHolidaySerializer, RiskSerializer, 
    ProjectRoleSerializer, ProjectDomainSerializer, PlanningBlockRiskSerializer, TaskRequiredRoleSerializer
)
from .services import RiskService


class WorkCalendarViewSet(viewsets.ModelViewSet):
    queryset = WorkCalendar.objects.all().order_by('name')
    serializer_class = WorkCalendarSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


class CalendarHolidayViewSet(viewsets.ModelViewSet):
    queryset = CalendarHoliday.objects.all().order_by('date')
    serializer_class = CalendarHolidaySerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


class RiskViewSet(viewsets.ModelViewSet):
    queryset = Risk.objects.all().order_by('name')
    serializer_class = RiskSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


class ProjectRoleViewSet(viewsets.ModelViewSet):
    queryset = ProjectRole.objects.all().order_by('name')
    serializer_class = ProjectRoleSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


class PlanningBlockRiskViewSet(viewsets.ModelViewSet):
    queryset = PlanningBlockRisk.objects.all().order_by('id')
    serializer_class = PlanningBlockRiskSerializer
    permission_classes = [IsAuthenticated, CanManageLibraryOrReadOnly]


class TaskRequiredRoleViewSet(viewsets.ModelViewSet):
    queryset = TaskRequiredRole.objects.all().order_by('id')
    serializer_class = TaskRequiredRoleSerializer
    permission_classes = [IsAuthenticated, CanManageLibraryOrReadOnly]


class ProjectDomainViewSet(viewsets.ModelViewSet):
    queryset = ProjectDomain.objects.all().order_by('name')
    serializer_class = ProjectDomainSerializer
    permission_classes = [IsAuthenticated, IsAdminOrReadOnly]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_risk_profile(request, project_id):
    """
    Get risk profile for a project.
    """
    from projects.models import Project
    project = access.filter_visible_projects(Project.objects.all(), request.user).filter(id=project_id).first()
    if project is None:
        return Response({'error': 'Project not found'}, status=404)

    profile = RiskService.get_project_risk_profile(project)
    return Response(profile)
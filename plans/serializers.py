from rest_framework import serializers
from .models import WorkCalendar, CalendarHoliday, Risk, ProjectRole, ProjectDomain, PlanningBlockRisk, TaskRequiredRole


class CalendarHolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = CalendarHoliday
        fields = '__all__'


class WorkCalendarSerializer(serializers.ModelSerializer):
    holidays = CalendarHolidaySerializer(many=True, read_only=True)
    
    class Meta:
        model = WorkCalendar
        fields = '__all__'


class RiskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Risk
        fields = '__all__'


class ProjectRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectRole
        fields = '__all__'


class PlanningBlockRiskSerializer(serializers.ModelSerializer):
    # Optional: Expand risk info
    risk = RiskSerializer(read_only=True)
    
    class Meta:
        model = PlanningBlockRisk
        fields = '__all__'


class TaskRequiredRoleSerializer(serializers.ModelSerializer):
    role = ProjectRoleSerializer(read_only=True)
    
    class Meta:
        model = TaskRequiredRole
        fields = '__all__'


class ProjectDomainSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectDomain
        fields = '__all__'
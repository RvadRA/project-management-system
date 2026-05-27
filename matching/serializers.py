from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Skill, EmployeeProfile, EmployeeSkill, WorkloadEntry, ProjectParticipation, EmployeeCertificate, EmployeeUnavailability
from projects.models import ProjectMember
from accounts.serializers import UserNestedSerializer

User = get_user_model()


class SkillSerializer(serializers.ModelSerializer):
    class Meta:
        model = Skill
        fields = ['id', 'name', 'category']


class EmployeeSkillSerializer(serializers.ModelSerializer):
    skill = SkillSerializer(read_only=True)
    skill_id = serializers.PrimaryKeyRelatedField(
        queryset=Skill.objects.all(), source='skill', write_only=True
    )
    level_score = serializers.IntegerField(source='level', read_only=True)

    class Meta:
        model = EmployeeSkill
        fields = ['id', 'skill', 'skill_id', 'level_score', 'years_experience']


class WorkloadEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkloadEntry
        fields = ['id', 'project', 'start_date', 'end_date', 'load_percent', 'note']


class ProjectParticipationSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='project.name', read_only=True)

    class Meta:
        model = ProjectParticipation
        fields = ['id', 'project', 'project_name', 'role', 'performance_score', 'joined_at', 'left_at']


class CertificateSerializer(serializers.ModelSerializer):
    is_expired = serializers.ReadOnlyField()

    class Meta:
        model = EmployeeCertificate
        fields = [
            'id', 'name', 'issuer', 'credential_id',
            'issued_date', 'expiry_date', 'certificate_url', 'is_expired', 'created_at'
        ]
        read_only_fields = ['created_at', 'is_expired']

class UnavailabilitySerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source='get_type_display', read_only=True)

    class Meta:
        model = EmployeeUnavailability
        fields = ['id', 'type', 'type_display', 'start_date', 'end_date', 'note', 'created_at']
        read_only_fields = ['created_at']


class ProjectMemberNestedSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='project.name', read_only=True)
    class Meta:
        model = ProjectMember
        fields = ['id', 'project', 'project_name', 'role']

class EmployeeProfileSerializer(serializers.ModelSerializer):
    user = UserNestedSerializer(read_only=True)
    full_name = serializers.SerializerMethodField()
    skills = EmployeeSkillSerializer(many=True, source='employee_skills', read_only=True)
    workload_entries = WorkloadEntrySerializer(many=True, read_only=True)
    participations = ProjectParticipationSerializer(many=True, read_only=True)
    certificates = CertificateSerializer(many=True, read_only=True)
    unavailability = UnavailabilitySerializer(many=True, read_only=True)
    memberships = serializers.SerializerMethodField()
    current_workload_percentage = serializers.SerializerMethodField()
    active_task_hours = serializers.ReadOnlyField()
    total_tasks = serializers.SerializerMethodField()
    completed_tasks = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeProfile
        fields = [
            'id', 'user', 'full_name', 'position', 'domain',
            'hourly_rate', 'bio', 'skills', 'workload_entries',
            'participations', 'certificates', 'unavailability', 'memberships', 'current_workload_percentage',
            'active_task_hours', 'total_tasks', 'completed_tasks',
        ]

    def get_memberships(self, obj):
        memberships = ProjectMember.objects.filter(user=obj.user).select_related('project')
        return ProjectMemberNestedSerializer(memberships, many=True).data

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_current_workload_percentage(self, obj):
        return obj.current_workload_percentage

    def get_total_tasks(self, obj):
        return obj.user.workflow_tasks.count()

    def get_completed_tasks(self, obj):
        return obj.user.workflow_tasks.filter(status='DONE').count()


class EmployeeProfileCreateSerializer(serializers.ModelSerializer):
    """
    Used on POST /api/employees/profiles/ — accepts user FK by integer id.
    """
    class Meta:
        model = EmployeeProfile
        fields = ['id', 'user', 'position', 'domain', 'hourly_rate', 'bio']


class CandidateScoreSerializer(serializers.Serializer):
    employee_id = serializers.IntegerField(source='employee.id')
    full_name = serializers.SerializerMethodField()
    position = serializers.CharField(source='employee.position')
    current_workload = serializers.SerializerMethodField()
    total_score = serializers.FloatField()
    competence_fit = serializers.FloatField()
    experience_similarity = serializers.FloatField()
    availability = serializers.FloatField()
    past_performance = serializers.FloatField()
    cost_fit = serializers.FloatField()
    conflicts = serializers.ListField(child=serializers.CharField())
    explanation = serializers.CharField()

    def get_full_name(self, obj):
        return obj.employee.user.get_full_name() or obj.employee.user.username

    def get_current_workload(self, obj):
        return obj.employee.current_workload_percentage
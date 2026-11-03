from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Skill, EmployeeProfile, EmployeeSkill, WorkloadEntry, ProjectParticipation, EmployeeCertificate, EmployeeUnavailability
from projects import access
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

    def validate(self, attrs):
        if attrs.get('end_date') and attrs.get('start_date') and attrs['end_date'] < attrs['start_date']:
            raise serializers.ValidationError({'end_date': 'Дата окончания не может быть раньше даты начала.'})
        if not 0 <= attrs.get('load_percent', 100) <= 100:
            raise serializers.ValidationError({'load_percent': 'Загрузка должна быть от 0 до 100%.'})
        return attrs


class ProjectParticipationSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source='project.name', read_only=True)
    stars = serializers.SerializerMethodField()
    rated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectParticipation
        fields = [
            'id', 'project', 'project_name', 'role', 'performance_score', 'stars',
            'comment', 'rated_by_name', 'rated_at', 'joined_at', 'left_at',
        ]

    def get_stars(self, obj):
        """Оценка в звёздах 1–5; None — участник не оценён."""
        return round(obj.performance_score * 5, 1) if obj.performance_score > 0 else None

    def get_rated_by_name(self, obj):
        return (obj.rated_by.get_full_name() or obj.rated_by.username) if obj.rated_by else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Комментарий руководителя видят те, кому доступны данные сотрудников, и сам сотрудник
        request = self.context.get('request')
        viewer = getattr(request, 'user', None)
        is_owner = viewer is not None and instance.employee.user_id == viewer.id
        if not (viewer is not None and (is_owner or access.can_view_staff(viewer))):
            data.pop('comment', None)
            data.pop('rated_by_name', None)
        return data


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
    open_task_count = serializers.ReadOnlyField()
    unestimated_task_count = serializers.ReadOnlyField()
    total_tasks = serializers.SerializerMethodField()
    completed_tasks = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeProfile
        fields = [
            'id', 'user', 'full_name', 'position', 'domain',
            'hourly_rate', 'bio', 'skills', 'workload_entries',
            'participations', 'certificates', 'unavailability', 'memberships', 'current_workload_percentage',
            'active_task_hours', 'open_task_count', 'unestimated_task_count', 'total_tasks', 'completed_tasks',
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
    # Явное поле без автоматической проверки уникальности: профиль создаётся автоматически
    # вместе с пользователем, поэтому POST для существующего пользователя обновляет его профиль
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.all())
    hourly_rate = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0, required=False)

    class Meta:
        model = EmployeeProfile
        fields = ['id', 'user', 'position', 'domain', 'hourly_rate', 'bio']

    def create(self, validated_data):
        user = validated_data.pop('user')
        profile, _ = EmployeeProfile.objects.update_or_create(user=user, defaults=validated_data)
        return profile

    def update(self, instance, validated_data):
        validated_data.pop('user', None)  # профиль нельзя перепривязать к другому пользователю
        return super().update(instance, validated_data)


class CandidateScoreSerializer(serializers.Serializer):
    employee_id = serializers.IntegerField(source='employee.id')
    user_id = serializers.IntegerField(source='employee.user_id')
    full_name = serializers.SerializerMethodField()
    position = serializers.CharField(source='employee.position')
    domain = serializers.CharField(source='employee.domain')
    hourly_rate = serializers.FloatField(source='employee.hourly_rate')
    current_workload = serializers.FloatField()
    active_task_hours = serializers.FloatField()
    open_task_count = serializers.IntegerField()
    unestimated_task_count = serializers.IntegerField()
    already_member = serializers.BooleanField()
    data_gaps = serializers.ListField(child=serializers.CharField())
    details = serializers.DictField()
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
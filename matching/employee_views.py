"""
Employee views under /api/employees/
Full CRUD for EmployeeProfile + skills and workload.
"""
import datetime
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from .models import Skill, EmployeeProfile, EmployeeSkill, WorkloadEntry, EmployeeCertificate, EmployeeUnavailability
from .serializers import (
    SkillSerializer,
    EmployeeProfileSerializer,
    EmployeeProfileCreateSerializer,
    EmployeeSkillSerializer,
    WorkloadEntrySerializer,
    CertificateSerializer,
    UnavailabilitySerializer,
)


class SkillViewSet(viewsets.ModelViewSet):
    queryset = Skill.objects.all().order_by('category', 'name')
    serializer_class = SkillSerializer
    permission_classes = [IsAuthenticated]


class EmployeeProfileViewSet(viewsets.ModelViewSet):
    queryset = EmployeeProfile.objects.select_related('user').prefetch_related(
        'employee_skills__skill', 'workload_entries', 'participations__project', 'certificates'
    )
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return EmployeeProfileCreateSerializer
        return EmployeeProfileSerializer

    # ── Skills ──────────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='skills')
    def add_skill(self, request, pk=None):
        """POST /api/employees/profiles/{id}/skills/"""
        profile = self.get_object()
        skill_id = request.data.get('skill_id')
        level = int(request.data.get('level', 1))
        years = float(request.data.get('years_experience', 0))

        if not skill_id:
            return Response({'error': 'skill_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            skill = Skill.objects.get(id=skill_id)
        except Skill.DoesNotExist:
            return Response({'error': 'Skill not found'}, status=status.HTTP_404_NOT_FOUND)

        es, _ = EmployeeSkill.objects.update_or_create(
            employee=profile,
            skill=skill,
            defaults={'level': level, 'years_experience': years},
        )
        return Response(EmployeeSkillSerializer(es).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'skills/(?P<skill_id>\d+)')
    def remove_skill(self, request, pk=None, skill_id=None):
        """DELETE /api/employees/profiles/{id}/skills/{skill_id}/"""
        profile = self.get_object()
        deleted, _ = EmployeeSkill.objects.filter(
            employee=profile, skill_id=skill_id
        ).delete()
        if deleted == 0:
            return Response(
                {'error': 'Skill not found on this profile'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Unavailability ───────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='unavailability')
    def get_unavailability(self, request, pk=None):
        """GET /api/employees/profiles/{id}/unavailability/"""
        profile = self.get_object()
        items = profile.unavailability.all()
        return Response(UnavailabilitySerializer(items, many=True).data)

    @action(detail=True, methods=['post'], url_path='unavailability/add')
    def add_unavailability(self, request, pk=None):
        """POST /api/employees/profiles/{id}/unavailability/add/"""
        profile = self.get_object()
        serializer = UnavailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = serializer.save(employee=profile)
        return Response(UnavailabilitySerializer(item).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'unavailability-delete/(?P<item_id>\d+)')
    def remove_unavailability(self, request, pk=None, item_id=None):
        """DELETE /api/employees/profiles/{id}/unavailability-delete/{item_id}/"""
        profile = self.get_object()
        deleted, _ = EmployeeUnavailability.objects.filter(
            employee=profile, id=item_id
        ).delete()
        if deleted == 0:
            return Response({'error': 'Unavailability entry not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Workload ─────────────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='workload')
    def workload(self, request, pk=None):
        """GET /api/employees/profiles/{id}/workload/"""
        profile = self.get_object()
        entries = profile.workload_entries.order_by('start_date')
        return Response(WorkloadEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=['post'], url_path='workload/add')
    def add_workload(self, request, pk=None):
        """POST /api/employees/profiles/{id}/workload/add/"""
        profile = self.get_object()
        serializer = WorkloadEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = serializer.save(employee=profile)
        return Response(WorkloadEntrySerializer(entry).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='reset-load')
    def reset_load(self, request, pk=None):
        """POST /api/employees/profiles/{id}/reset-load/"""
        profile = self.get_object()
        # 1. Удалить все записи о текущей нагрузке
        profile.workload_entries.all().delete()
        # 2. Обнулить процент выделения в проектах
        from projects.models import ProjectMember
        ProjectMember.objects.filter(user=profile.user).update(allocation_percentage=0)
        return Response({'status': 'Workload reset to 0%'}, status=status.HTTP_200_OK)

    # ── Certificates ─────────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='certificates')
    def certificates(self, request, pk=None):
        """GET /api/employees/profiles/{id}/certificates/"""
        profile = self.get_object()
        certs = profile.certificates.all()
        return Response(CertificateSerializer(certs, many=True).data)

    @action(detail=True, methods=['post'], url_path='certificates/add')
    def add_certificate(self, request, pk=None):
        """POST /api/employees/profiles/{id}/certificates/add/"""
        profile = self.get_object()
        serializer = CertificateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cert = serializer.save(employee=profile)
        return Response(CertificateSerializer(cert).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'certificates/(?P<cert_id>\d+)')
    def remove_certificate(self, request, pk=None, cert_id=None):
        """DELETE /api/employees/profiles/{id}/certificates/{cert_id}/"""
        profile = self.get_object()
        deleted, _ = EmployeeCertificate.objects.filter(
            employee=profile, id=cert_id
        ).delete()
        if deleted == 0:
            return Response({'error': 'Certificate not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
"""
/api/matching/ — candidate ranking endpoint.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import MatchingViewSet, SkillViewSet

router = DefaultRouter()
router.register(r'skills', SkillViewSet)
router.register(r'', MatchingViewSet, basename='matching')

urlpatterns = [
    path('', include(router.urls)),
]

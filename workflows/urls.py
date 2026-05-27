from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProcessViewSet, WorkflowTemplateViewSet, TaskViewSet, WorkflowTaskTemplateViewSet

router = DefaultRouter()
router.register(r'processes', ProcessViewSet, basename='workflow-process')
router.register(r'templates', WorkflowTemplateViewSet, basename='workflow-template')
router.register(r'task-templates', WorkflowTaskTemplateViewSet, basename='workflow-task-template')
router.register(r'tasks', TaskViewSet, basename='workflow-task')

urlpatterns = [
    path('', include(router.urls)),
]
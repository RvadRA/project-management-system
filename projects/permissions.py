from rest_framework import permissions

class IsProjectManagerOrAdmin(permissions.BasePermission):
    """
    Позволяет доступ только администраторам системы или менеджерам конкретного проекта.
    """
    def has_permission(self, request, view):
        # Для GET запросов (list) разрешаем всем, фильтрация будет в QuerySet
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Глобальные права для админов и менеджеров
        if request.user.role in ('ADMIN', 'MANAGER'):
            return True
            
        # Для POST запросов (create) проверяем проект в данных
        if request.method == 'POST':
            project_id = request.data.get('project')
            if project_id:
                from .models import Project
                return Project.objects.filter(id=project_id, members__user=request.user, members__role='MANAGER').exists()
            
            # Если проект не указан в данных, возможно это создание задачи в блоке/процессе
            block_id = request.data.get('block')
            if block_id:
                from .models import PlanningBlock
                return PlanningBlock.objects.filter(id=block_id, project__members__user=request.user, project__members__role='MANAGER').exists()
            
            workflow_id = request.data.get('workflow')
            if workflow_id:
                from workflows.models import WorkflowInstance
                return WorkflowInstance.objects.filter(id=workflow_id, project__members__user=request.user, project__members__role='MANAGER').exists()

        # Для PATCH/PUT/DELETE проверка будет в has_object_permission
        return True

    def has_object_permission(self, request, view, obj):
        if request.user.role in ('ADMIN', 'MANAGER'):
            return True
        
        # Если объект - Проект
        if hasattr(obj, 'members') and not hasattr(obj, 'project'): # Project model
            return obj.members.filter(user=request.user, role='MANAGER').exists()
        
        # Если объект имеет прямую связь с проектом (PlanningBlock, WorkflowInstance)
        if hasattr(obj, 'project'):
            if not obj.project:
                return False
            return obj.project.members.filter(user=request.user, role='MANAGER').exists()
        
        # Если объект - Задача (Task или WorkflowTask)
        if hasattr(obj, 'block'): # Planning Task
            return obj.block.project.members.filter(user=request.user, role='MANAGER').exists()
        
        if hasattr(obj, 'workflow'): # Workflow Task
            if not obj.workflow.project:
                return False
            return obj.workflow.project.members.filter(user=request.user, role='MANAGER').exists()

        return False

class IsProjectMember(permissions.BasePermission):
    """
    Позволяет доступ всем участникам проекта.
    """
    def has_object_permission(self, request, view, obj):
        if request.user.role in ('ADMIN', 'MANAGER'):
            return True
            
        project = None
        if hasattr(obj, 'members'):
            project = obj
        elif hasattr(obj, 'project'):
            project = obj.project
        elif hasattr(obj, 'block'):
            project = obj.block.project
        elif hasattr(obj, 'workflow'):
            project = obj.workflow.project
            
        if not project:
            return False
            
        return project.members.filter(user=request.user).exists()

class CanUpdateTaskStatus(permissions.BasePermission):
    """
    Только исполнитель задачи или менеджер проекта может менять статус.
    """
    def has_object_permission(self, request, view, obj):
        if request.user.role in ('ADMIN', 'MANAGER'):
            return True
            
        # Менеджер проекта всегда может
        project = None
        if hasattr(obj, 'workflow'):
            project = obj.workflow.project
        elif hasattr(obj, 'block'):
            project = obj.block.project
            
        if project:
            if project.members.filter(user=request.user, role='MANAGER').exists():
                return True
                
        if hasattr(obj, 'assigned_to') and obj.assigned_to == request.user:
            return True
            
        return False

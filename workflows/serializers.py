from django.db import transaction
from rest_framework import serializers
from .models import (
    WorkflowTemplate, WorkflowTaskTemplate,
    WorkflowInstance, WorkflowTask, TaskReport, TaskAttachment,
)

# Expose on the model class for view-level validation
WorkflowTask.STATUS_CHOICES = WorkflowTask.STATUS_CHOICES  # noqa: keep for views import


def assert_template_is_acyclic(template):
    """
    Шаги шаблона не должны ждать друг друга по кругу: такой процесс после запуска
    остановился бы навсегда — ни одна задача цикла не смогла бы начаться.
    """
    steps = list(template.task_templates.prefetch_related('depends_on'))
    waiting = {step.id: {dep.id for dep in step.depends_on.all()} for step in steps}
    names = {step.id: step.name for step in steps}
    while waiting:
        ready = [step_id for step_id, deps in waiting.items() if not deps]
        if not ready:
            stuck = ', '.join(f'«{names[i]}»' for i in list(waiting)[:4])
            raise serializers.ValidationError(
                {'task_templates': f'Шаги ждут друг друга по кругу: {stuck}. Уберите одну из связей.'})
        for step_id in ready:
            del waiting[step_id]
        for deps in waiting.values():
            deps.difference_update(ready)


class WorkflowTaskTemplateSerializer(serializers.ModelSerializer):
    frontend_id = serializers.CharField(required=False, write_only=True)
    depends_on_fids = serializers.ListField(child=serializers.CharField(), required=False, write_only=True)

    class Meta:
        model = WorkflowTaskTemplate
        fields = '__all__'
        extra_kwargs = {'template': {'required': False}}

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Укажите название шага.')
        return value.strip()

    def validate_sla_hours(self, value):
        if not 1 <= value <= 8760:
            raise serializers.ValidationError('Срок шага — от 1 часа до года.')
        return value

    def validate_checklist(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Чек-лист — это список пунктов.')
        return [str(item).strip() for item in value if str(item).strip()][:100]

    def _check_dependencies(self, step):
        """Связи — только между шагами одного шаблона и без циклов."""
        foreign = step.depends_on.exclude(template_id=step.template_id)
        if step.depends_on.filter(id=step.id).exists() or foreign.exists():
            raise serializers.ValidationError({'depends_on': 'Шаг может зависеть только от других шагов своего шаблона.'})
        assert_template_is_acyclic(step.template)

    # frontend_id / depends_on_fids нужны только вложенному сохранению шаблона
    # и не являются полями модели — при прямом CRUD их нужно отбросить
    @transaction.atomic
    def create(self, validated_data):
        validated_data.pop('frontend_id', None)
        validated_data.pop('depends_on_fids', None)
        template = validated_data.get('template')
        if not template:
            raise serializers.ValidationError({'template': 'Укажите шаблон процесса.'})
        explicit_links = 'depends_on' in validated_data
        siblings = list(template.task_templates.prefetch_related('depends_on').order_by('order', 'id'))
        step = super().create(validated_data)

        # Шаг добавлен в конец списка. Если порядок в шаблоне задан связями, новый шаг без связей
        # стартовал бы одновременно с первым — поэтому ставим его после нынешних последних шагов.
        # (В шаблоне без связей порядок определяется полем order, там ничего делать не нужно.)
        if not explicit_links and any(sibling.depends_on.all() for sibling in siblings):
            if step.is_parallel and siblings:
                step.depends_on.set(siblings[-1].depends_on.all())
            else:
                awaited = {dep.id for sibling in siblings for dep in sibling.depends_on.all()}
                step.depends_on.set([sibling for sibling in siblings if sibling.id not in awaited])
        self._check_dependencies(step)
        return step

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop('frontend_id', None)
        validated_data.pop('depends_on_fids', None)
        validated_data.pop('template', None)     # шаг не переезжает в другой шаблон
        step = super().update(instance, validated_data)
        self._check_dependencies(step)
        return step


class WorkflowTemplateSerializer(serializers.ModelSerializer):
    task_templates = WorkflowTaskTemplateSerializer(many=True, required=False)

    class Meta:
        model = WorkflowTemplate
        fields = '__all__'
        read_only_fields = ['created_by']

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Укажите название шаблона.')
        return value.strip()

    def validate_task_templates(self, items):
        seen = set()
        for item in items:
            fid = str(item.get('frontend_id') or '')
            if fid and fid in seen:
                raise serializers.ValidationError('У двух шагов совпадает идентификатор.')
            seen.add(fid)
        for item in items:
            for dep in item.get('depends_on_fids') or []:
                if dep == str(item.get('frontend_id') or ''):
                    raise serializers.ValidationError(f'Шаг «{item.get("name")}» не может зависеть от самого себя.')
                if dep not in seen:
                    raise serializers.ValidationError(f'Шаг «{item.get("name")}» связан с шагом, которого нет в шаблоне.')
        return items

    @transaction.atomic
    def create(self, validated_data):
        task_templates_data = validated_data.pop('task_templates', [])
        template = WorkflowTemplate.objects.create(**validated_data)
        self._sync_steps(template, task_templates_data)
        return template

    @transaction.atomic
    def update(self, instance, validated_data):
        task_templates_data = validated_data.pop('task_templates', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if task_templates_data is not None:
            self._sync_steps(instance, task_templates_data)
        return instance

    def _sync_steps(self, template, items):
        """
        Приводит шаги шаблона к присланному списку. Существующие шаги (frontend_id = их id)
        обновляются на месте: сохраняются их идентификаторы, связь с уже запущенными задачами
        и поля, которых нет в запросе (трудозатраты, вес, настройки интеграции). Новые шаги
        создаются, отсутствующие в списке — удаляются.
        """
        existing = {step.id: step for step in template.task_templates.all()}
        by_fid, kept, pending = {}, set(), []
        for item in items:
            data = dict(item)
            fid = str(data.pop('frontend_id', '') or '')
            dep_fids = data.pop('depends_on_fids', None)
            for extra in ('depends_on', 'template', 'id'):
                data.pop(extra, None)
            step = existing.get(int(fid)) if fid.isdigit() and int(fid) not in kept else None
            if step is not None:
                for attr, value in data.items():
                    setattr(step, attr, value)
                step.save()
            else:
                step = WorkflowTaskTemplate.objects.create(template=template, **data)
            kept.add(step.id)
            if fid:
                by_fid[fid] = step
            pending.append((step, dep_fids))

        template.task_templates.exclude(id__in=kept).delete()
        for step, dep_fids in pending:
            if dep_fids is not None:
                step.depends_on.set([by_fid[fid] for fid in dep_fids if fid in by_fid])
        assert_template_is_acyclic(template)

        # Раскладка схемы хранится по идентификаторам шагов: у новых шагов временный
        # идентификатор редактора заменяется настоящим, иначе при следующем открытии схема «рассыпается»
        config = template.ui_config if isinstance(template.ui_config, dict) else {}
        positions = config.get('positions')
        if isinstance(positions, dict):
            remapped = {}
            for fid, step in by_fid.items():
                if fid in positions:
                    remapped[str(step.id)] = positions[fid]
            template.ui_config = {**config, 'positions': remapped}
            template.save(update_fields=['ui_config'])


class TaskReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskReport
        fields = '__all__'


class TaskAttachmentSerializer(serializers.ModelSerializer):
    # Прямой путь к файлу не отдаём: скачивание идёт через API с проверкой прав
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = TaskAttachment
        fields = ['id', 'original_name', 'uploaded_by', 'uploaded_at', 'download_url']

    def get_download_url(self, obj):
        return f'/workflows/tasks/{obj.task_id}/attachments/{obj.id}/download/'


class WorkflowTaskSerializer(serializers.ModelSerializer):
    report = TaskReportSerializer(read_only=True)
    attachments = TaskAttachmentSerializer(many=True, read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    is_blocked = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTask
        fields = '__all__'
        read_only_fields = ['started_at', 'completed_at', 'created_at', 'review_comment']

    def get_is_blocked(self, obj):
        # Задача ждёт завершения предыдущих этапов (depends_on подгружается пачкой во вьюсетах)
        return any(dep.status != 'DONE' for dep in obj.depends_on.all())

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.username
        return None

    def get_is_overdue(self, obj):
        return obj.is_overdue


class WorkflowInstanceSerializer(serializers.ModelSerializer):
    tasks = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowInstance
        fields = '__all__'
        read_only_fields = ['created_by', 'started_at', 'completed_at']

    def get_tasks(self, obj):
        tasks = obj.tasks.all()
        request = self.context.get('request')
        if request is not None and not self._sees_all_tasks(request.user, obj):
            # Исполнитель видит в процессе только назначенные на него задачи
            tasks = [t for t in tasks if t.assigned_to_id == request.user.id]
        return WorkflowTaskSerializer(tasks, many=True, context=self.context).data

    def _sees_all_tasks(self, user, obj):
        from projects import access
        if access.has_global_access(user):
            return True
        if obj.project_id is None:
            return obj.created_by_id == user.id
        cache = self.context.setdefault('_wf_task_scope', {})
        if obj.project_id not in cache:
            cache[obj.project_id] = access.has_project_perm(user, obj.project, 'can_view_all_tasks')
        return cache[obj.project_id]

    def get_progress_percent(self, obj):
        tasks = obj.tasks.all()
        if not tasks:
            return 0
        from django.db.models import Sum
        total_w = tasks.aggregate(s=Sum('weight'))['s'] or 0
        if total_w == 0:
            return 0
        done_w = tasks.filter(status='DONE').aggregate(s=Sum('weight'))['s'] or 0
        return round(done_w / total_w * 100)

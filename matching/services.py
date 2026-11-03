import datetime

from django.db.models import F, Value
from django.db.models.functions import Greatest

from .models import EmployeeProfile, ProjectParticipation, WorkloadEntry
from .scoring import rank_for_task


class RecommendationService:
    """Подбор исполнителя на задачу процесса. Считает тем же движком, что и общий подбор."""

    @classmethod
    def recommend_for_task(cls, task_id, weights=None):
        from workflows.models import WorkflowTask
        task = WorkflowTask.objects.select_related(
            'workflow__project', 'linked_wbs_task',
        ).get(id=task_id)
        return rank_for_task(task, weights=weights)


def ensure_profile(user):
    """У каждого сотрудника должен быть профиль — без него он не попадает в подбор и в раздел «Команда»."""
    profile, _ = EmployeeProfile.objects.get_or_create(user=user, defaults={'domain': user.domain or ''})
    return profile


def sync_project_participations(project):
    """
    Фиксирует участие команды в завершённом проекте (история для подбора и профиля сотрудника).
    Оценку результативности (performance_score) не выставляет — её ставит руководитель;
    фактическая результативность считается движком подбора по задачам.
    """
    if project.status != 'COMPLETED':
        return 0
    created = 0
    # Участие заканчивается в день завершения проекта; загрузка по нему больше не занимает сотрудников
    left_at = datetime.date.today()
    WorkloadEntry.objects.filter(project=project, end_date__gt=left_at).update(
        end_date=Greatest(Value(left_at), F('start_date'))
    )
    for member in project.members.select_related('user', 'role_ref'):
        profile = ensure_profile(member.user)
        role = 'Менеджер проекта' if member.is_manager else (member.role_ref.name if member.role_ref else member.role)
        _, was_created = ProjectParticipation.objects.get_or_create(
            employee=profile, project=project,
            defaults={'role': role[:100], 'joined_at': member.joined_at, 'left_at': left_at},
        )
        created += was_created
    return created


def project_contribution(profile, project):
    """
    Вклад сотрудника в проект: его задачи (процессы и план), как они выполнены относительно срока,
    и оценка руководителя. Сроки классифицируются тем же правилом, что и «Результативность» в подборе.
    """
    from django.utils import timezone
    from projects.models import ProjectMember, Task
    from workflows.models import WorkflowTask
    from .scoring import task_timeliness

    user = profile.user
    now = timezone.now()
    today = now.date()
    tasks = []
    summary = {
        'total': 0, 'done': 0, 'on_time': 0, 'late': 0, 'overdue': 0, 'review': 0, 'open': 0, 'done_plan': 0,
        'estimated_hours': 0.0, 'done_hours': 0.0,
    }

    def add(row, kind):
        tasks.append(row)
        summary['total'] += 1
        summary[kind] += 1
        hours = row['estimated_hours'] or 0
        summary['estimated_hours'] += hours
        if row['status'] == 'DONE':
            summary['done'] += 1
            summary['done_hours'] += hours

    process_tasks = (
        WorkflowTask.objects.filter(assigned_to=user, workflow__project=project)
        .select_related('workflow', 'report').order_by('workflow_id', 'order', 'id')
    )
    linked_plan_ids = set()
    for task in process_tasks:
        report = getattr(task, 'report', None)
        submitted_at = report.submitted_at if report else None
        kind = task_timeliness(task.status, task.due_date, task.completed_at, submitted_at, now)
        finished = min(filter(None, [task.completed_at, submitted_at]), default=None)
        if task.linked_wbs_task_id:
            linked_plan_ids.add(task.linked_wbs_task_id)
        add({
            'id': f'p{task.id}', 'source': 'process', 'name': task.name, 'group': task.workflow.name,
            'status': task.status, 'timeliness': kind,
            'due': task.due_date, 'finished': finished if task.status in ('DONE', 'REVIEW') else None,
            'late_hours': round((finished - task.due_date).total_seconds() / 3600, 1) if kind == 'late' else None,
            'estimated_hours': task.estimated_hours or 0,
        }, kind)

    # Задачи плана (WBS), которые не ведутся через процесс — иначе они посчитались бы дважды
    plan_tasks = (
        Task.objects.filter(assigned_to=user, block__project=project, workflow_task__isnull=True)
        .exclude(id__in=linked_plan_ids).select_related('block').order_by('block_id', 'order', 'id')
    )
    for task in plan_tasks:
        # У задач плана нет отметки времени выполнения: «в срок / с опозданием» для них не определяется,
        # поэтому выполненные показываем как «done» и в долю «в срок» не включаем
        if task.status == 'DONE':
            kind = 'done_plan'
        elif task.status == 'REVIEW':
            kind = 'review'
        else:
            kind = 'overdue' if task.end_date and task.end_date < today else 'open'
        add({
            'id': f'w{task.id}', 'source': 'plan', 'name': task.name, 'group': task.block.name,
            'status': task.status, 'timeliness': 'done' if task.status == 'DONE' else kind,
            'due': task.end_date, 'finished': None, 'late_hours': None,
            'estimated_hours': task.estimated_hours or 0,
        }, kind)

    judged = summary['on_time'] + summary['late'] + summary['overdue']
    summary['on_time_rate'] = round(summary['on_time'] / judged * 100) if judged else None
    summary['estimated_hours'] = round(summary['estimated_hours'], 1)
    summary['done_hours'] = round(summary['done_hours'], 1)

    member = ProjectMember.objects.filter(project=project, user=user).select_related('role_ref').first()
    participation = (
        ProjectParticipation.objects.filter(project=project, employee=profile).select_related('rated_by').first()
    )
    if member:
        position = 'Менеджер проекта' if member.is_manager else (
            member.role_ref.name if member.role_ref else member.get_role_display()
        )
    else:
        position = participation.role if participation else ''

    entry = WorkloadEntry.objects.filter(employee=profile, project=project).order_by('-end_date').first()
    rating = None
    if participation and participation.performance_score > 0:
        rated_by = participation.rated_by
        rating = {
            'stars': round(participation.performance_score * 5, 1),
            'comment': participation.comment,
            'rated_by': (rated_by.get_full_name() or rated_by.username) if rated_by else None,
            'rated_at': participation.rated_at,
        }
    return {
        'project': {
            'id': project.id, 'name': project.name, 'status': project.status,
            'start_date': project.start_date, 'end_date': project.end_date,
        },
        'employee': {'id': profile.id, 'full_name': user.get_full_name() or user.username},
        'position': position,
        'is_member': member is not None,
        'joined_at': participation.joined_at if participation else (entry.start_date if entry else None),
        'left_at': participation.left_at if participation else None,
        'load_percent': entry.load_percent if entry else None,
        'rating': rating,
        'summary': summary,
        'tasks': tasks,
    }

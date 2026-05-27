import datetime
from django.db.models import Sum


def add_working_days(start_date: datetime.date, days: int, calendar=None) -> datetime.date:
    if days == 0:
        return start_date

    current_date = start_date
    added_days = 0
    step = 1 if days > 0 else -1
    target_days = abs(days)

    while added_days < target_days:
        current_date += datetime.timedelta(days=step)
        
        # Check if weekend (0=Mon, 4=Fri, 5=Sat, 6=Sun)
        # Simple check: if calendar provided, check holidays
        is_holiday = False
        if calendar:
            from plans.models import CalendarHoliday
            if CalendarHoliday.objects.filter(calendar=calendar, date=current_date).exists():
                is_holiday = True
        
        if not is_holiday and current_date.weekday() < 5:
            added_days += 1
            
    return current_date


class WBSScalingService:
    """
    Service for scaling WBS (Work Breakdown Structure) when importing or resizing projects.
    """
    @staticmethod
    def scale_block(block, scaling_factor: float = 1.0):
        """
        Scale all tasks, durations and dates in a block.
        Note: This usually happens on import/clone, not in-place.
        """
        scaled_tasks = []
        for task in block.tasks.all():
            task.duration_days = max(1, round(task.duration_days * scaling_factor))
            task.estimated_hours = max(0.1, round(task.estimated_hours * scaling_factor, 1))
            scaled_tasks.append(task)
        return scaled_tasks

    @staticmethod
    def recalculate_block_dates(block, start_date: datetime.date):
        """
        Recalculate all tasks in a block based on start_date and their offsets.
        """
        for task in block.tasks.all():
            task.start_date = add_working_days(start_date, task.start_offset_days)
            task.end_date = add_working_days(task.start_date, task.duration_days)
            task.save(update_fields=['start_date', 'end_date'])

    @staticmethod
    def shift_task_with_dependents(task, new_start_date):
        """
        What-if: Shift a task and propagate shifts to dependent tasks.
        """
        # This is complex, but we can delegate to the existing projects/services for now or reimplement.
        # For now, let's just implement the calculation logic.
        pass


class RiskService:
    @staticmethod
    def calculate_risk_score(task):
        """
        Simple risk calculation: probability * impact.
        Returns a score 1-9.
        """
        prob_map = {'LOW': 1, 'MEDIUM': 2, 'HIGH': 3}
        impact_map = {'LOW': 1, 'MEDIUM': 2, 'HIGH': 3}
        
        p = prob_map.get(task.risk_level, 1)
        i = impact_map.get(task.risk_level, 1) # Assuming prob=impact for simplicity or use separate
        
        return p * i

    @staticmethod
    def get_project_risk_profile(project):
        from projects.models import Task
        tasks = Task.objects.filter(block__project=project)
        
        total_risk = 0
        high_risk_count = 0
        
        for task in tasks:
            score = RiskService.calculate_risk_score(task)
            total_risk += score
            if score >= 6:
                high_risk_count += 1
                
        return {
            'total_risk_score': total_risk,
            'high_risk_tasks': high_risk_count,
            'avg_risk': round(total_risk / tasks.count(), 2) if tasks.count() > 0 else 0
        }
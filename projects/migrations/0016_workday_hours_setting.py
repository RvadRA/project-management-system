from django.db import migrations

WORKDAY_KEY = 'WORKDAY_HOURS'
MONTHLY_KEY = 'MONTHLY_CAPACITY_HOURS'
# Месячная норма задавалась из расчёта 20 рабочих дней (160 ч = 20 × 8 ч)
DAYS_IN_MONTHLY_NORM = 20
DESCRIPTION = (
    'Длина рабочего дня в часах. 100% загрузки сотрудника = столько часов в каждый рабочий день; '
    'выходные, праздники и отпуска считаются по производственному календарю.'
)


def _format(value):
    return str(int(value)) if float(value).is_integer() else str(round(value, 2))


def monthly_to_workday(apps, schema_editor):
    """
    Загрузка теперь считается по рабочим дням календаря, а не по фиксированной месячной норме,
    поэтому MONTHLY_CAPACITY_HOURS больше не используется. Переносим её значение в WORKDAY_HOURS.
    """
    GlobalSetting = apps.get_model('projects', 'GlobalSetting')
    monthly = GlobalSetting.objects.filter(key=MONTHLY_KEY).first()
    hours = 8.0
    if monthly is not None:
        try:
            candidate = float(monthly.value) / DAYS_IN_MONTHLY_NORM
            if 0 < candidate <= 24:
                hours = candidate
        except (TypeError, ValueError):
            pass
    GlobalSetting.objects.get_or_create(
        key=WORKDAY_KEY, defaults={'value': _format(hours), 'description': DESCRIPTION},
    )
    if monthly is not None:
        monthly.delete()


def workday_to_monthly(apps, schema_editor):
    GlobalSetting = apps.get_model('projects', 'GlobalSetting')
    workday = GlobalSetting.objects.filter(key=WORKDAY_KEY).first()
    if workday is None:
        return
    try:
        monthly = float(workday.value) * DAYS_IN_MONTHLY_NORM
    except (TypeError, ValueError):
        monthly = 160.0
    GlobalSetting.objects.get_or_create(
        key=MONTHLY_KEY,
        defaults={'value': _format(monthly), 'description': 'Monthly work capacity for employees in hours'},
    )
    workday.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0015_capacity_ratings_catalog'),
    ]

    operations = [
        migrations.RunPython(monthly_to_workday, workday_to_monthly),
    ]

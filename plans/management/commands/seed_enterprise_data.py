from django.core.management.base import BaseCommand
from plans.models import Risk, ProjectRole, ProjectDomain, WorkCalendar, CalendarHoliday
from projects.models import PlanningBlock
import datetime

class Command(BaseCommand):
    help = 'Seed the database with realistic enterprise data'

    def handle(self, *args, **options):
        self.stdout.write("Seeding Project Domains...")
        domains_data = [
            ("FinTech", "Банковские системы, платежные шлюзы, блокчейн."),
            ("E-commerce", "Интернет-магазины, маркетплейсы, системы лояльности."),
            ("EdTech", "Образовательные платформы, системы тестирования."),
            ("HealthTech", "Медицинские системы, электронные карты, телемедицина."),
            ("GovTech", "Государственные сервисы, автоматизация госслужб."),
            ("Retail", "Автоматизация розничной торговли, складской учет."),
            ("GameDev", "Разработка игр и игровых движков."),
            ("IT Infrastructure", "Облачные решения, системное администрирование."),
        ]
        for name, desc in domains_data:
            ProjectDomain.objects.get_or_create(name=name, defaults={'description': desc})

        self.stdout.write("Seeding Risks...")
        risks_data = [
            ("Бюджетный перерасход", "Превышение запланированных затрат на разработку или лицензии.", "MEDIUM", "HIGH"),
            ("Задержка поставок", "Несвоевременное получение необходимого оборудования или доступа к API.", "LOW", "MEDIUM"),
            ("Уход ключевого сотрудника", "Риск потери знаний и замедления процесса при увольнении лида.", "MEDIUM", "HIGH"),
            ("Изменение требований", "Scope creep или резкое изменение бизнес-логики заказчиком.", "HIGH", "HIGH"),
            ("Проблемы с производительностью", "Система не выдерживает нагрузку при масштабировании.", "MEDIUM", "MEDIUM"),
            ("Нарушение безопасности", "Утечка персональных данных или взлом системы.", "LOW", "HIGH"),
            ("Технический долг", "Накопление неоптимального кода, затрудняющего поддержку.", "HIGH", "MEDIUM"),
        ]
        for name, desc, prob, imp in risks_data:
            Risk.objects.get_or_create(
                name=name,
                defaults={'description': desc, 'probability': prob, 'impact': imp}
            )

        self.stdout.write("Seeding Project Roles...")
        roles_data = [
            ("Project Manager", "Ответственность за сроки, бюджет и коммуникацию."),
            ("Senior Developer", "Архитектурные решения и менторство команды."),
            ("Frontend Developer", "Разработка пользовательского интерфейса на React."),
            ("Backend Developer", "Бизнес-логика, API и работа с базами данных."),
            ("QA Engineer", "Тестирование функционала и контроль качества."),
            ("DevOps Engineer", "Настройка CI/CD, серверов и мониторинга."),
            ("UI/UX Designer", "Проектирование интерфейсов и Figma-макеты."),
            ("Business Analyst", "Сбор требований и формализация задач."),
            ("System Architect", "Проектирование высокоуровневой структуры системы."),
        ]
        for name, desc in roles_data:
            ProjectRole.objects.get_or_create(name=name, defaults={'description': desc})

        self.stdout.write("Seeding Calendars...")
        cal, created = WorkCalendar.objects.get_or_create(
            name="Производственный календарь РФ (2026)",
            defaults={'is_default': True}
        )
        
        holidays_2026 = [
            ("2026-01-01", "Новый год"),
            ("2026-01-02", "Новогодние каникулы"),
            ("2026-01-05", "Новогодние каникулы"),
            ("2026-01-06", "Новогодние каникулы"),
            ("2026-01-07", "Рождество Христово"),
            ("2026-01-08", "Новогодние каникулы"),
            ("2026-02-23", "День защитника Отечества"),
            ("2026-03-08", "Международный женский день"),
            ("2026-05-01", "Праздник Весны и Труда"),
            ("2026-05-09", "День Победы"),
            ("2026-06-12", "День России"),
            ("2026-11-04", "День народного единства"),
        ]
        for d, n in holidays_2026:
            CalendarHoliday.objects.get_or_create(
                calendar=cal,
                date=datetime.datetime.strptime(d, "%Y-%m-%d").date(),
                defaults={'name': n}
            )

        self.stdout.write("Seeding Planning Block Templates...")
        blocks_data = [
            ("Ядро Backend (Django/DRF)", "Backend", "MEDIUM", 45, 0.95),
            ("UI Kit & Design System", "Frontend", "LOW", 20, 0.98),
            ("Аналитическая подсистема", "Analytics", "HIGH", 60, 0.85),
            ("Интеграционный слой (API)", "Backend", "MEDIUM", 30, 0.90),
            ("Модуль аутентификации (SSO)", "Security", "LOW", 15, 0.99),
            ("Мобильное приложение (React Native)", "Mobile", "HIGH", 90, 0.80),
        ]
        for name, domain, comp, dur, succ in blocks_data:
            PlanningBlock.objects.get_or_create(
                name=name,
                is_template=True,
                defaults={
                    'domain': domain,
                    'complexity': comp,
                    'avg_duration': dur,
                    'success_rate': succ
                }
            )

        self.stdout.write(self.style.SUCCESS("Success! Data seeded."))

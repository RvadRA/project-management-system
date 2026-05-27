import os
import django

# Set up Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from projects.models import PlanningBlock, Task

def populate_templates():
    print("Начинаем наполнение шаблонов задачами...")
    
    # Define templates and their tasks
    templates_data = {
        "Ядро Backend (Django/DRF)": [
            ("Проектирование схемы БД", 16),
            ("Настройка базовых моделей и Django Admin", 8),
            ("Реализация REST API эндпоинтов", 24),
            ("Настройка фильтрации и пагинации", 8),
            ("Покрытие API автотестами (Pytest)", 16),
            ("Оптимизация SQL-запросов (select_related)", 8)
        ],
        "UI Kit & Design System": [
            ("Разработка цветовой палитры и типографики", 12),
            ("Создание библиотеки базовых компонентов (Buttons, Inputs)", 20),
            ("Реализация сложных компонентов (Modals, Dropdowns)", 16),
            ("Настройка Storybook для документации", 8),
            ("Реализация темной темы", 12),
            ("Аудит доступности (Accessibility/A11y)", 8)
        ],
        "Аналитическая подсистема": [
            ("Проектирование хранилища данных (DWH)", 16),
            ("Реализация ETL-процессов сбора данных", 24),
            ("Разработка агрегирующих SQL-представлений", 12),
            ("Интеграция с библиотекой графиков (Recharts)", 16),
            ("Экспорт отчетов в PDF/Excel", 12),
            ("Оптимизация производительности OLAP-кубов", 16)
        ],
        "Интеграционный слой (API)": [
            ("Анализ API внешних сервисов", 8),
            ("Реализация адаптеров интеграции", 24),
            ("Настройка системы очередей (Celery)", 16),
            ("Обработка ошибок и механизмы Retry", 12),
            ("Логирование и мониторинг запросов", 8),
            ("Безопасная передача секретов (Vault/Env)", 4)
        ],
        "Модуль аутентификации (SSO)": [
            ("Настройка OAuth2/OpenID Connect", 20),
            ("Реализация регистрации и логина", 16),
            ("Восстановление пароля и подтверждение Email", 12),
            ("Поддержка 2FA (TOTP/SMS)", 24),
            ("Управление сессиями и JWT-токенами", 12),
            ("Аудит безопасности и защита от Brute-force", 16)
        ],
        "Мобильное приложение (React Native)": [
            ("Настройка окружения и базовой навигации", 12),
            ("Верстка основных экранов приложения", 32),
            ("Интеграция с API бэкенда", 24),
            ("Работа с локальным хранилищем (AsyncStorage)", 12),
            ("Пуш-уведомления (Firebase/OneSignal)", 16),
            ("Подготовка и деплой в App Store/Google Play", 20)
        ]
    }

    for template_name, tasks in templates_data.items():
        try:
            block = PlanningBlock.objects.get(name=template_name, is_template=True)
            print(f"Обработка шаблона: {template_name}")
            
            # Remove existing tasks to avoid duplicates if re-run
            block.tasks.all().delete()
            
            for i, (task_name, hours) in enumerate(tasks):
                Task.objects.create(
                    block=block,
                    name=task_name,
                    estimated_hours=hours,
                    duration_days=max(1, hours // 8),
                    start_offset_days=i * 2,  # Simple offset for visual distribution
                    order=i,
                    priority='MEDIUM'
                )
            print(f"  - Добавлено задач: {len(tasks)}")
        except PlanningBlock.DoesNotExist:
            print(f"  - ОШИБКА: Шаблон '{template_name}' не найден!")

    print("Наполнение завершено успешно.")

if __name__ == "__main__":
    populate_templates()

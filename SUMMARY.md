# 📋 Project Management System - Полная сводка

**Дата:** май 2026  
**Версия:** 1.0  
**Статус:** ✅ Рабочая версия готова к развертыванию

---

## 📌 Содержание

1. [О проекте](#о-проекте)
2. [Технологический стек](#технологический-стек)
3. [Установка и запуск](#установка-и-запуск)
4. [Архитектура системы](#архитектура-системы)
5. [Документация](#документация)
6. [Быстрые ссылки](#быстрые-ссылки)

---

## 🎯 О проекте

### Назначение

Корпоративная система управления проектами, которая позволяет:

✅ **Переиспользование планирования**

- Импорт блоков планирования из завершенных проектов
- Сохранение WBS, задач, зависимостей, рисков
- Автоматический пересчет сроков и трудозатрат

✅ **Подбор сотрудников**

- Профили компетенций с уровнями и сертификатами
- Анализ текущей загрузки и недоступности
- Скоринг кандидатов на основе опыта и производительности
- Рекомендации по составу команды

✅ **Управление бизнес-процессами**

- Создание повторяемых процессов из шаблонов
- Гибкая настройка последовательности, условий, SLA
- Прозрачное отслеживание статусов в канбан-представлении
- Типы задач: отчет, файлы, чек-лист, утверждение, вебхуки

✅ **Личный кабинет сотрудника**

- Список активных и выполненных задач
- Интерактивная сдача отчетности и чек-листов
- Уведомления (email, push, мессенджеры)
- История выполненных работ

✅ **Отчетность и мониторинг**

- Дашборды по проектам и прогрессу
- Анализ компетенций и доступности персонала
- Журнал аудита всех изменений
- Прогнозирование выполнения

---

## 🛠️ Технологический стек

### Backend

- **Фреймворк:** Django 4.2+
- **API:** Django REST Framework
- **Аутентификация:** JWT (Simple JWT)
- **БД:** PostgreSQL 13+
- **Task Queue:** Celery + Redis
- **Асинхронность:** Django Channels

### Frontend

- **Фреймворк:** React 18+
- **Язык:** TypeScript
- **Стили:** Tailwind CSS
- **Сборщик:** Vite
- **HTTP-клиент:** Axios

### Infrastructure

- **ОС:** Linux (Ubuntu 20.04+) / macOS / Windows
- **Контейнеризация:** Docker + Docker Compose
- **Web-сервер:** Nginx
- **WSGI:** Gunicorn
- **HTTPS:** Let's Encrypt

### Дополнительно

- **Мониторинг:** ELK Stack (опционально)
- **Логирование:** Python logging + Syslog
- **Кэширование:** Redis
- **Email:** SMTP (Gmail, SendGrid и др.)

---

## ⚙️ Установка и запуск

### Минимальные требования

- Python 3.10+
- Node.js 16+
- PostgreSQL 13+
- Redis 6+
- 4GB RAM (рекомендуется 8GB)

### Вариант 1: Docker (Рекомендуется)

```bash
# Клонирование
git clone <URL> project_management_system
cd project_management_system

# Инициализация
docker-compose up -d
source venv/Scripts/activate
python manage.py migrate
python manage.py createsuperuser
```

### Вариант 2: Локальная установка

```bash
# Подробная инструкция в INSTALLATION_RU.md или INSTALLATION.md
```

### Запуск

```bash
# Терминал 1: Backend (Django)
python manage.py runserver

# Терминал 2: Celery Worker
celery -A config worker -l info -P eventlet

# Терминал 3: Celery Beat
celery -A config beat -l info

# Терминал 4: Frontend (React)
cd frontend && npm run dev
```

✅ Доступ:

- **Приложение:** http://localhost:5173
- **Admin Panel:** http://localhost:8000/admin/
- **API:** http://localhost:8000/api/
- **Swagger API Docs:** http://localhost:8000/api/swagger/

**Учетные данные:** admin / admin123

---

## 🏗️ Архитектура системы

### Структура проекта

```
project_management_system/
│
├── 📂 accounts/              # Управление пользователями
│   ├── models.py             # CustomUser, UserProfile
│   ├── views.py              # Аутентификация, профили
│   ├── serializers.py        # Сериализаторы
│   └── urls.py               # API endpoints
│
├── 📂 projects/              # Управление проектами
│   ├── models.py             # Project, ProjectTeam
│   ├── views.py              # CRUD операции
│   ├── permissions.py        # Проверка прав доступа
│   └── serializers.py
│
├── 📂 workflows/             # Бизнес-процессы
│   ├── models.py             # Workflow, Task, Stage
│   ├── services.py           # Бизнес-логика
│   ├── views.py              # API endpoints
│   └── tasks.py              # Celery задачи
│
├── 📂 matching/              # Подбор сотрудников
│   ├── models.py             # EmployeeProfile, Skills
│   ├── scoring.py            # Алгоритм скоринга
│   ├── services.py           # Логика подбора
│   └── views.py              # API endpoints
│
├── 📂 notifications/         # Уведомления
│   ├── models.py             # Notification
│   ├── tasks.py              # Отправка email/push
│   ├── utils.py              # Вспомогательные функции
│   └── views.py
│
├── 📂 plans/                 # Планирование
│   ├── models.py             # Plan, PlanBlock, WBS
│   ├── services.py           # Импорт/экспорт
│   └── views.py
│
├── 📂 frontend/              # React приложение
│   ├── src/
│   │   ├── components/       # React компоненты
│   │   ├── pages/            # Страницы
│   │   ├── api/              # API клиент
│   │   ├── context/          # Context API
│   │   ├── types/            # TypeScript типы
│   │   ├── utils/            # Утилиты
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── 📂 config/                # Django конфигурация
│   ├── settings.py           # Настройки проекта
│   ├── urls.py               # Главные URLs
│   ├── wsgi.py               # WSGI конфигурация
│   ├── celery.py             # Celery конфигурация
│   └── asgi.py               # ASGI конфигурация
│
├── 📄 docker-compose.yml     # Docker конфигурация
├── 📄 requirements.txt       # Python зависимости
├── 📄 manage.py              # Django управление
└── 📄 README_RUN.md          # Быстрый старт
```

### API структура

```
/api/
├── /auth/                    # Аутентификация
│   ├── POST   /token/        # Получить JWT токен
│   ├── POST   /refresh/      # Обновить токен
│   └── POST   /logout/       # Выход
│
├── /users/                   # Управление пользователями
│   ├── GET    /              # Список пользователей
│   ├── POST   /              # Создать пользователя
│   ├── GET    /{id}/         # Получить пользователя
│   ├── PUT    /{id}/         # Обновить пользователя
│   └── DELETE /{id}/         # Удалить пользователя
│
├── /projects/                # Управление проектами
│   ├── GET    /              # Список проектов
│   ├── POST   /              # Создать проект
│   ├── GET    /{id}/         # Получить проект
│   ├── PUT    /{id}/         # Обновить проект
│   └── DELETE /{id}/         # Удалить проект
│
├── /workflows/               # Бизнес-процессы
│   ├── GET    /              # Список процессов
│   ├── POST   /              # Создать процесс
│   └── GET    /{id}/tasks/   # Задачи процесса
│
├── /tasks/                   # Управление задачами
│   ├── GET    /              # Мои задачи
│   ├── POST   /{id}/complete # Завершить задачу
│   └── POST   /{id}/report/  # Отправить отчет
│
├── /matching/employees/      # Подбор сотрудников
│   ├── GET    /              # Доступные сотрудники
│   └── POST   /score/        # Получить рекомендации
│
└── /notifications/           # Уведомления
    ├── GET    /              # Список уведомлений
    └── POST   /{id}/read/    # Отметить как прочитано
```

### Поток данных

```
Frontend (React)
    ↓ (HTTP/JSON)
Nginx (Reverse Proxy)
    ↓
Gunicorn (WSGI)
    ↓
Django REST API
    ↓
PostgreSQL Database
    ↓
Redis Cache

Celery Workers (Background Tasks)
    ↓
Email, Webhooks, Notifications
```

---

## 📚 Документация

| Документ                                             | Описание                           |
| ---------------------------------------------------- | ---------------------------------- |
| [README_RUN.md](README_RUN.md)                       | ⚡ Быстрый старт за 5 минут        |
| [INSTALLATION_RU.md](INSTALLATION_RU.md)             | 📖 Полная инструкция на русском    |
| [INSTALLATION.md](INSTALLATION.md)                   | 📖 Полная инструкция на английском |
| [DEPLOYMENT.md](DEPLOYMENT.md)                       | 🚀 Развертывание на production     |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md)             | 📋 Справка по командам             |
| [project_requirements.md](project_requirements.md)   | 📋 Требования проекта              |
| [database_schema.md](database_schema.md)             | 🗄️ Схема БД                        |
| [interface_design_spec.md](interface_design_spec.md) | 🎨 Дизайн интерфейса               |
| [data_storage_policy.md](data_storage_policy.md)     | 🔒 Политика хранения данных        |

---

## 🔗 Быстрые ссылки

### Development

```
Frontend:     http://localhost:5173
Backend:      http://localhost:8000
Admin:        http://localhost:8000/admin/
API Docs:     http://localhost:8000/api/swagger/
```

### Учетные данные (Dev)

```
Username:     admin
Password:     admin123
Email:        admin@example.com
```

### Credentials для сервисов

```
PostgreSQL:   pms_user / pms_password
Redis:        (no auth)
```

---

## 📊 Системные требования по компонентам

| Компонент      | CPU      | RAM   | Диск  | Примечание                   |
| -------------- | -------- | ----- | ----- | ---------------------------- |
| Django Backend | 1 ядро   | 512MB | 2GB   | Оптимально 2+ ядра           |
| React Frontend | 0.5 ядра | 256MB | 500MB | Статичные файлы              |
| PostgreSQL     | 1 ядро   | 1GB   | 10GB+ | Зависит от объема данных     |
| Redis          | 0.5 ядра | 512MB | 1GB   | Кэш и очередь задач          |
| Celery Worker  | 1 ядро   | 512MB | 1GB   | По одному на задачу          |
| **ИТОГО**      | 4+ ядер  | 4GB   | 20GB  | Для продакшна: 8+ ядер, 8GB+ |

---

## ✅ Функциональность

### Реализовано

- ✅ Аутентификация и управление пользователями
- ✅ RBAC (Role-Based Access Control)
- ✅ Создание и управление проектами
- ✅ Бизнес-процессы с шаблонизацией
- ✅ Подбор сотрудников по компетенциям
- ✅ Система задач и отчетности
- ✅ Уведомления (email, push)
- ✅ Celery для фоновых задач
- ✅ API с документацией (Swagger)
- ✅ Отчеты и аналитика

### Планируется

- 🔜 Интеграция с Telegram
- 🔜 Интеграция с Slack
- 🔜 Расширенная аналитика
- 🔜 Мобильное приложение
- 🔜 Многоязычность (i18n)

---

## 🔒 Безопасность

- ✅ JWT токены для аутентификации
- ✅ CSRF защита
- ✅ SQL injection защита (ORM)
- ✅ XSS защита (CORS, CSP)
- ✅ HTTPS/SSL (Nginx)
- ✅ Валидация всех входных данных
- ✅ Rate limiting (опционально)
- ✅ 2FA (планируется)

---

## 📈 Performance

- **API Response Time:** < 200ms
- **Database Queries:** Оптимизированы с индексами
- **Frontend Load:** < 3 сек (первый раз)
- **Caching:** Redis для часто используемых данных
- **Static Files:** Сжатие Gzip, CDN (опционально)

---

## 🐛 Известные проблемы и решения

| Проблема                   | Статус    | Решение                   |
| -------------------------- | --------- | ------------------------- |
| Долгая инициализация БД    | ✅ Решено | Используйте Docker volume |
| CORS ошибки                | ✅ Решено | Настроены в settings.py   |
| Memory leak в Celery       | ✅ Решено | Обновлена версия          |
| Slow API on large datasets | ✅ Решено | Pagination + caching      |

---

## 📞 Контакты и поддержка

| Канал       | Информация        |
| ----------- | ----------------- |
| 📧 Email    | admin@example.com |
| 🐛 Issues   | GitHub issues     |
| 📱 Telegram | @projectteam      |

---

## 📄 Лицензия

Проект защищен авторским правом. Все права защищены. © 2026

---

## 📋 История версий

| Версия | Дата        | Изменения    |
| ------ | ----------- | ------------ |
| 1.0    | май 2026    | Первый релиз |
| 0.9    | апрель 2026 | Бета версия  |
| 0.1    | март 2026   | Альфа версия |

---

## 🚀 Следующие шаги

1. **Локальная установка** → [README_RUN.md](README_RUN.md)
2. **Полная инструкция** → [INSTALLATION_RU.md](INSTALLATION_RU.md)
3. **Development** → [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
4. **Production** → [DEPLOYMENT.md](DEPLOYMENT.md)

---

**Спасибо за использование Project Management System!** 🙏

**Последнее обновление:** май 2026

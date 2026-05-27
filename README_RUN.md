# 🚀 Инструкция по запуску Project Management System

**⚠️ БЫСТРЫЙ СТАРТ:** Откройте 4 терминала и выполните команды ниже

> **Полная инструкция по установке:** см. [INSTALLATION_RU.md](INSTALLATION_RU.md)

---

## ⏱️ Быстрый старт (5 минут)

### Предварительные условия

- ✅ Python 3.10+ активирован в виртуальном окружении (venv)
- ✅ PostgreSQL запущена (или используется Docker)
- ✅ Redis запущена

### Инициализация (выполните 1 раз)

```bash
# Активация окружения (Windows Git Bash)
source venv/Scripts/activate

# Или для PowerShell:
.\venv\Scripts\Activate.ps1

# Миграция БД
python manage.py migrate

# Загрузка тестовых данных
python manage.py populate_templates

# Создание суперпользователя (если нужно)
python manage.py createsuperuser
```

---

## ▶️ Запуск 4 компонентов

### 1️⃣ Backend (Django) - Терминал 1

```bash
source venv/Scripts/activate
python manage.py runserver

# ✅ Доступен на: http://localhost:8000
# Admin: http://localhost:8000/admin/
```

### 2️⃣ Celery Worker - Терминал 2

```bash
source venv/Scripts/activate
celery -A config worker -l info -P eventlet
```

### 3️⃣ Celery Beat (Планировщик) - Терминал 3

```bash
source venv/Scripts/activate
celery -A config beat -l info
```

### 4️⃣ Frontend (React) - Терминал 4

```bash
cd frontend
npm run dev

# ✅ Доступен на: http://localhost:5173
```

---

## 📊 Учетные данные по умолчанию

- **Username:** admin
- **Password:** admin123

---

## 🔗 Ссылки

| Сервис              | URL                                |
| ------------------- | ---------------------------------- |
| 🎨 Приложение       | http://localhost:5173              |
| 🖧 Backend API       | http://localhost:8000/api/         |
| 🔧 Admin Panel      | http://localhost:8000/admin/       |
| 📖 Swagger API Docs | http://localhost:8000/api/swagger/ |

---

## 🐳 Использование Docker (альтернатива)

Если у вас установлен Docker:

```bash
# Запуск только PostgreSQL
docker-compose up -d

# Затем выполните шаги выше (инициализация + запуск 4 компонентов)
```

---

## 🆘 Помощь

- ❌ Ошибка подключения к БД? → Проверьте PostgreSQL
- ❌ CORS ошибки? → Проверьте, запущен ли backend
- ❌ Ошибка Redis? → Запустите `redis-server` или `docker run -d -p 6379:6379 redis`

**Полное руководство:** [INSTALLATION_RU.md](INSTALLATION_RU.md)

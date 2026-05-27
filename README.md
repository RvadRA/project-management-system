# Project Management System / Система управления проектами

English / Русский

## Summary / Кратко

A corporate Project Management System (backend: Django + DRF; frontend: React + TypeScript) — supports reusable project planning blocks, employee matching, workflow templates, task management, and notifications.

Корпоративная система управления проектами (backend: Django + DRF; frontend: React + TypeScript) — поддерживает переиспользуемые блоки планирования, подбор сотрудников, шаблоны процессов, управление задачами и уведомления.

---

## Quick start (5 minutes)

Recommended: Docker

```bash
# Start services
docker-compose up -d

# Activate venv (if running locally)
source venv/Scripts/activate  # Git Bash / macOS/Linux
.\venv\Scripts\Activate.ps1 # PowerShell (Windows)

# Apply migrations and create superuser
python manage.py migrate
python manage.py createsuperuser

# Run backend (Terminal 1)
python manage.py runserver

# Run worker (Terminal 2)
celery -A config worker -l info -P eventlet

# Run beat (Terminal 3)
celery -A config beat -l info

# Run frontend (Terminal 4)
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend / Admin: http://localhost:8000

---

## Documentation / Документация

- Main index: `INDEX.md`
- Installation: `INSTALLATION.md` (EN) and `INSTALLATION_RU.md` (RU)
- Deployment: `DEPLOYMENT.md`
- Quick reference: `QUICK_REFERENCE.md`
- Summary: `SUMMARY.md`

---

## Repository

https://github.com/RvadRA/project-management-system.git

---

If you want, I can expand this `README.md` with badges, screenshots, or a more detailed overview in English and Russian.

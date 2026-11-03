# Project Management System

A project and workflow management application with employee matching, reusable planning blocks, project/task tracking, workflow templates, and notifications.

## Tech stack

- Backend: Django and Django REST Framework
- Frontend: React, TypeScript, and Vite
- Data/services: PostgreSQL, Redis, and Celery

## Run locally

1. Install Python and Node.js, then create a Python virtual environment.
2. Install backend dependencies with `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env` and set your local database settings and a unique Django secret key.
4. Start PostgreSQL and Redis. To start the local PostgreSQL container, run `docker compose up -d db`.
5. Apply migrations and start Django:

   ```powershell
   python manage.py migrate
   python manage.py runserver
   ```

6. In another terminal, start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

The frontend is available at <http://localhost:5173> and the backend at <http://localhost:8000>.

## Documentation

- [Installation (English)](INSTALLATION.md)
- [Installation (Russian)](INSTALLATION_RU.md)
- [Deployment](DEPLOYMENT.md)
- [Running with old and synthetic data](RUN_OLD_AND_NEW_DATA.md)
- [Documentation index](INDEX.md)

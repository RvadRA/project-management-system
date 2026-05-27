# 🚀 Project Management System - Complete Installation Guide

**Version:** 1.0  
**Last Updated:** May 2026  
**Language:** English (Русский: [INSTALLATION_RU.md](INSTALLATION_RU.md))

## 📋 Table of Contents

1. [System Requirements](#-system-requirements)
2. [Quick Start with Docker](#-quick-start-with-docker-recommended)
3. [Local Installation](#-local-installation)
4. [Running the Application](#-running-the-application)
5. [Initial Setup](#-initial-setup)
6. [Verification](#-verification)
7. [Troubleshooting](#-troubleshooting)
8. [Stopping & Restarting](#-stopping--restarting)

---

## 🖥️ System Requirements

### Minimum Requirements

- **OS:** Windows 10+, macOS 10.14+, Linux (Ubuntu 18.04+)
- **RAM:** 4 GB (recommended 8 GB)
- **Disk:** 5 GB free space
- **Internet:** Required for downloading dependencies

### Required Software

**Option 1 - Docker (RECOMMENDED):**

- Docker Desktop 4.10+ ([download](https://www.docker.com/products/docker-desktop))
- Docker Compose (included with Docker Desktop)

**Option 2 - Local Installation:**

- Python 3.10+ ([download](https://www.python.org/downloads/))
- Node.js 16+ and npm 8+ ([download](https://nodejs.org/))
- PostgreSQL 13+ ([download](https://www.postgresql.org/download/))
- Redis 6+ ([download for Windows](https://github.com/tporadowski/redis/releases))
- Git ([download](https://git-scm.com/))

---

## 🐳 Quick Start with Docker (Recommended)

### Step 1: Install Docker

1. Download [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Install and launch
3. Verify installation in terminal:
   ```bash
   docker --version
   docker-compose --version
   ```

### Step 2: Clone the Project

```bash
git clone <repository-url> project_management_system
cd project_management_system
```

### Step 3: Run All Services

```bash
# Start PostgreSQL via Docker Compose
docker-compose up -d

# Wait 5-10 seconds for DB initialization
sleep 10

# Activate Python virtual environment
source venv/Scripts/activate  # Windows (Git Bash)
# or
.\venv\Scripts\Activate.ps1   # Windows (PowerShell)
# or
source venv/bin/activate      # macOS/Linux

# Apply database migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Load sample data (optional)
python manage.py populate_templates
```

### Step 4: Start the Application

**Open 4 different terminals:**

**Terminal 1 - Backend:**

```bash
source venv/Scripts/activate
python manage.py runserver
# Available at: http://localhost:8000
# API: http://localhost:8000/api/
# Admin: http://localhost:8000/admin/
```

**Terminal 2 - Celery Worker:**

```bash
source venv/Scripts/activate
pip install eventlet
celery -A config worker -l info -P eventlet
```

**Terminal 3 - Celery Beat (Scheduler):**

```bash
source venv/Scripts/activate
celery -A config beat -l info
```

**Terminal 4 - Frontend:**

```bash
cd frontend
npm install
npm run dev
# Available at: http://localhost:5173
```

---

## 💻 Local Installation

### Step 1: System Setup

**Windows (PowerShell):**

```powershell
# Check versions
python --version  # Must be 3.10+
node --version    # Must be 16+
```

**macOS/Linux:**

```bash
python3 --version
node --version
```

### Step 2: Clone and Prepare Project

```bash
git clone <repository-url> project_management_system
cd project_management_system

# Create virtual environment
python -m venv venv

# Activate virtual environment
source venv/Scripts/activate  # Windows (Git Bash)
# or
.\venv\Scripts\Activate.ps1   # Windows (PowerShell)
# or
source venv/bin/activate      # macOS/Linux
```

### Step 3: Install Backend Dependencies

```bash
# Make sure venv is activated!
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Setup PostgreSQL

**Windows:**

1. Download [PostgreSQL 15 installer](https://www.postgresql.org/download/windows/)
2. Install with default settings (remember password)

**macOS (with Homebrew):**

```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux (Ubuntu):**

```bash
sudo apt-get install postgresql postgresql-contrib
sudo service postgresql start
```

### Step 5: Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Execute in PostgreSQL interpreter:
CREATE DATABASE pms_db;
CREATE USER pms_user WITH PASSWORD 'pms_password';
ALTER ROLE pms_user SET client_encoding TO 'utf8';
ALTER ROLE pms_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE pms_user SET default_transaction_deferrable TO on;
ALTER ROLE pms_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE pms_db TO pms_user;
\q
```

### Step 6: Install Redis

**Windows:**

```bash
# Download redis-server.exe from https://github.com/tporadowski/redis/releases
# Or use WSL2:
wsl
sudo apt-get install redis-server
redis-server
```

**macOS:**

```bash
brew install redis
redis-server
```

**Linux:**

```bash
sudo apt-get install redis-server
redis-server
```

### Step 7: Initialize Backend

```bash
# Activate venv
source venv/Scripts/activate

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser
# Enter:
# Username: admin
# Email: admin@example.com
# Password: admin123

# Load sample data
python manage.py populate_templates
```

### Step 8: Install Frontend Dependencies

```bash
cd frontend
npm install
```

---

## ▶️ Running the Application

### First Run: Open 4 Different Terminals

**Terminal 1 - Django Backend:**

```bash
cd <project-path>
source venv/Scripts/activate
python manage.py runserver
```

✅ Available at: http://localhost:8000

**Terminal 2 - Celery Worker:**

```bash
cd <project-path>
source venv/Scripts/activate
celery -A config worker -l info -P eventlet
```

**Terminal 3 - Celery Beat:**

```bash
cd <project-path>
source venv/Scripts/activate
celery -A config beat -l info
```

**Terminal 4 - React Frontend:**

```bash
cd <project-path>/frontend
npm run dev
```

✅ Available at: http://localhost:5173

---

## ⚙️ Initial Setup

### Login

1. Open http://localhost:5173
2. Use superuser credentials:
   - Username: `admin`
   - Password: `admin123`

### Access Admin Panel

- URL: http://localhost:8000/admin/
- Username: `admin`
- Password: `admin123`

### API Documentation

- Swagger UI: http://localhost:8000/api/swagger/
- ReDoc: http://localhost:8000/api/redoc/

### First Steps

1. Go to admin panel
2. Add employees (Accounts → Users)
3. Create projects (Projects)
4. Upload workflow templates (Workflows)
5. Assign employees to tasks

---

## ✅ Verification

### Check Backend

```bash
# Verify database connection
python manage.py dbshell
# Should open PostgreSQL console
\q

# Check system status
python manage.py check
```

### Check Frontend

```bash
cd frontend
npm run build
# Should build without errors
```

### Check API

```bash
# Get authentication token
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Get user list
curl -X GET http://localhost:8000/api/users/ \
  -H "Authorization: Bearer <your-token>"
```

---

## 🐛 Troubleshooting

### Error: "ConnectionRefusedError: [WinError 10061]"

**Cause:** PostgreSQL not running  
**Solution:**

```bash
# For Docker:
docker-compose up -d

# For local installation:
# Windows: Start PostgreSQL from Services (services.msc)
# macOS: brew services start postgresql@15
# Linux: sudo service postgresql start
```

### Error: "redis.exceptions.ConnectionError"

**Cause:** Redis not running  
**Solution:**

```bash
# Start Redis
redis-server
# Or via Docker:
docker run -d -p 6379:6379 redis
```

### Error: "ModuleNotFoundError: No module named 'django'"

**Cause:** Dependencies not installed in virtual environment  
**Solution:**

```bash
# Activate venv and reinstall:
source venv/Scripts/activate
pip install -r requirements.txt
```

### Error: "CORS error" on frontend

**Solution:** Check that backend is running on http://localhost:8000

```bash
# Verify CORS settings
grep -i "CORS" config/settings.py
```

### Error: "npm ERR!" during frontend setup

**Solution:**

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

---

## ⏹️ Stopping & Restarting

### Stop All Services

```bash
# In each terminal press:
Ctrl+C

# If using Docker:
docker-compose down
```

### Clean Database (for reinstall)

```bash
# WARNING: This will delete all data!
python manage.py migrate zero  # Rollback migrations
docker-compose down -v         # Remove volumes

# Then restart:
python manage.py migrate
python manage.py createsuperuser
```

### Restart Project

```bash
# Stop all services (Ctrl+C in each terminal)
# Then repeat application startup (see "Running the Application" section)
```

---

## 📚 Project Structure

```
project_management_system/
├── backend (Django)
│   ├── accounts/          # User management
│   ├── projects/          # Project management
│   ├── workflows/         # Business processes
│   ├── matching/          # Employee matching
│   ├── tasks/             # Task management
│   ├── notifications/     # Notifications
│   ├── plans/             # Planning
│   ├── config/            # Django settings
│   └── manage.py
│
├── frontend (React)
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Pages
│   │   ├── api/           # API client
│   │   └── App.tsx
│   └── package.json
│
├── docker-compose.yml     # Docker configuration
├── requirements.txt       # Python dependencies
└── INSTALLATION.md        # This file
```

---

## 🔗 Useful Links

| Component   | URL                                | Credentials             |
| ----------- | ---------------------------------- | ----------------------- |
| Application | http://localhost:5173              | admin / admin123        |
| Backend     | http://localhost:8000              | admin / admin123        |
| Admin Panel | http://localhost:8000/admin/       | admin / admin123        |
| API Swagger | http://localhost:8000/api/swagger/ | -                       |
| API ReDoc   | http://localhost:8000/api/redoc/   | -                       |
| PostgreSQL  | localhost:5432                     | pms_user / pms_password |
| Redis       | localhost:6379                     | -                       |

---

## 📞 Support

If you encounter issues:

1. Check this file (see "Troubleshooting" section)
2. Check terminal logs
3. Verify all services are running
4. Create an issue with problem description

---

## 📝 License

This project is protected by copyright. All rights reserved.

---

**Last Updated:** May 2026

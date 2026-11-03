# 🚀 Система управления проектами - Полная инструкция по установке и запуску

**Версия:** 1.0  
**Дата обновления:** май 2026  
**Язык:** Русский / English (see [INSTALLATION.md](INSTALLATION.md))

## 📋 Оглавление

1. [Требования к системе](#-требования-к-системе)
2. [Быстрый старт (Docker - рекомендуется)](#-быстрый-старт-docker-рекомендуется)
3. [Установка без Docker](#-установка-без-docker)
4. [Запуск приложения](#-запуск-приложения)
5. [Первоначальная настройка](#-первоначальная-настройка)
6. [Проверка установки](#-проверка-установки)
7. [Типичные ошибки и решения](#-типичные-ошибки-и-решения)
8. [Остановка и перезагрузка](#-остановка-и-перезагрузка)

---

## 🖥️ Требования к системе

### Минимальные требования

- **ОС:** Windows 10+, macOS 10.14+, Linux (Ubuntu 18.04+)
- **RAM:** 4 GB (рекомендуется 8 GB)
- **Диск:** 5 GB свободного места
- **Интернет:** Требуется для скачивания зависимостей

### Требуемое ПО

**Вариант 1 - Docker (РЕКОМЕНДУЕТСЯ):**

- Docker Desktop 4.10+ ([скачать](https://www.docker.com/products/docker-desktop))
- Docker Compose (входит в Docker Desktop)

**Вариант 2 - Локальная установка:**

- Python 3.10+ ([скачать](https://www.python.org/downloads/))
- Node.js 16+ и npm 8+ ([скачать](https://nodejs.org/))
- PostgreSQL 13+ ([скачать](https://www.postgresql.org/download/))
- Redis 6+ ([скачать для Windows](https://github.com/tporadowski/redis/releases))
- Git ([скачать](https://git-scm.com/))

---

## 🐳 Быстрый старт (PostgreSQL в Docker)

> В текущем `docker-compose.yml` контейнером запускается только PostgreSQL. Django, React, Celery и Redis не упакованы в Docker: приложение запускается локально по инструкциям ниже.

### Шаг 1: Проверьте требования Windows

Установите Docker Desktop по [официальной инструкции](https://docs.docker.com/desktop/setup/install/windows-install/) и включите backend WSL 2. По актуальным требованиям Docker Desktop необходима Windows 11 версии 23H2 (сборка 22631) или новее либо Windows 10 версии 22H2 (сборка 19045), а также включённая аппаратная виртуализация.

После установки откройте Docker Desktop, дождитесь запуска движка и в PowerShell проверьте:

```powershell
docker --version
docker compose version
docker info
```

### Шаг 2: Подготовьте локальные настройки

В PowerShell из корня проекта:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Откройте `.env` и задайте параметры для **новой базы проекта в Docker**:

```dotenv
DJANGO_DEBUG=True
DJANGO_SECRET_KEY=<уникальный локальный ключ>
DB_NAME=pms_db
DB_USER=pms_user
DB_PASSWORD=<уникальный локальный пароль>
DB_HOST=localhost
DB_PORT=5433
```

Создайте Django-ключ командой `python manage.py generate_secret_key` и скопируйте его результат в `.env`. Не публикуйте и не отправляйте файл `.env`.

### Шаг 3: Запустите контейнер с PostgreSQL

Команды выполняются из папки с `docker-compose.yml`:

```powershell
docker compose up -d db
docker compose ps
docker compose logs -f db
```

Дождитесь состояния `healthy`. Комбинация портов `5433:5432` подключает приложение на Windows к PostgreSQL в контейнере и позволяет не конфликтовать с PostgreSQL, уже работающим на порту 5432.

### Шаг 4: Запустите backend и frontend в Windows

В первом терминале:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Миграции и создание администратора нужны при первом запуске новой пустой базы. Во втором терминале:

```powershell
cd frontend
npm install
npm run dev
```

Откройте <http://localhost:5173>. Backend доступен по адресу <http://localhost:8000>.

### Часто используемые команды Docker

```powershell
docker compose ps                # состояние сервисов
docker compose logs -f db        # журнал PostgreSQL; Ctrl+C закрывает только журнал
docker compose stop db           # остановить базу, сохранив данные
docker compose start db          # снова запустить базу
docker compose down              # удалить контейнер, но сохранить данные в томе
docker compose down -v           # УДАЛИТЬ также том и всю базу этого Compose-проекта
```

PostgreSQL хранит данные в томе `postgres_data`. Команда `down -v` удалит этот том безвозвратно. Эти команды не изменяют отдельные локальные базы PostgreSQL и не импортируют в контейнер `pms_db` или `pms_synthv2_test`.

---

## 💻 Установка без Docker

### Шаг 1: Подготовка системы

**На Windows (PowerShell):**

```powershell
# Проверьте версии
python --version  # Должна быть 3.10+
node --version    # Должна быть 16+
```

**На macOS/Linux:**

```bash
python3 --version
node --version
```

### Шаг 2: Клонирование и подготовка проекта

```bash
git clone <https://github.com/RvadRA/project-management-system.git> project_management_system
cd project_management_system

# Создание виртуального окружения
python -m venv venv

# Активация виртуального окружения
source venv/Scripts/activate  # Windows (Git Bash)
# или
.\venv\Scripts\Activate.ps1   # Windows (PowerShell)
# или
source venv/bin/activate      # macOS/Linux
```

### Шаг 3: Установка Backend зависимостей

```bash
# Убедитесь, что venv активирована!
pip install --upgrade pip
pip install -r requirements.txt
```

### Шаг 4: Установка и запуск PostgreSQL

**Windows:**

1. Скачайте установщик [PostgreSQL 15](https://www.postgresql.org/download/windows/)
2. Установите с параметрами по умолчанию (пароль: postgres)
3. При установке запомните пароль

**macOS (с Homebrew):**

```bash
brew install postgresql@15
brew services start postgresql@15
```

**Linux (Ubuntu):**

```bash
sudo apt-get install postgresql postgresql-contrib
sudo service postgresql start
```

### Шаг 5: Создание БД

```bash
# Подключение к PostgreSQL
psql -U postgres

# В интерпретаторе PostgreSQL выполните:
CREATE DATABASE pms_db;
CREATE USER pms_user WITH PASSWORD 'pms_password';
ALTER ROLE pms_user SET client_encoding TO 'utf8';
ALTER ROLE pms_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE pms_user SET default_transaction_deferrable TO on;
ALTER ROLE pms_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE pms_db TO pms_user;
\q
```

### Шаг 6: Установка Redis

**Windows:**

```bash
# Скачайте redis-server.exe с https://github.com/tporadowski/redis/releases
# или используйте WSL2:
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

### Шаг 7: Инициализация Backend

```bash
# Активация venv
source venv/Scripts/activate

# Миграции БД
python manage.py migrate

# Создание суперпользователя
python manage.py createsuperuser
# Введите:
# Username: admin
# Email: admin@example.com
# Password: admin123

# Загрузка тестовых данных
python manage.py ?
```

### Шаг 8: Установка Frontend зависимостей

```bash
cd frontend
npm install
```

---

## ▶️ Запуск приложения

### Первый запуск: Откройте 4 разных терминала

**Терминал 1 - Backend Django:**

```bash
cd <путь-к-проекту>
source venv/Scripts/activate
python manage.py runserver
```

✅ Доступен: http://localhost:8000

**Терминал 2 - Celery Worker:**

```bash
cd <путь-к-проекту>
source venv/Scripts/activate
celery -A config worker -l info -P eventlet
```

**Терминал 3 - Celery Beat:**

```bash
cd <путь-к-проекту>
source venv/Scripts/activate
celery -A config beat -l info
```

**Терминал 4 - Frontend React:**

```bash
cd <путь-к-проекту>/frontend
npm run dev
```

✅ Доступен: http://localhost:5173

---

## ⚙️ Первоначальная настройка

### Вход в систему

1. Откройте http://localhost:5173
2. Введите credentials суперпользователя:
   - Username: `admin`
   - Password: `admin123`

### Доступ к админ-панели

- URL: http://localhost:8000/admin/
- Username: `admin`
- Password: `admin123`

### API Документация

- Swagger UI: http://localhost:8000/api/swagger/
- ReDoc: http://localhost:8000/api/redoc/

### Первые действия

1. Перейдите в админ-панель
2. Добавьте сотрудников (Accounts → Users)
3. Создайте проекты (Projects)
4. Загрузите шаблоны бизнес-процессов (Workflows)
5. Назначьте сотрудников на задачи

---

## ✅ Проверка установки

### Проверка Backend

```bash
# Проверка подключения к БД
python manage.py dbshell
# Должна открыться консоль PostgreSQL
\q

# Проверка статуса Celery
python manage.py check
```

### Проверка Frontend

```bash
cd frontend
npm run build
# Должна собраться без ошибок
```

### Проверка API

```bash
# Получение токена
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Получение списка пользователей
curl -X GET http://localhost:8000/api/users/ \
  -H "Authorization: Bearer <ваш-токен>"
```

---

## 🐛 Типичные ошибки и решения

### Ошибка: "ConnectionRefusedError: [WinError 10061]"

**Причина:** PostgreSQL не запущена  
**Решение:**

```bash
# Для Docker:
docker-compose up -d

# Для локальной установки:
# Windows: Запустите PostgreSQL из Services (services.msc)
# macOS: brew services start postgresql@15
# Linux: sudo service postgresql start
```

### Ошибка: "redis.exceptions.ConnectionError"

**Причина:** Redis не запущен  
**Решение:**

```bash
# Запуск Redis
redis-server
# или через Docker:
docker run -d -p 6379:6379 redis
```

### Ошибка: "ModuleNotFoundError: No module named 'django'"

**Причина:** Зависимости не установлены в виртуальное окружение  
**Решение:**

```bash
# Активируйте venv и переустановите:
source venv/Scripts/activate
pip install -r requirements.txt
```

### Ошибка: "CORS error" на фронтенде

**Решение:** Проверьте, запущен ли backend на http://localhost:8000

```bash
# Проверьте settings.py
grep -i "CORS" config/settings.py
```

### Ошибка: "node-sass" на фронтенде

**Решение:**

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

---

## ⏹️ Остановка и перезагрузка

### Остановка всех сервисов

```bash
# В каждом терминале нажмите:
Ctrl+C

# Если используете Docker:
docker-compose down
```

### Очистка БД (для переустановки)

```bash
# ВНИМАНИЕ: Это удалит все данные!
python manage.py migrate zero  # Откат миграций
docker-compose down -v         # Удаление volumes

# Заново:
python manage.py migrate
python manage.py createsuperuser
```

### Перезагрузка проекта

```bash
# Остановите все сервисы (Ctrl+C в каждом терминале)
# Затем повторите запуск приложения (см. раздел "Запуск приложения")
```

---

## 📚 Структура проекта

```
project_management_system/
├── backend (Django)
│   ├── accounts/          # Управление пользователями
│   ├── projects/          # Управление проектами
│   ├── workflows/         # Бизнес-процессы
│   ├── matching/          # Подбор сотрудников
│   ├── tasks/             # Управление задачами
│   ├── notifications/     # Уведомления
│   ├── plans/             # Планирование
│   ├── config/            # Настройки Django
│   └── manage.py
│
├── frontend (React)
│   ├── src/
│   │   ├── components/    # React компоненты
│   │   ├── pages/         # Страницы
│   │   ├── api/           # API клиент
│   │   └── App.tsx
│   └── package.json
│
├── docker-compose.yml     # Docker конфигурация
├── requirements.txt       # Python зависимости
└── INSTALLATION_RU.md     # Этот файл
```

---

## 🔗 Полезные ссылки

| Компонент   | URL                                | Учетные данные          |
| ----------- | ---------------------------------- | ----------------------- |
| Приложение  | http://localhost:5173              | admin / admin123        |
| Backend     | http://localhost:8000              | admin / admin123        |
| Admin Panel | http://localhost:8000/admin/       | admin / admin123        |
| API Swagger | http://localhost:8000/api/swagger/ | -                       |
| API ReDoc   | http://localhost:8000/api/redoc/   | -                       |
| PostgreSQL  | localhost:5432                     | pms_user / pms_password |
| Redis       | localhost:6379                     | -                       |

---

## 📞 Поддержка

Если вы столкнулись с проблемой:

1. Проверьте этот файл (раздел "Типичные ошибки")
2. Проверьте логи в терминале
3. Убедитесь, что все сервисы запущены
4. Создайте issue с описанием проблемы

---

## 📝 Лицензия

Этот проект защищен авторским правом. Все права защищены.

---

**Последнее обновление:** май 2026

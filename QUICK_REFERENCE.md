# 📚 Quick Reference Guide

**Project Management System - Command Cheat Sheet**

## 🚀 Quick Commands

### Активация окружения

```bash
# Windows (Git Bash)
source venv/Scripts/activate

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# macOS/Linux
source venv/bin/activate
```

### 🐳 Docker

```bash
# Запуск всех сервисов
docker-compose up -d

# Остановка всех сервисов
docker-compose down

# Просмотр логов
docker-compose logs -f backend

# Перестройка образов
docker-compose build --no-cache

# Удаление данных (осторожно!)
docker-compose down -v
```

### 🗄️ Django

```bash
# Создание миграций
python manage.py makemigrations

# Применение миграций
python manage.py migrate

# Откат на N версий
python manage.py migrate app_name 0001

# Создание суперпользователя
python manage.py createsuperuser

# Загрузка тестовых данных
python manage.py populate_templates

# Проверка конфигурации
python manage.py check

# Очистка кэша
python manage.py clear_cache

# Сбор статических файлов
python manage.py collectstatic --noinput

# Django shell
python manage.py shell
```

### 📦 npm / Frontend

```bash
# Установка зависимостей
npm install

# Разработка (hot reload)
npm run dev

# Production build
npm run build

# Предпросмотр production build
npm run preview

# Линтинг
npm run lint

# Форматирование кода
npm run format
```

### 🔄 Celery

```bash
# Запуск worker
celery -A config worker -l info -P eventlet

# Запуск scheduler (beat)
celery -A config beat -l info

# Просмотр активных задач
celery -A config inspect active

# Очистка очереди
celery -A config purge
```

### 🗄️ PostgreSQL

```bash
# Подключение
psql -U pms_user -d pms_db -h localhost

# В консоли PostgreSQL:
\dt                    # Список таблиц
\d table_name          # Описание таблицы
\l                     # Список БД
\c database_name       # Подключиться к БД
\du                    # Список пользователей
\q                     # Выход

# Бэкап БД
pg_dump -U pms_user pms_db > backup.sql

# Восстановление из бэкапа
psql -U pms_user pms_db < backup.sql
```

### 📝 Git

```bash
# Статус
git status

# Добавить файлы
git add .

# Коммит
git commit -m "описание изменений"

# Отправка на сервер
git push origin main

# Получение изменений
git pull origin main

# Просмотр логов
git log --oneline

# Откат последних изменений
git reset --hard HEAD~1
```

---

## 🔧 Типичные рабочие потоки

### Запуск проекта (локально)

```bash
# Терминал 1: Backend
source venv/Scripts/activate && python manage.py runserver

# Терминал 2: Worker
source venv/Scripts/activate && celery -A config worker -l info -P eventlet

# Терминал 3: Beat
source venv/Scripts/activate && celery -A config beat -l info

# Терминал 4: Frontend
cd frontend && npm run dev
```

### Создание нового приложения Django

```bash
python manage.py startapp myapp
# Добавить в INSTALLED_APPS в settings.py
# Создать URLs, Views, Models, Serializers
```

### Добавление зависимостей

```bash
# Backend
pip install package_name
pip freeze > requirements.txt

# Frontend
cd frontend
npm install package_name
npm install --save-dev package_name
```

### Развертывание изменений

```bash
# 1. Коммит и push
git add .
git commit -m "feature: описание"
git push origin main

# 2. На сервере
git pull origin main
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart pms-gunicorn
```

---

## 🔗 Важные URLs

| Компонент      | URL                                |
| -------------- | ---------------------------------- |
| 🎨 Приложение  | http://localhost:5173              |
| 🖧 API          | http://localhost:8000/api/         |
| 🔧 Admin       | http://localhost:8000/admin/       |
| 📖 Swagger API | http://localhost:8000/api/swagger/ |
| 📚 ReDoc API   | http://localhost:8000/api/redoc/   |

---

## 🔐 Учетные данные (Development)

```
Admin Panel:
- Username: admin
- Password: admin123

PostgreSQL:
- Host: localhost
- Port: 5432
- User: pms_user
- Password: pms_password
- Database: pms_db

Redis:
- Host: localhost
- Port: 6379
```

---

## 📁 Важные файлы

```
config/settings.py          # Настройки Django
config/urls.py              # Главные URLs
config/celery.py            # Конфигурация Celery
frontend/src/App.tsx        # Главный компонент React
frontend/src/main.tsx       # Точка входа
docker-compose.yml          # Docker конфигурация
requirements.txt            # Python зависимости
.env                        # Переменные окружения
```

---

## ⚠️ Частые ошибки

| Ошибка                  | Решение                               |
| ----------------------- | ------------------------------------- |
| ModuleNotFoundError     | Убедитесь, что venv активирована      |
| ConnectionError (DB)    | Запустите PostgreSQL                  |
| ConnectionError (Redis) | Запустите Redis                       |
| CORS error              | Проверьте, запущен ли backend         |
| Port already in use     | Измените порт или завершите процесс   |
| npm ERR!                | Удалите node_modules и переустановите |

---

## 🐛 Отладка

### Просмотр логов

```bash
# Django
tail -f django.log

# Celery
celery -A config worker -l debug

# PostgreSQL
tail -f /var/log/postgresql/postgresql.log

# Nginx
tail -f /var/log/nginx/error.log
```

### Отладка в Python

```python
# Добавить в код:
import pdb; pdb.set_trace()
```

### Отладка API

```bash
# Получить токен
curl -X POST http://localhost:8000/api/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Использовать токен
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8000/api/users/
```

---

## 🎯 Performance Tips

- Используйте `select_related()` и `prefetch_related()` в Django ORM
- Добавьте индексы на часто используемые колонки
- Используйте Redis для кэширования
- Минимизируйте количество API запросов на фронтенде
- Используйте lazy loading для изображений

---

## 📋 Структура ответа API

```json
{
  "status": "success|error",
  "data": {},
  "message": "Сообщение",
  "errors": {}
}
```

---

## 🚦 Статус-коды HTTP

| Код | Значение     |
| --- | ------------ |
| 200 | OK           |
| 201 | Created      |
| 400 | Bad Request  |
| 401 | Unauthorized |
| 403 | Forbidden    |
| 404 | Not Found    |
| 500 | Server Error |

---

## 📞 Чек-лист перед запуском в production

- [ ] DEBUG = False в settings.py
- [ ] SECRET_KEY изменен
- [ ] ALLOWED_HOSTS настроен
- [ ] SSL сертификат установлен
- [ ] Резервная копия БД
- [ ] Мониторинг настроен
- [ ] Логи настроены
- [ ] CORS настроен
- [ ] Email настроен
- [ ] Статические файлы собраны

---

**Последнее обновление:** май 2026

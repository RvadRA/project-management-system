# Система управления проектами (PMS)

Веб-приложение для управления проектами, задачами и рабочими процессами. Включает подбор сотрудников, шаблоны процессов, уведомления и ИИ-помощника.

## Технологии

- Backend: Django и Django REST Framework
- Frontend: React, TypeScript и Vite
- База данных: PostgreSQL
- Фоновые задачи: Celery и Redis

## Быстрый запуск на Windows

1. Установите Python, Node.js и [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Скопируйте `.env.example` в `.env`, создайте Django-ключ командой `python manage.py generate_secret_key` и задайте локальные параметры:

   ```dotenv
   DJANGO_DEBUG=True
   DJANGO_SECRET_KEY='вставьте-сгенерированный-ключ'
   DB_NAME=pms_db
   DB_USER=pms_user
   DB_PASSWORD='ваш-локальный-пароль'
   DB_HOST=localhost
   DB_PORT=5433
   ```

   Одинарные кавычки сохраняют символы `$` буквально. Не добавляйте `.env` в Git.
3. В корне проекта запустите PostgreSQL:

   ```powershell
   docker compose up -d db
   docker compose ps
   ```

5. В другом терминале установите Python-зависимости, примените миграции и запустите backend:

   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py runserver
   ```

6. В третьем терминале запустите frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

Frontend: <http://localhost:5173> · Backend: <http://localhost:8000>

> Docker Compose в этом проекте запускает только PostgreSQL. Django и frontend запускаются в Windows. Он создаёт отдельную пустую базу и не подключается автоматически к вашим прежним локальным базам.

## Docker простыми словами

- **Образ (image)** — шаблон, из которого Docker создаёт контейнер.
- **Контейнер (container)** — запущенный экземпляр PostgreSQL.
- **Порт** `5433:5432` связывает порт Windows `5433` с портом PostgreSQL `5432` внутри контейнера.
- **Том (volume)** `postgres_data` хранит данные отдельно от контейнера. Перезапуск контейнера не удаляет базу.
- **Compose** читает `docker-compose.yml` и управляет сервисами проекта.

Полезные команды из корня проекта:

```powershell
docker compose up -d db          # запустить базу в фоне
docker compose ps                # показать состояние контейнеров
docker compose logs -f db        # смотреть журнал; Ctrl+C завершает просмотр
docker compose stop db           # остановить контейнер, сохранив данные
docker compose start db          # снова запустить остановленный контейнер
docker compose down              # удалить контейнер, но сохранить том с данными
docker compose down -v           # удалить также том и ВСЮ базу проекта
```

Для подробной инструкции см. [установку на русском](INSTALLATION_RU.md), [справочник команд](QUICK_REFERENCE.md) и [индекс документации](INDEX.md).

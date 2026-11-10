# Система управления проектами (PMS)

Веб-приложение для управления проектами, задачами и рабочими процессами. Включает подбор сотрудников, шаблоны процессов, уведомления и ИИ-помощника.

## Технологии

- Backend: Django и Django REST Framework
- Frontend: React, TypeScript и Vite
- Базы данных: PostgreSQL
- Фоновые задачи: Celery и Redis
- ИИ-функции: локальная Ollama (не обязательна для запуска основного приложения)

## Первичная настройка (Windows)

Для нового клона проекта:

1. Создайте и активируйте Python-окружение, затем установите backend-зависимости:

   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

   В **Git Bash** используйте:

   ```bash
   python -m venv venv
   source venv/Scripts/activate
   pip install -r requirements.txt
   ```

2. Если локального `.env` ещё нет, скопируйте образец:

   ```powershell
   Copy-Item .env.example .env
   ```

   В Git Bash: `cp .env.example .env`. Не выполняйте эту команду повторно поверх существующего `.env`.

   Не перезаписывайте уже настроенный `.env`. Создайте ключ командой `python manage.py generate_secret_key`, затем откройте `.env` и задайте локальные параметры. Например, для основной базы в установленном PostgreSQL:

   ```dotenv
   DJANGO_DEBUG=True
   DJANGO_SECRET_KEY='вставьте-сгенерированный-ключ'
   DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
   CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
   DB_NAME=pms_db
   DB_USER=postgres
   DB_PASSWORD='пароль-вашего-локального-PostgreSQL'
   DB_HOST=127.0.0.1
   DB_PORT=5432
   ```

   Кавычки сохраняют символы `$` буквально. `.env` содержит секреты и исключён из Git.

## Важно: здесь есть три разные базы данных

Имя базы само по себе не определяет, где она находится. Важно также подключение — адрес и порт PostgreSQL.

| База | Где находится | Подключение | Назначение и данные |
|---|---|---|---|
| `pms_db` (основная) | Установленный PostgreSQL в Windows | `127.0.0.1:5432` | Ваша существующая рабочая база: проверено 20 пользователей, 19 профилей, 16 проектов, 133 проектные задачи и 65 workflow-задач |
| `pms_synthv2_test` | Тот же PostgreSQL в Windows | `127.0.0.1:5432` | Отдельная база с синтетическими данными для тестирования: проверено 31 пользователь, 30 профилей, 55 проектов и 728 workflow-задач |
| `pms_db` в Docker | Отдельный контейнер PostgreSQL | `127.0.0.1:5433` | Изолированная база разработки. В ней нет данных из PostgreSQL Windows; при проверке она была пустой |

Количество записей проверено **10 ноября 2026 года** и может меняться при работе приложения. В таблице различаются проектные задачи и задачи внутри workflow. В `pms_synthv2_test` проектных задач нет: тестовые данные задач хранятся в workflow. Docker-база может называться так же, как Windows-база, но это другая база на другом порту. Данные между ними автоматически не копируются.

## Обычный запуск с вашей основной базой

Это рекомендуемый способ для работы с существующими данными. Убедитесь, что установленный PostgreSQL в Windows запущен, а локальный `.env` содержит правильные параметры:

```dotenv
DB_NAME=pms_db
DB_USER=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
```

Пароль берётся из `DB_PASSWORD` в локальном `.env`. Не публикуйте этот файл.

### 1. Запустите backend

В PowerShell из корня проекта:

```powershell
.\venv\Scripts\Activate.ps1
python manage.py check
python manage.py runserver
```

В Git Bash из корня проекта:

```bash
source venv/Scripts/activate
python manage.py check
python manage.py runserver
```

Проверка выбранной базы в PowerShell (не меняет данные):

```powershell
python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print(connection.settings_dict['NAME'], connection.settings_dict['HOST'], connection.settings_dict['PORT'])"
```

В Git Bash:

```bash
python manage.py shell -c 'from django.db import connection; connection.ensure_connection(); print(connection.settings_dict["NAME"], connection.settings_dict["HOST"], connection.settings_dict["PORT"])'
```

Для обычного запуска ожидается `pms_db 127.0.0.1 5432`.

### 2. Запустите frontend

Во втором терминале PowerShell:

```powershell
cd frontend
npm run dev
```

В Git Bash откройте второй терминал и выполните:

```bash
cd frontend
npm run dev
```

Откройте <http://localhost:5173>. Frontend использует `frontend/.env.local`, где `VITE_API_URL` должен указывать на backend, обычно `http://localhost:8000/api`.

### 3. Войдите в приложение

Используйте существующую учётную запись из выбранной базы. README намеренно не содержит паролей. Для просмотра данных через Django Admin откройте <http://localhost:8000/admin/>.

### Фоновые задачи и ИИ (по необходимости)

Основной backend и интерфейс можно запустить без этих дополнительных процессов. Если нужны фоновые уведомления и периодические задачи, отдельно запустите Redis, а затем в активированном Python-окружении откройте два терминала:

```powershell
celery -A config worker -l info -P eventlet
```

```powershell
celery -A config beat -l info
```

В Git Bash используются те же команды (из корня проекта, при активированном окружении):

```bash
celery -A config worker -l info -P eventlet
```

```bash
celery -A config beat -l info
```

Redis, Celery и Ollama **не запускаются** текущим `docker compose up -d db`. ИИ-функции требуют отдельно запущенной локальной Ollama и моделей, указанных в `.env`; без них функции ИИ могут быть недоступны, но база, backend и frontend запускаются отдельно.

## Переключение на синтетические данные

Остановите backend сочетанием `Ctrl+C`. В том же PowerShell задайте имя второй базы и снова запустите backend:

```powershell
$env:DB_NAME = 'pms_synthv2_test'
$env:DB_USER = 'postgres'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '5432'
python manage.py runserver
```

В **Git Bash** используйте `export` вместо PowerShell `$env:`:

```bash
export DB_NAME=pms_synthv2_test
export DB_USER=postgres
export DB_HOST=127.0.0.1
export DB_PORT=5432
python manage.py runserver
```

Frontend остаётся на <http://localhost:5173>; он показывает данные той базы, к которой подключён текущий backend. Используйте учётную запись из `pms_synthv2_test`. Чтобы вернуться к основной базе, остановите backend и выполните:

```powershell
$env:DB_NAME = 'pms_db'
python manage.py runserver
```

Вернуться на `pms_db` в Git Bash:

```bash
export DB_NAME=pms_db
python manage.py runserver
```

Для временного запуска без изменения окружения Bash можно выполнить одну команду:

```bash
DB_NAME=pms_synthv2_test DB_USER=postgres DB_HOST=127.0.0.1 DB_PORT=5432 python manage.py runserver
```

Переменные `$env:` действуют только в текущем PowerShell; переменные `export` — только в текущем Git Bash. Они имеют приоритет над `.env`. Чтобы вернуться к значениям `.env`, выполните `Remove-Item Env:DB_NAME, Env:DB_USER, Env:DB_HOST, Env:DB_PORT` в PowerShell или `unset DB_NAME DB_USER DB_HOST DB_PORT` в Git Bash.

> Не запускайте `python manage.py migrate`, команды seed или импорт синтетических данных на существующих базах, если не планировали менять их схему или содержимое. На момент проверки основная `pms_db` проходит `migrate --check`, а `pms_synthv2_test` сообщает о незавершённой миграции. Не применяйте её без необходимости и свежей резервной копии. См. [руководство по старым и новым данным](RUN_OLD_AND_NEW_DATA.md).

## Docker в этом проекте

Docker Desktop и Compose запускают **только PostgreSQL**, не весь проект:

- **Образ** `postgres:15-alpine` — загружаемый шаблон PostgreSQL.
- **Контейнер** — запущенный PostgreSQL. Его состояние: `docker compose ps`.
- **Порт** `5433:5432` — приложение на Windows подключается к порту `5433`; внутри контейнера PostgreSQL слушает `5432`.
- **Том** `postgres_data` хранит файлы базы отдельно от контейнера и сохраняет их при остановке и пересоздании контейнера.
- Django и frontend запускаются в Windows. Compose сам по себе не запускает Redis, Celery или Ollama.

Запустите Docker Desktop. Команды одинаковы в PowerShell и Git Bash; выполните их из корня проекта:

```bash
docker compose up -d db
docker compose ps
docker compose logs -f db
```

В `docker compose ps` дождитесь статуса `healthy`. Просмотр журнала завершается `Ctrl+C`; сам контейнер при этом продолжает работать.

### Подключить Django к PostgreSQL в Docker

Docker-база отдельная и не содержит ваших данных из Windows PostgreSQL. Чтобы запустить backend на ней, остановите текущий backend и задайте параметры **в его терминале**:

```powershell
$env:DB_NAME = 'pms_db'
$env:DB_USER = 'pms_user'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '5433'
python manage.py runserver
```

Эквивалент в Git Bash:

```bash
export DB_NAME=pms_db
export DB_USER=pms_user
export DB_HOST=127.0.0.1
export DB_PORT=5433
python manage.py runserver
```

Для нового пустого Docker-тома один раз примените миграции и создайте отдельную учётную запись:

```bash
# Сначала задайте DB_NAME=pms_db, DB_USER=pms_user, DB_HOST=127.0.0.1, DB_PORT=5433
python manage.py migrate
python manage.py createsuperuser
```

В Git Bash установите параметры перед командами, чтобы миграции и отдельный администратор относились к Docker-базе:

```bash
export DB_NAME=pms_db DB_USER=pms_user DB_HOST=127.0.0.1 DB_PORT=5433
python manage.py migrate
python manage.py createsuperuser
```

Эти команды изменяют **Docker-базу**, если перед ними заданы Docker-параметры подключения. Не выполняйте их с настройками основной или синтетической базы без намерения изменить эту базу.

### Остановка и сохранение данных Docker

```bash
docker compose stop db       # остановить контейнер; данные останутся в томе
docker compose start db      # снова запустить его
docker compose down          # удалить контейнер и сеть; том с базой сохранить
docker compose up -d db      # создать/запустить сервис с сохранённым томом
```

> **Опасно:** `docker compose down -v` удаляет том Docker с данными этой Docker-базы. Эта команда не удаляет PostgreSQL Windows, но данные Docker-тома восстановить без резервной копии нельзя.

## Проверки и тесты

```bash
python manage.py check
python manage.py migrate --check
cd frontend
npm test
npm run build
```

Проверки `migrate --check` нужно запускать с подключением к нужной базе. Они проверяют состояние миграций и не применяют их.

## Документация

- [Полная установка на русском](INSTALLATION_RU.md)
- [Установка на английском](INSTALLATION.md)
- [Запуск со старыми и синтетическими данными](RUN_OLD_AND_NEW_DATA.md)
- [Справочник команд](QUICK_REFERENCE.md)
- [Индекс документации](INDEX.md)

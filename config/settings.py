"""
Django settings for Project Management System.
"""

import os
import sys
from pathlib import Path
from datetime import timedelta

from django.core.exceptions import ImproperlyConfigured

from .env import env, env_bool, env_int, env_list, load_env_file

BASE_DIR = Path(__file__).resolve().parent.parent
load_env_file(BASE_DIR / '.env')

TESTING = 'test' in sys.argv

# Режим отладки включается только явно (DJANGO_DEBUG=True в .env на машине разработчика).
# По умолчанию — боевой режим: без подробных страниц ошибок и с обязательными секретами.
DEBUG = env_bool('DJANGO_DEBUG', False)

# Ключ подписывает токены входа. Он не хранится в коде: прежний ключ попал в историю git,
# поэтому в .env должен лежать новый (python manage.py generate_secret_key).
SECRET_KEY = env('DJANGO_SECRET_KEY')
if not SECRET_KEY:
    if DEBUG or TESTING:
        SECRET_KEY = 'dev-only-key-not-for-production-' + 'x' * 32
    else:
        raise ImproperlyConfigured('Задайте DJANGO_SECRET_KEY в .env (см. .env.example).')

ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]')

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'django_celery_beat',
    'django_celery_results',
    # Local apps
    'accounts',      # custom user model (AUTH_USER_MODEL)
    'projects',
    'matching',      # EmployeeProfile, Skill, Workload lives here
    'workflows',
    'notifications',
    'plans',
    'assistant',     # ИИ-ассистент: голосовой ввод, вопросы по базе знаний
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# To use PostgreSQL install psycopg2-binary and uncomment the block below:
#
# Параметры можно переопределить переменными окружения (например, для docker-compose,
# где по умолчанию заданы pms_user / pms_password).
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DB_NAME', 'pms_db'),
        'USER': os.environ.get('DB_USER', 'postgres'),
        # Пароль по умолчанию годится только для локальной разработки
        'PASSWORD': os.environ.get('DB_PASSWORD', 'postgres' if (DEBUG or TESTING) else ''),
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '5432'),
    }
}

#DATABASES = {
 #   'default': {
 #       'ENGINE': 'django.db.backends.sqlite3',
 #       'NAME': BASE_DIR / 'db.sqlite3',
 #   }
#}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
AUTH_USER_MODEL = 'accounts.CustomUser'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 10}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ---------------------------------------------------------------------------
# DRF
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    # Ограничение частоты запросов: защита от перебора паролей и от перегрузки API.
    # Попытки входа ограничиваются отдельно (accounts.throttles), запросы к ИИ — тоже (scope «ai»).
    'DEFAULT_THROTTLE_CLASSES': [] if TESTING else [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    # Сколько доверенных прокси стоит перед сервером: без этого адрес клиента берётся из соединения,
    # а заголовок X-Forwarded-For (его легко подделать) игнорируется
    'NUM_PROXIES': env_int('NUM_PROXIES', 0),
    'DEFAULT_THROTTLE_RATES': {
        'anon': env('THROTTLE_ANON', '60/min'),
        'user': env('THROTTLE_USER', '1200/min'),
        'ai': env('THROTTLE_AI', '20/min'),
    },
}
if not DEBUG:
    # В боевом режиме API отдаёт только JSON — без интерактивной страницы DRF
    REST_FRAMEWORK['DEFAULT_RENDERER_CLASSES'] = ('rest_framework.renderers.JSONRenderer',)

# Попытки входа: с одного адреса и на одну учётную запись
LOGIN_THROTTLE_PER_IP = env('LOGIN_THROTTLE_PER_IP', '20/min')
LOGIN_THROTTLE_PER_USER = env('LOGIN_THROTTLE_PER_USER', '8/min')

# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------
SIMPLE_JWT = {
    # Короткий access-токен: украденный токен быстро перестаёт работать.
    # Клиент сам обновляет его по refresh-токену.
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=env_int('JWT_ACCESS_MINUTES', 30)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=env_int('JWT_REFRESH_DAYS', 7)),
    'ROTATE_REFRESH_TOKENS': True,
    # Использованный refresh-токен аннулируется; выход и смена пароля аннулируют все токены пользователя
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# Обращаться к API из браузера могут только перечисленные адреса интерфейса.
# Раньше было разрешено любому сайту (CORS_ALLOW_ALL_ORIGINS) — это закрыто.
CORS_ALLOWED_ORIGINS = env_list(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://localhost:5175' if DEBUG else '',
)
CORS_ALLOW_CREDENTIALS = False   # вход по токену в заголовке, cookie не используются
CORS_EXPOSE_HEADERS = ['Content-Disposition']
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS', '')

# ---------------------------------------------------------------------------
# Защитные заголовки и cookie
# ---------------------------------------------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
if not DEBUG and not TESTING:
    # За HTTPS: cookie только по защищённому каналу, браузер запоминает требование HTTPS
    USE_HTTPS = env_bool('DJANGO_USE_HTTPS', True)
    SESSION_COOKIE_SECURE = USE_HTTPS
    CSRF_COOKIE_SECURE = USE_HTTPS
    SECURE_SSL_REDIRECT = USE_HTTPS and env_bool('DJANGO_SSL_REDIRECT', True)
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    if USE_HTTPS:
        SECURE_HSTS_SECONDS = env_int('DJANGO_HSTS_SECONDS', 31536000)
        SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# ---------------------------------------------------------------------------
# Загрузка файлов
# ---------------------------------------------------------------------------
MAX_UPLOAD_MB = env_int('MAX_UPLOAD_MB', 25)
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024          # крупнее — во временный файл, не в память
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024         # тело запроса без файлов
DATA_UPLOAD_MAX_NUMBER_FIELDS = 2000
# Адреса, на которые задачам-интеграциям разрешено обращаться во внутренней сети (по умолчанию — ни на какие)
INTEGRATION_ALLOWED_HOSTS = env_list('INTEGRATION_ALLOWED_HOSTS', '')

# ---------------------------------------------------------------------------
# i18n / TZ
# ---------------------------------------------------------------------------
LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static / Media
# ---------------------------------------------------------------------------
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
# Console backend: emails are printed to the terminal (good for dev/demo)
# To use real SMTP: change to 'django.core.mail.backends.smtp.EmailBackend'
# and set EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
DEFAULT_FROM_EMAIL = 'PMS System <noreply@pms.local>'
EMAIL_SUBJECT_PREFIX = '[PMS] '

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0')
CELERY_RESULT_BACKEND = 'django-db'
CELERY_CACHE_BACKEND = 'default'
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
# Без отдельного воркера (разработка, демо, тесты) задачи выполняются сразу
CELERY_TASK_ALWAYS_EAGER = env_bool('CELERY_TASK_ALWAYS_EAGER', DEBUG or TESTING)
CELERY_TASK_EAGER_PROPAGATES = True

from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    'daily-summary-digest': {
        'task': 'notifications.tasks.daily_summary_digest',
        'schedule': crontab(hour=9, minute=0), # Every morning at 9:00
    },
    'check-sla-deadlines': {
        'task': 'workflows.tasks.check_all_tasks_sla',
        'schedule': crontab(minute='*/30'), # Every 30 minutes
    },
}
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'

# ---------------------------------------------------------------------------
# External Notifications
# ---------------------------------------------------------------------------
# Telegram settings (set via env or here for demo)
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHANNEL_ID = os.environ.get('TELEGRAM_CHANNEL_ID', '') # Default channel if no personal chat

# Slack settings
SLACK_WEBHOOK_URL = os.environ.get('SLACK_WEBHOOK_URL', '')

# Frontend settings for links in notifications
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5175')

# ---------------------------------------------------------------------------
# ИИ-ассистент (этап 2)
# ---------------------------------------------------------------------------
# Ключи и внешние API ассистенту не нужны: единственный провайдер — локальная Ollama.
AI_REQUEST_TIMEOUT = env_int('AI_REQUEST_TIMEOUT', 20)

# Local, offline task-assignment models (Ollama). Ollama is the only AI
# assistant provider: no external API is used for drafts, questions or status.
OLLAMA_BASE_URL = env('OLLAMA_BASE_URL', 'http://localhost:11434')
OLLAMA_CHAT_MODEL = env('OLLAMA_CHAT_MODEL', 'qwen3:4b')
OLLAMA_EMBED_MODEL = env('OLLAMA_EMBED_MODEL', 'qwen3-embedding:0.6b')
OLLAMA_TIMEOUT = env_int('OLLAMA_TIMEOUT', 90)
OLLAMA_CHAT_TIMEOUT = env_int('OLLAMA_CHAT_TIMEOUT', 45)
# One bounded retry for a transient timeout/connection failure; keep the total
# bounded wait below the frontend request timeout.
OLLAMA_CHAT_RETRIES = env_int('OLLAMA_CHAT_RETRIES', 1)
OLLAMA_RETRY_BACKOFF = env_int('OLLAMA_RETRY_BACKOFF', 1)
OLLAMA_STATUS_TIMEOUT = env_int('OLLAMA_STATUS_TIMEOUT', 2)
OLLAMA_NUM_CTX = env_int('OLLAMA_NUM_CTX', 4096)
# Memory-saving default: unload the chat model after each response. Set a
# duration such as 5m only on machines where faster repeat requests matter more
# than RAM. This is not a hard memory cap; the next request may reload the model.
_OLLAMA_KEEP_ALIVE = env('OLLAMA_KEEP_ALIVE', '0').strip()
try:
    OLLAMA_KEEP_ALIVE = int(_OLLAMA_KEEP_ALIVE)
except ValueError:
    OLLAMA_KEEP_ALIVE = _OLLAMA_KEEP_ALIVE
# Draft recommendations are interactive: both the requirement extraction and
# the prose explanations have their own short budget. When it is exhausted the
# deterministic path is used instead of keeping the assistant spinner forever.
OLLAMA_ANALYSIS_TIMEOUT = env_int('OLLAMA_ANALYSIS_TIMEOUT', 20)
OLLAMA_EXPLANATION_TIMEOUT = env_int('OLLAMA_EXPLANATION_TIMEOUT', 5)
MAX_AUDIO_MB = env_int('MAX_AUDIO_MB', 10)
STT_ENABLED = env_bool('STT_ENABLED', True)
STT_MODEL = env('STT_MODEL', 'base').strip()
STT_CPU_THREADS = max(1, env_int('STT_CPU_THREADS', 2))
STT_BEAM_SIZE = max(1, env_int('STT_BEAM_SIZE', 1))
STT_MODEL_CACHE_DIR = Path(env(
    'STT_MODEL_CACHE_DIR',
    str(Path.home() / '.cache' / 'projectms' / 'faster-whisper'),
)).expanduser()

# ---------------------------------------------------------------------------
# Журнал событий безопасности (неудачные входы, отказы в доступе)
# ---------------------------------------------------------------------------
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {'plain': {'format': '%(asctime)s %(levelname)s %(name)s %(message)s'}},
    'handlers': {'console': {'class': 'logging.StreamHandler', 'formatter': 'plain'}},
    'loggers': {
        'security': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
        'ai': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}

"""
Чтение настроек из переменных окружения и файла .env в корне проекта.

Секреты (SECRET_KEY, пароли, API-ключи) в коде и в репозитории не хранятся:
они лежат в .env, который исключён из git. Образец — .env.example.
"""
import os
from pathlib import Path


def load_env_file(path: Path) -> None:
    """Подгружает KEY=VALUE из файла; уже заданные переменные окружения не перезаписывает."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ.setdefault(key, value)


def env(key: str, default: str = '') -> str:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    value = os.environ.get(key)
    if value is None:
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')


def env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def env_list(key: str, default: str = '') -> list:
    return [item.strip() for item in os.environ.get(key, default).split(',') if item.strip()]

"""
Проверка загружаемых файлов и безопасная отдача файлов.

Файлы проектов, базы знаний и вложения задач хранятся в MEDIA_ROOT, но напрямую по ссылке
не отдаются — только через API с проверкой прав и всегда как «вложение», чтобы браузер
не выполнял их содержимое (HTML, SVG со скриптами и т. п.).
"""
import os

from django.conf import settings
from django.http import FileResponse
from rest_framework.exceptions import ValidationError

# Исполняемые файлы и активное содержимое, которое браузер или ОС могут запустить
BLOCKED_EXTENSIONS = {
    '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.dll', '.sys', '.lnk', '.reg',
    '.ps1', '.psm1', '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.jar', '.jse', '.js', '.mjs',
    '.sh', '.bash', '.php', '.phtml', '.asp', '.aspx', '.jsp', '.cgi', '.pl', '.py', '.rb',
    '.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.xml', '.xsl', '.swf', '.apk', '.app', '.dmg',
}

# Картинки, которые можно показывать прямо в интерфейсе (SVG сюда не входит: в нём бывают скрипты)
INLINE_IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'}


def validate_upload(file, max_mb=None):
    """Отклоняет слишком большие файлы и файлы опасных типов. Возвращает файл, если всё в порядке."""
    if file is None:
        return file
    limit_mb = max_mb or settings.MAX_UPLOAD_MB
    if file.size > limit_mb * 1024 * 1024:
        raise ValidationError(f'Файл слишком большой: максимум {limit_mb} МБ.')
    name = os.path.basename(str(getattr(file, 'name', '') or ''))
    if not name or name.startswith('.'):
        raise ValidationError('Недопустимое имя файла.')
    # Проверяем все расширения: «отчёт.pdf.exe» не должен пройти
    parts = name.lower().split('.')[1:]
    blocked = next((f'.{ext}' for ext in parts if f'.{ext}' in BLOCKED_EXTENSIONS), None)
    if blocked:
        raise ValidationError(f'Файлы типа «{blocked}» загружать нельзя.')
    return file


def file_response(field_file, download_name=None, inline_image=False):
    """Отдаёт файл как вложение; картинку из белого списка — для показа в интерфейсе."""
    name = download_name or os.path.basename(field_file.name)
    ext = os.path.splitext(name)[1].lower()
    handle = field_file.open('rb')
    if inline_image and ext in INLINE_IMAGE_TYPES:
        response = FileResponse(handle, as_attachment=False, filename=name, content_type=INLINE_IMAGE_TYPES[ext])
    else:
        response = FileResponse(handle, as_attachment=True, filename=name, content_type='application/octet-stream')
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "default-src 'none'; sandbox"
    response['Cache-Control'] = 'private, no-store'
    return response

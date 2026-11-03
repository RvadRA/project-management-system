"""API ИИ-ассистента: /api/ai/…  Все запросы — только для вошедших пользователей и с ограничением частоты."""
import struct
import time

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from matching.serializers import CandidateScoreSerializer
from projects import access
from projects.models import Project

from . import router, services
from .models import AIRequestLog

MAX_RECORD_SECONDS = 60
WAV_BYTES_PER_SECOND = 32000   # 16 кГц, моно, 16 бит


class AIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'ai'

    def log(self, feature, provider, started):
        AIRequestLog.objects.create(
            user=self.request.user, feature=feature, provider=provider or '',
            duration_ms=int((time.time() - started) * 1000),
        )


def _failure_response(failure):
    details = ' '.join(
        f'{provider}: {reason}.' for provider, reason in failure.attempts
    )
    return Response({
        'error': f'Локальное распознавание речи недоступно. {details}'.strip(),
        'attempts': [{'provider': name, 'reason': reason} for name, reason in failure.attempts],
    }, status=status.HTTP_503_SERVICE_UNAVAILABLE)


def _validate_wav(data: bytes):
    """Принимается только WAV PCM 16 кГц моно 16 бит — в этот формат звук переводит интерфейс."""
    if len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE' or data[12:16] != b'fmt ':
        return 'Ожидается звук в формате WAV.'
    audio_format, channels, sample_rate = struct.unpack('<HHI', data[20:28])
    bits = struct.unpack('<H', data[34:36])[0]
    if (audio_format, channels, sample_rate, bits) != (1, 1, 16000, 16):
        return 'Ожидается WAV: 16 кГц, моно, 16 бит.'
    if len(data) > 44 + MAX_RECORD_SECONDS * WAV_BYTES_PER_SECOND:
        return f'Запись длиннее {MAX_RECORD_SECONDS} секунд.'
    return None


def _is_silent(data: bytes) -> bool:
    """Запись без звука: самый громкий отсчёт ниже ~1,5% шкалы."""
    samples = memoryview(data[44:44 + (len(data) - 44) // 2 * 2]).cast('h')
    return not samples or max(max(samples), -min(samples)) < 500


class StatusView(AIView):
    """Какие провайдеры настроены и работают. Ключи не возвращаются."""
    throttle_classes = []

    def get(self, request):
        providers = router.status()
        data = {
            'chat_available': any(p['chat'] and p.get('available') for p in providers),
            'transcribe_available': any(p['transcribe'] for p in providers),
            'max_record_seconds': MAX_RECORD_SECONDS,
            'max_audio_mb': settings.MAX_AUDIO_MB,
        }
        if not data['transcribe_available']:
            speech_provider = next(
                (provider for provider in providers if provider['name'] == 'faster-whisper'),
                None,
            )
            data['transcribe_error'] = (
                speech_provider['error'] if speech_provider else 'локальное распознавание недоступно'
            )
        # Подробности о провайдерах и расходе — менеджерам и выше
        if access.can_view_staff(request.user):
            since = timezone.now() - timezone.timedelta(hours=24)
            usage = {}
            for provider, feature in AIRequestLog.objects.filter(created_at__gte=since).values_list('provider', 'feature'):
                usage.setdefault(provider or 'fallback', {}).setdefault(feature, 0)
                usage[provider or 'fallback'][feature] += 1
            data.update({'providers': providers, 'order': [p['name'] for p in providers], 'usage_24h': usage})
        return Response(data)

    def post(self, request):
        """«Проверить снова»: снимает паузы (например, после пополнения счёта или выдачи прав ключу)."""
        if not access.is_admin(request.user):
            return Response({'error': 'Доступно только администратору.'}, status=status.HTTP_403_FORBIDDEN)
        router.reset_pauses()
        return self.get(request)


class TranscribeView(AIView):
    """Локальное распознавание речи: POST multipart, поля audio и language."""
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        audio = request.FILES.get('audio')
        if audio is None:
            return Response({'error': 'Не передан звук (поле audio).'}, status=status.HTTP_400_BAD_REQUEST)
        language = request.data.get('language', 'ru')
        if language not in ('auto', 'en', 'ru', 'uz'):
            return Response(
                {'error': 'Выберите автоопределение, русский, английский или узбекский язык.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if audio.size > settings.MAX_AUDIO_MB * 1024 * 1024:
            return Response({'error': f'Запись больше {settings.MAX_AUDIO_MB} МБ.'}, status=status.HTTP_400_BAD_REQUEST)
        data = audio.read()
        problem = _validate_wav(data)
        if problem:
            return Response({'error': problem}, status=status.HTTP_400_BAD_REQUEST)
        if _is_silent(data):
            return Response({'text': '', 'provider': None, 'silent': True})
        started = time.time()
        try:
            text, provider = router.transcribe(data, language=language)
        except router.AllProvidersFailed as failure:
            self.log('transcribe', '', started)
            return _failure_response(failure)
        self.log('transcribe', provider, started)
        return Response({'text': services.clean_text(text), 'provider': provider})


class CorrectTranscriptView(AIView):
    """Предлагает локальную коррекцию текста; не получает аудио и ничего не применяет."""
    parser_classes = [JSONParser]

    def post(self, request):
        original = request.data.get('text')
        if not isinstance(original, str):
            return Response(
                {'error': 'Передайте текст расшифровки в поле text.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not original.strip():
            return Response(
                {'error': 'Текст расшифровки не должен быть пустым.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(original) > services.MAX_TEXT:
            return Response(
                {'error': f'Текст не должен превышать {services.MAX_TEXT} символов.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(services.suggest_transcript_correction(original))


class TaskDraftView(AIView):
    """Черновик задачи из текста: POST {"text": "...", "project_id": 5}. Ничего не создаёт."""
    parser_classes = [JSONParser]

    def post(self, request):
        text = services.clean_text(request.data.get('text'))
        if len(text) < 3:
            return Response({'error': 'Опишите задачу хотя бы несколькими словами.'}, status=status.HTTP_400_BAD_REQUEST)
        started = time.time()
        result = services.build_task_draft(request.user, text, request.data.get('project_id'))
        self.log('task_draft', result['provider'], started)
        return Response(result)


class CandidatesView(AIView):
    """
    Кандидаты в исполнители для выбранного проекта: POST {"project_id", "skill_ids", "due_date", "assignee_hint"}.
    Нужен, когда в черновике меняют проект. Нейросеть не вызывается — считает собственный скоринг.
    """
    parser_classes = [JSONParser]

    def post(self, request):
        import datetime
        project = services.editable_projects(request.user).filter(
            id=request.data.get('project_id') if str(request.data.get('project_id') or '').isdigit() else 0).first()
        if project is None:
            return Response({'candidates': [], 'warnings': []})
        skill_ids = [int(i) for i in (request.data.get('skill_ids') or []) if str(i).isdigit()][:5]
        try:
            due = datetime.date.fromisoformat(str(request.data.get('due_date') or ''))
        except ValueError:
            due = None
        warnings = []
        hint = services.clean_text(request.data.get('assignee_hint'), 100) or None
        candidates = services.suggest_assignees(request.user, project, skill_ids, due, hint, warnings)
        return Response({'candidates': candidates, 'warnings': warnings})


class DraftCandidatesView(AIView):
    """
    Top-three для несохранённого черновика: POST {"project_id", "title", "description", ...}.
    Ничего не создаёт: задача и назначение появляются только после подтверждения менеджера.
    """
    parser_classes = [JSONParser]

    def post(self, request):
        raw_project = request.data.get('project_id')
        if not str(raw_project or '').isdigit():
            return Response({'error': 'Выберите проект.'}, status=status.HTTP_400_BAD_REQUEST)
        project = access.filter_visible_projects(
            Project.objects.select_related('calendar').prefetch_related('members'), request.user,
        ).filter(id=int(raw_project)).first()
        if project is None:
            return Response({'error': 'Проект не найден или недоступен.'}, status=status.HTTP_404_NOT_FOUND)
        if not access.has_project_perm(request.user, project, 'can_assign_tasks'):
            return Response(
                {'error': 'Нет права назначать исполнителей в этом проекте.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        title = services.clean_text(request.data.get('title'), 255)
        description = services.clean_text(request.data.get('description'), 4000)
        if len(title) < 3 and len(description) < 3:
            return Response(
                {'error': 'Опишите задачу, чтобы подобрать исполнителей.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        skill_ids = request.data.get('skill_ids') or []
        if not isinstance(skill_ids, list):
            skill_ids = []
        draft = {
            'title': title,
            'description': description,
            'due_date': request.data.get('due_date'),
            'skill_ids': skill_ids,
            'process_name': services.clean_text(request.data.get('process_name'), 255),
            'block_name': services.clean_text(request.data.get('block_name'), 255),
        }
        result = services.recommend_draft_candidates(request.user, project, draft)
        result['candidates'] = CandidateScoreSerializer(result['candidates'], many=True).data
        return Response(result)


class AskView(AIView):
    """Вопрос по базе знаний: POST {"question": "..."}. Ищет только в доступных пользователю материалах."""
    parser_classes = [JSONParser]

    def post(self, request):
        question = services.clean_text(request.data.get('question'), 1000)
        if len(question) < 3:
            return Response({'error': 'Сформулируйте вопрос.'}, status=status.HTTP_400_BAD_REQUEST)
        started = time.time()
        result = services.answer_question(request.user, question)
        self.log('ask', result['provider'], started)
        return Response(result)

"""ИИ-ассистент: локальная Ollama, права доступа, резервный режим."""
import datetime
import json
import struct
import time

import requests
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from matching.ai import OllamaUnavailable
from matching.models import EmployeeExperienceEmbedding, EmployeeSkill, EmployeeUnavailability, Skill, WorkloadEntry
from projects.models import KnowledgeMaterial, Project, ProjectMember, Task
from projects.tests import RBACTestCase
from workflows.models import WorkflowTask

from . import router
from .models import AIRequestLog
from .providers.base import ProviderError
from .providers.faster_whisper import FasterWhisperProvider
from .providers.ollama import OllamaProvider


def fake_recommendation_embeddings(task_text, profiles, persist=False, force=False, keep_alive=None):
    profiles = list(profiles)
    return [1.0, 0.0], {profile.id: [1.0, 0.0] for profile in profiles}

LOCAL_SETTINGS = dict(
    OLLAMA_BASE_URL='http://localhost:11434',
    OLLAMA_CHAT_MODEL='qwen3:4b',
    OLLAMA_CHAT_TIMEOUT=5,
    OLLAMA_CHAT_RETRIES=0,
    OLLAMA_RETRY_BACKOFF=0,
    OLLAMA_STATUS_TIMEOUT=1,
    OLLAMA_NUM_CTX=4096,
    OLLAMA_KEEP_ALIVE='5m',
)
LOCAL = 'ollama:qwen3:4b'
HEALTHY = {'available': True, 'model_installed': True, 'error': ''}


class ollama:
    """
    Подменяет метод локального провайдера. behaviour: {имя: ответ или исключение}, '*' — для остальных.
    names() — к каким провайдерам обращались, по порядку.
    """

    def __init__(self, method, behaviour):
        def call(provider, *args, **kwargs):
            value = behaviour.get(provider.name, behaviour.get('*'))
            if isinstance(value, Exception):
                raise value
            return value

        self.patcher = mock.patch.object(OllamaProvider, method, autospec=True, side_effect=call)
        self.mock = None

    def __enter__(self):
        self.mock = self.patcher.start()
        return self

    def __exit__(self, *exc):
        self.patcher.stop()

    def names(self):
        return [c.args[0].name for c in self.mock.call_args_list]

    def sent(self):
        return str(self.mock.call_args_list)


def wav(seconds=1.0, rate=16000, channels=1, amplitude=8000):
    """Звук: меандр заданной громкости (amplitude=0 — тишина)."""
    count = int(rate * seconds) * channels
    half = struct.pack('<h', amplitude) * 40 + struct.pack('<h', -amplitude) * 40
    pcm = (half * (count // 80 + 1))[:count * 2]
    header = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack(
        '<IHHIIHH', 16, 1, channels, rate, rate * channels * 2, channels * 2, 16) + b'data' + struct.pack('<I', len(pcm))
    return header + pcm


@override_settings(**LOCAL_SETTINGS)
class AITestCase(RBACTestCase):
    def setUp(self):
        cache.clear()


class FailoverTests(AITestCase):
    MESSAGES = [{'role': 'user', 'content': 'ping'}]

    def test_local_model_is_used(self):
        with ollama('chat', {'*': 'да'}) as calls:
            self.assertEqual(router.chat(self.MESSAGES), ('да', LOCAL))
        self.assertEqual(calls.names(), [LOCAL])

    def test_local_failure_is_reported(self):
        with ollama('chat', {LOCAL: ProviderError('unavailable', 'offline')}):
            with self.assertRaises(router.AllProvidersFailed) as raised:
                router.chat(self.MESSAGES)
        self.assertEqual(raised.exception.attempts, [(LOCAL, 'сервис недоступен')])

    def test_only_local_provider_is_configured(self):
        self.assertEqual([p.name for p in router.providers()], [LOCAL])
        self.assertEqual([p.name for p in router.all_providers()], [LOCAL, 'faster-whisper'])

    def test_status_lists_local_chat_and_speech_providers(self):
        with (
            mock.patch.object(OllamaProvider, 'probe', return_value=HEALTHY),
            mock.patch.object(FasterWhisperProvider, 'probe', return_value={'available': True, 'error': ''}),
        ):
            rows = router.status()
        self.assertEqual([r['name'] for r in rows], [LOCAL, 'faster-whisper'])
        self.assertTrue(rows[1]['transcribe'])
        self.assertNotIn('gemini', str(rows).lower())

    def test_no_external_fallback_on_local_failure(self):
        fake = mock.Mock(status_code=503, headers={})
        fake.json.return_value = {'error': 'busy'}
        with mock.patch('assistant.providers.ollama.requests.post', return_value=fake) as post:
            with self.assertRaises(router.AllProvidersFailed) as raised:
                router.chat(self.MESSAGES)
        self.assertEqual(raised.exception.attempts, [(LOCAL, 'сервис недоступен')])
        self.assertEqual(post.call_count, 1)
        self.assertTrue(post.call_args.args[0].startswith('http://localhost:11434'))

    def test_transcription_uses_only_local_speech_recognition(self):
        with (
            mock.patch('assistant.providers.ollama.requests.post') as post,
            mock.patch.object(OllamaProvider, 'chat') as chat,
            mock.patch.object(FasterWhisperProvider, 'can_transcribe', return_value=True),
            mock.patch.object(FasterWhisperProvider, 'transcribe', return_value='распознанный текст'),
        ):
            self.assertEqual(router.transcribe(wav()), ('распознанный текст', 'faster-whisper'))
        post.assert_not_called()
        chat.assert_not_called()


class OllamaProviderTests(AITestCase):
    def response(self, code=200, body=None):
        fake = mock.Mock(status_code=code, headers={})
        fake.json.return_value = body if body is not None else {'message': {'content': ' Париж '}}
        return fake

    def test_request_is_local_and_uses_context_options(self):
        provider = OllamaProvider()
        messages = [{'role': 'system', 'content': 'Отвечай кратко.'}, {'role': 'user', 'content': 'Столица Франции?'}]
        with mock.patch('assistant.providers.ollama.requests.post', return_value=self.response()) as post:
            self.assertEqual(provider.chat(messages, json_mode=True), 'Париж')
        url = post.call_args.args[0]
        self.assertTrue(url.startswith('http://localhost:11434'))
        body = post.call_args.kwargs['json']
        self.assertEqual(body['model'], 'qwen3:4b')
        self.assertFalse(body['think'])
        self.assertEqual(body['format'], 'json')
        self.assertEqual(body['keep_alive'], '5m')
        self.assertEqual(body['options']['num_ctx'], 4096)
        self.assertEqual(body['options']['temperature'], 0.2)
        self.assertEqual(body['options']['num_predict'], 900)

    def test_transient_timeout_is_retried_once(self):
        with override_settings(OLLAMA_CHAT_RETRIES=1, OLLAMA_RETRY_BACKOFF=0):
            with mock.patch('assistant.providers.ollama.requests.post',
                            side_effect=[requests.Timeout('slow'), self.response()]) as post:
                self.assertEqual(OllamaProvider().chat([{'role': 'user', 'content': 'x'}]), 'Париж')
        self.assertEqual(post.call_count, 2)

    def test_timeout_gives_up_after_bounded_retry(self):
        with override_settings(OLLAMA_CHAT_RETRIES=1, OLLAMA_RETRY_BACKOFF=0):
            with mock.patch('assistant.providers.ollama.requests.post', side_effect=requests.Timeout('slow')) as post:
                with self.assertRaises(ProviderError) as raised:
                    OllamaProvider().chat([{'role': 'user', 'content': 'x'}])
        self.assertEqual((raised.exception.kind, post.call_count), ('unavailable', 2))

    def test_missing_model_is_not_retried(self):
        with override_settings(OLLAMA_CHAT_RETRIES=1, OLLAMA_RETRY_BACKOFF=0):
            with mock.patch('assistant.providers.ollama.requests.post',
                            return_value=self.response(404, {'error': 'model "qwen3:4b" not found'})) as post:
                with self.assertRaises(ProviderError) as raised:
                    OllamaProvider().chat([{'role': 'user', 'content': 'x'}])
        self.assertEqual((raised.exception.kind, post.call_count), ('model', 1))

    def test_probe_reports_healthy_model(self):
        tags = mock.Mock(status_code=200)
        tags.json.return_value = {'models': [{'name': 'qwen3:4b'}]}
        with mock.patch('assistant.providers.ollama.requests.get', return_value=tags):
            self.assertEqual(OllamaProvider().probe(), HEALTHY)

    def test_probe_reports_missing_model(self):
        tags = mock.Mock(status_code=200)
        tags.json.return_value = {'models': [{'name': 'llama3:8b'}]}
        with mock.patch('assistant.providers.ollama.requests.get', return_value=tags):
            result = OllamaProvider().probe()
        self.assertFalse(result['available'])
        self.assertFalse(result['model_installed'])
        self.assertIn('qwen3:4b', result['error'])


class StatusTests(AITestCase):
    def test_only_local_provider_is_exposed(self):
        self.login(self.admin)
        with mock.patch.object(OllamaProvider, 'probe', return_value=HEALTHY):
            body = str(self.client.get('/api/ai/status/').data)
        self.assertNotIn('gemini', body.lower())
        self.assertNotIn('key-one', body)
        self.assertIn(LOCAL, body)

    def test_employee_sees_only_availability(self):
        self.login(self.emp1)
        with mock.patch.object(OllamaProvider, 'probe', return_value=HEALTHY):
            data = self.client.get('/api/ai/status/').data
        self.assertNotIn('providers', data)
        self.assertTrue(data['chat_available'])
        self.assertFalse(data['transcribe_available'])

    def test_unavailable_ollama_is_reported(self):
        self.login(self.emp1)
        down = {'available': False, 'model_installed': False, 'error': 'Ollama недоступна'}
        with mock.patch.object(OllamaProvider, 'probe', return_value=down):
            data = self.client.get('/api/ai/status/').data
        self.assertFalse(data['chat_available'])

    def test_only_admin_can_reset_pauses(self):
        self.login(self.pm1)
        self.assertEqual(self.client.post('/api/ai/status/').status_code, 403)
        self.login(self.admin)
        with mock.patch.object(OllamaProvider, 'probe', return_value=HEALTHY):
            self.assertEqual(self.client.post('/api/ai/status/').status_code, 200)


class TranscribeTests(AITestCase):
    def send(self, data, name='speech.wav', language='ru'):
        return self.client.post(
            '/api/ai/transcribe/',
            {'audio': SimpleUploadedFile(name, data), 'language': language},
            format='multipart',
        )

    def test_speech_is_sent_only_to_local_faster_whisper(self):
        self.login(self.emp1)
        with (
            mock.patch('assistant.providers.ollama.requests.post') as post,
            mock.patch.object(OllamaProvider, 'chat') as chat,
            mock.patch.object(FasterWhisperProvider, 'can_transcribe', return_value=True),
            mock.patch.object(FasterWhisperProvider, 'transcribe', return_value='распознанная речь') as transcribe,
        ):
            res = self.send(wav())
        self.assertEqual((res.status_code, res.data['text'], res.data['provider']),
                         (200, 'распознанная речь', 'faster-whisper'))
        transcribe.assert_called_once_with(wav(), language='ru')
        post.assert_not_called()
        chat.assert_not_called()

        self.assertEqual(AIRequestLog.objects.get().provider, 'faster-whisper')

    def test_invalid_language_is_rejected(self):
        self.login(self.emp1)
        response = self.send(wav(), language='fr')

        self.assertEqual(response.status_code, 400)
        self.assertIn('Выберите', response.data['error'])

    def test_silence_is_not_sent_for_recognition(self):
        self.login(self.emp1)
        with (
            mock.patch('assistant.providers.ollama.requests.post') as post,
            mock.patch.object(OllamaProvider, 'chat') as chat,
        ):
            res = self.send(wav(amplitude=0))
        self.assertEqual((res.status_code, res.data['text']), (200, ''))
        post.assert_not_called()
        chat.assert_not_called()

    def test_only_expected_audio_is_accepted(self):
        self.login(self.emp1)
        with (
            mock.patch('assistant.providers.ollama.requests.post') as post,
            mock.patch.object(OllamaProvider, 'chat') as chat,
        ):
            self.assertEqual(self.send(b'not audio at all').status_code, 400)
            self.assertEqual(self.send(wav(rate=44100)).status_code, 400)
            self.assertEqual(self.send(wav(channels=2)).status_code, 400)
            self.assertEqual(self.send(wav(seconds=61)).status_code, 400)
        post.assert_not_called()
        chat.assert_not_called()


class TaskDraftTests(AITestCase):
    DOWN = {LOCAL: ProviderError('unavailable', 'offline')}

    def draft(self, text, **extra):
        return self.client.post('/api/ai/task-draft/', {'text': text, **extra}, format='json')

    def test_draft_is_built_from_model_answer(self):
        python = Skill.objects.create(name='Python')
        EmployeeSkill.objects.create(employee=self.emp1.profile, skill=python, level=4)
        self.login(self.pm1)
        answer = ('```json\n{"title": "Подготовить отчёт", "description": "по продажам", "project": "A", '
                  '"block": "Этап 1", "priority": "HIGH", "estimated_hours": 6, "due_date": null, '
                  '"skills": ["Python", "Несуществующий"], "assignee": "emp2"}\n```')
        with ollama('chat', {'*': answer}) as calls:
            res = self.draft('Нужно подготовить отчёт по продажам в проекте A, часов на шесть, пусть emp2 сделает')
        self.assertEqual(res.status_code, 200)
        draft = res.data['draft']
        self.assertEqual((draft['title'], draft['project_id'], draft['block_id'], draft['priority'], draft['estimated_hours']),
                         ('Подготовить отчёт', self.project_a.id, self.block_a.id, 'HIGH', 6.0))
        self.assertEqual(draft['skill_ids'], [python.id])          # выдуманный навык отброшен
        self.assertEqual(res.data['provider'], LOCAL)
        # названный человек — первый; пул кандидатов общий, как у сохранённой задачи
        self.assertEqual(res.data['candidates'][0]['user_id'], self.emp2.id)
        self.assertLessEqual(len(res.data['candidates']), 4)
        self.assertIn(self.emp1.id, {c['user_id'] for c in res.data['candidates']})
        # нейросети не уходят ни ставки, ни сведения о сотрудниках, ни чужие проекты
        sent = calls.sent()
        self.assertNotIn('hourly', sent)
        self.assertNotIn('emp1', sent)
        self.assertNotIn('- B:', sent)
        self.assertIn('- A:', sent)
        self.assertEqual(Task.objects.filter(name='Подготовить отчёт').count(), 0)   # ничего не создано
        # предлагаются только процессы доступного проекта
        self.assertEqual([p['id'] for p in res.data['processes']], [self.workflow_a.id])

    def test_draft_separates_work_from_service_instructions(self):
        sql = Skill.objects.create(name='SQL')
        pandas = Skill.objects.create(name='Pandas')
        self.login(self.pm1)
        instruction = (
            'Создай черновик задачи для проекта A: интегрировать модель прогнозирования загрузки '
            'с использованием SQL и Pandas. Срок выполнения — 22 марта 2027 года. '
            'Подбери трёх наиболее подходящих сотрудников. Покажи рекомендации до создания и назначения задачи. '
            'Не создавай задачу до подтверждения.'
        )
        answer = json.dumps({
            'title': 'Создай черновик задачи для проекта A: интеграция модели прогнозирования загрузки с SQL и Pandas',
            'description': instruction,
            'project': 'A',
            'priority': 'MEDIUM',
            'due_date': None,
            'skills': [],
        }, ensure_ascii=False)
        with ollama('chat', {'*': answer}):
            res = self.draft(instruction)
        self.assertEqual(res.status_code, 200)
        draft = res.data['draft']
        self.assertEqual(
            draft['description'],
            'интегрировать модель прогнозирования загрузки с использованием SQL и Pandas.',
        )
        self.assertNotIn('Создай', draft['title'])
        for phrase in ('Подбери', 'Покажи', 'Не создавай', 'Срок'):
            self.assertNotIn(phrase, draft['description'])
        self.assertEqual(draft['due_date'], '2027-03-22')
        self.assertEqual(set(draft['skill_ids']), {sql.id, pandas.id})

    def test_fallback_cleans_service_instructions(self):
        self.login(self.pm1)
        text = (
            'Создай черновик задачи для проекта A: обновить регламент. '
            'Срок выполнения — 22 марта 2027 года. Подбери трёх сотрудников. '
            'Не создавай задачу до подтверждения.'
        )
        with ollama('chat', self.DOWN):
            res = self.draft(text)
        self.assertTrue(res.data['degraded'])
        self.assertEqual(res.data['draft']['title'], 'Обновить регламент.')
        self.assertEqual(res.data['draft']['description'], 'обновить регламент.')
        self.assertEqual(res.data['draft']['due_date'], '2027-03-22')

    def test_draft_does_not_create_records_before_confirmation(self):
        self.login(self.pm1)
        before = (Task.objects.count(), WorkflowTask.objects.count(), ProjectMember.objects.count())
        with ollama('chat', {'*': '{"title": "T", "project": "A"}'}):
            res = self.draft('Сделать задачу')
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['draft']['project_id'])
        self.assertEqual(res.data['project_resolution'], 'missing')
        self.assertTrue(res.data['warnings'][0].startswith('Проект не указан.'))
        self.assertEqual(
            (Task.objects.count(), WorkflowTask.objects.count(), ProjectMember.objects.count()),
            before,
        )

    def test_named_process_or_plan_sets_the_destination(self):
        self.login(self.pm1)
        with ollama('chat', {'*': '{"title": "T", "project": "A", "target": "process", "process": "Процесс A"}'}) as calls:
            draft = self.draft('добавь в процесс Процесс A задачу проверить форму в проекте A').data['draft']
        self.assertEqual((draft['destination'], draft['process_id']), ('process', self.workflow_a.id))
        self.assertIn('процессы: Процесс A', calls.sent())
        with ollama('chat', {'*': '{"title": "T", "project": "A", "target": "plan", "block": "Этап 1"}'}):
            draft = self.draft('добавь в план в этап один задачу проекта A').data['draft']
        self.assertEqual((draft['destination'], draft['block_id'], draft['process_id']), ('plan', self.block_a.id, None))
        # место не названо — решает интерфейс; чужой процесс подставить нельзя
        with ollama('chat', {'*': '{"title": "T", "project": "A", "process": "Чужой процесс"}'}):
            draft = self.draft('сделать задачу').data['draft']
        self.assertEqual((draft['destination'], draft['process_id']), (None, None))
        # без нейросети слова «в процесс» тоже понимаются
        with ollama('chat', self.DOWN):
            self.assertEqual(self.draft('Добавь в процесс задачу: проверить форму').data['draft']['destination'], 'process')

    def test_new_process_is_proposed_when_asked(self):
        self.login(self.pm1)
        with ollama('chat', {'*': '{"title": "T", "project": "A", "target": "process", "new_process": "Game Toys"}'}):
            draft = self.draft('создай процесс Game Toys в проекте A и добавь задачу').data['draft']
        self.assertEqual((draft['destination'], draft['process_id'], draft['new_process_name']), ('process', None, 'Game Toys'))
        # процесс с таким именем уже идёт — второй не создаём
        with ollama('chat', {'*': '{"title": "T", "project": "A", "new_process": "процесс a"}'}):
            draft = self.draft('создай процесс Процесс A и добавь задачу в проект A').data['draft']
        self.assertEqual((draft['process_id'], draft['new_process_name']), (self.workflow_a.id, None))

    def test_russian_name_finds_person_written_in_latin(self):
        from .services import name_match
        for said, stored in [('Иван Петров', 'Ivan Petrov'), ('Ивану Петрову', 'Ivan Petrov'), ('Алексей Иванов', 'Alexei Ivanov'),
                             ('Дмитрий Петров', 'Dmitri Petrov'), ('Марии Смирновой', 'Maria Smirnova'), ('Николай', 'Nikolai Volkov'),
                             ('Муслим Остонов', 'Muslim Ostonov'), ('София Лебедева', 'Sofia Lebedeva')]:
            self.assertEqual(name_match(said, stored), 1.0, said)
        self.assertEqual(name_match('Иван Петров', 'Dmitri Petrov'), 0.5)    # совпала только фамилия
        self.assertEqual(name_match('Сергей Кузнецов', 'Ivan Petrov'), 0.0)

        self.emp1.first_name, self.emp1.last_name = 'Ivan', 'Petrov'
        self.emp1.save()
        self.emp2.first_name, self.emp2.last_name = 'Dmitri', 'Petrov'
        self.emp2.save()
        self.login(self.pm1)
        with ollama('chat', {'*': '{"title": "T", "project": "A", "assignee": "Иван Петров"}'}):
            res = self.draft('пусть Иван Петров сделает задачу в проекте A')
        named = [c['user_id'] for c in res.data['candidates'] if c['named']]
        self.assertEqual(named, [self.emp1.id])
        self.assertEqual(res.data['candidates'][0]['user_id'], self.emp1.id)
        self.assertEqual(res.data['candidate_warnings'], [])
        # одна фамилия на двоих — не угадываем
        with ollama('chat', {'*': '{"title": "T", "project": "A", "assignee": "Петров"}'}):
            res = self.draft('пусть Петров сделает задачу в проекте A')
        self.assertEqual([c['user_id'] for c in res.data['candidates'] if c['named']], [])
        self.assertIn('подходит нескольким', res.data['candidate_warnings'][0])

    def test_candidates_for_another_project(self):
        self.login(self.pm1)
        res = self.client.post('/api/ai/candidates/', {'project_id': self.project_a.id, 'assignee_hint': 'emp2'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['candidates'][0]['user_id'], self.emp2.id)
        # чужой проект — пусто; исполнитель без права назначать — тоже
        self.assertEqual(self.client.post('/api/ai/candidates/', {'project_id': self.project_b.id}, format='json').data['candidates'], [])
        self.login(self.emp1)
        self.assertEqual(self.client.post('/api/ai/candidates/', {'project_id': self.project_a.id}, format='json').data['candidates'], [])

    def test_model_cannot_place_task_into_foreign_project(self):
        self.login(self.pm1)
        with ollama('chat', {'*': '{"title": "Взлом", "project": "B", "block": null}'}):
            res = self.draft('создай задачу в проекте B')
        self.assertIsNone(res.data['draft']['project_id'])
        self.assertEqual(res.data['project_resolution'], 'not_found')
        self.assertEqual([p['name'] for p in res.data['projects']], ['A'])

    def test_user_without_edit_right_gets_no_projects(self):
        self.login(self.emp1)
        with ollama('chat', {'*': '{"title": "Задача", "project": "A"}'}):
            res = self.draft('сделать что-нибудь в проекте A')
            self.assertFalse(res.data['can_create'])
            self.assertIsNone(res.data['draft']['project_id'])
            self.assertEqual(res.data['candidates'], [])
            # право «Правка задач» открывает проект, но кандидатов без права «Назначение» нет
            self.grant(self.member1, can_edit_tasks=True)
            res = self.draft('сделать что-нибудь в проекте A')
        self.assertEqual(res.data['draft']['project_id'], self.project_a.id)
        self.assertEqual(res.data['candidates'], [])

    def test_fallback_when_ollama_unavailable(self):
        self.login(self.pm1)
        with ollama('chat', self.DOWN):
            res = self.draft('Срочно починить выгрузку. Клиент ждёт до вечера.')
            second = self.draft('Обновить регламент, примерно 2,5 часа работы').data
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['degraded'])
        self.assertEqual(res.data['draft']['title'], 'Срочно починить выгрузку.')
        self.assertEqual(res.data['draft']['priority'], 'URGENT')
        self.assertEqual(len(res.data['attempts']), 1)
        self.assertEqual(second['draft']['estimated_hours'], 2.5)    # часы распознаются и без нейросети
        self.assertEqual(set(AIRequestLog.objects.values_list('provider', flat=True)), {''})

    def test_garbage_from_model_is_handled(self):
        self.login(self.pm1)
        with ollama('chat', {'*': 'Извините, не могу помочь'}):
            res = self.draft('Обновить документацию')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['draft']['title'], 'Обновить документацию')
        bad = '{"title": "X", "priority": "DROP TABLE", "estimated_hours": "много", "due_date": "вчера", "skills": "все"}'
        with ollama('chat', {'*': bad}):
            draft = self.draft('Обновить документацию').data['draft']
        self.assertEqual((draft['priority'], draft['estimated_hours'], draft['due_date'], draft['skill_ids']),
                         ('MEDIUM', None, None, []))


class LocalDraftProviderTests(AITestCase):
    def draft(self, text='Сделать задачу в проекте A'):
        return self.client.post('/api/ai/task-draft/', {'text': text}, format='json')

    def test_local_model_parses_draft_without_external_calls(self):
        self.login(self.pm1)
        answer = '{"title": "Локальная задача", "project": "A"}'
        with (
            mock.patch.object(OllamaProvider, 'chat', autospec=True, return_value=answer) as local,
            mock.patch('requests.post') as post,
        ):
            response = self.draft()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['provider'], LOCAL)
        self.assertEqual(response.data['draft']['title'], 'Локальная задача')
        self.assertEqual(local.call_count, 1)
        post.assert_not_called()

    def test_local_failure_returns_heuristic_with_retry_hint(self):
        self.login(self.pm1)
        with (
            mock.patch.object(
                OllamaProvider, 'chat', autospec=True,
                side_effect=ProviderError('unavailable', 'offline'),
            ) as local,
            mock.patch('requests.post') as post,
        ):
            response = self.draft()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data['provider'])
        self.assertTrue(response.data['degraded'])
        self.assertIn('Ollama', response.data['warnings'][0])
        self.assertEqual(response.data['attempts'], [{
            'provider': LOCAL,
            'reason': 'сервис недоступен',
            'code': 'unavailable',
        }])
        self.assertEqual(local.call_count, 1)
        post.assert_not_called()


class DraftCandidatesTests(AITestCase):
    def setUp(self):
        super().setUp()
        self.python = Skill.objects.create(name='Python')
        for user in (self.emp1, self.emp2, self.pm1):
            EmployeeSkill.objects.create(employee=user.profile, skill=self.python, level=3)
        self.login(self.pm1)

    def payload(self, **extra):
        return {
            'project_id': self.project_a.id,
            'title': 'Написать сервис на Python',
            'description': 'Нужен API и тесты',
            'due_date': '2030-02-01',
            'skill_ids': [self.python.id],
            **extra,
        }

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит: навыки подтверждены.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_returns_no_more_than_three_and_keeps_explanations(self, analyse, recommend_embeddings, explain):
        ProjectMember.objects.create(project=self.project_a, user=self.gm, role='DEVELOPER')
        EmployeeSkill.objects.create(employee=self.gm.profile, skill=self.python, level=3)
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        before = (
            Task.objects.count(), WorkflowTask.objects.count(), WorkloadEntry.objects.count(),
            EmployeeExperienceEmbedding.objects.count(), AIRequestLog.objects.count(),
        )
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 3)
        self.assertEqual(response.data['scoring']['top_limit'], 3)
        self.assertEqual(response.data['candidates'][0]['explanation'], 'Кандидат подходит: навыки подтверждены.')
        self.assertEqual(response.data['candidates'][0]['details']['explanation_source'], 'llm')
        after = (
            Task.objects.count(), WorkflowTask.objects.count(), WorkloadEntry.objects.count(),
            EmployeeExperienceEmbedding.objects.count(), AIRequestLog.objects.count(),
        )
        self.assertEqual(before, after)

    @override_settings(OLLAMA_EXPLANATION_TIMEOUT=0.1)
    @mock.patch('matching.recommendations.explain_candidate', side_effect=lambda *args, **kwargs: time.sleep(2) or 'Медленное объяснение.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_slow_explanations_do_not_block_top_three(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        started = time.monotonic()
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        elapsed = time.monotonic() - started
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 3)
        self.assertTrue(all(
            row['details']['explanation_source'] == 'deterministic'
            for row in response.data['candidates']
        ))
        self.assertEqual(explain.call_count, 3)
        self.assertLess(elapsed, 1.5)

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_returns_only_suitable_candidates_without_padding(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 3)
        excluded = response.data['excluded_candidates']
        self.assertTrue(any(row['employee_id'] == self.gm.profile.id for row in excluded))
        self.assertGreater(response.data['scoring']['excluded_count'], 0)

        EmployeeSkill.objects.filter(employee=self.pm1.profile).delete()
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 2)
        self.assertEqual(response.data['scoring']['eligible_count'], 2)
        self.assertGreater(response.data['scoring']['excluded_count'], 0)
        pm1_row = next(row for row in response.data['excluded_candidates'] if row['employee_id'] == self.pm1.profile.id)
        self.assertEqual(pm1_row['reasons'][0]['code'], 'missing_required_skills')

    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_zero_eligible_keeps_requirements_warning_and_exclusion_reasons(self, analyse, recommend_embeddings):
        rust = Skill.objects.create(name='Rust')
        analyse.return_value = {
            'skills': ['Rust'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        response = self.client.post(
            '/api/ai/draft-candidates/', self.payload(skill_ids=[rust.id]), format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['candidates'], [])
        self.assertEqual(response.data['requirements']['skills'], ['Rust'])
        self.assertEqual(response.data['scoring']['eligible_count'], 0)
        self.assertGreater(response.data['scoring']['excluded_count'], 0)
        self.assertTrue(any('обязательные условия' in warning for warning in response.data['warnings']))
        recommend_embeddings.assert_not_called()
        self.assertTrue(all(
            reason['message'].strip()
            for row in response.data['excluded_candidates']
            for reason in row['reasons']
        ))

    @mock.patch('matching.recommendations.explain_candidate', return_value='Детерминированный кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task', side_effect=OllamaUnavailable('offline'))
    def test_ollama_failure_degrades_to_deterministic_matching(self, analyse, recommend_embeddings, explain):
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['degraded'])
        self.assertTrue(any('детерминированный' in warning for warning in response.data['warnings']))
        self.assertEqual(len(response.data['candidates']), 3)
        self.assertEqual(response.data['requirements']['skills_source'], 'catalog_text_fallback')

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_missing_workload_records_are_reported_without_writes(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        self.assertEqual(WorkloadEntry.objects.count(), 0)
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        row = response.data['candidates'][0]
        self.assertFalse(row['details']['availability']['workload_known'])
        self.assertIsNone(row['details']['availability']['free_percent'])
        self.assertTrue(any('Нет записей загрузки' in gap for gap in row['data_gaps']))
        self.assertEqual(WorkloadEntry.objects.count(), 0)

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_project_without_employee_members_uses_global_pool(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        project = Project.objects.create(name='Только менеджер', manager=self.pm1)
        ProjectMember.objects.create(project=project, user=self.pm1, role='MANAGER')
        response = self.client.post(
            '/api/ai/draft-candidates/', self.payload(project_id=project.id), format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn(self.emp1.id, {row['user_id'] for row in response.data['candidates']})
        self.assertTrue(any(not row['already_member'] for row in response.data['candidates']))
        self.assertNotIn('нет участников', ' '.join(response.data['warnings']))

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task', side_effect=OllamaUnavailable('offline'))
    def test_skills_are_extracted_from_text_when_selection_is_empty(self, analyse, recommend_embeddings, explain):
        sql = Skill.objects.create(name='SQL')
        pandas = Skill.objects.create(name='Pandas')
        for user in (self.emp1, self.emp2, self.pm1):
            EmployeeSkill.objects.create(employee=user.profile, skill=sql, level=3)
            EmployeeSkill.objects.create(employee=user.profile, skill=pandas, level=3)
        response = self.client.post('/api/ai/draft-candidates/', self.payload(
            title='Интеграция SQL и Pandas',
            description='Нужно объединить выгрузки SQL и обработать их в Pandas',
            skill_ids=[],
        ), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(response.data['requirements']['skills']), {'SQL', 'Pandas'})
        self.assertEqual(response.data['requirements']['skills_source'], 'catalog_text_fallback')
        self.assertEqual(len(response.data['candidates']), 3)
        self.assertEqual(response.data['scoring']['eligible_count'], 3)

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_employee_unavailable_for_the_whole_period_is_excluded(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        EmployeeUnavailability.objects.create(
            employee=self.emp1.profile,
            start_date=datetime.date.today(),
            end_date=datetime.date(2030, 2, 1),
        )
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        excluded = next(row for row in response.data['excluded_candidates'] if row['employee_id'] == self.emp1.profile.id)
        self.assertIn('zero_availability', [reason['code'] for reason in excluded['reasons']])

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_unavailability_starting_on_deadline_keeps_candidate_with_warning(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        EmployeeUnavailability.objects.create(
            employee=self.emp1.profile,
            start_date=datetime.date(2030, 2, 1),
            end_date=datetime.date(2030, 2, 10),
        )
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        row = next(row for row in response.data['candidates'] if row['user_id'] == self.emp1.id)
        self.assertGreater(row['availability'], 0)
        self.assertTrue(any('Недоступен' in conflict for conflict in row['conflicts']))
        self.assertNotIn(
            self.emp1.profile.id,
            {excluded['employee_id'] for excluded in response.data['excluded_candidates']},
        )

    @mock.patch('matching.recommendations.explain_candidate', return_value='Кандидат подходит.')
    @mock.patch('matching.recommendations.recommendation_embeddings', side_effect=fake_recommendation_embeddings)
    @mock.patch('matching.recommendations.analyse_task')
    def test_excluded_candidates_have_structured_reasons(self, analyse, recommend_embeddings, explain):
        analyse.return_value = {
            'skills': ['Python'], 'skills_source': 'llm', 'task_type': 'backend',
            'complexity': 'medium', 'summary': 'Build API',
        }
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 200, response.data)
        excluded = response.data['excluded_candidates']
        self.assertEqual(response.data['scoring']['excluded_count'], len(excluded))
        self.assertTrue(excluded)
        for row in excluded:
            self.assertTrue(row['reasons'])
            self.assertTrue(all(reason.get('code') and reason.get('message') for reason in row['reasons']))
        gm_row = next(row for row in excluded if row['employee_id'] == self.gm.profile.id)
        self.assertIn('missing_required_skills', [reason['code'] for reason in gm_row['reasons']])
        self.assertTrue(any('Python' in reason['message'] for reason in gm_row['reasons']))

    def test_requires_assignment_permission(self):
        self.login(self.emp1)
        response = self.client.post('/api/ai/draft-candidates/', self.payload(), format='json')
        self.assertEqual(response.status_code, 403)

    def test_foreign_project_is_not_disclosed(self):
        response = self.client.post(
            '/api/ai/draft-candidates/', self.payload(project_id=self.project_b.id), format='json',
        )
        self.assertEqual(response.status_code, 404)


class AskTests(AITestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.public = KnowledgeMaterial.objects.create(
            title='Регламент отпусков', text_instruction='Заявление на отпуск подаётся за 14 дней.')
        cls.secret_a = KnowledgeMaterial.objects.create(
            title='ТЗ проекта A', project=cls.project_a, text_instruction='Бюджет на отпуск серверов — 5 млн.')
        cls.secret_b = KnowledgeMaterial.objects.create(
            title='ТЗ проекта B', project=cls.project_b, text_instruction='Секрет проекта B про отпуск.')

    def ask(self, question='Как оформить отпуск?'):
        with ollama('chat', {'*': 'За 14 дней [1].'}) as calls:
            res = self.client.post('/api/ai/ask/', {'question': question}, format='json')
        return res, calls.sent()

    def test_answer_uses_only_materials_the_user_may_see(self):
        # исполнитель без права «Файлы: просмотр» — только общая база
        self.grant(self.member1, can_view_files=False)
        self.login(self.emp1)
        res, sent = self.ask()
        self.assertEqual([s['id'] for s in res.data['sources']], [self.public.id])
        self.assertEqual(res.data['answer'], 'За 14 дней [1].')
        self.assertNotIn('5 млн', sent)
        self.assertNotIn('Секрет проекта B', sent)
        # с правом на файлы проекта A — добавляется его ТЗ, но не чужого проекта
        self.grant(self.member1, can_view_files=True)
        res, sent = self.ask()
        self.assertEqual({s['id'] for s in res.data['sources']}, {self.public.id, self.secret_a.id})
        self.assertNotIn('Секрет проекта B', sent)
        # руководитель проектов видит всё
        self.login(self.gm)
        res, _ = self.ask()
        self.assertEqual(len(res.data['sources']), 3)

    def test_nothing_found_does_not_call_the_model(self):
        self.login(self.emp1)
        with ollama('chat', {'*': 'x'}) as calls:
            res = self.client.post('/api/ai/ask/', {'question': 'квантовая хромодинамика'}, format='json')
        self.assertEqual(calls.names(), [])
        self.assertEqual(res.data['sources'], [])

    def test_fallback_returns_sources_without_answer(self):
        self.grant(self.member1, can_view_files=False)
        self.login(self.emp1)
        with ollama('chat', {LOCAL: ProviderError('unavailable', 'offline')}):
            res = self.client.post('/api/ai/ask/', {'question': 'Как оформить отпуск?'}, format='json')
        self.assertTrue(res.data['degraded'])
        self.assertEqual([s['id'] for s in res.data['sources']], [self.public.id])


class ThrottleTests(AITestCase):
    def test_ai_requests_are_rate_limited_per_user(self):
        self.login(self.emp1)
        with mock.patch('rest_framework.throttling.ScopedRateThrottle.get_rate', return_value='2/min'), \
                ollama('chat', {'*': '{"title": "t"}'}):
            codes = [self.client.post('/api/ai/task-draft/', {'text': 'сделать дело'}, format='json').status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

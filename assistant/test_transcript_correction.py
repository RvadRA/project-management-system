"""Database-free tests for optional local transcript correction."""
import json
import re
import struct
import unittest
from types import SimpleNamespace
from unittest import mock

import requests
from django.test import override_settings
from rest_framework import status

from assistant import router, services
from assistant.providers.base import ProviderError
from assistant.providers.ollama import OllamaProvider
from assistant.views import CorrectTranscriptView, _is_silent, _validate_wav


class TranscriptCorrectionTests(unittest.TestCase):
    def setUp(self):
        self.projects = [
            SimpleNamespace(id=1, name='[SYNTHV2] TASKS Retail'),
            SimpleNamespace(id=2, name='[SYNTHV2] Retail Analytics'),
        ]

    def test_resolves_full_and_prefixless_project_names_to_real_records(self):
        selected, status, matches = services._resolve_project(
            self.projects, 'Создать задачу для проекта [SYNTHV2] TASKS Retail',
            extracted_name='[SYNTHV2] TASKS Retail',
        )
        self.assertEqual((selected, status, matches), (self.projects[0], 'matched', [self.projects[0]]))

        selected, status, matches = services._resolve_project(
            self.projects, 'Сделать задачу для проекта TASKS Retail',
            extracted_name='TASKS Retail',
        )
        self.assertEqual((selected, status, matches), (self.projects[0], 'matched', [self.projects[0]]))

    def test_resolves_unique_partial_project_name_and_reports_ambiguous_matches(self):
        only_project = self.projects[:1]
        selected, status, matches = services._resolve_project(
            only_project, 'В проекте Retail создать экран', extracted_name='Retail',
        )
        self.assertEqual((selected, status, matches), (only_project[0], 'matched', only_project))
        self.assertEqual(
            services._resolve_project(only_project, 'В проекте Retail создать экран'),
            (None, 'missing', []),
        )

        selected, status, matches = services._resolve_project(
            self.projects, 'Для проекта Retail сделать задачу', extracted_name='Retail',
        )
        self.assertIsNone(selected)
        self.assertEqual(status, 'ambiguous')
        self.assertEqual(matches, self.projects)

    def test_project_resolution_distinguishes_missing_unmatched_and_invalid_id(self):
        self.assertEqual(
            services._resolve_project(
                self.projects, 'Добавить каталог товаров', extracted_name='Retail',
            ),
            (None, 'missing', []),
        )
        self.assertEqual(
            services._resolve_project(self.projects, 'Для проекта Unknown сделать задачу', 'Unknown'),
            (None, 'not_found', []),
        )
        self.assertEqual(
            services._resolve_project(self.projects, 'Добавить каталог', project_id='999'),
            (None, 'invalid_id', []),
        )
        self.assertEqual(
            services._resolve_project(self.projects, 'Добавить каталог', project_id='null'),
            (None, 'invalid_id', []),
        )

    def test_wav_validation_enforces_pcm_format_sixty_seconds_and_silence(self):
        def wav(seconds):
            audio_bytes = int(seconds * 16000 * 2)
            data = bytearray(44 + audio_bytes)
            data[0:4] = b'RIFF'
            data[8:12] = b'WAVE'
            data[12:16] = b'fmt '
            struct.pack_into('<HHI', data, 20, 1, 1, 16000)
            struct.pack_into('<H', data, 34, 16)
            struct.pack_into('<I', data, 40, audio_bytes)
            return bytes(data)

        sixty_seconds = wav(60)
        self.assertIsNone(_validate_wav(sixty_seconds))
        self.assertEqual(_validate_wav(wav(60) + b'\x00'), 'Запись длиннее 60 секунд.')
        self.assertTrue(_is_silent(sixty_seconds))
        self.assertFalse(_is_silent(sixty_seconds[:44] + struct.pack('<h', 800)))

    def test_assignee_suggestions_preserve_unknown_current_workload(self):
        employee = SimpleNamespace(
            id=5,
            user_id=7,
            user=SimpleNamespace(username='developer', get_full_name=lambda: 'Developer'),
            position='Backend developer',
        )
        candidate = SimpleNamespace(
            employee=employee,
            total_score=0.5,
            current_workload=0,
            conflicts=[],
            already_member=False,
            details={'availability': {'current_workload_known': False}},
        )
        warnings = []
        with (
            mock.patch('assistant.services.access.has_project_perm', return_value=True),
            mock.patch('matching.scoring.rank_candidates', return_value=[candidate]),
        ):
            rows = services.suggest_assignees(
                SimpleNamespace(),
                SimpleNamespace(end_date=None),
                [],
                None,
                None,
                warnings,
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['current_workload'], 0)
        self.assertFalse(rows[0]['current_workload_known'])

    @override_settings(
        OLLAMA_BASE_URL='http://localhost:11434',
        OLLAMA_CHAT_MODEL='qwen3:4b',
        OLLAMA_CHAT_TIMEOUT=45,
        OLLAMA_CHAT_RETRIES=1,
        OLLAMA_RETRY_BACKOFF=0,
    )
    def test_task_draft_chat_timeout_reports_timeout_code_and_configured_duration(self):
        with (
            mock.patch('assistant.providers.ollama.requests.post', side_effect=requests.Timeout) as post,
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            with self.assertRaises(router.AllProvidersFailed) as raised:
                router.chat(
                    [{'role': 'system', 'content': 'Кратко.'}, {'role': 'user', 'content': 'Черновик.'}],
                    temperature=0.1,
                    max_tokens=350,
                    json_mode=True,
                )

        self.assertEqual(raised.exception.diagnostics, [('ollama:qwen3:4b', 'timeout')])
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args.kwargs['timeout'], 45)
        self.assertEqual(post.call_args.kwargs['json']['options']['num_predict'], 350)
        self.assertFalse(post.call_args.kwargs['json']['stream'])
        logs = '\n'.join(captured.output)
        self.assertIn('stage=request attempt=1/2', logs)
        self.assertIn('stage=request attempt=2/2', logs)
        self.assertIn('duration_ms=', logs)
        self.assertIn('code=timeout', logs)

    def test_task_draft_failure_keeps_specific_diagnostic_code_and_safe_reason(self):
        failure = router.AllProvidersFailed(
            [('ollama:qwen3:4b', 'сервис недоступен')],
            [('ollama:qwen3:4b', 'timeout')],
        )

        attempts = services._task_draft_failure_attempts(failure)

        self.assertEqual(attempts, [{
            'provider': 'ollama:qwen3:4b',
            'reason': 'истекло время ожидания ответа (timeout)',
            'code': 'timeout',
        }])
        self.assertNotIn('Черновик.', str(attempts))

    def test_task_draft_response_validation_distinguishes_bad_json_and_bad_shape(self):
        self.assertEqual(services._task_draft_response(''), (None, 'empty_response'))
        self.assertEqual(services._task_draft_response('not JSON'), (None, 'invalid_json'))
        self.assertEqual(services._task_draft_response('[]'), (None, 'invalid_json_shape'))
        self.assertEqual(services._task_draft_response('{}'), (None, 'invalid_json_shape'))
        self.assertEqual(
            services._task_draft_response('{"title": 42, "description": ""}'),
            (None, 'invalid_json_shape'),
        )
        self.assertEqual(
            services._task_draft_response('{"title":"Черновик","description":""}'),
            ({'title': 'Черновик', 'description': ''}, ''),
        )
        self.assertEqual(
            services._task_draft_response('{"title":"Черновик"}'),
            ({'title': 'Черновик', 'description': ''}, ''),
        )

    def test_task_draft_keeps_provider_visible_when_its_response_is_rejected(self):
        result = {'provider': None, 'attempts': []}
        with self.assertLogs('ai', level='WARNING') as captured:
            parsed = services._process_task_draft_response(
                result,
                '{"title": 42, "description": ""}',
                'ollama:qwen3:4b',
            )

        self.assertIsNone(parsed)
        self.assertEqual(result['provider'], 'ollama:qwen3:4b')
        self.assertEqual(result['attempts'][0]['code'], 'invalid_json_shape')
        self.assertIn('stage=response_validation', '\n'.join(captured.output))
        self.assertNotIn('"title": 42', '\n'.join(captured.output))

    @override_settings(
        OLLAMA_BASE_URL='http://localhost:11434',
        OLLAMA_CHAT_MODEL='qwen3:4b',
        OLLAMA_CHAT_RETRIES=0,
    )
    def test_ollama_distinguishes_connection_http_decode_and_response_shape_failures(self):
        provider = OllamaProvider()
        messages = [{'role': 'user', 'content': 'Секретный текст поручения'}]

        with mock.patch('assistant.providers.ollama.requests.post', side_effect=requests.ConnectionError):
            with self.assertRaises(ProviderError) as raised:
                provider.chat(messages)
        self.assertEqual(raised.exception.code, 'connection_error')

        http_response = SimpleNamespace(
            status_code=503,
            headers={},
            json=lambda: {'error': 'internal detail'},
        )
        with mock.patch('assistant.providers.ollama.requests.post', return_value=http_response):
            with self.assertRaises(ProviderError) as raised:
                provider.chat(messages)
        self.assertEqual(raised.exception.code, 'http_503')

        malformed_response = SimpleNamespace(
            status_code=200,
            json=mock.Mock(side_effect=ValueError('private response')),
        )
        with (
            mock.patch('assistant.providers.ollama.requests.post', return_value=malformed_response),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            with self.assertRaises(ProviderError) as raised:
                provider.chat(messages)
        self.assertEqual(raised.exception.code, 'malformed_json')
        self.assertIn('stage=response_decode', '\n'.join(captured.output))
        self.assertNotIn('private response', '\n'.join(captured.output))

        invalid_shape_response = SimpleNamespace(
            status_code=200,
            json=lambda: {'unexpected': 'shape'},
        )
        with (
            mock.patch('assistant.providers.ollama.requests.post', return_value=invalid_shape_response),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            with self.assertRaises(ProviderError) as raised:
                provider.chat(messages)
        self.assertEqual(raised.exception.code, 'invalid_response_shape')
        self.assertIn('stage=response_validation', '\n'.join(captured.output))
        self.assertNotIn('Секретный текст поручения', '\n'.join(captured.output))

        empty_response = SimpleNamespace(
            status_code=200,
            json=lambda: {'message': {'content': '  '}},
        )
        with mock.patch('assistant.providers.ollama.requests.post', return_value=empty_response):
            with self.assertRaises(ProviderError) as raised:
                provider.chat(messages)
        self.assertEqual(raised.exception.code, 'empty_response')

    def test_heuristic_fallback_separates_short_title_and_description_without_guessing_fields(self):
        text = 'Разработать REST API, добавить авторизацию и написать модульные тесты'

        draft = services._heuristic_draft(text)

        self.assertEqual(draft['title'], 'Разработать REST API')
        self.assertEqual(draft['description'], text)
        self.assertIsNone(draft['project'])
        self.assertIsNone(draft['estimated_hours'])
        self.assertIsNone(draft['due_date'])
        self.assertIsNone(draft['target'])

    def test_heuristic_fallback_resolves_full_and_prefixless_project_names(self):
        projects = [
            SimpleNamespace(id=1, name='[SYNTHV2] TASKS Retail'),
            SimpleNamespace(id=2, name='[SYNTHV2] Retail Analytics'),
        ]
        for text in (
            'Создать задачу для проекта [SYNTHV2] TASKS Retail: проверить каталог',
            'Создать задачу для проекта TASKS Retail: проверить каталог',
        ):
            with self.subTest(text=text):
                draft = services._heuristic_draft(text, projects)
                selected, resolution, matches = services._resolve_project(
                    projects, text, extracted_name=draft['project'],
                )
                self.assertEqual(draft['project'], projects[0].name)
                self.assertEqual((selected, resolution, matches), (projects[0], 'matched', [projects[0]]))

    def test_heuristic_fallback_keeps_partial_project_ambiguous_and_requires_explicit_context(self):
        projects = [
            SimpleNamespace(id=1, name='[SYNTHV2] TASKS Retail'),
            SimpleNamespace(id=2, name='[SYNTHV2] Retail Analytics'),
        ]
        ambiguous_text = 'Для проекта Retail проверить каталог'
        draft = services._heuristic_draft(ambiguous_text, projects)
        selected, resolution, matches = services._resolve_project(
            projects, ambiguous_text, extracted_name=draft['project'],
        )
        self.assertEqual(draft['project'], 'retail')
        self.assertIsNone(selected)
        self.assertEqual(resolution, 'ambiguous')
        self.assertEqual(matches, projects)

        unmentioned = services._heuristic_draft('Проверить Retail отчёт', projects)
        self.assertIsNone(unmentioned['project'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_corrects_storefront_example_without_changing_numbers(self):
        original = (
            'создать интернет-магазин на реакт, использовать тайв скрип и пускалерской сквл, '
            'добавить каталлок товаров и корзину, напись 80 тестов срок в 4 рабочих дни'
        )
        corrected = (
            'Создать интернет-магазин на React, использовать TypeScript и PostgreSQL. '
            'Добавить каталог товаров и корзину, написать 80 тестов. Срок — в 4 рабочих дня.'
        )
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': corrected}), 'ollama:qwen3:4b'),
        ) as chat:
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertEqual(result['original'], original)
        self.assertEqual(result['suggested'], corrected)
        self.assertIn('«в 4 рабочих дней» на «в 4 рабочих дня»', chat.call_args.args[0][0]['content'])
        self.assertIn('«тайв скрип» → TypeScript', chat.call_args.args[0][0]['content'])
        self.assertIn('пунктуацию', chat.call_args.args[0][0]['content'])
        self.assertEqual(
            re.findall(r'(?<!\w)\d+(?:[.,]\d+)?(?!\w)', corrected),
            ['80', '4'],
        )

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_rejects_response_that_changes_numeric_values(self):
        original = 'Написать 80 тестов за 4 рабочих дня.'
        altered = 'Написать 8 тестов за 4 рабочих дня.'
        with (
            mock.patch.object(
                router,
                'chat',
                return_value=(json.dumps({'corrected_text': altered}), 'ollama:qwen3:4b'),
            ),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('numeric_values_changed', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_keeps_unintelligible_phrase_and_requests_manual_review(self):
        original = (
            'Использовать React и PostgreSQL. '
            'Выключить сотрудника создания для воскресления.'
        )
        corrected = (
            'Использовать React и PostgreSQL. '
            'Выключить сотрудника создания для воскресления.'
        )
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': corrected}), 'ollama:qwen3:4b'),
        ) as chat:
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertIsNone(result['suggested'])
        self.assertEqual(result['original'], original)
        self.assertIn('Проверьте неоднозначные фрагменты вручную', result['error'])
        prompt = chat.call_args.args[0][0]['content']
        self.assertIn('неоднозначный/неразборчивый фрагмент', prompt)
        self.assertIn('uncertain_fragments', prompt)
        self.assertIn('requires_manual_review=true', prompt)

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_marks_ambiguous_asr_phrase_for_manual_review_without_guessing(self):
        original = 'Использовать rsip для назначения 3 и по этому назначению позвать получение.'
        uncertain = 'для назначения 3 и по этому назначению позвать получение'
        corrected = 'Использовать REST API для назначения 3 и по этому назначению позвать получение.'
        response = {
            'corrected_text': corrected,
            'requires_manual_review': True,
            'uncertain_fragments': [uncertain],
        }
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps(response), 'ollama:qwen3:4b'),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertTrue(result['requires_manual_review'])
        self.assertEqual(result['uncertain_fragments'], [uncertain])
        self.assertEqual(result['original'], original)
        self.assertIn(uncertain, result['suggested'])
        self.assertNotIn('позвать получение сотрудника', result['suggested'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_grammatical_rewrite_of_unknown_word_still_requires_manual_review(self):
        original = 'создание опозвателя, получение списка опозвателей и удаление опозвателя'
        corrected = 'Создание опознавателя, получение списка опознавателей и удаление опознавателя.'
        response = {
            'corrected_text': corrected,
            'requires_manual_review': True,
            'uncertain_fragments': [
                'опознавателя',
                'опознавателей',
                'опознавателя',
            ],
        }
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps(response), 'ollama:qwen3:4b'),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertTrue(result['requires_manual_review'])
        self.assertEqual(result['uncertain_fragments'], response['uncertain_fragments'])
        self.assertEqual(result['original'], original)
        self.assertEqual(result['suggested'], corrected)

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_nonempty_uncertain_fragments_force_manual_review(self):
        original = 'Добавить React и сохранить исходную формулировку.'
        response = {
            'corrected_text': 'Добавить React и сохранить исходную формулировку.',
            'requires_manual_review': False,
            'uncertain_fragments': ['сохранить исходную формулировку'],
        }
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps(response), 'ollama:qwen3:4b'),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertTrue(result['requires_manual_review'])
        self.assertEqual(result['uncertain_fragments'], ['сохранить исходную формулировку'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_does_not_guess_meaning_of_unintelligible_phrase_while_correcting_terms(self):
        original = (
            'Использовать Реакт и Постгрес. '
            'Выключить сотрудника создания для воскресления.'
        )
        corrected = (
            'Использовать React и PostgreSQL. '
            'Выключить сотрудника создания для воскресления.'
        )
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': corrected}), 'ollama:qwen3:4b'),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertEqual(result['original'], original)
        self.assertEqual(result['suggested'], corrected)
        self.assertIn('Выключить сотрудника создания для воскресления.', result['suggested'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_suggests_technical_corrections_from_transcript_only(self):
        original = (
            'Создать задачу для разработки Race IP на Django Race Framework. '
            'Добавить Postgre SQL, Python и модульные тесты. Не удалять старые данные; срок 12 дней.'
        )
        suggested = (
            'Создать задачу для разработки REST API на Django REST Framework. '
            'Добавить PostgreSQL, Python и модульные тесты. Не удалять старые данные; срок 12 дней.'
        )
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({
                'corrected_text': suggested,
                'requires_manual_review': False,
                'uncertain_fragments': [],
            }), 'ollama:qwen3:4b'),
        ) as chat:
            result = services.suggest_transcript_correction(original)

        self.assertEqual(
            result,
            {
                'original': original,
                'suggested': suggested,
                'available': True,
                'error': '',
                'requires_manual_review': False,
                'uncertain_fragments': [],
            },
        )
        messages = chat.call_args.args[0]
        self.assertEqual([message['role'] for message in messages], ['system', 'user'])
        self.assertEqual(messages[1]['content'], original)
        self.assertIn('REST API', messages[0]['content'])
        self.assertIn('джангу рейс Фреймгорг', messages[0]['content'])
        self.assertIn('Post Grace SQL', messages[0]['content'])
        self.assertIn('Пайтон', messages[0]['content'])
        self.assertIn('за ватрикас Ратсил', messages[0]['content'])
        self.assertIn('сроки', messages[0]['content'])
        self.assertIn('Не добавляй вступление', messages[0]['content'])
        self.assertIn('Не угадывай их значение', messages[0]['content'])
        self.assertEqual(chat.call_args.kwargs, {
            'temperature': 0,
            'max_tokens': 900,
            'think': False,
            'format_schema': {
                'type': 'object',
                'properties': {
                    'corrected_text': {'type': 'string'},
                    'requires_manual_review': {'type': 'boolean'},
                    'uncertain_fragments': {'type': 'array', 'items': {'type': 'string'}},
                },
                'required': ['corrected_text', 'requires_manual_review', 'uncertain_fragments'],
                'additionalProperties': False,
            },
        })
        chat.assert_called_once()

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_prior_voice_example_corrects_terms_in_place_and_preserves_uncertain_fragments(self):
        original = (
            'Создать задачу для разработки рейс Аэпп-Ай на джангу рейс Фреймгорг, '
            'с использованием Post Grace SQL, за ватрикас Ратсил, и авторизация ползателей, '
            'добавить проверку уходной данной, а по обработку афибок и на 50 модельные тесты, '
            'назначить сотрудника, который знает Пайтон, джангу имеет оп, тробот, особого данного '
            'и доступен для в полиной задачи в течении трех работчих дней.'
        )
        corrected = (
            'Создать задачу для разработки REST API на Django REST Framework, '
            'с использованием PostgreSQL, за ватрикас Ратсил, и авторизация ползателей, '
            'добавить проверку уходной данной, а по обработку афибок и на 50 модульные тесты, '
            'назначить сотрудника, который знает Python, джангу имеет оп, тробот, особого данного '
            'и доступен для в полиной задачи в течении трех работчих дней.'
        )
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': corrected}), 'ollama:qwen3:4b'),
        ) as chat:
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertEqual(result['original'], original)
        self.assertEqual(result['suggested'], corrected)
        prompt = chat.call_args.args[0][0]['content']
        self.assertIn('сохраняй порядок и границы предложений', prompt)
        self.assertIn('Никогда не переноси технологию', prompt)
        self.assertIn('Не добавляй опыт, навыки, сроки, требования или факты', prompt)
        for uncertain_fragment in ('за ватрикас Ратсил', 'джангу имеет оп, тробот', 'особого данного'):
            self.assertIn(uncertain_fragment, result['suggested'])
        self.assertIn('50 модельные тесты', original)
        self.assertIn('50 модульные тесты', result['suggested'])
        self.assertIn('трех работчих дней', result['suggested'])

    @override_settings(
        OLLAMA_BASE_URL='http://localhost:11434',
        OLLAMA_CHAT_MODEL='qwen3:4b',
        OLLAMA_KEEP_ALIVE=0,
        OLLAMA_NUM_CTX=4096,
        OLLAMA_CHAT_RETRIES=0,
    )
    def test_uses_existing_local_qwen_provider_and_memory_policy(self):
        original = 'Исправить Race IP.'
        response = mock.Mock(status_code=200)
        response.json.return_value = {
            'message': {'content': json.dumps({
                'corrected_text': 'Исправить REST API.',
                'requires_manual_review': False,
                'uncertain_fragments': [],
            })},
        }
        with mock.patch('assistant.providers.ollama.requests.post', return_value=response) as post:
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        payload = post.call_args.kwargs['json']
        self.assertEqual(payload['model'], 'qwen3:4b')
        self.assertEqual(payload['keep_alive'], 0)
        self.assertEqual(payload['options']['num_ctx'], 4096)
        self.assertEqual(payload['format'], {
            'type': 'object',
            'properties': {
                'corrected_text': {'type': 'string'},
                'requires_manual_review': {'type': 'boolean'},
                'uncertain_fragments': {'type': 'array', 'items': {'type': 'string'}},
            },
            'required': ['corrected_text', 'requires_manual_review', 'uncertain_fragments'],
            'additionalProperties': False,
        })
        self.assertFalse(payload['think'])
        self.assertEqual([message['role'] for message in payload['messages']], ['system', 'user'])
        self.assertEqual(payload['messages'][1]['content'], original)
        self.assertNotIn('audio', payload)

    @override_settings(
        OLLAMA_BASE_URL='http://localhost:11434',
        OLLAMA_CHAT_MODEL='qwen3:4b',
        OLLAMA_CHAT_RETRIES=0,
    )
    def test_ignores_separate_thinking_field_and_returns_only_message_content(self):
        original = 'Создать задачу для Race IP.'
        corrected = 'Создать задачу для REST API.'
        response = mock.Mock(status_code=200)
        response.json.return_value = {
            'message': {
                'thinking': 'Размышления модели: возможно, следует изменить текст.',
                'content': json.dumps({'corrected_text': corrected}),
            },
        }
        with mock.patch('assistant.providers.ollama.requests.post', return_value=response) as post:
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertEqual(result['suggested'], corrected)
        self.assertNotIn('Размышления', result['suggested'])
        self.assertFalse(post.call_args.kwargs['json']['think'])

    @override_settings(
        OLLAMA_BASE_URL='http://localhost:11434',
        OLLAMA_CHAT_MODEL='qwen3:4b',
        OLLAMA_CHAT_RETRIES=0,
    )
    def test_endpoint_returns_only_validated_corrected_text(self):
        original = 'Создать задачу для Race IP.'
        suggested = 'Создать задачу для REST API.'
        response = mock.Mock(status_code=200)
        response.json.return_value = {
            'message': {'content': json.dumps({
                'corrected_text': suggested,
                'requires_manual_review': False,
                'uncertain_fragments': [],
            })},
        }

        with (
            override_settings(OLLAMA_CHAT_MODEL='qwen3:4b'),
            override_settings(
                OLLAMA_BASE_URL='http://localhost:11434',
                OLLAMA_CHAT_RETRIES=0,
            ),
            mock.patch('assistant.providers.ollama.requests.post', return_value=response),
        ):
            endpoint_response = CorrectTranscriptView().post(
                SimpleNamespace(data={'text': original}),
            )

        self.assertEqual(endpoint_response.status_code, status.HTTP_200_OK)
        self.assertEqual(endpoint_response.data, {
            'original': original,
            'suggested': suggested,
            'available': True,
            'error': '',
            'requires_manual_review': False,
            'uncertain_fragments': [],
        })

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_does_not_expose_model_reasoning_as_a_correction(self):
        original = 'Создать задачу для Race IP.'
        verbose = 'Хорошо, давай разберусь. Сначала рассмотрю слово «Race», затем слово «IP».'
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': verbose}), 'ollama:qwen3:4b'),
        ), self.assertLogs('ai', level='WARNING') as captured:
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('reasoning_detected', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_extracts_only_corrected_text_from_structured_chat_content(self):
        original = 'Создать задачу для Race IP.'
        corrected = 'Создать задачу для REST API.'
        response = json.dumps({'corrected_text': corrected})
        with mock.patch.object(router, 'chat', return_value=(response, 'ollama:qwen3:4b')):
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertEqual(result['original'], original)
        self.assertEqual(result['suggested'], corrected)

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_rejects_unstructured_plain_text_from_ollama_chat(self):
        original = 'Создать задачу для Race IP.'
        corrected = 'Создать задачу для REST API.'
        with mock.patch.object(
            router,
            'chat',
            return_value=(corrected, 'ollama:qwen3:4b'),
        ), self.assertLogs('ai', level='WARNING') as captured:
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('invalid_json', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_does_not_expose_plain_text_analysis(self):
        original = 'Создать задачу для Race IP.'
        analysis = (
            'Сначала рассмотрю слово «Race», затем слово «IP». '
            'Возможно, автор имеет в виду REST API. Вероятно, нужна корректировка.'
        )
        with mock.patch.object(
            router,
            'chat',
            return_value=(analysis, 'ollama:qwen3:4b'),
        ), self.assertLogs('ai', level='WARNING') as captured:
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('invalid_json', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_reports_unchanged_natural_conditional_wording_as_no_correction(self):
        original = 'Добавить журналирование, если это возможно, потому что данные важны.'
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': original}), 'ollama:qwen3:4b'),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertIsNone(result['suggested'])
        self.assertEqual(result['original'], original)
        self.assertIn('Проверьте неоднозначные фрагменты вручную', result['error'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_identical_correction_is_reported_as_no_significant_changes(self):
        original = 'Создать задачу для REST API и добавить модульные тесты.'
        with (
            mock.patch.object(
                router,
                'chat',
                return_value=(json.dumps({'corrected_text': original}), 'ollama:qwen3:4b'),
            ),
            self.assertLogs('ai', level='INFO') as captured,
        ):
            result = services.suggest_transcript_correction(original)

        self.assertEqual(result, {
            'original': original,
            'suggested': None,
            'available': False,
            'error': (
                'Значимых исправлений не найдено. Исходный текст сохранён. '
                'Проверьте неоднозначные фрагменты вручную.'
            ),
            'requires_manual_review': True,
            'uncertain_fragments': [],
        })
        self.assertIn('transcript_correction_no_changes', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_whitespace_only_response_is_not_reported_as_a_correction(self):
        original = 'Создать задачу для REST API.'
        response = 'Создать задачу\nдля REST API.'
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': response}), 'ollama:qwen3:4b'),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertIsNone(result['suggested'])
        self.assertEqual(result['original'], original)
        self.assertIn('Проверьте неоднозначные фрагменты вручную', result['error'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_rejects_malformed_json_content(self):
        original = 'Создать задачу для Race IP.'
        response = '{"corrected_text": "REST API"'
        with (
            mock.patch.object(
                router,
                'chat',
                return_value=(response, 'ollama:qwen3:4b'),
            ),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('invalid_json', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_rejects_long_analysis_inside_corrected_text(self):
        original = 'Создать задачу для Race IP.'
        analysis = 'Хорошо, давай разберусь. ' + ('Сначала анализирую каждое слово. ' * 25)
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': analysis}), 'ollama:qwen3:4b'),
        ), self.assertLogs('ai', level='WARNING') as captured:
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('reasoning_detected', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_preserves_fragment_that_cannot_be_reliably_recovered(self):
        original = 'Добавить поддержку Race IP для [неразборчивый фрагмент] и написать тесты.'
        corrected = 'Добавить поддержку REST API для [неразборчивый фрагмент] и написать тесты.'
        with mock.patch.object(
            router,
            'chat',
            return_value=(json.dumps({'corrected_text': corrected}), 'ollama:qwen3:4b'),
        ) as chat:
            result = services.suggest_transcript_correction(original)

        self.assertTrue(result['available'])
        self.assertEqual(result['suggested'], corrected)
        self.assertIn('[неразборчивый фрагмент]', result['suggested'])
        self.assertIn('оставляй дословно и на том же месте', chat.call_args.args[0][0]['content'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_timeout_is_reported_without_logging_transcript(self):
        original = 'Секретный текст поручения.'
        with (
            override_settings(
                OLLAMA_BASE_URL='http://localhost:11434',
                OLLAMA_CHAT_RETRIES=0,
            ),
            mock.patch('assistant.providers.ollama.requests.post', side_effect=requests.Timeout),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertEqual(
            result['error'],
            'Не удалось получить исправленный текст: локальная ИИ-модель не ответила вовремя. '
            'Исходная расшифровка сохранена — попробуйте ещё раз или продолжите без исправлений',
        )
        self.assertNotIn('памят', result['error'].lower())
        self.assertIn('timeout', '\n'.join(captured.output))
        self.assertNotIn(original, '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_connection_failure_is_reported_without_memory_advice(self):
        original = 'Исходный текст.'
        with (
            override_settings(
                OLLAMA_BASE_URL='http://localhost:11434',
                OLLAMA_CHAT_RETRIES=0,
            ),
            mock.patch(
                'assistant.providers.ollama.requests.post',
                side_effect=requests.ConnectionError,
            ),
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertEqual(
            result['error'],
            'Не удалось связаться с локальной ИИ-моделью. '
            'Исходная расшифровка сохранена — попробуйте ещё раз или продолжите без исправлений',
        )
        self.assertNotIn('памят', result['error'].lower())

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_missing_model_returns_safe_message_and_preserves_original(self):
        original = 'Исходный текст поручения.'
        response = mock.Mock(status_code=404, headers={})
        response.json.return_value = {'error': 'model qwen3:4b not found'}
        with (
            override_settings(
                OLLAMA_BASE_URL='http://localhost:11434',
                OLLAMA_CHAT_RETRIES=0,
            ),
            mock.patch('assistant.providers.ollama.requests.post', return_value=response),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('локальная ИИ-модель сейчас недоступна', result['error'])
        self.assertNotIn('qwen3:4b', result['error'])
        self.assertNotIn(original, '\n'.join(captured.output))
        self.assertIn('model_not_found', '\n'.join(captured.output))
        self.assertNotIn('памят', result['error'].lower())

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_malformed_ollama_response_keeps_original_text(self):
        original = 'Исходный текст.'
        response = mock.Mock(status_code=200)
        response.json.return_value = {'message': {'content': '  '}}
        with (
            override_settings(
                OLLAMA_BASE_URL='http://localhost:11434',
                OLLAMA_CHAT_RETRIES=0,
            ),
            mock.patch('assistant.providers.ollama.requests.post', return_value=response),
            self.assertLogs('ai', level='WARNING') as captured,
        ):
            result = services.suggest_transcript_correction(original)

        self.assertFalse(result['available'])
        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertIn('локальная ИИ-модель вернула некорректный ответ', result['error'])
        self.assertNotIn('памят', result['error'].lower())
        self.assertIn('empty_response', '\n'.join(captured.output))

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_non_json_ollama_response_is_reported_safely(self):
        response = mock.Mock(status_code=200)
        response.json.side_effect = ValueError('invalid JSON')
        with (
            override_settings(
                OLLAMA_BASE_URL='http://localhost:11434',
                OLLAMA_CHAT_RETRIES=0,
            ),
            mock.patch('assistant.providers.ollama.requests.post', return_value=response),
        ):
            result = services.suggest_transcript_correction('Исходная расшифровка.')

        self.assertFalse(result['available'])
        self.assertIsNone(result['suggested'])
        self.assertIn('локальная ИИ-модель вернула некорректный ответ', result['error'])

    @override_settings(OLLAMA_CHAT_MODEL='qwen3:4b')
    def test_ollama_unavailable_returns_original_without_suggestion(self):
        original = 'Исходная расшифровка задачи.'
        failure = router.AllProvidersFailed([('ollama:qwen3:4b', 'сервис недоступен')])
        with mock.patch.object(router, 'chat', side_effect=failure):
            result = services.suggest_transcript_correction(original)

        self.assertEqual(result['original'], original)
        self.assertIsNone(result['suggested'])
        self.assertFalse(result['available'])
        self.assertIn('Исходная расшифровка сохранена', result['error'])

    @override_settings(OLLAMA_CHAT_MODEL='another-model')
    def test_does_not_call_a_different_configured_model(self):
        original = 'Текст поручения.'
        with mock.patch.object(router, 'chat') as chat:
            result = services.suggest_transcript_correction(original)

        self.assertEqual(result['original'], original)
        self.assertFalse(result['available'])
        self.assertIn('qwen3:4b', result['error'])
        chat.assert_not_called()

    def test_endpoint_accepts_only_text_and_returns_graceful_unavailable_result(self):
        original = 'Только текстовая расшифровка.'
        request = SimpleNamespace(data={'text': original})
        failure = router.AllProvidersFailed([('ollama:qwen3:4b', 'сервис недоступен')])
        with (
            override_settings(OLLAMA_CHAT_MODEL='qwen3:4b'),
            mock.patch.object(router, 'chat', side_effect=failure),
        ):
            response = CorrectTranscriptView().post(request)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['original'], original)
        self.assertFalse(response.data['available'])

    def test_endpoint_rejects_missing_text(self):
        response = CorrectTranscriptView().post(SimpleNamespace(data={}))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_endpoint_rejects_empty_text_without_calling_ollama(self):
        with mock.patch.object(router, 'chat') as chat:
            response = CorrectTranscriptView().post(SimpleNamespace(data={'text': ' \t '}))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        chat.assert_not_called()


if __name__ == '__main__':
    unittest.main()

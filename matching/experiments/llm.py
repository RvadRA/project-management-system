"""Direct local-LLM ranking adapter with strict JSON validation."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

PROMPT_VERSION = "direct_llm_v2"

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "ranking": {"type": "array", "items": {"type": "string"}},
        "reasons": {"type": "object", "additionalProperties": {"type": "string"}},
    },
    "required": ["ranking", "reasons"],
}


class LLMUnavailable(Exception):
    pass


@dataclass
class LLMRanking:
    ranking: List[str]
    reasons: Dict[str, str]
    latency_ms: float
    calls: int
    errors: List[str] = field(default_factory=list)
    raw_samples: List[str] = field(default_factory=list)


def _content_from_response(payload: dict) -> str:
    try:
        message = payload["message"]
        content = message.get("content")
    except (KeyError, TypeError, AttributeError) as exc:
        raise LLMUnavailable("Ollama returned an unexpected chat response.") from exc
    if not isinstance(content, str) or not content.strip():
        raise LLMUnavailable("Ollama returned empty content.")
    return content.strip()


def _load_json(text: str) -> dict:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        if candidate.lower().startswith("json"):
            candidate = candidate[4:].strip()
    try:
        value = json.loads(candidate)
    except ValueError as exc:
        raise LLMUnavailable(f"Ollama returned invalid JSON: {candidate[:240]!r}") from exc
    if not isinstance(value, dict):
        raise LLMUnavailable("Ollama JSON root is not an object.")
    return value


def _post(messages: Sequence[dict], model: str, timeout: int, seed: int) -> dict:
    import requests
    from django.conf import settings
    payload = {
        "model": model,
        "messages": list(messages),
        "stream": False,
        "format": RESPONSE_SCHEMA,
        "think": False,
        "options": {
            "temperature": 0,
            "seed": seed,
            "num_predict": 1200,
            "num_ctx": 16384,
        },
    }
    try:
        response = requests.post(
            f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()
    except requests.Timeout as exc:
        raise LLMUnavailable(f"Ollama timed out after {timeout}s.") from exc
    except requests.HTTPError as exc:
        try:
            detail = exc.response.json().get("error", "")
        except Exception:
            detail = ""
        raise LLMUnavailable(f"Ollama HTTP error: {detail or exc}") from exc
    except Exception as exc:
        raise LLMUnavailable(f"Ollama request failed: {exc}") from exc


def _prompt(task_payload: dict, candidates: Sequence[dict]) -> str:
    task_view = {
        key: task_payload.get(key)
        for key in (
            "title", "description", "task_type", "priority", "deadline",
            "estimated_hours", "domain", "required_skills",
        )
    }
    eligible_ids = [str(item["id"]) for item in candidates]
    return (
        "Ты помогаешь руководителю выбрать исполнителя задачи. "
        "Твой ответ — это ТОЛЬКО ранжирование кандидатов, а не описание задачи.\n"
        "Не копируй задачу в ответ. Не добавляй новых кандидатов. "
        "Не используй скрытые метки и не выдумывай данные.\n"
        "Верни JSON строго по схеме: "
        '{"ranking": ["ID1", "ID2", ...], "reasons": {"ID1": "краткое обоснование"}}.\n'
        f"В ranking должны быть все эти ID ровно один раз: {eligible_ids}.\n"
        "reasons — только для первых трёх ID рейтинга.\n"
        "В каждом reason укажи хотя бы один совпавший обязательный навык и доступность. "
        "Если workload_known=false, нельзя писать, что кандидат полностью свободен.\n\n"
        "ЗАДАЧА:\n" + json.dumps(task_view, ensure_ascii=False, sort_keys=True) + "\n\n"
        "КАНДИДАТЫ:\n" + json.dumps(list(candidates), ensure_ascii=False, sort_keys=True) + "\n\n"
        "Напоминание: ответ содержит ranking и reasons, а не поля задачи."
    )


def _validate(payload: dict, eligible_ids: Sequence[str]) -> tuple[List[str], Dict[str, str]]:
    ranking = payload.get("ranking")
    if isinstance(ranking, list):
        normalized = []
        for item in ranking:
            if isinstance(item, str):
                normalized.append(item)
            elif isinstance(item, dict):
                value = item.get("employee_id") or item.get("id")
                if isinstance(value, str):
                    normalized.append(value)
        ranking = normalized
    if not isinstance(ranking, list) or any(not isinstance(item, str) for item in ranking):
        raise LLMUnavailable("ranking must be a list of employee IDs.")
    if len(ranking) != len(set(ranking)):
        raise LLMUnavailable("ranking contains duplicate employee IDs.")
    if set(ranking) != set(eligible_ids):
        missing = sorted(set(eligible_ids) - set(ranking))
        extra = sorted(set(ranking) - set(eligible_ids))
        raise LLMUnavailable(
            f"ranking does not match the eligible pool; missing={missing[:5]}, extra={extra[:5]}"
        )
    reasons = payload.get("reasons") or {}
    if not isinstance(reasons, dict):
        reasons = {}
    cleaned = {}
    for key, value in reasons.items():
        if key in ranking[:3] and isinstance(value, str) and value.strip():
            cleaned[key] = " ".join(value.strip().split())[:400]
    return ranking, cleaned


def rank_with_llm(task_payload: dict, candidates: Sequence[dict],
                  eligible_ids: Sequence[str], model: str, timeout: int = 180,
                  seed: int = 42) -> LLMRanking:
    if not eligible_ids:
        return LLMRanking([], {}, 0.0, 0)
    messages = [
        {"role": "system", "content": "Return only valid JSON. Never invent candidate IDs."},
        {"role": "user", "content": _prompt(task_payload, candidates)},
    ]
    started = time.perf_counter()
    errors = []
    samples = []
    calls = 0
    last_error: Optional[Exception] = None
    for attempt in range(2):
        calls += 1
        try:
            payload = _post(messages, model=model, timeout=timeout, seed=seed)
            content = _content_from_response(payload)
            samples.append(content[:500])
            parsed = _load_json(content)
            ranking, reasons = _validate(parsed, eligible_ids)
            return LLMRanking(
                ranking=ranking,
                reasons=reasons,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
                calls=calls,
                errors=errors,
                raw_samples=samples,
            )
        except LLMUnavailable as exc:
            last_error = exc
            errors.append(str(exc))
            if attempt == 0:
                messages[1]["content"] += (
                    "\n\nPrevious answer was invalid: " + str(exc)
                    + "\nReturn the complete ranking of every eligible ID exactly once."
                )
    raise LLMUnavailable(
        f"Direct LLM failed after {calls} calls: {last_error}; errors={errors}"
    )

"""Embedding providers for the experiment.

The default provider is a deterministic feature-hashing encoder.  It is useful
for exercising the pipeline and is explicitly reported as
``synthetic_vectors=true``; it is not a substitute for a language model.

The optional Ollama provider calls the real local embedding model and is
reported separately with ``synthetic_vectors=false``.
"""
from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence

from .schema import Employee, HistoryTask, Task


TOKEN_RE = re.compile(r"[A-Za-zА-Яа-яЁё0-9+#/]+")
DEFAULT_HASH_DIM = 256


class EmbeddingUnavailable(Exception):
    pass


def _tokens(text: str) -> List[str]:
    return [item.lower() for item in TOKEN_RE.findall(text or "")]


def hashing_embedding(text: str, dimensions: int = DEFAULT_HASH_DIM) -> List[float]:
    vector = [0.0] * dimensions
    tokens = _tokens(text)
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = -1.0 if digest[4] & 1 else 1.0
        vector[index] += sign
    for left, right in zip(tokens, tokens[1:]):
        digest = hashlib.sha256(f"{left} {right}".encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        vector[index] += -1.0 if digest[4] & 1 else 1.0
    norm = math.sqrt(sum(value * value for value in vector))
    if norm:
        vector = [value / norm for value in vector]
    return vector


def cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    divisor = math.sqrt(sum(value * value for value in left)) * math.sqrt(
        sum(value * value for value in right)
    )
    if not divisor:
        return 0.0
    return max(0.0, sum(a * b for a, b in zip(left, right)) / divisor)


def task_text(task: Task) -> str:
    """Only fields available before assignment; target/scenario are excluded."""
    return "\n".join([
        f"Title: {task.title}",
        f"Description: {task.description}",
        f"Type: {task.task_type}",
        f"Domain: {task.domain}",
        "Required skills: " + ", ".join(item.name for item in task.required_skills),
    ])


def employee_text(employee: Employee, history: Sequence[HistoryTask]) -> str:
    skills = ", ".join(f"{item.name} level {item.level}" for item in employee.skills)
    completed = ", ".join(f"{item.title} ({item.domain})" for item in history[-25:])
    return "\n".join([
        f"Position: {employee.position}",
        f"Domain: {employee.domain}",
        f"Summary: {employee.summary}",
        f"Skills: {skills}",
        f"Completed tasks: {completed}",
    ])


@dataclass
class EmbeddingProvider:
    name: str
    synthetic_vectors: bool
    model: Optional[str] = None
    dimensions: Optional[int] = None

    def embed(self, text: str) -> List[float]:
        raise NotImplementedError

    def metadata(self) -> Dict[str, object]:
        return {
            "provider": self.name,
            "synthetic_vectors": self.synthetic_vectors,
            "model": self.model,
            "dimensions": self.dimensions,
        }


class HashingEmbeddingProvider(EmbeddingProvider):
    def __init__(self, dimensions: int = DEFAULT_HASH_DIM):
        super().__init__(
            name="hashing", synthetic_vectors=True, model=None, dimensions=dimensions,
        )
        self._cache: Dict[str, List[float]] = {}

    def embed(self, text: str) -> List[float]:
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if key not in self._cache:
            self._cache[key] = hashing_embedding(text, self.dimensions or DEFAULT_HASH_DIM)
        return self._cache[key]


class OllamaEmbeddingProvider(EmbeddingProvider):
    def __init__(self, model: Optional[str] = None):
        from django.conf import settings
        super().__init__(
            name="ollama",
            synthetic_vectors=False,
            model=model or settings.OLLAMA_EMBED_MODEL,
            dimensions=None,
        )
        self._cache: Dict[str, List[float]] = {}

    def embed(self, text: str) -> List[float]:
        import hashlib as _hashlib
        import requests
        from django.conf import settings
        key = _hashlib.sha256(text.encode("utf-8")).hexdigest()
        if key in self._cache:
            return self._cache[key]
        try:
            response = requests.post(
                f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/embed",
                json={"model": self.model, "input": text},
                timeout=settings.OLLAMA_TIMEOUT,
            )
            response.raise_for_status()
            payload = response.json()
            values = payload.get("embeddings")
            if not isinstance(values, list) or not values or not isinstance(values[0], list):
                raise EmbeddingUnavailable("Ollama returned no embedding.")
            vector = [float(item) for item in values[0]]
        except EmbeddingUnavailable:
            raise
        except Exception as exc:
            raise EmbeddingUnavailable(
                f"Local Ollama embedding request failed for model {self.model}: {exc}"
            ) from exc
        self._cache[key] = vector
        self.dimensions = len(vector)
        return vector


def build_provider(name: str) -> EmbeddingProvider:
    if name == "hashing":
        return HashingEmbeddingProvider()
    if name == "ollama":
        return OllamaEmbeddingProvider()
    raise ValueError(f"Unknown embedding provider: {name}")

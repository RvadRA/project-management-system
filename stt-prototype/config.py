"""Configuration for the standalone STT prototype."""
import os
from dataclasses import dataclass
from pathlib import Path


def _positive_int(name, default):
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("{} must be a positive integer.".format(name)) from exc
    if value < 1:
        raise ValueError("{} must be a positive integer.".format(name))
    return value


@dataclass(frozen=True)
class Settings:
    model: str
    cpu_threads: int
    beam_size: int
    max_audio_mb: int
    port: int
    model_cache: Path
    temp_dir: Path

    @classmethod
    def from_env(cls):
        model = os.environ.get("STT_MODEL", "base").strip()
        if not model:
            raise ValueError("STT_MODEL must not be empty.")
        return cls(
            model=model,
            cpu_threads=_positive_int("STT_CPU_THREADS", 2),
            beam_size=_positive_int("STT_BEAM_SIZE", 1),
            max_audio_mb=_positive_int("STT_MAX_AUDIO_MB", 25),
            port=_positive_int("STT_PORT", 8765),
            model_cache=Path(
                os.environ.get(
                    "STT_MODEL_CACHE",
                    str(Path.home() / ".cache" / "local-speech-studio" / "models"),
                )
            ).expanduser(),
            temp_dir=Path(
                os.environ.get(
                    "STT_TEMP_DIR",
                    str(Path.home() / ".cache" / "local-speech-studio" / "temp"),
                )
            ).expanduser(),
        )

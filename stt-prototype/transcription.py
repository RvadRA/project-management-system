"""Lazy, serialized CPU transcription with faster-whisper."""
import gc
import threading
import time
from pathlib import Path


SUPPORTED_LANGUAGES = frozenset(("auto", "en", "ru", "uz"))
_INFERENCE_LOCK = threading.Lock()


class InferenceBusyError(Exception):
    """Another transcription is already in progress."""


class TranscriptionError(Exception):
    """A model or audio decoding failure safe to show in the local UI."""


def transcribe_file(audio_path, language, settings):
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError("Choose auto, en, ru, or uz for the language.")
    if not _INFERENCE_LOCK.acquire(blocking=False):
        raise InferenceBusyError("A transcription is already in progress.")

    model = None
    started_at = time.monotonic()
    try:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise TranscriptionError(
                "Speech recognition is not installed in this prototype environment. "
                "Install stt-prototype/requirements.txt in its isolated environment."
            ) from exc

        settings.model_cache.mkdir(parents=True, exist_ok=True)
        model = WhisperModel(
            settings.model,
            device="cpu",
            compute_type="int8",
            cpu_threads=settings.cpu_threads,
            num_workers=1,
            download_root=str(settings.model_cache),
        )
        segments, info = model.transcribe(
            str(Path(audio_path)),
            language=None if language == "auto" else language,
            beam_size=settings.beam_size,
            vad_filter=True,
        )
        text = " ".join(
            segment.text.strip()
            for segment in segments
            if segment.text and segment.text.strip()
        )
        elapsed = time.monotonic() - started_at
        return {
            "text": text,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 4),
            "audio_seconds": round(float(info.duration), 2),
            "processing_seconds": round(elapsed, 2),
        }
    except (OSError, RuntimeError, ValueError) as exc:
        raise TranscriptionError(
            "Transcription failed: {}".format(str(exc) or type(exc).__name__)
        ) from exc
    finally:
        if model is not None:
            del model
            gc.collect()
        _INFERENCE_LOCK.release()

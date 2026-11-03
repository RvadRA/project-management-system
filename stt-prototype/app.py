"""Loopback-only FastAPI server for Local Speech Studio."""
import os
import tempfile
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import Settings
from transcription import (
    InferenceBusyError,
    SUPPORTED_LANGUAGES,
    TranscriptionError,
    transcribe_file,
)


BASE_DIR = Path(__file__).resolve().parent
settings = Settings.from_env()
MAX_AUDIO_BYTES = settings.max_audio_mb * 1024 * 1024
ALLOWED_EXTENSIONS = frozenset(
    (".aac", ".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm")
)

app = FastAPI(
    title="Local Speech Studio",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/api/config")
def get_config():
    return {
        "max_audio_mb": settings.max_audio_mb,
        "model": settings.model,
        "languages": sorted(SUPPORTED_LANGUAGES),
    }


@app.post("/api/transcribe")
def transcribe(file: UploadFile = File(...), language: str = Form("auto")):
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail="Language must be auto, en, ru, or uz.",
        )
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        file.file.close()
        raise HTTPException(
            status_code=415,
            detail="Unsupported audio format. Use WAV, MP3, M4A, MP4, OGG, FLAC, AAC, or WebM.",
        )

    temp_path = None
    try:
        settings.temp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix="recording-",
            suffix=suffix,
            dir=str(settings.temp_dir),
            delete=False,
        ) as audio_file:
            temp_path = Path(audio_file.name)
            total_bytes = 0
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_AUDIO_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Audio file exceeds the {} MB limit.".format(
                            settings.max_audio_mb
                        ),
                    )
                audio_file.write(chunk)

        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="The audio file is empty.")

        return transcribe_file(temp_path, language, settings)
    except InferenceBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TranscriptionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        file.file.close()
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


app.mount(
    "/static",
    StaticFiles(directory=str(BASE_DIR / "static")),
    name="static",
)


if __name__ == "__main__":
    port = int(os.environ.get("STT_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)

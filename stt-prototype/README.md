# Local Speech Studio

Standalone, local-only speech-to-text prototype for Windows. It is not wired
into ProJectMS and does not access its database, `.env`, tasks, assignments,
projects, or Ollama.

The browser records audio or uploads a local audio file. A separate Python
service transcribes it with `faster-whisper` on the CPU; the transcript is
editable and can be copied. Audio is held in a temporary file only while a
transcription is running and is then deleted. Transcripts are kept only in the
open browser page.

## Requirements

- Windows 11 and Python 3.9 or newer. Python 3.9 is sufficient for the
  dependencies below.
- Internet access the first time a model is requested. The `base` model is
  downloaded lazily on the first transcription, not when the server starts.
  After its download, transcription can work offline.
- A modern browser for microphone recording. Microphone access is available
  from `localhost`; file upload does not require a microphone.

`faster-whisper` uses PyAV to decode audio; a separate FFmpeg installation is
not required. PyAV is constrained to versions below 19 because the pinned
`faster-whisper` release still passes an option removed in PyAV 19. The first
model download can take time. A downloaded model is cached outside this
project in the user's home directory.

## Create the isolated environment

Run these commands from this directory in PowerShell. They create an
environment for this prototype only; do not activate or install these
dependencies into the Django environment.

```powershell
py -3.9 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PowerShell blocks activation, invoke the environment's Python directly:

```powershell
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Run

```powershell
.\venv\Scripts\python.exe app.py
```

Open <http://127.0.0.1:8765>. Stop the server with `Ctrl+C`. It binds to
loopback only and does not expose a network service to other machines.

The server starts without importing or loading the speech model. The first
transcription may download the configured model. Close the server after use;
each transcription creates and releases its own model instance.

## Prototype settings

Set these environment variables in the same PowerShell session before starting
the server. Defaults are intentionally small and CPU-only.

| Variable | Default | Purpose |
| --- | --- | --- |
| `STT_MODEL` | `base` | Multilingual Whisper model; `small` can be evaluated separately. |
| `STT_CPU_THREADS` | `2` | CPU threads for the model. |
| `STT_BEAM_SIZE` | `1` | Beam size for decoding. |
| `STT_MAX_AUDIO_MB` | `25` | Maximum accepted audio file size. |
| `STT_PORT` | `8765` | Local web server port. |

The model uses `device=cpu` and `compute_type=int8`. The language selector
supports automatic detection, English, Russian, and Uzbek (`en`, `ru`, `uz`).
Language quality, especially Uzbek and technical vocabulary, has not yet been
benchmarked in this prototype.

## Checks

Run the small unit suite without loading or downloading any model:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

These tests use a fake model implementation. They do not measure recognition
quality, latency, or RAM. Benchmark those separately using representative
recordings before considering integration into ProJectMS.

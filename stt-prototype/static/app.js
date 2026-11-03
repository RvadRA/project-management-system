const recordButton = document.querySelector("#record-button");
const recordLabel = document.querySelector("#record-label");
const uploadButton = document.querySelector("#upload-button");
const audioFile = document.querySelector("#audio-file");
const transcript = document.querySelector("#transcript");
const transcriptMeta = document.querySelector("#transcript-meta");
const statusMessage = document.querySelector("#status-message");
const errorMessage = document.querySelector("#error-message");
const progress = document.querySelector("#progress");
const progressLabel = document.querySelector("#progress-label");
const copyButton = document.querySelector("#copy-button");
const clearButton = document.querySelector("#clear-button");

let MAX_AUDIO_MB = 25;
let activeRecorder = null;
let recordingStartedAt = 0;
let timerHandle = null;
let working = false;
let recordingPending = false;
let discardRecording = false;

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  setStatus("The audio could not be transcribed.", true);
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
  statusMessage.classList.remove("is-error");
}

function setWorking(value, message = "Transcribing locally…") {
  working = value;
  progress.hidden = !value;
  progressLabel.textContent = message;
  updateInputControls();
  copyButton.disabled = value || !transcript.value.trim();
  clearButton.disabled = value;
  transcript.disabled = value;
}

function updateInputControls() {
  uploadButton.disabled = working || recordingPending || activeRecorder !== null;
  recordButton.disabled = working || recordingPending;
  document.querySelectorAll('input[name="language"]').forEach((input) => {
    input.disabled = working || recordingPending || activeRecorder !== null;
  });
}

function selectedLanguage() {
  return document.querySelector('input[name="language"]:checked').value;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function recordingFormat() {
  const candidates = [
    ["audio/webm;codecs=opus", ".webm"],
    ["audio/ogg;codecs=opus", ".ogg"],
    ["audio/mp4", ".m4a"],
  ];
  return candidates.find(([mime]) => MediaRecorder.isTypeSupported(mime)) ?? null;
}

async function transcribe(blob, filename) {
  clearError();
  transcriptMeta.textContent = "";
  if (!blob.size) {
    showError("The recording is empty. Try recording again.");
    return;
  }
  if (blob.size > MAX_AUDIO_MB * 1024 * 1024) {
    showError(`The audio file exceeds the ${MAX_AUDIO_MB} MB limit.`);
    return;
  }

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("language", selectedLanguage());
  setWorking(true);
  setStatus("Audio is being processed on this computer.");
  transcript.value = "";

  try {
    const response = await fetch("/api/transcribe", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || `Transcription failed (${response.status}).`);
    }
    transcript.value = result.text;
    const language = result.language ? ` · ${result.language.toUpperCase()}` : "";
    const time = Number.isFinite(result.processing_seconds)
      ? ` · ${result.processing_seconds}s`
      : "";
    transcriptMeta.textContent = `${formatDuration(result.audio_seconds || 0)} audio${language}${time}`;
    setStatus(result.text ? "Review and edit the transcript before copying." : "No speech was detected. Try another recording or language.");
  } catch (error) {
    showError(error instanceof Error ? error.message : "An unexpected transcription error occurred.");
  } finally {
    setWorking(false);
    copyButton.disabled = !transcript.value.trim();
  }
}

function stopClock() {
  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
}

function updateRecordingTime() {
  const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
  recordLabel.textContent = `Stop · ${formatDuration(seconds)}`;
}

async function beginRecording() {
  clearError();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showError("Microphone recording is not supported by this browser. You can upload an audio file instead.");
    return;
  }
  const format = recordingFormat();
  if (!format) {
    showError("This browser does not support a compatible audio recording format. Upload an audio file instead.");
    return;
  }

  let stream;
  recordingPending = true;
  updateInputControls();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: format[0] });
    const chunks = [];
    activeRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      activeRecorder = null;
      stopClock();
      recordButton.classList.remove("is-recording");
      recordButton.setAttribute("aria-pressed", "false");
      recordLabel.textContent = "Record";
      updateInputControls();
      if (discardRecording) {
        discardRecording = false;
        return;
      }
      const audio = new Blob(chunks, { type: format[0] });
      void transcribe(audio, `recording${format[1]}`);
    }, { once: true });
    recorder.start();
    recordingPending = false;
    updateInputControls();
    recordingStartedAt = Date.now();
    updateRecordingTime();
    timerHandle = window.setInterval(updateRecordingTime, 1000);
    recordButton.classList.add("is-recording");
    recordButton.setAttribute("aria-pressed", "true");
    setStatus("Recording. Select Stop when you are finished.");
  } catch (error) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    activeRecorder = null;
    recordingPending = false;
    stopClock();
    recordButton.classList.remove("is-recording");
    recordButton.setAttribute("aria-pressed", "false");
    recordLabel.textContent = "Record";
    updateInputControls();
    const name = error instanceof Error ? error.name : "";
    const message = name === "NotAllowedError" || name === "PermissionDeniedError"
      ? "Microphone access was denied. Allow access in your browser settings or upload an audio file."
      : name === "NotFoundError" || name === "DevicesNotFoundError"
        ? "No microphone was found. Connect a microphone or upload an audio file."
        : "The microphone could not be started. Check that it is available and try again.";
    showError(message);
  }
}

recordButton.addEventListener("click", () => {
  if (working) return;
  if (activeRecorder?.state === "recording") activeRecorder.stop();
  else void beginRecording();
});

uploadButton.addEventListener("click", () => {
  if (!working) audioFile.click();
});

audioFile.addEventListener("change", () => {
  const file = audioFile.files?.[0];
  audioFile.value = "";
  if (!file) return;
  if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
    showError(`The selected file exceeds the ${MAX_AUDIO_MB} MB limit.`);
    return;
  }
  void transcribe(file, file.name);
});

transcript.addEventListener("input", () => {
  copyButton.disabled = working || !transcript.value.trim();
});

copyButton.addEventListener("click", async () => {
  if (!transcript.value.trim()) return;
  try {
    await navigator.clipboard.writeText(transcript.value);
    clearError();
    setStatus("Transcript copied to the clipboard.");
  } catch {
    showError("Clipboard access was denied. Select and copy the transcript manually.");
  }
});

clearButton.addEventListener("click", () => {
  if (working) return;
  if (activeRecorder) {
    discardRecording = true;
    if (activeRecorder.state === "recording") activeRecorder.stop();
  }
  transcript.value = "";
  transcriptMeta.textContent = "";
  copyButton.disabled = true;
  clearError();
  setStatus("Transcript cleared. Nothing was saved.");
});

fetch("/api/config")
  .then((response) => {
    if (!response.ok) throw new Error("Could not load prototype configuration.");
    return response.json();
  })
  .then((config) => {
    if (Number.isInteger(config.max_audio_mb) && config.max_audio_mb > 0) {
      MAX_AUDIO_MB = config.max_audio_mb;
    }
  })
  .catch(() => {
    setStatus("Could not contact the local transcription server. Start it using the setup guide.", true);
  });

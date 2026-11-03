// Запись голоса и перевод в WAV 16 кГц моно 16 бит: компактный формат, который принимает сервер.

const TARGET_RATE = 16000;

export interface Recording {
  /** Останавливает запись и возвращает WAV; null — если ничего не записалось */
  stop: () => Promise<Blob | null>;
  /** Отмена без результата */
  cancel: () => void;
}

const writeString = (view: DataView, offset: number, text: string) => {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
};

const encodeWav = (samples: Float32Array): Blob => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // моно
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

/** Преобразует декодированный звук в 16 кГц, моно, 16 бит. */
const decodedToWav = async (decoded: AudioBuffer): Promise<Blob> => {
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0));
};

/** Декодирует звук и пересчитывает его в WAV 16 кГц моно. */
const toWav = async (recorded: Blob): Promise<Blob | null> => {
  if (recorded.size === 0) return null;
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
    return decodedToWav(decoded);
  } finally {
    void context.close();
  }
};

export const canRecord = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/** Почему микрофон недоступен */
export type MicProblem = 'denied' | 'nodevice' | 'busy' | 'insecure' | 'unsupported';

/**
 * Что будет при обращении к микрофону: 'granted' — уже разрешён, 'prompt' — браузер спросит,
 * остальное — причина, по которой запись невозможна (тогда браузер ничего не спрашивает).
 */
export async function microphoneState(): Promise<'granted' | 'prompt' | MicProblem> {
  // Браузеры дают микрофон только страницам по https и на localhost
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
  if (!canRecord()) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (status.state === 'denied') return 'denied';
    if (status.state === 'granted') return 'granted';
  } catch {
    // Firefox и Safari не умеют отвечать про микрофон заранее — узнаем при запросе
  }
  return 'prompt';
}

/** Причина отказа по ошибке getUserMedia */
export const micProblemFrom = (error: unknown): MicProblem => {
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'nodevice';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'SecurityError') return 'insecure';
  return 'denied';
};

/** Начинает запись с микрофона. Браузер спросит разрешение у пользователя. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
  recorder.start();

  const release = () => stream.getTracks().forEach(track => track.stop());

  return {
    stop: () => new Promise((resolve, reject) => {
      recorder.onstop = () => {
        release();
        toWav(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject);
      };
      if (recorder.state === 'inactive') { release(); resolve(null); } else recorder.stop();
    }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

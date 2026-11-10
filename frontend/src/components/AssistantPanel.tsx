import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, Mic, Square, Loader2, Wand2, Send, AlertTriangle, FileText, RefreshCw, CheckCircle2, ArrowRight, Maximize2, Minimize2, Copy, Trash2, Globe2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { isStaff } from '../utils/roles';
import { OPEN_ASSISTANT_EVENT, type OpenAssistantDetail } from '../utils/events';
import DraftCandidateCard from './matching/DraftCandidateCard';
import AssistantRecommendationsState from './AssistantRecommendationsState';
import {
  buildDraftCandidatePayload, compatibleProcessId, validDraftProjectId,
  type DraftCandidatePayload,
} from '../utils/assistantDraft';
import { buildPlanTaskPayload, buildWorkflowTaskPayload } from '../utils/assistantTaskPayload';
import { assistantDrawerClass } from '../utils/assistantLayout';
import {
  AssistantRequestEpoch, assistantTaskFooterClass, assistantTaskGridClass,
  assistantTaskWorkspaceState, canCreateAssistantTask, shouldConfirmTaskReset,
} from '../utils/assistantWorkflow';
import { niceConfirm } from '../utils/confirm';
import {
  canCreateTaskWithAssignee, excludedRowsWithReasons, isMembershipConfirmed,
  resolveCandidateSelection,
} from '../utils/assistantCandidateSelection';
import {
  acceptTranscriptCorrection, confirmTranscriptManualReview, createTranscriptCorrectionReview,
  failedTranscriptCorrection, transcriptCorrectionRequestError,
  type TranscriptCorrectionResponse, type TranscriptCorrectionReview,
} from '../utils/transcriptCorrection';
import {
  applyRecognizedText, runCorrectionAction, runDraftAction,
} from '../utils/transcriptActions';
import type { DraftRecommendationResponse, ScoreResult } from '../types/matching';
import {
  micProblemFrom, microphoneState, startRecording,
  type MicProblem, type Recording,
} from '../utils/audio';

type Tab = 'task' | 'ask';

/** Куда добавить задачу: в активный процесс (доску) или в план проекта (этап структуры работ) */
type Destination = 'process' | 'plan';

interface Attempt { provider: string; reason: string }

interface Candidate {
  user_id: number;
  full_name: string;
  position: string;
  score: number;
  current_workload: number;
  current_workload_known?: boolean;
  conflicts: string[];
  named: boolean;
  already_member?: boolean;
}

interface DraftResponse {
  provider: string | null;
  degraded: boolean;
  attempts: Attempt[];
  can_create: boolean;
  warnings: string[];
  candidate_warnings: string[];
  projects: { id: number; name: string }[];
  blocks: { id: number; name: string; project_id: number; has_process: boolean }[];
  processes: { id: number; name: string; project_id: number }[];
  candidates: Candidate[];
  draft: {
    title: string;
    description: string;
    project_id: number | null;
    block_id: number | null;
    process_id: number | null;
    new_process_name: string | null;
    destination: Destination | null;
    priority: string;
    estimated_hours: number | null;
    due_date: string | null;
    skill_ids: number[];
    assignee_hint: string | null;
  };
}

interface DraftForm {
  title: string;
  description: string;
  project_id: number | null;
  block_id: number | null;
  process_id: number | null;
  /** Создать новый процесс с этим названием вместо выбора идущего */
  new_process: boolean;
  new_process_name: string;
  destination: Destination;
  priority: string;
  estimated_hours: number | null;
  due_date: string | null;
  assignee: number | '';
}

/** Где искать только что созданную задачу */
interface CreatedInfo {
  title: string;
  destination: Destination;
  projectId: number;
  projectName: string;
  placeName: string;
  processId: number | null;
}

interface AskResponse {
  answer: string;
  provider: string | null;
  degraded: boolean;
  attempts: Attempt[];
  sources: { id: number; title: string; category: string; project: string | null; snippet: string }[];
}

interface ProviderStatus {
  name: string;
  title: string;
  chat: boolean;
  transcribe: boolean;
  hint: string;
  available?: boolean;
  model_installed?: boolean | null;
  error?: string;
  paused: Record<string, { reason: string; seconds_left: number }>;
}

interface StatusResponse {
  chat_available: boolean;
  transcribe_available: boolean;
  max_record_seconds: number;
  max_audio_mb?: number;
  transcribe_error?: string;
  providers?: ProviderStatus[];
}

/** «ollama:qwen3:4b» → «Ollama · qwen3:4b» */
const providerTitle = (name: string) => name.startsWith('ollama:') ? `Ollama · ${name.slice(7)}` : name;
const PRIORITY_LABEL: Record<string, string> = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный' };
const SAMPLE_TASK_TEXT = 'Разработать REST API для управления заказами интернет-магазина. Добавить проверку входных данных и автоматизированные тесты.';

const inputClass = 'w-full bg-slate-950/70 border border-slate-700/80 text-slate-100 text-sm rounded-xl px-3 py-2.5 outline-none transition-colors placeholder:text-slate-500 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/15';
const labelClass = 'block text-[11px] font-semibold text-slate-400 uppercase tracking-[0.1em] mb-1.5';

/** Что случилось с микрофоном и что делать — показывается прямо под кнопкой «Говорить» */
const MIC_HELP: Record<MicProblem, { title: string; steps: string[] }> = {
  denied: {
    title: 'Браузер не даёт доступ к микрофону',
    steps: [
      'Нажмите на значок слева от адреса сайта (замок или «настройки сайта») → «Микрофон» → «Разрешить», затем обновите страницу.',
      'Если такого пункта нет, значит система открыта во встроенном окне другой программы, где микрофон отключён. Откройте этот адрес в Chrome или Edge — там браузер спросит разрешение.',
      'В Windows: «Параметры» → «Конфиденциальность и защита» → «Микрофон» — доступ для браузера должен быть включён.',
    ],
  },
  nodevice: {
    title: 'Микрофон не найден',
    steps: ['Подключите микрофон или гарнитуру и проверьте, что Windows его видит: «Параметры» → «Система» → «Звук» → «Ввод».'],
  },
  busy: {
    title: 'Микрофон занят или не отвечает',
    steps: ['Закройте программу, которая сейчас использует микрофон (звонок, запись), и нажмите «Говорить» ещё раз.'],
  },
  insecure: {
    title: 'Запись голоса работает только по защищённому адресу',
    steps: ['Откройте систему по адресу https://… или на этом компьютере через http://localhost — по обычному http браузер микрофон не даёт.'],
  },
  unsupported: {
    title: 'Этот браузер не умеет записывать звук',
    steps: ['Откройте систему в свежей версии Chrome, Edge или Firefox.'],
  },
};

function AutoGrowTextarea({ value, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 360)}px`;
  }, [value]);
  return <textarea ref={ref} value={value} className={`${className} overflow-y-auto`} {...props} />;
}

/** Подпись: кто ответил — нейросеть или резервный режим */
function ProviderBadge({ provider, degraded }: { provider: string | null; degraded: boolean }) {
  if (provider) {
    return <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">{providerTitle(provider)}</span>;
  }
  if (degraded) {
    return <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">без нейросети</span>;
  }
  return null;
}

export function AssistantPanel() {
  const { user } = useAuth();
  const { extractError, refreshData, addMemberToProject } = useAppContext();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showModelStatus, setShowModelStatus] = useState(false);
  const [tab, setTab] = useState<Tab>('task');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(false);

  // Задача
  const [text, setText] = useState('');
  const [transcriptCorrection, setTranscriptCorrection] = useState<TranscriptCorrectionReview | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [correctingTranscript, setCorrectingTranscript] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [language, setLanguage] = useState<'auto' | 'ru' | 'en' | 'uz'>('ru');
  const [micProblem, setMicProblem] = useState<MicProblem | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResponse | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const taskWorkspaceState = assistantTaskWorkspaceState(!!(result && form), !!parseError);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  // Кандидаты считаются для выбранного проекта и обновляются при его смене
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateWarnings, setCandidateWarnings] = useState<string[]>([]);
  const [aiCandidates, setAiCandidates] = useState<ScoreResult[]>([]);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiExcluded, setAiExcluded] = useState<DraftRecommendationResponse['excluded_candidates']>([]);
  const [aiScoring, setAiScoring] = useState<DraftRecommendationResponse['scoring'] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [addToTeamFor, setAddToTeamFor] = useState<number | null>(null);
  const aiRequest = useRef(0);
  const candidateRequest = useRef(0);
  const taskRequest = useRef(new AssistantRequestEpoch());
  const taskGeneration = useRef(0);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const recorder = useRef<Recording | null>(null);
  const timer = useRef<number | null>(null);
  const elapsed = useRef(0);
  const correctionRequestRef = useRef(false);

  // Вопрос
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const draftColumnScrollRef = useRef<HTMLDivElement>(null);
  const recommendationsScrollRef = useRef<HTMLElement>(null);

  const loadStatus = () => {
    setStatusLoading(true);
    setStatusError(false);
    return api.get<StatusResponse>('/ai/status/', { timeout: 10000 })
      .then(res => setStatus(res.data))
      .catch(() => {
        setStatus(null);
        setStatusError(true);
      })
      .finally(() => setStatusLoading(false));
  };

  const open = () => { setIsOpen(true); void loadStatus(); };

  const clearTask = async (confirmDiscard = true) => {
    if (creatingRef.current) return;
    if (
      confirmDiscard
      && shouldConfirmTaskReset(text, !!(result || form))
      && !await niceConfirm('Текущий текст и черновик будут удалены. Задача не будет создана.')
    ) return;

    taskGeneration.current += 1;
    taskRequest.current.invalidate();
    aiRequest.current += 1;
    candidateRequest.current += 1;
    stopEverything();
    setSeconds(0);
    elapsed.current = 0;
    setTranscribing(false);
    setCorrectingTranscript(false);
    correctionRequestRef.current = false;
    setRequestingMic(false);
    setMicProblem(null);
    setParsing(false);
    setParseError(null);
    setText('');
    setParseError(null);
    setTranscriptCorrection(null);
    setResult(null);
    setForm(null);
    setCreated(null);
    setCandidates([]);
    setCandidateWarnings([]);
    setAiCandidates([]);
    setAiWarnings([]);
    setAiError(null);
    setAiExcluded([]);
    setAiScoring(null);
    setAiLoading(false);
    setAddToTeamFor(null);
  };

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => {
      contentScrollRef.current?.scrollTo({ top: 0 });
      draftColumnScrollRef.current?.scrollTo({ top: 0 });
      recommendationsScrollRef.current?.scrollTo({ top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, taskWorkspaceState]);

  // Справочный центр открывает ассистента с готовой фразой («Попробовать»)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenAssistantDetail>).detail ?? {};
      setIsOpen(true);
      void api.get<StatusResponse>('/ai/status/', { timeout: 10000 }).then(res => setStatus(res.data)).catch(() => setStatus(null));
      if (detail.tab) setTab(detail.tab);
      if (detail.text && detail.tab === 'ask') setQuestion(detail.text);
      else if (detail.text) {
        setText(detail.text);
        setTranscriptCorrection(null);
      }
    };
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen);
  }, []);

  const clearTimer = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };

  const stopEverything = () => {
    clearTimer();
    recorder.current?.cancel();
    recorder.current = null;
    setRecording(false);
  };

  const close = () => { stopEverything(); setIsOpen(false); setAddToTeamFor(null); };

  // При размонтировании микрофон должен быть отпущен
  useEffect(() => () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    recorder.current?.cancel();
  }, []);

  const correctVoiceTranscript = async (original = text) => {
    const source = original.trim();
    if (!source || correctionRequestRef.current) return;
    const generation = taskGeneration.current;
    correctionRequestRef.current = true;
    setCorrectingTranscript(true);
    setTranscriptCorrection(null);
    try {
      const response = await api.post<TranscriptCorrectionResponse>(
        '/ai/correct-transcript/',
        { text: source },
        { timeout: 60000 },
      );
      if (generation !== taskGeneration.current) return;
      const review = createTranscriptCorrectionReview({ ...response.data, original: source });
      setTranscriptCorrection(review);
      if (!review.available) toast.error(review.error || 'Коррекция недоступна. Исходный текст сохранён.');
    } catch (err) {
      if (generation !== taskGeneration.current) return;
      const error = transcriptCorrectionRequestError(err);
      setTranscriptCorrection(failedTranscriptCorrection(source, error));
      toast.error(`${error} Исходный текст сохранён; можно повторить коррекцию или разобрать его без изменений.`);
    } finally {
      if (generation === taskGeneration.current) {
        correctionRequestRef.current = false;
        setCorrectingTranscript(false);
      }
    }
  };

  const applyTranscriptCorrection = () => {
    if (!transcriptCorrection?.available || !transcriptCorrection.suggested) return;
    const accepted = acceptTranscriptCorrection(transcriptCorrection);
    if (!accepted.accepted) return;
    setText(accepted.suggested ?? text);
    setTranscriptCorrection(accepted);
  };

  const continueWithOriginalTranscript = () => {
    if (!transcriptCorrection) return;
    const original = transcriptCorrection.original;
    setText(original);
    setTranscriptCorrection(null);
  };

  const transcribeAudio = async (audio: Blob) => {
    const generation = taskGeneration.current;
    const maxAudioMb = status?.max_audio_mb ?? 10;
    if (audio.size > maxAudioMb * 1024 * 1024) {
      toast.error(`Запись превышает ограничение ${maxAudioMb} МБ.`);
      return;
    }
    setTranscribing(true);
    try {
      const body = new FormData();
      body.append('audio', audio, 'speech.wav');
      body.append('language', language);
      const res = await api.post<{ text: string; provider: string }>('/ai/transcribe/', body, { timeout: 120000 });
      if (generation !== taskGeneration.current) return;
      if (res.data.text) {
        applyRecognizedText(
          text,
          res.data.text,
          setText,
          recognizedText => { void correctVoiceTranscript(recognizedText); },
        );
        toast.success('Речь распознана. Запускаю автоматическую коррекцию; проверьте исходный текст и предложение.');
      } else {
        toast('Речь не слышна — проверьте микрофон и попробуйте ещё раз');
      }
    } catch (err) {
      if (generation !== taskGeneration.current) return;
      toast.error(extractError(err, 'Не удалось распознать речь локально. Проверьте установку модели и попробуйте ещё раз.'));
      void loadStatus();
    } finally {
      if (generation === taskGeneration.current) setTranscribing(false);
    }
  };

  const finishRecording = async () => {
    const generation = taskGeneration.current;
    clearTimer();
    setRecording(false);
    const active = recorder.current;
    recorder.current = null;
    if (!active) return;
    try {
      const wav = await active.stop();
      if (generation !== taskGeneration.current) return;
      if (!wav) { toast.error('Запись пустая'); return; }
      await transcribeAudio(wav);
    } catch (err) {
      if (generation !== taskGeneration.current) return;
      toast.error(extractError(err, 'Не удалось подготовить запись для распознавания.'));
    }
  };

  const startVoice = async () => {
    const generation = taskGeneration.current;
    if (status && !status.transcribe_available) {
      toast.error('Локальное распознавание речи недоступно. Проверьте установку faster-whisper на сервере.');
      return;
    }
    const limit = status?.max_record_seconds ?? 60;
    setSeconds(0);
    // Сначала выясняем, спросит ли браузер разрешение: если доступ запрещён, он молчит —
    // тогда объясняем причину сами, а не оставляем человека гадать
    const mic = await microphoneState();
    if (generation !== taskGeneration.current) return;
    if (mic !== 'granted' && mic !== 'prompt') { setMicProblem(mic); return; }
    setMicProblem(null);
    setRequestingMic(mic === 'prompt');
    try {
      const nextRecorder = await startRecording();
      if (generation !== taskGeneration.current) {
        nextRecorder.cancel();
        return;
      }
      recorder.current = nextRecorder;
    } catch (err) {
      if (generation !== taskGeneration.current) return;
      setMicProblem(micProblemFrom(err));
      return;
    } finally {
      if (generation === taskGeneration.current) setRequestingMic(false);
    }
    setRecording(true);
    elapsed.current = 0;
    timer.current = window.setInterval(() => {
      elapsed.current += 1;
      setSeconds(elapsed.current);
      // Запись ограничена по длительности — останавливаем сами
      if (elapsed.current >= limit) void finishRecording();
    }, 1000);
  };

  const copyTaskText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Текст скопирован.');
    } catch {
      toast.error('Не удалось скопировать текст. Выделите его и скопируйте вручную.');
    }
  };

  const loadAiCandidates = async (payload: DraftCandidatePayload) => {
    const requestId = ++aiRequest.current;
    setAiLoading(true);
    try {
      const res = await api.post<DraftRecommendationResponse>('/ai/draft-candidates/', payload, { timeout: 45000 });
      if (requestId !== aiRequest.current) return;
      setAiCandidates(res.data.candidates);
      setAiWarnings(res.data.warnings);
      setAiError(null);
      setAiExcluded(res.data.excluded_candidates);
      setAiScoring(res.data.scoring);
    } catch (err) {
      if (requestId !== aiRequest.current) return;
      setAiCandidates([]);
      setAiWarnings([]);
      setAiError(extractError(err, 'Не удалось получить список лучших кандидатов.'));
      setAiExcluded([]);
      setAiScoring(null);
    } finally {
      if (requestId === aiRequest.current) setAiLoading(false);
    }
  };

  const parse = async (draftText = text) => {
    const requestId = taskRequest.current.begin();
    aiRequest.current += 1;
    candidateRequest.current += 1;
    setAiLoading(false);
    setParseError(null);
    setParsing(true);
    try {
      const res = await api.post<DraftResponse>('/ai/task-draft/', { text: draftText }, { timeout: 120000 });
      if (!taskRequest.current.isCurrent(requestId)) return;
      setResult(res.data);
      setCreated(null);
      setCandidates(res.data.candidates);
      setCandidateWarnings(res.data.candidate_warnings);
      setAiCandidates([]);
      setAiWarnings([]);
      setAiError(null);
      setAddToTeamFor(null);
      setAiExcluded([]);
      setAiScoring(null);
      const named = res.data.candidates.find(c => c.named);
      const draft = res.data.draft;
      const projectId = validDraftProjectId(draft.project_id, res.data.projects);
      const processes = res.data.processes.filter(p => p.project_id === projectId);
      const blocks = res.data.blocks.filter(b => b.project_id === projectId);
      setForm({
        title: draft.title, description: draft.description, project_id: projectId,
        priority: draft.priority, estimated_hours: draft.estimated_hours, due_date: draft.due_date,
        // Место, названное в поручении, важнее. Иначе, если в проекте идёт процесс, кладём туда:
        // задачу увидят на доске и в «Моём кабинете»
        destination: draft.destination ?? (processes.length > 0 ? 'process' : 'plan'),
        process_id: compatibleProcessId(draft.process_id, projectId, processes) ?? processes[0]?.id ?? null,
        // Новый процесс — если о нём попросили или в проекте пока нет ни одного идущего
        new_process: !!draft.new_process_name || processes.length === 0,
        new_process_name: draft.new_process_name ?? '',
        block_id: draft.block_id ?? (blocks.length === 1 ? blocks[0].id : null),
        assignee: named ? named.user_id : '',
      });
      if (projectId) {
        const processName = draft.process_id
          ? processes.find(p => p.id === draft.process_id)?.name ?? ''
          : draft.new_process_name ?? '';
        const blockName = draft.block_id
          ? blocks.find(b => b.id === draft.block_id)?.name ?? ''
          : '';
        const payload = buildDraftCandidatePayload({
          projectId, title: draft.title, description: draft.description,
          dueDate: draft.due_date, skillIds: draft.skill_ids,
          processName, blockName,
        });
        if (payload) void loadAiCandidates(payload);
      }
    } catch (err) {
      if (!taskRequest.current.isCurrent(requestId)) return;
      const message = extractError(err, 'Не удалось разобрать текст');
      setParseError(message);
      toast.error(message);
    } finally {
      if (taskRequest.current.isCurrent(requestId)) {
        setParsing(false);
        void loadStatus();
      }
    }
  };

  const projectBlocks = result && form ? result.blocks.filter(b => b.project_id === form.project_id) : [];
  const projectProcesses = result && form ? result.processes.filter(p => p.project_id === form.project_id) : [];
  const chosenBlock = projectBlocks.find(b => b.id === form?.block_id);
  const chosenProcess = projectProcesses.find(p => p.id === form?.process_id);
  const processChosen = form ? (form.new_process ? form.new_process_name.trim().length > 0 : !!chosenProcess) : false;
  const placeChosen = form ? (form.destination === 'process' ? processChosen : !!chosenBlock) : false;
  const selection = resolveCandidateSelection(
    form?.assignee, aiCandidates, candidates, Boolean(aiScoring),
  );
  const selectedCandidate = selection.candidate;
  const selectedIsExternal = selection.external;
  const selectedMissing = selection.missing;

  const addToTeam = isMembershipConfirmed(form?.assignee, selectedCandidate, addToTeamFor);
  const assigneeReady = canCreateTaskWithAssignee(form?.assignee, selectedCandidate, addToTeamFor);
  const excludedTotal = aiScoring?.excluded_count ?? aiExcluded.length;
  const excludedRows = excludedRowsWithReasons(aiExcluded);
  const excludedWithoutReasons = Math.max(0, excludedTotal - excludedRows.length);
  const topThreeComplete = aiScoring !== null;
  const baseCandidatesVisible = !aiLoading && !topThreeComplete
    && aiCandidates.length === 0 && candidates.length > 0;

  const refreshAiCandidates = () => {
    if (!form?.project_id || !result) return;
    const payload = buildDraftCandidatePayload({
      projectId: form.project_id, title: form.title, description: form.description,
      dueDate: form.due_date, skillIds: result.draft.skill_ids,
      processName: form.new_process ? form.new_process_name : chosenProcess?.name ?? '',
      blockName: chosenBlock?.name ?? '',
    });
    if (payload) void loadAiCandidates(payload);
  };

  /** Смена проекта: место и исполнитель сбрасываются на подходящие для нового проекта */
  const changeProject = (projectId: number | null) => {
    if (!form || !result) return;
    aiRequest.current += 1;
    setAiLoading(false);
    const processes = result.processes.filter(p => p.project_id === projectId);
    const blocks = result.blocks.filter(b => b.project_id === projectId);
    const next: DraftForm = {
      ...form, project_id: projectId, assignee: '',
      process_id: compatibleProcessId(form.process_id, projectId, result.processes),
      // Название нового процесса, если оно было продиктовано, сохраняем и для другого проекта
      new_process: form.new_process_name.trim().length > 0 || processes.length === 0,
      block_id: blocks.length === 1 ? blocks[0].id : null,
    };
    setForm(next);
    setCandidates([]);
    setCandidateWarnings([]);
    setAiCandidates([]);
    setAiWarnings([]);
    setAiError(null);
    setAddToTeamFor(null);
    setAiExcluded([]);
    setAiScoring(null);
    if (!projectId) return;
    const generation = taskGeneration.current;
    const requestId = ++candidateRequest.current;
    // Исполнители подбираются заново по общему пулу, как у сохранённой задачи
    api.post<{ candidates: Candidate[]; warnings: string[] }>('/ai/candidates/', {
      project_id: projectId, skill_ids: result.draft.skill_ids,
      due_date: form.due_date, assignee_hint: result.draft.assignee_hint,
    }).then(res => {
      if (generation !== taskGeneration.current || requestId !== candidateRequest.current) return;
      setCandidates(res.data.candidates);
      setCandidateWarnings(res.data.warnings);
      const named = res.data.candidates.find(c => c.named);
      if (named) setForm(current => (current && current.project_id === projectId ? { ...current, assignee: named.user_id } : current));
    }).catch(() => {
      if (generation === taskGeneration.current && requestId === candidateRequest.current) {
        setCandidateWarnings(['Не удалось обновить список исполнителей. Повторите подбор.']);
      }
    });
    const payload = buildDraftCandidatePayload({
      projectId, title: next.title, description: next.description,
      dueDate: next.due_date, skillIds: result.draft.skill_ids,
      processName: next.new_process
        ? next.new_process_name
        : next.process_id ? processes.find(p => p.id === next.process_id)?.name ?? '' : '',
      blockName: next.block_id ? blocks.find(b => b.id === next.block_id)?.name ?? '' : '',
    });
    if (payload) void loadAiCandidates(payload);
  };

  const createTask = async () => {
    if (!form || !result || creatingRef.current) return;
    if (!form.project_id) return;
    if (!canCreateAssistantTask({
      canCreate: result.can_create,
      placeChosen,
      title: form.title,
      assigneeReady,
      creating: creatingRef.current,
    })) return;
    if (selectedMissing) {
      toast.error('Выбранный сотрудник больше не доступен в подборе. Обновите список кандидатов и выберите исполнителя заново.');
      return;
    }
    if (!assigneeReady) {
      toast.error('Сотрудник не в команде проекта. Подтвердите добавление в команду или выберите другого исполнителя.');
      return;
    }
    const requestedAssignee = form.assignee === '' ? null : Number(form.assignee);
    const selectedAssignee = selectedCandidate?.user_id ?? null;
    if (requestedAssignee !== null && requestedAssignee !== selectedAssignee) {
      toast.error('Исполнитель не совпадает с выбранной карточкой кандидата. Выберите его заново.');
      return;
    }
    const assigneeForPayload: number | '' = selectedAssignee ?? '';
    creatingRef.current = true;
    setCreating(true);
    try {
      const input = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        estimatedHours: form.estimated_hours,
        dueDate: form.due_date,
        assignee: assigneeForPayload,
      };
      if (selectedIsExternal && selectedAssignee) {
        await addMemberToProject(form.project_id, selectedAssignee, 'DEVELOPER', null);
      }
      let processId: number | null = null;
      let processName = '';
      if (form.destination === 'process') {
        if (form.new_process) {
          processName = form.new_process_name.trim();
          const res = await api.post<{ id: number }>('/workflows/processes/', {
            name: processName, description: '', project: form.project_id, status: 'IN_PROGRESS',
          });
          processId = res.data.id;
        } else if (chosenProcess) {
          processId = chosenProcess.id;
          processName = chosenProcess.name;
        }
      }
      if (processId !== null) {
        await api.post('/workflows/tasks/', buildWorkflowTaskPayload(processId, input));
      } else if (chosenBlock) {
        await api.post('/projects/tasks/', buildPlanTaskPayload(chosenBlock.id, input, {
          hasProcess: chosenBlock.has_process,
        }));
      }
      setCreated({
        title: form.title.trim(), destination: form.destination, projectId: form.project_id,
        projectName: result.projects.find(p => p.id === form.project_id)?.name ?? '',
        placeName: (form.destination === 'process' ? processName : chosenBlock?.name) ?? '',
        processId,
      });
      aiRequest.current += 1;
      setResult(null);
      setForm(null);
      setText('');
      setTranscriptCorrection(null);
      setAddToTeamFor(null);
      await refreshData();
    } catch (err) {
      toast.error(extractError(err, 'Не удалось создать задачу'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const ask = async () => {
    setAsking(true);
    try {
      const res = await api.post<AskResponse>('/ai/ask/', { question }, { timeout: 60000 });
      setAnswer(res.data);
    } catch (err) {
      toast.error(extractError(err, 'Не удалось получить ответ'));
    } finally {
      setAsking(false);
      void loadStatus();
    }
  };

  const failedNote = (attempts: Attempt[]) =>
    attempts.length > 0 && (
      <p className="text-[11px] text-slate-500">
        {[...new Set(attempts.map(a => `${providerTitle(a.provider)}: ${a.reason}`))].join(' · ')}
      </p>
    );

  return (
    <>
      <button
        onClick={open}
        className="fixed bottom-24 right-6 z-50 w-14 h-14 bg-violet-600 hover:bg-violet-500 border border-white/15 text-white rounded-2xl shadow-xl shadow-violet-950/40 flex items-center justify-center transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        title="ИИ-ассистент: задача голосом и вопросы по документам"
        aria-label="Открыть ИИ-ассистента"
      >
        <Sparkles size={22} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[240] bg-slate-950/65 backdrop-blur-md" onClick={close}>
          <div
            className={assistantDrawerClass(expanded)}
            onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="ИИ-ассистент"
            tabIndex={-1}
            onKeyDown={e => { if (e.key === 'Escape') close(); }}
          >
            <div className="flex-shrink-0 space-y-2.5 border-b border-slate-800/80 bg-slate-950/95 px-4 py-3 sm:px-6 sm:py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
                    <Sparkles size={19} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-semibold tracking-tight text-white">ИИ-ассистент</h2>
                    <p className="mt-0.5 text-[11px] text-slate-400">Задачи и база знаний</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {status?.providers && (
                    <div className="hidden items-center gap-1.5 xl:flex">
                      {status.providers.map(provider => {
                        const ready = provider.available ?? (provider.chat || provider.transcribe);
                        const modelReady = ready && provider.name.startsWith('ollama:');
                        return (
                          <span
                            key={provider.name}
                            title={modelReady ? `${provider.title}: модель найдена; inference отдельно не проверялся` : `${provider.title}: ${ready ? 'доступна' : provider.error || 'недоступна'}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-[10px] text-slate-400"
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {provider.title}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {isStaff(user) && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showModelStatus;
                        setShowModelStatus(next);
                        if (next && !status) void loadStatus();
                      }}
                      aria-expanded={showModelStatus}
                      aria-label="Состояние локальных моделей"
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 text-[10px] font-medium text-slate-300 hover:border-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                      <span className="hidden sm:inline">Локальный ИИ</span>
                    </button>
                  )}
                  {isStaff(user) && (
                    <button
                      type="button"
                      onClick={() => void loadStatus()}
                      disabled={statusLoading}
                      title="Проверить доступность локальных моделей; запрос inference не выполняется"
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 text-[10px] font-medium text-slate-300 hover:border-violet-500/40 hover:text-white disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} />
                      <span className="hidden md:inline">{statusLoading ? 'Проверяю…' : 'Проверить'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(value => !value)}
                    className="hidden md:inline-flex text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    aria-label={expanded ? 'Свернуть панель' : 'Развернуть панель'}
                    title={expanded ? 'Свернуть панель' : 'Развернуть панель'}
                  >
                    {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                  <button onClick={close} className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400" aria-label="Закрыть"><X size={19} /></button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1" role="tablist">
                {([['task', 'Задача голосом'], ['ask', 'Вопрос по документам']] as [Tab, string][]).map(([id, label]) => (
                  <button
                    key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    className={`min-h-10 px-2 py-2 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${tab === id ? 'bg-slate-700/90 text-white shadow-sm' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {isStaff(user) && showModelStatus && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold text-slate-300">Доступность локальных моделей</p>
                    <button
                      type="button" onClick={() => void loadStatus()} disabled={statusLoading}
                      className="flex items-center gap-1 text-[10px] text-violet-300 hover:text-violet-200 disabled:opacity-50"
                      title="Проверяет доступность Ollama и наличие модели; inference не выполняется"
                    >
                      <RefreshCw size={10} className={statusLoading ? 'animate-spin' : ''} /> {statusLoading ? 'Проверяю…' : 'Проверить'}
                    </button>
                  </div>
                  {status?.providers ? status.providers.map(provider => {
                    const ready = provider.available ?? (provider.chat || provider.transcribe);
                    return (
                      <p key={provider.name} className="text-[10px] leading-relaxed text-slate-400">
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className="font-medium text-slate-300">{provider.title}</span>
                        {' — '}{ready
                          ? provider.name.startsWith('ollama:') ? 'модель найдена; inference не проверялся' : 'доступна'
                          : provider.error || 'недоступна'}
                        {ready && provider.hint ? ` (${provider.hint})` : ''}
                      </p>
                    );
                  }) : (
                    <p className={`text-[10px] ${statusError ? 'text-red-300' : 'text-slate-500'}`}>
                      {statusError ? 'Не удалось получить состояние моделей. Проверьте доступ и повторите запрос.' : 'Состояние ещё не загружено.'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div ref={contentScrollRef} className={`flex-1 min-h-0 min-w-0 px-4 py-4 sm:px-6 sm:py-5 ${tab === 'task' ? 'overflow-x-hidden overflow-y-auto custom-scrollbar lg:overflow-hidden' : 'overflow-x-hidden overflow-y-auto custom-scrollbar'}`}>
              {tab === 'task' && (
                <div className={assistantTaskGridClass}>
                  <div ref={draftColumnScrollRef} className="min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5 shadow-lg shadow-black/10 sm:p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300">1 · Ввод поручения</p>
                        <label className="block text-sm font-semibold text-slate-100" htmlFor="assistant-text">Продиктуйте или напишите поручение</label>
                        <p className="mt-1 text-[11px] text-slate-400">Опишите задачу своими словами — детали можно уточнить в черновике.</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-950/60 px-2.5 py-1 text-[10px] font-medium text-slate-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Локальный помощник
                      </span>
                    </div>
                    <div className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 sm:flex-row sm:items-center">
                      <button
                        type="button" onClick={recording ? () => void finishRecording() : () => void startVoice()}
                        disabled={transcribing || correctingTranscript || requestingMic || parsing || (!recording && !!status && !status.transcribe_available)}
                        className={`flex h-14 w-14 flex-shrink-0 items-center justify-center self-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:self-auto ${
                          recording ? 'border-red-400/50 bg-red-500/15 text-red-300 shadow-lg shadow-red-950/25' : 'border-violet-400/40 bg-violet-600 text-white shadow-lg shadow-violet-950/35 hover:bg-violet-500'
                        }`}
                        aria-label={recording ? 'Остановить запись' : 'Начать запись голоса'}
                      >
                        {transcribing ? <Loader2 size={21} className="animate-spin" /> : recording ? <Square size={18} /> : <Mic size={21} />}
                      </button>
                      <div className="min-w-0 flex-1 text-center sm:text-left">
                        <p className="text-xs font-semibold text-slate-100">
                          {transcribing ? 'Распознаю речь…' : correctingTranscript ? 'Исправляю текст…' : requestingMic ? 'Ожидаю разрешение микрофона…' : recording ? `Идёт запись · ${seconds} с` : 'Нажмите, чтобы говорить'}
                        </p>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                          До {status?.max_record_seconds ?? 60} секунд · распознавание выполняется локально
                        </p>
                      </div>
                      <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/70 px-3 text-xs text-slate-400 sm:min-w-40">
                        <span className="flex items-center gap-1.5"><Globe2 size={13} /> Язык</span>
                        <select
                          value={language}
                          onChange={event => setLanguage(event.target.value as typeof language)}
                          disabled={recording || transcribing || correctingTranscript || requestingMic}
                          className="max-w-[70%] bg-transparent text-slate-100 outline-none focus:text-violet-200 disabled:opacity-50"
                        >
                          <option value="auto">Автоопределение</option>
                          <option value="ru">Русский</option>
                          <option value="en">Английский</option>
                          <option value="uz">Узбекский</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-2">
                      <AutoGrowTextarea
                        id="assistant-text" rows={3} value={text} maxLength={4000}
                        disabled={correctingTranscript}
                        onChange={e => {
                          setText(e.target.value);
                          setParseError(null);
                          setTranscriptCorrection(null);
                        }}
                        placeholder="Продиктуйте или напишите поручение…"
                        className={`${inputClass} min-h-24 resize-y leading-relaxed`}
                      />
                    </div>
                    <div className="mt-2 flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
                      <p className="text-[10px] text-slate-500">
                        {text.length} / 4000 · Ручной ввод обрабатывается локально по кнопке «Разобрать»
                      </p>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setText(SAMPLE_TASK_TEXT);
                            setParseError(null);
                            setTranscriptCorrection(null);
                          }}
                          disabled={!!text.trim() || parsing || recording || transcribing || correctingTranscript}
                          title={text.trim() ? 'Сначала очистите поле поручения' : 'Вставить пример поручения'}
                          className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-violet-500/50 hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <FileText size={14} /> Вставить пример
                        </button>
                        <button
                          type="button" onClick={() => void runCorrectionAction(text, correctVoiceTranscript)} disabled={parsing || recording || transcribing || correctingTranscript || text.trim().length === 0}
                          className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:border-violet-500/50 hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
                          aria-label="Исправить текст"
                        >
                          {correctingTranscript ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                          {correctingTranscript ? 'Исправляю…' : 'Исправить текст'}
                        </button>
                        <button
                          type="button" onClick={() => void runDraftAction(text, parse)} disabled={parsing || recording || transcribing || correctingTranscript || text.trim().length < 3}
                          className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-950/30 transition-colors hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {parsing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                          {parsing ? 'Формирую черновик…' : 'Разобрать поручение'}
                        </button>
                      </div>
                    </div>
                    {transcriptCorrection && (
                      <div className="mt-3 p-3 rounded-lg border border-violet-500/30 bg-violet-500/5 space-y-2" aria-live="polite">
                        <p className="text-xs font-semibold text-violet-200">
                          {transcriptCorrection.accepted
                            ? 'Исправленный текст применён. Исходная расшифровка сохранена:'
                            : transcriptCorrection.available
                              ? 'Предложенный исправленный текст — проверьте перед применением. Поле задачи пока не изменено:'
                              : 'Исправление недоступно. Исходная расшифровка не изменена.'}
                        </p>
                        {transcriptCorrection.available && transcriptCorrection.requires_manual_review && (
                          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200">
                            Модель отметила части текста как неоднозначные. Они сохранены без догадок;
                            проверьте смысл вручную перед применением.
                          </p>
                        )}
                        {transcriptCorrection.available && transcriptCorrection.uncertain_fragments.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-100">
                            {transcriptCorrection.uncertain_fragments.map((fragment, index) => (
                              <li key={`${index}-${fragment}`}>{fragment}</li>
                            ))}
                          </ul>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="min-w-0 rounded-md bg-slate-900/70 p-2">
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Исходный текст</p>
                            <p className="whitespace-pre-wrap break-words text-xs text-slate-300">{transcriptCorrection.original}</p>
                          </div>
                          <div className="min-w-0 rounded-md bg-slate-900/70 p-2">
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              {transcriptCorrection.accepted ? 'Текущий текст' : 'Предложенный исправленный текст'}
                            </p>
                            <p className="whitespace-pre-wrap break-words text-xs text-slate-200">
                              {transcriptCorrection.suggested || transcriptCorrection.error}
                            </p>
                          </div>
                        </div>
                        {!transcriptCorrection.accepted && transcriptCorrection.available && transcriptCorrection.suggested && (
                          <div className="space-y-2">
                            {transcriptCorrection.requires_manual_review && (
                              <label className="flex items-start gap-2 text-xs text-amber-100">
                                <input
                                  type="checkbox"
                                  checked={transcriptCorrection.manualReviewConfirmed}
                                  onChange={event => setTranscriptCorrection(current => (
                                    current ? confirmTranscriptManualReview(current, event.target.checked) : current
                                  ))}
                                  className="mt-0.5 accent-violet-500"
                                />
                                Я проверил отмеченные фрагменты и подтверждаю применение предложения
                              </label>
                            )}
                            <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={applyTranscriptCorrection}
                              disabled={transcriptCorrection.requires_manual_review && !transcriptCorrection.manualReviewConfirmed}
                              className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Принять исправление
                            </button>
                            <button
                              type="button"
                              onClick={continueWithOriginalTranscript}
                              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                            >
                              Оставить исходный текст
                            </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {status && !status.transcribe_available && (
                      <p className="text-[11px] text-amber-300/90 mt-2">
                        {status.transcribe_error || 'Локальное распознавание недоступно.'} Текст можно ввести вручную.
                      </p>
                    )}
                    <div className="mt-4 flex flex-col gap-3 border-t border-slate-800/80 pt-3 sm:flex-row sm:items-start sm:justify-between">
                      <p className="max-w-2xl text-[11px] leading-relaxed text-slate-400">
                        Аудио распознаётся локально faster-whisper и не отправляется в Ollama или облако.
                        Коррекция текста выполняется локальной Ollama только по нажатию «Исправить текст».
                        Разбор поручения использует текущий текст и не запускает коррекцию повторно.
                        {status?.max_record_seconds ? ` До ${status.max_record_seconds} секунд.` : ''}
                      </p>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void copyTaskText()}
                          disabled={!text.trim() || transcribing || correctingTranscript}
                          className="inline-flex min-h-8 items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
                        >
                          <Copy size={12} /> Копировать текст
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setText('');
                            setTranscriptCorrection(null);
                          }}
                          disabled={!text || transcribing || correctingTranscript || recording}
                          className="inline-flex min-h-8 items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
                        >
                          <Trash2 size={12} /> Очистить текст
                        </button>
                      </div>
                    </div>
                    {requestingMic && (
                      <p className="text-[11px] text-violet-300 mt-2">
                        Браузер спрашивает разрешение на микрофон — нажмите «Разрешить» в окошке у адресной строки.
                      </p>
                    )}
                    {recording && (
                      <p className="text-[11px] text-red-300 mt-2 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Идёт запись — говорите. Нажмите «Остановить», когда закончите.
                      </p>
                    )}
                    {micProblem && (
                      <div className="mt-2 p-3 bg-amber-500/5 border border-amber-500/25 rounded-lg space-y-1.5" role="alert">
                        <p className="text-xs font-bold text-amber-200 flex items-center gap-2">
                          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" /> {MIC_HELP[micProblem].title}
                        </p>
                        <ol className="space-y-1 list-decimal list-inside">
                          {MIC_HELP[micProblem].steps.map(step => (
                            <li key={step} className="text-[11px] text-slate-300 leading-relaxed">{step}</li>
                          ))}
                        </ol>
                        {micProblem === 'denied' && (
                          <button
                            type="button"
                            onClick={() => { void navigator.clipboard?.writeText(window.location.origin).then(() => toast.success('Адрес скопирован'), () => undefined); }}
                            className="text-[11px] font-mono text-violet-300 hover:text-violet-200 underline underline-offset-2"
                            title="Скопировать адрес, чтобы открыть его в Chrome или Edge"
                          >
                            {window.location.origin} — скопировать
                          </button>
                        )}
                        <p className="text-[11px] text-slate-500">Поручение можно просто напечатать в поле выше — «Разобрать» работает и без голоса.</p>
                      </div>
                    )}
                  </section>

                  {created && (
                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/25 rounded-xl space-y-2" role="status">
                      <p className="text-sm font-bold text-emerald-300 flex items-center gap-2">
                        <CheckCircle2 size={16} /> Задача создана
                      </p>
                      <p className="text-xs text-slate-200">«{created.title}»</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {created.destination === 'process'
                          ? `Где искать: «Процессы» → процесс «${created.placeName}» (проект «${created.projectName}»), колонка «К выполнению». Исполнитель увидит её в «Моём кабинете».`
                          : `Где искать: «Проекты» → «${created.projectName}» → вкладка «Структура работ / План» → этап «${created.placeName}». В «Процессах» её не будет: это задача плана.`}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const target = created;
                          close();
                          if (target.destination === 'process') navigate('/workflows', { state: { openProcessId: target.processId } });
                          else navigate('/projects', { state: { openProjectId: target.projectId, openTab: 'gantt' } });
                        }}
                        className="flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300"
                      >
                        Открыть <ArrowRight size={13} />
                      </button>
                    </div>
                  )}

                  {taskWorkspaceState === 'draft' && result && form && (
                    <section className="assistant-panel-appear space-y-3 rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5 shadow-lg shadow-black/10 sm:p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-xs font-bold text-violet-200">2</span>
                          <div>
                            <h3 className="text-sm font-semibold text-slate-100">Черновик задачи</h3>
                            <p className="mt-0.5 text-[11px] text-slate-400">Проверьте детали перед созданием</p>
                          </div>
                        </div>
                        <ProviderBadge provider={result.provider} degraded={result.degraded} />
                      </div>
                      {failedNote(result.attempts)}
                      {result.degraded && result.attempts.length > 0 && (
                        <button
                          type="button" onClick={() => void parse()} disabled={parsing}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-violet-300 hover:text-violet-200 disabled:opacity-50"
                        >
                          <RefreshCw size={11} className={parsing ? 'animate-spin' : ''} /> Повторить с помощью Ollama
                        </button>
                      )}
                      {[...result.warnings, ...candidateWarnings, ...aiWarnings]
                        .map(warning => warning.trim())
                        .filter(Boolean)
                        .map((warning, index) => (
                          <p key={`${index}-${warning}`} className="text-xs text-amber-200/90 flex gap-2 p-2 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-amber-400" /> <span>{warning}</span>
                          </p>
                        ))}
                      {aiError && (
                        <div role="alert" className="text-xs text-red-200 p-2 bg-red-500/5 border border-red-500/25 rounded-lg space-y-1.5">
                          <p className="flex gap-2">
                            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-red-400" /> <span>{aiError}</span>
                          </p>
                          <button
                            type="button" onClick={refreshAiCandidates} disabled={aiLoading}
                            className="flex items-center gap-1.5 text-[11px] font-bold text-violet-300 hover:text-violet-200 disabled:opacity-50"
                          >
                            <RefreshCw size={11} className={aiLoading ? 'animate-spin' : ''} /> Повторить подбор
                          </button>
                        </div>
                      )}

                      <div className="min-w-0 space-y-3">
                      <div className="grid gap-1 lg:grid-cols-[92px_minmax(0,1fr)] lg:items-center lg:gap-3">
                        <label className={`${labelClass} mb-0`} htmlFor="draft-title">Название задачи</label>
                        <input id="draft-title" className={inputClass} value={form.title} maxLength={255} onChange={e => setForm({ ...form, title: e.target.value })} />
                      </div>
                      <div className="grid gap-1 lg:grid-cols-[92px_minmax(0,1fr)] lg:items-start lg:gap-3">
                        <label className={`${labelClass} mb-0 lg:pt-2`} htmlFor="draft-description">Описание</label>
                        <AutoGrowTextarea
                          id="draft-description" rows={3} maxLength={4000}
                          className={`${inputClass} min-h-[88px] resize-y`}
                          value={form.description}
                          onChange={e => setForm({ ...form, description: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className={labelClass} htmlFor="draft-project">Проект</label>
                          <select
                            id="draft-project" className={inputClass} value={form.project_id ?? ''}
                            onChange={e => changeProject(Number(e.target.value) || null)}
                          >
                            <option value="">— выберите —</option>
                            {result.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        {form.project_id && (
                          <div className="col-span-2">
                            <p className={labelClass}>Куда добавить задачу</p>
                            <div className="grid grid-cols-2 gap-2">
                              {([
                                ['process', 'В процесс', 'Доска процесса и «Мой кабинет» исполнителя; срок отсчитывается с начала работы'],
                                ['plan', 'В план проекта', 'Этап в «Структура работ / План» — для планирования сроков'],
                              ] as [Destination, string, string][]).map(([value, title, hint]) => (
                                <button
                                  key={value} type="button" aria-pressed={form.destination === value}
                                  onClick={() => setForm({ ...form, destination: value })}
                                  className={`text-left p-2.5 rounded-lg border transition-colors ${
                                    form.destination === value ? 'bg-violet-600/15 border-violet-500/50' : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <span className="block text-xs font-bold text-slate-100">{title}</span>
                                  <span className="block text-[10px] text-slate-500 mt-0.5 leading-snug">{hint}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {form.project_id && form.destination === 'process' && (
                          <div className="col-span-2">
                            <label className={labelClass} htmlFor="draft-process">Процесс</label>
                            <select
                              id="draft-process" className={inputClass} value={form.new_process ? 'new' : form.process_id ?? ''}
                              onChange={e => setForm(e.target.value === 'new'
                                ? { ...form, new_process: true }
                                : { ...form, new_process: false, process_id: Number(e.target.value) || null })}
                            >
                              {!form.new_process && <option value="">— выберите —</option>}
                              {projectProcesses.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              <option value="new">＋ Новый процесс…</option>
                            </select>
                            {form.new_process && (
                              <div className="mt-2">
                                <label className={labelClass} htmlFor="draft-new-process">Название нового процесса</label>
                                <input
                                  id="draft-new-process" className={inputClass} value={form.new_process_name} maxLength={255}
                                  placeholder="Например: Подготовка релиза"
                                  onChange={e => setForm({ ...form, new_process_name: e.target.value })}
                                />
                                <p className="text-[11px] text-slate-500 mt-1.5">
                                  {projectProcesses.length === 0 ? 'В проекте пока нет идущих процессов. ' : ''}
                                  Процесс будет создан в этом проекте и сразу запущен, задача попадёт в него.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                        {form.project_id && form.destination === 'plan' && (
                          <div className="col-span-2">
                            <label className={labelClass} htmlFor="draft-block">Этап плана</label>
                            <select
                              id="draft-block" className={inputClass} value={form.block_id ?? ''}
                              onChange={e => setForm({ ...form, block_id: Number(e.target.value) || null })}
                            >
                              <option value="">— выберите —</option>
                              {projectBlocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                            <p className="text-[11px] text-slate-500 mt-1.5">
                              Этап — раздел плана работ проекта. В списке только этапы выбранного проекта
                              {projectBlocks.length === 1 ? ': сейчас он один.' : '.'}
                            </p>
                          </div>
                        )}
                        <div>
                          <label className={labelClass} htmlFor="draft-priority">Приоритет</label>
                          <select id="draft-priority" className={inputClass} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                            {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass} htmlFor="draft-hours">Трудозатраты, ч</label>
                          <input
                            id="draft-hours" type="number" min={0} step={0.5} className={inputClass} value={form.estimated_hours ?? ''}
                            onChange={e => setForm({ ...form, estimated_hours: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </div>
                        <div className="col-span-2">
                          <label className={labelClass} htmlFor="draft-due-date">Дедлайн</label>
                          <input
                            id="draft-due-date" type="date" lang={document.documentElement.lang || undefined} className={inputClass}
                            value={form.due_date ?? ''}
                            onChange={e => setForm({ ...form, due_date: e.target.value || null })}
                          />
                          <p className="text-[11px] text-slate-500 mt-1.5">
                            Календарный срок хранится отдельно от нормативного срока процесса. По умолчанию он составляет 24 часа.
                          </p>
                        </div>
                      </div>
                      {form.project_id && form.destination === 'plan' && projectBlocks.length === 0 && (
                        <p className="text-xs text-amber-200/90">В проекте пока нет этапов — сначала создайте этап во вкладке «Структура работ / План».</p>
                      )}
                      {form.destination === 'plan' && chosenBlock?.has_process && (
                        <p className="text-[11px] text-slate-500">У этапа есть шаблон процесса: задача сразу получит процесс и нормативный срок выполнения.</p>
                      )}

                      </div>
                      {!form.title.trim() && <p className="text-[11px] text-red-300">Укажите название задачи.</p>}
                      {form.project_id && !placeChosen && (
                        <p className="text-[11px] text-amber-300">Выберите процесс или этап плана.</p>
                      )}
                    </section>
                  )}
                  </div>
                  {taskWorkspaceState === 'draft' && result && form && !parsing && !parseError ? (
                    <section ref={recommendationsScrollRef} className="assistant-panel-appear min-w-0 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/65 p-3.5 shadow-lg shadow-black/10 sm:p-4 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-xs font-bold text-violet-200">3</span>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-100">Рекомендуемые исполнители</h3>
                            <p className="mt-0.5 text-[11px] text-slate-400">Три лучших кандидата по навыкам и доступным данным</p>
                          </div>
                        </div>
                        <button
                          type="button" onClick={refreshAiCandidates} disabled={aiLoading}
                          className="flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 text-[11px] font-medium text-slate-300 hover:border-violet-500/50 hover:text-violet-200 disabled:opacity-50 transition-colors"
                          title="Пересчитать список кандидатов по текущим полям черновика"
                        >
                          <RefreshCw size={11} className={aiLoading ? 'animate-spin' : ''} /> Обновить
                        </button>
                      </div>
                      {aiLoading && (
                        <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-3" role="status">
                          <Loader2 size={15} className="animate-spin text-violet-300" />
                          <span>
                            <span className="block text-xs font-medium text-slate-200">Подбираю кандидатов…</span>
                            <span className="mt-0.5 block text-[10px] text-slate-400">Проверяю навыки и доступность на период задачи</span>
                          </span>
                        </div>
                      )}
                      {!aiLoading && aiCandidates.length > 0 && (
                        <div className="space-y-2">
                          {aiCandidates.map((candidate, index) => (
                            <DraftCandidateCard
                              key={candidate.employee_id}
                              result={candidate}
                              rank={index + 1}
                              selected={form.assignee === candidate.user_id}
                              dueDate={form.due_date}
                              competenceFilterApplied={Boolean(aiScoring?.competence_filter_applied)}
                              onSelect={() => { setAddToTeamFor(null); setForm({ ...form, assignee: candidate.user_id }); }}
                            />
                          ))}
                        </div>
                      )}
                      {baseCandidatesVisible && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-slate-500">
                            {aiError
                              ? 'Предварительный список: проверка обязательных навыков выполнена не полностью:'
                              : 'Предварительный список до завершения подбора:'}
                          </p>
                          {candidates.map(c => (
                            <label
                              key={c.user_id}
                              className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                form.assignee === c.user_id ? 'bg-violet-600/15 border-violet-500/50' : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                              }`}
                            >
                              <input
                                type="radio" name="assistant-assignee" className="mt-1 accent-violet-500"
                                checked={form.assignee === c.user_id} onChange={() => { setAddToTeamFor(null); setForm({ ...form, assignee: c.user_id }); }}
                              />
                              <span className="flex-1 min-w-0">
                                <span className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-100 break-words min-w-0">{c.full_name}{c.named && ' · назван в поручении'}</span>
                                  <span className="text-[10px] font-bold text-violet-300 flex-shrink-0">{c.score}%</span>
                                </span>
                                <span className={`block text-[10px] mt-0.5 ${c.current_workload_known !== true ? 'text-slate-500' : c.current_workload >= 100 ? 'text-red-400' : 'text-slate-500'}`}>
                                  {c.position || 'должность не указана'} · загрузка {c.current_workload_known !== true ? 'не подтверждена' : `${c.current_workload}%`}
                                  {c.already_member === false && ' · не в команде проекта'}
                                </span>
                                {c.conflicts[0] && <span className="block text-[10px] text-amber-300/90 mt-0.5">{c.conflicts[0]}</span>}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      {!aiLoading && topThreeComplete && aiCandidates.length === 0 && (
                        <div className="rounded-xl border border-slate-700/80 bg-slate-950/50 px-3.5 py-3">
                          <p className="text-xs font-medium text-slate-200">
                            {aiScoring?.competence_filter_applied
                              ? `Ни один из ${aiScoring.total_considered ?? excludedTotal} сотрудников не прошёл проверку обязательных навыков и доступности.`
                              : 'Подходящих сотрудников не найдено.'}
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                            Можно создать задачу без исполнителя или изменить требования и срок.
                          </p>
                        </div>
                      )}
                      {!aiLoading && !aiError && !topThreeComplete && aiCandidates.length === 0 && candidates.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3.5 py-3 text-[11px] leading-relaxed text-slate-400">
                          Пока нет рекомендаций. Можно продолжить без исполнителя или обновить подбор.
                        </div>
                      )}
                      {!aiLoading && aiScoring && (
                        <p className="text-[10px] text-slate-500">
                          Период: {aiScoring.period_start} — {aiScoring.period_end}
                          {' · '}{aiScoring.competence_filter_applied ? 'навыки проверены' : 'навыки не извлечены'}
                          {aiScoring.semantic_status === 'unavailable' && ' · семантика недоступна'}
                        </p>
                      )}
                      {!aiLoading && excludedTotal > 0 && (
                        <details className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2">
                          <summary className="text-[10px] font-semibold text-slate-400 cursor-pointer">
                            Почему остальные кандидаты не прошли отбор ({excludedTotal})
                          </summary>
                          {excludedRows.length > 0 ? (
                            <ul className="mt-1.5 space-y-1">
                              {excludedRows.slice(0, 6).map(row => (
                                <li key={row.item.employee_id} className="text-[10px] text-slate-500 leading-relaxed">
                                  <span className="text-slate-400 font-semibold">{row.item.full_name}</span>
                                  {' — '}{row.reason}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
                              Сервер вернул только количество исключённых сотрудников, без причин.
                            </p>
                          )}
                          {excludedRows.length > 0 && excludedWithoutReasons > 0 && (
                            <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
                              Ещё для {excludedWithoutReasons} сотрудников причины не переданы.
                            </p>
                          )}
                        </details>
                      )}
                      <label className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-xs text-slate-400 cursor-pointer hover:bg-slate-800/50">
                        <input type="radio" name="assistant-assignee" className="accent-violet-500" checked={form.assignee === ''} onChange={() => { setAddToTeamFor(null); setForm({ ...form, assignee: '' }); }} />
                        Пока без исполнителя
                      </label>
                      {selectedMissing && (
                        <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
                          <p className="flex items-center gap-2 text-xs font-bold text-red-200">
                            <AlertTriangle size={13} className="flex-shrink-0 text-red-400" />
                            Выбранный сотрудник не входит в текущий список кандидатов
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                            Выберите исполнителя из списка, создайте задачу без исполнителя или измените требования и обновите подбор. Пока выбор не подтверждён, задача не будет создана.
                          </p>
                        </div>
                      )}
                      {selectedIsExternal && (
                        <div role="alert" className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                          <p className="flex items-center gap-2 text-xs font-bold text-amber-200">
                            <AlertTriangle size={13} className="flex-shrink-0 text-amber-400" />
                            Сотрудник не в команде проекта
                          </p>
                          <p className="text-[11px] leading-relaxed text-slate-300">
                            Чтобы сохранить назначение, добавьте сотрудника в команду. Это отдельное действие
                            требует права «Управление участниками». Без подтверждения задача не будет создана.
                          </p>
                          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-amber-100">
                            <input
                              type="checkbox" className="mt-0.5 accent-violet-500"
                              checked={addToTeam}
                              data-user-id={selectedCandidate?.user_id}
                              onChange={e => setAddToTeamFor(e.target.checked && form.assignee ? Number(form.assignee) : null)}
                            />
                            <span>Добавить {selectedCandidate?.full_name ?? 'сотрудника'} в команду проекта</span>
                          </label>
                        </div>
                      )}
                    </section>
                  ) : (
                    <div ref={element => { recommendationsScrollRef.current = element; }} className="min-w-0 lg:min-h-0">
                      <AssistantRecommendationsState
                        state={parsing ? 'loading' : parseError ? 'error' : 'empty'}
                        error={parseError}
                        previousDraftKept={taskWorkspaceState === 'draft'}
                        retryDisabled={text.trim().length < 3}
                        onRetry={() => void parse()}
                      />
                    </div>
                  )}
                </div>
              )}

              {tab === 'ask' && (
                <>
                  <form onSubmit={e => { e.preventDefault(); if (question.trim().length >= 3 && !asking) void ask(); }}>
                    <label className={labelClass} htmlFor="assistant-question">Вопрос по базе знаний и файлам проектов</label>
                    <div className="flex gap-2">
                      <input
                        id="assistant-question" className={inputClass} value={question} maxLength={1000}
                        onChange={e => setQuestion(e.target.value)} placeholder="Например: как оформить отпуск?"
                      />
                      <button
                        type="submit" disabled={asking || question.trim().length < 3} aria-label="Спросить"
                        className="px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors"
                      >
                        {asking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2">Ассистент ищет только в материалах, которые вам разрешено видеть.</p>
                  </form>

                  {answer && (
                    <div className="space-y-3">
                      <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/65 p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-100">Ответ</p>
                          <ProviderBadge provider={answer.provider} degraded={answer.degraded} />
                        </div>
                        <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{answer.answer}</p>
                        {failedNote(answer.attempts)}
                        {answer.degraded && answer.attempts.length > 0 && (
                          <button
                            type="button" onClick={() => void ask()} disabled={asking}
                            className="flex items-center gap-1.5 text-[11px] font-bold text-violet-300 hover:text-violet-200 disabled:opacity-50"
                          >
                            <RefreshCw size={11} className={asking ? 'animate-spin' : ''} /> Повторить с помощью Ollama
                          </button>
                        )}
                      </div>
                      {answer.sources.length > 0 && (
                        <div className="space-y-2">
                          <p className={labelClass}>Источники</p>
                          {answer.sources.map((source, index) => (
                            <div key={source.id} className="p-3.5 bg-slate-900/65 border border-slate-800 rounded-xl">
                              <p className="text-xs font-bold text-slate-100 flex items-center gap-2">
                                <FileText size={13} className="text-violet-400 flex-shrink-0" /> [{index + 1}] {source.title}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">{source.category}{source.project ? ` · проект «${source.project}»` : ' · общая база знаний'}</p>
                              {source.snippet && <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed line-clamp-3">{source.snippet}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {tab === 'task' && (
              <footer className={assistantTaskFooterClass}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p id="assistant-create-hint" className="text-[10px] leading-relaxed text-slate-400">
                    {created
                      ? 'Задача создана. Можно начать новое поручение.'
                      : parsing
                        ? 'Разбираю поручение…'
                        : !result || !form
                          ? 'До подтверждения задача не создаётся.'
                          : !form.title.trim()
                            ? 'Укажите название задачи'
                            : form.project_id && !placeChosen
                              ? 'Выберите процесс или этап плана'
                              : !assigneeReady
                                ? 'Подтвердите выбор исполнителя или продолжите без него'
                                : !result.can_create
                                  ? 'Черновик пока нельзя создать — проверьте предупреждения'
                                  : 'Задача будет создана только после вашего подтверждения'}
                  </p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    {!created ? (
                      <>
                        {result && form && (
                          <button
                            type="button" onClick={close}
                            className="min-h-10 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                          >
                            Отмена
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void clearTask()}
                          disabled={creating || (!text.trim() && !result && !form && !parseError && !created)}
                          className="min-h-10 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Очистить
                        </button>
                        {result && form && (
                          <button
                            type="button" onClick={() => void createTask()}
                            disabled={!canCreateAssistantTask({
                              canCreate: result.can_create && !!form.project_id,
                              placeChosen,
                              title: form.title,
                              assigneeReady,
                              creating: creating || parsing,
                            })}
                            aria-describedby="assistant-create-hint"
                            className="flex min-h-10 w-full flex-shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-950/20 transition-colors hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:w-auto"
                          >
                            {creating ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                            {form.destination === 'process' && form.new_process ? 'Создать процесс и задачу' : 'Создать задачу'}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void clearTask(false)}
                        className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-950/20 transition-colors hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                      >
                        <Sparkles size={15} /> Новое поручение
                      </button>
                    )}
                  </div>
                </div>
              </footer>
            )}

          </div>
        </div>
      )}
    </>
  );
}

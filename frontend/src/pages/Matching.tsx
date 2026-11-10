import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, TrendingUp, X, Zap } from 'lucide-react';
import api from '../api/client';
import { useAppContext } from '../context/AppContext';
import { complexityLabel, skillCategoryLabel, taskTypeLabel } from '../utils/localization';
import MemberRoleSelect from '../components/MemberRoleSelect';
import AllocationInput from '../components/AllocationInput';
import AssignmentConfirmDialog from '../components/matching/AssignmentConfirmDialog';
import CandidateCard from '../components/matching/CandidateCard';
import { projectPerms, resolveMemberRole } from '../utils/roles';
import {
  formatAvailabilityScore, formatDateKey, getGradient, getInitials, isAvailabilityKnown,
  isCompetenceEvaluated, isCostNeutral, isPerformanceNeutral, suggestLoad,
  taskMatchPeriod, taskPeriodSourceLabel,
} from '../utils/matchingPresentation';
import type { AssignmentRequest, ScoreResult, TaskMatchContext } from '../types/matching';
import { toast } from 'react-hot-toast';


interface AiRequirements {
  skills: string[];
  task_type: string;
  complexity: string;
  skills_source?: 'llm' | 'catalog_text_fallback' | 'none';
}

interface ExcludedReason {
  code: 'missing_required_skills' | 'below_minimum_skills' | 'zero_availability';
  skills?: string[];
  message: string;
}

interface ExcludedCandidate {
  employee_id: number;
  full_name: string;
  position?: string;
  reasons: ExcludedReason[];
}

interface ScoringMeta {
  competence_filter_applied?: boolean;
  skills_source?: string;
  total_considered?: number;
  eligible_count?: number;
  excluded_count?: number;
  top_limit?: number;
  semantic_status?: string;
}

interface Weights {
  w1: number; w2: number; w3: number; w4: number; w5: number;
}

/** Требуемый навык: level — желаемый уровень владения (1–5) */
interface RequiredSkill {
  name: string;
  level: number;
}

const SKILL_LEVELS = ['', 'Нач.', 'Баз.', 'Сред.', 'Прод.', 'Эксп.'];

export default function Matching() {
  const {
    employees, projects, skills: skillsFromContext, assignEmployeeToProject,
    globalRoles, domains, extractError, refreshData,
  } = useAppContext();
  const location = useLocation();
  const state = location.state as { employeeId?: number } | null;
  
  // Домен подставляется из выбранного проекта; жёстко заданного значения нет,
  // потому что справочник доменов у каждой организации свой
  const [domain, setDomain] = useState('');
  
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScoreResult[]>([]);
  const [aiRequirements, setAiRequirements] = useState<AiRequirements | null>(null);
  const [aiScoring, setAiScoring] = useState<ScoringMeta | null>(null);
  const [excludedCandidates, setExcludedCandidates] = useState<ExcludedCandidate[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [highlightedEmpId, setHighlightedEmpId] = useState<number | null>(null);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [pendingAssignment, setPendingAssignment] = useState<AssignmentRequest | null>(null);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [, setError] = useState('');

  const [skills, setSkills] = useState<RequiredSkill[]>([]);
  const [weights, setWeights] = useState<Weights>({ w1: 35, w2: 20, w3: 25, w4: 15, w5: 5 });

  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [matchingMode, setMatchingMode] = useState<'general' | 'task'>('general');
  const [selectedTaskId, setSelectedTaskId] = useState<number | ''>('');
  const { allTasks, processes, loading: dataLoading } = useAppContext();
  const targetProject = projects.find(p => p.id === selectedProjectId) || null;

  const selectedTask = allTasks.find(task => task.id === Number(selectedTaskId)) ?? null;
  const selectedTaskProject = selectedTask
    ? projects.find(project => project.id === processes.find(process => process.id === selectedTask.workflow)?.project) ?? null
    : null;
  const taskPeriod = selectedTask ? taskMatchPeriod(selectedTask) : null;
  const taskMatchContext: TaskMatchContext | null = selectedTask && selectedTaskProject && taskPeriod ? {
    id: selectedTask.id,
    name: selectedTask.name,
    project: selectedTaskProject,
    start: taskPeriod.start,
    end: taskPeriod.end,
    dueDate: taskPeriod.dueDate,
    periodSource: taskPeriod.source,
    deadlineStatus: taskPeriod.deadlineStatus,
    assignedToId: selectedTask.assigned_to ?? null,
    assignedToName: selectedTask.assigned_to_name ?? null,
  } : null;
  const resultsCompetenceEvaluated = results.some(result => (result.details?.weights?.w1 ?? 0) > 0);
  const competenceFilterApplied = matchingMode === 'task'
    ? (aiScoring?.competence_filter_applied
      ?? (aiRequirements
        ? ((aiRequirements.skills.length ?? 0) > 0 && aiRequirements.skills_source !== 'none')
        : results.length > 0 ? resultsCompetenceEvaluated : true))
    : skills.length > 0;

  // Selection and Comparison States
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [comparisonResults, setComparisonResults] = useState<ScoreResult[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [compareAssignConfig, setCompareAssignConfig] = useState<Record<number, {
    projectId: number | '';
    role: string;
    load: number;
    start: string;
    end: string;
  }>>({});

  /** Веса в формате API. Сервер сам нормирует их к сумме 100%. */
  const weightsPayload = () => ({
    w1_competence: weights.w1,
    w2_experience: weights.w2,
    w3_availability: weights.w3,
    w4_performance: weights.w4,
    w5_cost: weights.w5,
  });

  /** Параметры общего подбора. Бюджет, состав команды и календарь сервер берёт из проекта. */
  const rankPayload = () => ({
    project_id: selectedProjectId || undefined,
    required_skills: skills.flatMap(s => {
      const skill = skillsFromContext.find(x => x.name === s.name);
      // минимум — на ступень ниже желаемого уровня
      return skill ? [{ skill_id: skill.id, min_level: Math.max(1, s.level - 1), preferred_level: s.level }] : [];
    }),
    domain,
    date_from: dateFrom,
    date_to: dateTo,
    weights: weightsPayload(),
  });

  const handleCompareClick = async () => {
    setLoadingCompare(true);
    setIsCompareModalOpen(true);
    try {
      // Под задачу оценки уже посчитаны с параметрами задачи — сравниваем их же
      const compared: ScoreResult[] = matchingMode === 'task'
        ? results.filter(r => selectedCandidateIds.includes(r.employee_id))
        : (await api.post('/matching/compare/', { candidate_ids: selectedCandidateIds, ...rankPayload() })).data;
      setComparisonResults(compared);

      const defaultProjectId = matchingMode === 'task'
        ? (taskMatchContext?.project.id ?? '')
        : (selectedProjectId || '');
      const defaultStart = matchingMode === 'task' ? taskMatchContext?.start ?? dateFrom : dateFrom;
      const defaultEnd = matchingMode === 'task' ? taskMatchContext?.end ?? dateTo : dateTo;
      const initialConfigs: typeof compareAssignConfig = {};
      compared.forEach((r: ScoreResult) => {
        initialConfigs[r.employee_id] = {
          projectId: defaultProjectId,
          role: '',
          load: suggestLoad(r.availability, r.details?.availability),
          start: defaultStart,
          end: defaultEnd,
        };
      });
      setCompareAssignConfig(initialConfigs);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при сравнении кандидатов'));
      setIsCompareModalOpen(false);
    } finally {
      setLoadingCompare(false);
    }
  };

  const initialized = useRef(false);
  useEffect(() => {
    // Ждём загрузки справочников: раньше флаг ставился при первом же рендере,
    // и проект, переданный со страницы проекта, не подставлялся
    if (initialized.current || dataLoading) return;
    const id = state?.employeeId|| sessionStorage.getItem('matchingEmployeeId');
    const stateProjId = (state as any)?.projectId || sessionStorage.getItem('targetProjectId');
    const stateTaskId = (state as any)?.taskId || sessionStorage.getItem('targetTaskId');
    
    if (stateTaskId && allTasks.length > 0) {
      setSelectedTaskId(Number(stateTaskId));
      setMatchingMode('task');
      handleTaskRun(Number(stateTaskId));
    } else if (stateProjId && projects.length > 0) {
      setSelectedProjectId(Number(stateProjId));
    }
    
    if (id && employees.length > 0) {
      setHighlightedEmpId(Number(id));
      sessionStorage.removeItem('matchingEmployeeId');
      const emp = employees.find(e => e.id === Number(id));
      if (emp && emp.skills.length > 0) {
        setSkills(emp.skills.slice(0, 3).map(s => ({ name: s.skill.name, level: 3 })));
      }
      if (!stateTaskId) handleRun();
    }
    initialized.current = true;
  }, [state, employees, allTasks, projects, dataLoading]);

  useEffect(() => {
    if (targetProject && targetProject.domain) {
      setDomain(targetProject.domain);
    }
  }, [targetProject]);

  const handleTaskRun = async (tid?: number) => {
    const id = tid || Number(selectedTaskId);
    if (!id) return;
    setLoading(true);
    setRan(false);
    setAiRequirements(null);
    setAiScoring(null);
    setExcludedCandidates([]);
    setShowExcluded(false);
    setSelectedCandidateIds([]);
    setShowAllCandidates(false);
    try {
      // Тот же движок и те же веса, что в общем подборе: навыки берутся из текста задачи,
      // домен и бюджет — из её проекта, период — до дедлайна
      const response = await api.post(`/matching/ai-recommend/${id}/`, { weights: weightsPayload() });
      setResults(response.data.candidates || []);
      setAiRequirements(response.data.requirements || null);
      setAiScoring(response.data.scoring || null);
      setExcludedCandidates(response.data.excluded_candidates || []);
      setRan(true);
    } catch (err: any) {
      console.error(err);
      toast.error(extractError(err, 'Ошибка при подборе для задачи'));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(prev => prev.filter(s => s.name !== skill));
  };

  const handleRun = async () => {
    // Без навыков подбор тоже возможен: компонент «Компетенции» исключается, веса перераспределяются
    setLoading(true);
    setError('');
    setSelectedCandidateIds([]);
    setShowAllCandidates(false);
    setAiRequirements(null);
    setAiScoring(null);
    setExcludedCandidates([]);
    setShowExcluded(false);
    
    try {
      const response = await api.post('/matching/rank/', rankPayload());
      setResults(response.data);
      setRan(true);
    } catch (err: any) {
      console.error("Matching error:", err);
      toast.error(extractError(err, 'Ошибка при выполнении матчинга'));
    } finally {
      setLoading(false);
    }
  };

  const resetRunState = () => {
    setRan(false);
    setResults([]);
    setPendingAssignment(null);
    setSelectedCandidateIds([]);
    setShowAllCandidates(false);
    setAiRequirements(null);
    setAiScoring(null);
    setExcludedCandidates([]);
    setShowExcluded(false);
  };

  const requestAssignment = (request: AssignmentRequest) => {
    if (request.isTaskAssignment) {
      if (!taskMatchContext || request.taskId !== taskMatchContext.id) {
        toast.error('Не удалось определить задачу назначения');
        return;
      }
      if (request.projectId !== taskMatchContext.project.id) {
        toast.error('Проект задачи изменить нельзя');
        return;
      }
    }
    if (!request.projectId) {
      toast.error('Пожалуйста, выберите проект');
      return;
    }
    if (new Date(request.start) > new Date(request.end)) {
      toast.error('Дата начала не может быть больше даты окончания');
      return;
    }
    setPendingAssignment(request);
  };

  const confirmAssignment = async () => {
    const request = pendingAssignment;
    if (!request || assignmentSubmitting) return;

    const emp = employees.find(employee => employee.id === request.employeeId);
    const project = projects.find(item => item.id === request.projectId);
    if (!emp || !project) {
      toast.error('Сотрудник или проект не найдены');
      return;
    }

    if (request.isTaskAssignment) {
      const requestTask = allTasks.find(task => task.id === request.taskId);
      const requestTaskProjectId = requestTask
        ? processes.find(process => process.id === requestTask.workflow)?.project
        : null;
      if (!requestTask || requestTaskProjectId !== request.projectId) {
        toast.error('Проект задачи не совпадает с выбранным проектом. Назначение отменено.');
        return;
      }
    }

    setAssignmentSubmitting(true);
    let membershipSaved = false;
    let taskSaved = false;

    try {
      if (request.isTaskAssignment) {
        const isMember = project.members?.some(member => member.user.id === emp.user.id) || request.alreadyMember;
        if (!isMember) {
          await assignEmployeeToProject(
            request.employeeId,
            request.projectId,
            request.role,
            request.load,
            request.roleRefId,
            { start: request.start, end: request.end },
          );
          membershipSaved = true;
        }

        await api.patch(`/workflows/tasks/${request.taskId}/`, { assigned_to: emp.user.id });
        taskSaved = true;
        setPendingAssignment(null);
        setIsCompareModalOpen(false);
        setHighlightedEmpId(request.employeeId);

        let refreshFailed = false;
        try {
          refreshFailed = !(await refreshData());
        } catch {
          refreshFailed = true;
        }

        if (refreshFailed) {
          toast.success('Назначение на задачу сохранено');
          toast.error('Назначение сохранено, но список не обновился. Обновите страницу.');
        } else {
          toast.success(`${emp.user.full_name} назначен на задачу «${request.taskName}»`);
        }
      } else {
        const refreshFailed = !(await assignEmployeeToProject(
          request.employeeId,
          request.projectId,
          request.role,
          request.load,
          request.roleRefId,
          { start: request.start, end: request.end },
        ));
        setPendingAssignment(null);
        setIsCompareModalOpen(false);
        setHighlightedEmpId(request.employeeId);

        if (refreshFailed) {
          toast.success('Назначение на проект сохранено');
          toast.error('Назначение сохранено, но список не обновился. Обновите страницу.');
        } else {
          toast.success(`${emp.user.full_name} назначен на проект «${project.name}»: ${request.load}% с ${request.start} по ${request.end}`);
        }
      }
    } catch (err: any) {
      if (membershipSaved && !taskSaved) {
        toast.error('Сотрудник добавлен в проект, но назначение на задачу не сохранено: '
          + extractError(err, 'ошибка при назначении на задачу'));
      } else {
        toast.error(extractError(err, 'Ошибка при назначении'));
      }
    } finally {
      setAssignmentSubmitting(false);
    }
  };

  const handleWeightChange = (key: keyof Weights, value: number) => {
    setWeights(prev => ({ ...prev, [key]: value }));
  };

  const weightSum = weights.w1 + weights.w2 + weights.w3 + weights.w4 + weights.w5;
  const effectiveWeightBase = competenceFilterApplied
    ? weightSum
    : weights.w2 + weights.w3 + weights.w4 + weights.w5;
  const effectiveWeight = (key: keyof Weights): number | null => {
    if (key === 'w1' && !competenceFilterApplied) return 0;
    if (effectiveWeightBase <= 0) return null;
    return Math.round((weights[key] / effectiveWeightBase) * 100);
  };
  const visibleResults = showAllCandidates ? results : results.slice(0, 3);

  return (
    <div className="p-8 space-y-6 flex flex-col h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Zap size={22} className="text-violet-400" /> Подбор команды
        </h1>
        <p className="text-sm text-slate-400 mt-1">Умный матчинг сотрудников по компетенциям, загрузке и результативности</p>
      </div>

      <div className="grid grid-cols-3 gap-6 flex-1 items-start">
        <div className="col-span-1 space-y-4 sticky top-0">
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => {
                if (matchingMode === 'general') return;
                resetRunState();
                setMatchingMode('general');
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${matchingMode === 'general' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Общий подбор
            </button>
            <button 
              onClick={() => {
                if (matchingMode === 'task') return;
                resetRunState();
                setMatchingMode('task');
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${matchingMode === 'task' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Под задачу
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 max-h-[calc(100vh-180px)] overflow-y-auto thin-scrollbar">
            <h3 className="text-sm font-semibold text-white">Параметры поиска</h3>

            {matchingMode === 'task' ? (
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Выберите задачу</label>
                <select 
                  value={selectedTaskId} 
                  onChange={e => {
                    const nextTaskId = e.target.value ? Number(e.target.value) : '';
                    if (nextTaskId !== selectedTaskId) resetRunState();
                    setSelectedTaskId(nextTaskId);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="">— Выбрать задачу —</option>
                  {allTasks.filter(t => t.status !== 'DONE').map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                  Навыки определяются по тексту задачи, домен и бюджет берутся из её проекта. Период —
                  до срока выполнения; если срок истекает сегодня, просрочен или не задан, используется нормативный период.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Целевой проект (бюджет, домен, команда)</label>
                  <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors">
                    <option value="">— Не выбран —</option>
                    {projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Домен проекта</label>
                  <select value={domain} onChange={e => setDomain(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors">
                    <option value="">— Выбрать —</option>
                    {/* Домен проекта может отсутствовать в справочнике — показываем его как есть */}
                    {domain && !domains.some(d => d.name === domain) && <option value={domain}>{domain}</option>}
                    {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Начало</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Конец</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500 transition-colors" />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Необходимые навыки</label>
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {skills.map(skill => (
                        <span key={skill.name} className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-300 text-xs pl-2 pr-1 py-0.5 rounded-md">
                          {skill.name}
                          <select
                            value={skill.level}
                            title="Желаемый уровень владения"
                            onChange={e => setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, level: Number(e.target.value) } : s))}
                            className="bg-transparent border-none text-[10px] font-bold text-violet-400 focus:outline-none cursor-pointer py-0 pl-0.5 pr-0"
                          >
                            {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>{SKILL_LEVELS[l]}</option>)}
                          </select>
                          <button type="button" onClick={() => handleRemoveSkill(skill.name)} className="text-violet-400 hover:text-red-400 transition-colors">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={e => {
                        const s = e.target.value;
                        if (s && !skills.some(x => x.name === s)) {
                          setSkills(prev => [...prev, { name: s, level: 3 }]);
                        }
                      }}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors"
                    >
                      <option value="">— Добавить навык из базы —</option>
                      {skillsFromContext.filter(s => !skills.some(x => x.name === s.name)).map(s => (
                        <option key={s.id} value={s.name}>{s.name} ({skillCategoryLabel(s.category)})</option>
                      ))}
                    </select>
                  </div>
                </div>

              </>
            )}

            <div className="border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Веса формулы</h4>
                <span className="text-xs font-medium text-slate-500" title="Исходные веса задают относительную важность; эффективные пересчитываются после исключения недоступных компонентов">
                  {weightSum === 100 ? 'Σ = 100%' : `Σ = ${weightSum}% → приводится к 100%`}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed mb-3">
                Исходные веса задаются здесь. Эффективные пересчитываются к 100%; если навыки не заданы
                или не извлечены из задачи, w₁ исключается.
              </p>
              {([
                { key: 'w1' as const, label: 'w₁ Компетенции' },
                { key: 'w2' as const, label: 'w₂ Опыт' },
                { key: 'w3' as const, label: 'w₃ Доступность' },
                { key: 'w4' as const, label: 'w₄ Результаты' },
                { key: 'w5' as const, label: 'w₅ Бюджет' },
              ]).map(({ key, label }) => {
                const effective = effectiveWeight(key);
                return (
                  <div key={key} className="mb-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs text-slate-400">{label}</span>
                      <span className="text-[11px] text-right">
                        <span className="text-slate-500">{weights[key]}% исх.</span>
                        <span className="text-violet-400">
                          {' · '}{effective == null ? '—' : `${effective}%`} эфф.
                        </span>
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={weights[key]}
                      onChange={e => handleWeightChange(key, Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </div>
                );
              })}
            </div>

            <button onClick={matchingMode === 'general' ? handleRun : () => handleTaskRun()} disabled={loading || (matchingMode === 'task' && !selectedTaskId)}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
              {loading ? <><span className="animate-spin">⟳</span> Анализируем...</> : <><TrendingUp size={15} /> Запустить подбор</>}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="col-span-2 space-y-3 pb-8">
          {!ran ? (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center py-24 bg-slate-900 border border-slate-800 border-dashed rounded-xl">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
                <Zap size={24} className="text-violet-400" />
              </div>
              <p className="text-sm font-medium text-slate-300">Настройте параметры и запустите подбор</p>
              <p className="text-xs text-slate-600 mt-1">Алгоритм проанализирует компетенции, загрузку и историю</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-sm text-slate-300">
                  Найдено <span className="font-semibold text-white">{results.length}</span> кандидатов
                  {!showAllCandidates && results.length > 3 && (
                    <span className="text-slate-500"> · показан топ-3</span>
                  )}
                </p>
                {matchingMode === 'general' ? (
                  <p className="text-xs text-slate-500">Домен: <span className="text-slate-300">{domain || 'не задан'}</span> · {dateFrom} – {dateTo}</p>
                ) : selectedTask ? (
                  <p className="text-xs text-slate-500 truncate">
                    Задача: <span className="text-slate-300">{selectedTask.name}</span>
                    {taskMatchContext && <> · проект: <span className="text-slate-300">{taskMatchContext.project.name}</span></>}
                  </p>
                ) : null}
              </div>
              {matchingMode === 'task' && selectedTaskId && !taskMatchContext && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-200">
                  Не удалось определить проект выбранной задачи. Назначение недоступно, выберите другую задачу.
                </div>
              )}
              {matchingMode === 'task' && taskMatchContext && (
                <div className={`rounded-lg border px-4 py-2.5 text-xs ${
                  taskMatchContext.deadlineStatus === 'overdue'
                    ? 'border-amber-500/25 bg-amber-500/5 text-amber-200'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}>
                  <p>
                    Расчётный период: <span className="font-semibold text-slate-200">
                      {formatDateKey(taskMatchContext.start)} — {formatDateKey(taskMatchContext.end)}
                    </span>
                    {' · '}{taskPeriodSourceLabel(taskMatchContext.periodSource, taskMatchContext.deadlineStatus)}
                  </p>
                  <p className="mt-0.5">
                    Дедлайн задачи: {taskMatchContext.dueDate ? formatDateKey(taskMatchContext.dueDate) : 'не задан'}
                    {taskMatchContext.deadlineStatus === 'overdue' && ' · просрочен, период рассчитан по нормативному сроку'}
                    {taskMatchContext.deadlineStatus === 'today' && ' · истекает сегодня, период рассчитан по нормативному сроку'}
                    {taskMatchContext.deadlineStatus === 'missing' && ' · период рассчитан по нормативному сроку'}
                  </p>
                </div>
              )}
              {matchingMode === 'task' && aiRequirements && !competenceFilterApplied && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
                  <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                  <span>
                    <b>Навыки не извлечены из задачи.</b> Фильтр компетенций не применялся, w₁ исключён,
                    а остальные веса пересчитаны. Проверьте требования к задаче перед назначением.
                  </span>
                </div>
              )}
              {matchingMode === 'task' && taskMatchContext?.assignedToName && (
                <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs text-slate-400">
                  Текущий исполнитель задачи: <span className="font-semibold text-slate-200">{taskMatchContext.assignedToName}</span>
                </div>
              )}
              {matchingMode === 'task' && aiRequirements && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-slate-300">
                    <span className="font-semibold text-violet-300">Анализ задачи ИИ:</span>{' '}
                    {aiRequirements.skills.length
                      ? aiRequirements.skills.join(', ')
                      : <span className="text-amber-300">навыки не извлечены — фильтр компетенций не применялся</span>}
                    {' · '}{taskTypeLabel(aiRequirements.task_type)} · {complexityLabel(aiRequirements.complexity)}
                    {aiRequirements.skills_source === 'catalog_text_fallback' && (
                      <span title="LLM не вернул подтверждённые навыки; использован поиск по каталогу в тексте задачи">
                        {' '}· резервный поиск по каталогу
                      </span>
                    )}
                    {aiScoring?.total_considered != null && (
                      <span className="text-slate-500">
                        {' '}· проверено {aiScoring.total_considered}, прошли фильтры {aiScoring.eligible_count ?? results.length}
                      </span>
                    )}
                  </div>
                  {excludedCandidates.length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-slate-300">
                      <button
                        type="button"
                        onClick={() => setShowExcluded(prev => !prev)}
                        className="w-full flex items-center justify-between gap-2 text-left"
                      >
                        <span className="font-semibold text-amber-300">
                          Исключено кандидатов: {excludedCandidates.length}
                        </span>
                        {showExcluded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {showExcluded && (
                        <div className="mt-2 space-y-1.5">
                          {excludedCandidates.slice(0, 20).map(item => (
                            <div key={item.employee_id} className="text-[11px] text-slate-400">
                              <span className="text-slate-200">{item.full_name}</span>
                              {item.position ? ` · ${item.position}` : ''}
                              {' — '}{item.reasons.map(reason => reason.message).join('; ')}
                            </div>
                          ))}
                          {excludedCandidates.length > 20 && (
                            <p className="text-[11px] text-slate-500">…и ещё {excludedCandidates.length - 20}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {visibleResults.map((r, i) => (
                <CandidateCard
                  key={`${r.employee_id}-${taskMatchContext?.id ?? 'general'}`}
                  result={r}
                  rank={i + 1}
                  projects={projects}
                  globalRoles={globalRoles}
                  isTaskMatch={matchingMode === 'task'}
                  taskContext={taskMatchContext}
                  competenceFilterApplied={competenceFilterApplied}
                  requestedWeights={weights}
                  onRequestAssign={requestAssignment}
                  highlightedEmpId={highlightedEmpId}
                  defaultStart={dateFrom}
                  defaultEnd={dateTo}
                  isChecked={selectedCandidateIds.includes(r.employee_id)}
                  onCheck={() => {
                    if (selectedCandidateIds.includes(r.employee_id)) {
                      setSelectedCandidateIds(prev => prev.filter(id => id !== r.employee_id));
                    } else {
                      setSelectedCandidateIds(prev => [...prev, r.employee_id]);
                    }
                  }}
                />
              ))}
              {results.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllCandidates(prev => !prev)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold py-2.5 transition-colors"
                >
                  {showAllCandidates
                    ? 'Свернуть до топ-3'
                    : `Показать всех (ещё ${results.length - 3})`}
                </button>
              )}
              {results.length === 0 && excludedCandidates.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center text-sm text-slate-300">
                  Все проверенные кандидаты исключены обязательными фильтрами. Причины указаны выше.
                </div>
              )}

              {/* Floating Compare Button */}
              {selectedCandidateIds.length >= 2 && !isCompareModalOpen && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-slate-900 border border-slate-800 rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-5 duration-200">
                  <span className="text-sm font-semibold text-slate-350">
                    Выбрано кандидатов для сравнения: <strong className="text-white">{selectedCandidateIds.length}</strong>
                  </span>
                  <button
                    onClick={handleCompareClick}
                    className="bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-violet-600/20"
                  >
                    Сравнить выбранных ({selectedCandidateIds.length})
                  </button>
                </div>
              )}

              {/* Modal: Compare Candidates */}
              {isCompareModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh] min-h-0">
                    <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
                      <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Zap size={20} className="text-violet-400" /> Сравнение выбранных кандидатов
                      </h2>
                      <button 
                        onClick={() => setIsCompareModalOpen(false)} 
                        className="text-slate-500 hover:text-white transition-colors p-1 bg-slate-800 rounded-lg hover:bg-slate-700"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    
                    {loadingCompare ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3 flex-1 animate-pulse">
                        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm">Загрузка параметров сравнения...</p>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto p-6 custom-scrollbar">
                        {!competenceFilterApplied && (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-200 mb-4">
                            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
                            <span>
                              Компетенции не оценивались: обязательные навыки не заданы или не извлечены.
                              w₁ исключён из формулы.
                            </span>
                          </div>
                        )}
                        <div className="flex items-start gap-6 min-w-max pb-4">
                          {comparisonResults.map(r => {
                            const taskAssignmentProject = matchingMode === 'task' ? taskMatchContext?.project ?? null : null;
                            const config = compareAssignConfig[r.employee_id] || {
                              projectId: taskAssignmentProject?.id ?? (selectedProjectId || ''),
                              role: '',
                              load: suggestLoad(r.availability, r.details?.availability),
                              start: matchingMode === 'task' ? taskMatchContext?.start ?? dateFrom : dateFrom,
                              end: matchingMode === 'task' ? taskMatchContext?.end ?? dateTo : dateTo,
                            };
                            const configuredProject = taskAssignmentProject
                              ?? projects.find(project => project.id === Number(config.projectId))
                              ?? null;
                            const availabilityKnown = isAvailabilityKnown(r.details);
                            const competenceEvaluated = isCompetenceEvaluated(r.details, competenceFilterApplied);
                            const performanceNeutral = isPerformanceNeutral(r.details);
                            const costNeutral = isCostNeutral(r.details);
                            const alreadyAssignedToTask = matchingMode === 'task'
                              && taskMatchContext?.assignedToId === r.user_id;

                            const scoreColor = r.total_score >= 0.8 ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : r.total_score >= 0.6 ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : 'text-red-400 border-red-500/20 bg-red-500/10';

                            return (
                              <div key={r.employee_id} className="w-[300px] bg-slate-950 border border-slate-850 rounded-2xl p-5 flex flex-col gap-4">
                                {/* Header */}
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getGradient(r.employee_id)} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
                                    {getInitials(r.full_name)}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <h4 className="text-sm font-bold text-white truncate leading-snug">{r.full_name}</h4>
                                    <p className="text-[10px] text-slate-500">{r.position || 'Кандидат'}</p>
                                    {alreadyAssignedToTask && (
                                      <p className="text-[9px] font-bold text-emerald-400">Назначен на задачу</p>
                                    )}
                                  </div>
                                  <div className={`text-xs font-bold px-2 py-1 rounded-lg border ${scoreColor}`}>
                                    {Math.round(r.total_score * 100)}
                                  </div>
                                </div>

                                {/* Metrics */}
                                <div className="space-y-2.5 pt-3 border-t border-slate-850">
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Компетенции</span>
                                      <span className={`font-bold ${competenceEvaluated ? '' : 'text-slate-500'}`}>
                                        {competenceEvaluated ? `${Math.round(r.competence_fit * 100)}%` : 'не учитывается'}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${competenceEvaluated ? 'bg-violet-500' : 'bg-slate-600'}`}
                                        style={{ width: `${competenceEvaluated ? r.competence_fit * 100 : 0}%` }}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Опыт</span>
                                      <span className="font-bold">{Math.round(r.experience_similarity * 100)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${r.experience_similarity * 100}%` }} />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Доступность</span>
                                      <span className="font-bold">{formatAvailabilityScore(r.availability, r.details)}</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${availabilityKnown ? 'bg-emerald-500' : 'bg-slate-600'}`}
                                        style={{ width: `${availabilityKnown ? r.availability * 100 : 0}%` }}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Результативность</span>
                                      <span className={`font-bold ${performanceNeutral ? 'text-slate-500' : ''}`}>
                                        {performanceNeutral ? 'н/д' : `${Math.round(r.past_performance * 100)}%`}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${performanceNeutral ? 'bg-slate-600' : 'bg-amber-500'}`}
                                        style={{ width: `${performanceNeutral ? 0 : r.past_performance * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Соответствие бюджету</span>
                                      <span className={`font-bold ${costNeutral ? 'text-slate-500' : ''}`}>
                                        {costNeutral ? 'н/д' : `${Math.round(r.cost_fit * 100)}%`}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${costNeutral ? 'bg-slate-600' : 'bg-pink-500'}`}
                                        style={{ width: `${costNeutral ? 0 : r.cost_fit * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Workload and conflicts */}
                                <div className="text-[11px] text-slate-400 space-y-1.5 pt-3 border-t border-slate-850">
                                  <div className="flex justify-between">
                                    <span>Текущая загрузка:</span>
                                    <span className={`font-semibold ${
                                      r.details?.availability?.current_workload_known === false
                                        ? 'text-slate-400'
                                        : r.current_workload > 100 ? 'text-red-400' : r.current_workload > 70 ? 'text-amber-400' : 'text-emerald-400'
                                    }`}>
                                      {r.details?.availability?.current_workload_known === false ? 'н/д' : `${r.current_workload}%`}
                                    </span>
                                  </div>
                                  {r.conflicts.length > 0 && (
                                    <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-2 mt-1">
                                      <p className="text-[10px] text-amber-400 font-bold mb-1">Предупреждения:</p>
                                      {r.conflicts.map((c, i) => <p key={i} className="text-[9px] text-amber-300/80 leading-relaxed">{c}</p>)}
                                    </div>
                                  )}
                                </div>

                                {/* Form controls */}
                                <div className="space-y-3 bg-slate-900 border border-slate-850 rounded-xl p-3 pt-2">
                                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Назначение</p>
                                  <div>
                                    <label className="block text-[9px] text-slate-500 mb-1 uppercase">
                                      {matchingMode === 'task' ? 'Проект задачи' : 'Проект'}
                                    </label>
                                    {matchingMode === 'task' ? (
                                      <p
                                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 truncate"
                                        title={taskMatchContext?.project.name}
                                      >
                                        {taskMatchContext?.project.name ?? 'Проект не найден'}
                                      </p>
                                    ) : (
                                      <select
                                        value={config.projectId}
                                        onChange={e => setCompareAssignConfig({
                                          ...compareAssignConfig,
                                          [r.employee_id]: { ...config, projectId: e.target.value ? Number(e.target.value) : '' }
                                        })}
                                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500"
                                      >
                                        <option value="">— Выбрать проект —</option>
                                        {projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                      </select>
                                    )}
                                  </div>
                                  <div>
                                    <label className="block text-[9px] text-slate-500 mb-1 uppercase">Должность в проекте</label>
                                    <MemberRoleSelect
                                      value={config.role}
                                      onChange={value => setCompareAssignConfig({
                                        ...compareAssignConfig,
                                        [r.employee_id]: { ...config, role: value }
                                      })}
                                      positions={globalRoles}
                                      allowManager={projectPerms(configuredProject).is_manager}
                                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500"
                                    />
                                  </div>
                                  <AllocationInput
                                    compact
                                    projectId={config.projectId}
                                    userId={r.user_id}
                                    start={config.start}
                                    end={config.end}
                                    onPeriodChange={(start, end) => setCompareAssignConfig(prev => ({
                                      ...prev, [r.employee_id]: { ...(prev[r.employee_id] ?? config), start, end },
                                    }))}
                                    value={config.load}
                                    onChange={load => setCompareAssignConfig(prev => ({
                                      ...prev, [r.employee_id]: { ...(prev[r.employee_id] ?? config), load },
                                    }))}
                                    periodLocked={matchingMode === 'task'}
                                    availabilityConfirmed={availabilityKnown}
                                  />

                                  <button
                                    disabled={!config.projectId || alreadyAssignedToTask || (matchingMode === 'task' && !taskMatchContext)}
                                    onClick={() => {
                                      if (alreadyAssignedToTask) return;
                                      if (!config.projectId) return;
                                      if (matchingMode === 'task' && (!taskMatchContext || Number(config.projectId) !== taskMatchContext.project.id)) {
                                        toast.error('Проект задачи изменить нельзя');
                                        return;
                                      }
                                      const { role, roleRefId } = resolveMemberRole(config.role, globalRoles);
                                      requestAssignment({
                                        employeeId: r.employee_id,
                                        employeeUserId: r.user_id,
                                        employeeName: r.full_name,
                                        employeePosition: r.position,
                                        projectId: Number(config.projectId),
                                        projectName: matchingMode === 'task'
                                          ? taskMatchContext?.project.name ?? ''
                                          : configuredProject?.name ?? '',
                                        taskId: matchingMode === 'task' ? taskMatchContext?.id : undefined,
                                        taskName: matchingMode === 'task' ? taskMatchContext?.name : undefined,
                                        role,
                                        roleRefId,
                                        load: config.load,
                                        start: matchingMode === 'task' ? taskMatchContext?.start ?? config.start : config.start,
                                        end: matchingMode === 'task' ? taskMatchContext?.end ?? config.end : config.end,
                                        isTaskAssignment: matchingMode === 'task',
                                        alreadyMember: r.already_member || Boolean(
                                          configuredProject?.members?.some(member => member.user.id === r.user_id),
                                        ),
                                        currentAssigneeId: matchingMode === 'task' ? taskMatchContext?.assignedToId ?? null : null,
                                        currentAssigneeName: matchingMode === 'task' ? taskMatchContext?.assignedToName ?? null : null,
                                        periodSource: matchingMode === 'task' ? taskMatchContext?.periodSource : undefined,
                                        deadlineDate: matchingMode === 'task' ? taskMatchContext?.dueDate ?? null : null,
                                        deadlineStatus: matchingMode === 'task' ? taskMatchContext?.deadlineStatus : undefined,
                                        competenceFilterApplied,
                                        availabilityKnown,
                                      });
                                    }}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-lg transition-all shadow shadow-emerald-950/20 flex items-center justify-center gap-1.5"
                                  >
                                    <TrendingUp size={12} />
                                    {alreadyAssignedToTask
                                      ? 'Уже назначен на задачу'
                                      : matchingMode === 'task' ? 'Назначить на задачу' : 'Назначить'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    <div className="p-4 border-t border-slate-800 flex justify-end flex-shrink-0">
                      <button 
                        onClick={() => setIsCompareModalOpen(false)}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-750 transition-colors"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AssignmentConfirmDialog
        request={pendingAssignment}
        submitting={assignmentSubmitting}
        onCancel={() => { if (!assignmentSubmitting) setPendingAssignment(null); }}
        onConfirm={confirmAssignment}
      />
    </div>
  );
}

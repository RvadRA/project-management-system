import { useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, Info, TrendingUp, Zap,
} from 'lucide-react';
import type { Project, ProjectRole } from '../../context/AppContext';
import type {
  AssignmentRequest, CandidateAssignmentState, ScoreResult, ScoreWeights, TaskMatchContext,
} from '../../types/matching';
import AllocationInput from '../AllocationInput';
import MemberRoleSelect from '../MemberRoleSelect';
import { projectPerms, resolveMemberRole } from '../../utils/roles';
import {
  assignmentStateLabel,
  availabilityWarnings,
  currentWorkloadLabel,
  dataQualityIssues,
  effectiveWeightPercent,
  explainScore,
  explanationSourceLabel,
  explanationText,
  formatAvailabilityScore,
  formatDateKey,
  formatSemanticSimilarity,
  getCandidateAssignmentState,
  getGradient,
  getInitials,
  isAvailabilityKnown,
  isCompetenceEvaluated,
  isCostNeutral,
  isPerformanceNeutral,
  isSemanticAvailable,
  requiredSkillChips,
  suggestLoad,
  taskPeriodSourceLabel,
} from '../../utils/matchingPresentation';

interface Props {
  result: ScoreResult;
  rank: number;
  projects: Project[];
  globalRoles: ProjectRole[];
  isTaskMatch: boolean;
  taskContext: TaskMatchContext | null;
  competenceFilterApplied: boolean;
  requestedWeights?: ScoreWeights;
  highlightedEmpId?: number | null;
  defaultStart: string;
  defaultEnd: string;
  isChecked: boolean;
  onCheck: () => void;
  onRequestAssign: (request: AssignmentRequest) => void;
}

const ScoreBar = ({
  value, color, displayValue, muted,
}: {
  value: number;
  color: string;
  displayValue?: string;
  muted?: boolean;
}) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${muted ? 'bg-slate-600' : color}`}
        style={{ width: `${muted ? 0 : Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
    <span className={`text-xs shrink-0 text-right ${muted ? 'text-slate-500' : 'text-slate-400'}`}>
      {displayValue ?? `${Math.round(value * 100)}%`}
    </span>
  </div>
);

const stateStyle = (state: CandidateAssignmentState) => {
  if (state === 'assigned') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (state === 'recommended') return 'bg-violet-500/10 text-violet-300 border-violet-500/20';
  return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
};

const skillStyle = (state: 'matched' | 'below_minimum' | 'missing') => {
  if (state === 'matched') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (state === 'below_minimum') return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  return 'bg-red-500/10 text-red-300 border-red-500/20';
};

export default function CandidateCard({
  result, rank, projects, globalRoles, isTaskMatch, taskContext, competenceFilterApplied,
  requestedWeights, highlightedEmpId, defaultStart, defaultEnd, isChecked, onCheck, onRequestAssign,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [assignProjectId, setAssignProjectId] = useState<number | ''>(
    Number(sessionStorage.getItem('targetProjectId')) || '',
  );
  const [assignRole, setAssignRole] = useState('');

  const suggestedLoad = suggestLoad(result.availability, result.details?.availability);
  const [assignLoad, setAssignLoad] = useState(suggestedLoad);
  const [assignStart, setAssignStart] = useState(isTaskMatch ? taskContext?.start ?? defaultStart : defaultStart);
  const [assignEnd, setAssignEnd] = useState(isTaskMatch ? taskContext?.end ?? defaultEnd : defaultEnd);



  const notes = explainScore(result.details ?? {});
  const semanticAvailable = isSemanticAvailable(result.details);
  const semanticLabel = formatSemanticSimilarity(result.details);
  const showSemantic = isTaskMatch
    || result.details?.semantic_available !== undefined
    || result.details?.semantic_similarity !== undefined;

  const assignmentState = getCandidateAssignmentState(result, {
    isTaskMode: isTaskMatch,
    assignedUserId: taskContext?.assignedToId ?? null,
    isTopThree: rank <= 3,
  });
  const selectedProject = isTaskMatch
    ? taskContext?.project ?? null
    : projects.find(project => project.id === Number(assignProjectId)) ?? null;
  const availabilityKnown = isAvailabilityKnown(result.details);
  const workloadLabel = currentWorkloadLabel(result);
  const skillChips = requiredSkillChips(result.details);
  const competenceEvaluated = isCompetenceEvaluated(result.details, competenceFilterApplied);
  const performanceNeutral = isPerformanceNeutral(result.details);
  const costNeutral = isCostNeutral(result.details);
  const warningList = [
    ...dataQualityIssues(result, competenceFilterApplied),
    ...availabilityWarnings(result.conflicts),
  ];
  if (!availabilityKnown && !warningList.some(warning => /загруз|workloadentry/i.test(warning))) {
    warningList.unshift('Нет данных о загрузке за период — доступность нельзя считать полной.');
  }
  const alreadyAssignedToTask = isTaskMatch && taskContext?.assignedToId === result.user_id;
  const effectiveWeights = result.details?.weights;
  const effectiveWeightText = effectiveWeights
    ? (['w1', 'w2', 'w3', 'w4', 'w5'] as const)
      .map(key => `${effectiveWeightPercent(effectiveWeights, key) ?? 0}%`)
      .join(' / ')
    : null;
  const requestedWeightText = requestedWeights
    ? (['w1', 'w2', 'w3', 'w4', 'w5'] as const)
      .map(key => `${requestedWeights[key] ?? 0}%`)
      .join(' / ')
    : null;

  const scoreColor = result.total_score >= 0.8 ? 'text-emerald-400' : result.total_score >= 0.6 ? 'text-amber-400' : 'text-red-400';
  const scoreBg = result.total_score >= 0.8 ? 'bg-emerald-500/10 border-emerald-500/20' : result.total_score >= 0.6 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';

  const submitAssignment = () => {
    if (!selectedProject) return;
    const { role, roleRefId } = resolveMemberRole(assignRole, globalRoles);
    const start = isTaskMatch ? taskContext?.start ?? assignStart : assignStart;
    const end = isTaskMatch ? taskContext?.end ?? assignEnd : assignEnd;
    onRequestAssign({
      employeeId: result.employee_id,
      employeeUserId: result.user_id,
      employeeName: result.full_name,
      employeePosition: result.position,
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      taskId: isTaskMatch ? taskContext?.id : undefined,
      taskName: isTaskMatch ? taskContext?.name : undefined,
      role,
      roleRefId,
      load: assignLoad,
      start,
      end,
      isTaskAssignment: isTaskMatch,
      alreadyMember: result.already_member || Boolean(
        selectedProject.members?.some(member => member.user.id === result.user_id),
      ),
      currentAssigneeId: isTaskMatch ? taskContext?.assignedToId ?? null : null,
      currentAssigneeName: isTaskMatch ? taskContext?.assignedToName ?? null : null,
      periodSource: isTaskMatch ? taskContext?.periodSource : undefined,
      deadlineDate: isTaskMatch ? taskContext?.dueDate ?? null : null,
      deadlineStatus: isTaskMatch ? taskContext?.deadlineStatus : undefined,
      competenceFilterApplied,
      availabilityKnown,
    });
  };

  return (
    <div className={`bg-slate-900 border rounded-xl overflow-hidden transition-all duration-200 ${
      result.conflicts.length > 0 ? 'border-amber-500/20' : 'border-slate-800'
    } ${result.employee_id === highlightedEmpId ? 'ring-2 ring-violet-500 shadow-lg shadow-violet-500/20' : ''}`}>
      <div className="flex items-center gap-3 p-4">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onCheck}
          className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-violet-600 focus:ring-violet-500 focus:ring-offset-slate-900 cursor-pointer"
        />
        <div className="w-6 text-center text-sm font-bold text-slate-600">#{rank}</div>
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getGradient(result.employee_id)} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
          {getInitials(result.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h4 className="text-base font-bold text-white truncate">{result.full_name}</h4>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${stateStyle(assignmentState)}`}>
              {assignmentStateLabel(assignmentState, isTaskMatch)}
            </span>
            {!competenceFilterApplied && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                Без проверки навыков
              </span>
            )}
            {isTaskMatch && result.already_member && assignmentState !== 'assigned' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                В команде проекта
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {result.open_task_count > 0
                ? `Открыто задач: ${result.open_task_count}${result.active_task_hours > 0 ? ` · ${result.active_task_hours} ч` : ' · часы не указаны'}`
                : 'Нет открытых задач'}
            </span>
          </div>
          <p className="text-xs text-slate-400">{result.position || 'Кандидат'}</p>
        </div>
        <div className={`text-sm font-bold px-3 py-1 rounded-lg border ${scoreBg} ${scoreColor}`}>
          {Math.round(result.total_score * 100)}
        </div>
        {warningList.length > 0 && (
          <div className="flex items-center gap-1 text-amber-400 text-xs" title={warningList.join('\n')}>
            <AlertTriangle size={13} /><span>{warningList.length} предупр.</span>
          </div>
        )}
        <span
          title={result.details?.availability?.current_workload_known === false
            ? `Нет активных записей о загрузке: текущая занятость неизвестна. Известная оценка открытых задач: ${result.active_task_hours} ч${result.unestimated_task_count ? `; без оценки: ${result.unestimated_task_count}` : ''}`
            : 'Текущая загрузка по записям о занятости'}
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            result.details?.availability?.current_workload_known === false ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' :
            result.current_workload > 100 ? 'bg-red-500/10 text-red-400 border-red-500/20' :
            result.current_workload > 70 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
          {workloadLabel}
        </span>
        <button onClick={() => setExpanded(!expanded)} className="text-slate-600 hover:text-slate-300 transition-colors">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      <div className="border-t border-slate-800/80 px-4 py-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">Требуемые навыки</span>
        {!competenceFilterApplied ? (
          <span className="text-[11px] font-medium text-amber-300">
            Навыки не извлечены из задачи — фильтр компетенций не применялся
          </span>
        ) : skillChips.length > 0 ? skillChips.map(chip => (
          <span key={`${chip.state}-${chip.label}`} className={`text-[10px] px-2 py-0.5 rounded-full border ${skillStyle(chip.state)}`}>
            {chip.label}
          </span>
        )) : (
          <span className="text-[11px] text-slate-500">
            {result.details?.competence?.note ?? 'Требования не заданы'}
          </span>
        )}
      </div>

      {warningList.length > 0 && (
        <div className="mx-4 mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 space-y-1">
          {warningList.map((warning, index) => (
            <p key={`${index}-${warning}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300/90">
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      )}

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-3 bg-slate-900/50">
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <p className="text-[10px] font-bold text-violet-300 uppercase tracking-wider">Объяснение рекомендации</p>
              <span className="text-[9px] px-2 py-0.5 rounded-full border border-violet-500/20 text-violet-300/80">
                {explanationSourceLabel(result.details?.explanation_source)}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{explanationText(result.explanation)}</p>
          </div>
          <div className="space-y-2">
            <div className="mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Разбивка оценок</p>
              <p className="text-[10px] text-slate-500 leading-relaxed mt-1">
                Эффективные веса после исключения недоступных компонентов.
                {requestedWeightText && effectiveWeightText && (
                  <> Исходные: {requestedWeightText}. Эффективные: {effectiveWeightText}.</>
                )}
              </p>
              {isTaskMatch && (
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Итоговый балл: 80% детерминированной оценки + 20% семантического сходства, если оно рассчитано.
                  Веса компонентов относятся к детерминированной части.
                </p>
              )}
            </div>
            {[
              { key: 'w1' as const, label: 'Компетенции', value: result.competence_fit, color: 'bg-violet-500', note: notes.competence },
              { key: 'w2' as const, label: 'Опыт в домене', value: result.experience_similarity, color: 'bg-blue-500', note: notes.experience },
              { key: 'w3' as const, label: 'Доступность', value: result.availability, color: 'bg-emerald-500', note: notes.availability, availability: true },
              { key: 'w4' as const, label: 'Результативность', value: result.past_performance, color: 'bg-amber-500', note: notes.performance },
              { key: 'w5' as const, label: 'Соответствие бюджету', value: result.cost_fit, color: 'bg-pink-500', note: notes.cost },
            ].map(item => {
              const weight = result.details?.weights?.[item.key];
              const unavailable = Boolean(item.availability && !availabilityKnown);
              const excluded = item.key === 'w1' && !competenceEvaluated;
              const neutral = (item.key === 'w4' && performanceNeutral) || (item.key === 'w5' && costNeutral);
              const muted = unavailable || excluded || neutral;
              const displayValue = excluded
                ? 'не учитывается'
                : unavailable
                  ? 'н/д'
                  : neutral
                    ? 'н/д (нейтрально)'
                    : item.availability
                      ? formatAvailabilityScore(item.value, result.details)
                      : undefined;
              return (
                <div key={item.label}>
                  <div className="grid grid-cols-[170px_1fr] items-center gap-3">
                    <span className="text-xs text-slate-400">
                      {item.label}
                      {weight !== undefined && (
                        <span className="text-slate-600">
                          {' · '}{weight <= 0 ? 'не учитывается' : `вес ${Math.round(weight * 100)}%`}
                        </span>
                      )}
                    </span>
                    <ScoreBar
                      value={item.value}
                      color={item.color}
                      muted={muted}
                      displayValue={displayValue}
                    />
                  </div>
                  {item.note && (
                    <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
                      {item.note}
                      {excluded && ' · компонент исключён из формулы'}
                      {neutral && ' · в итоговом балле использовано нейтральное значение'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {showSemantic && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Семантическое сходство</span>
                {semanticAvailable && result.details?.semantic_similarity != null ? (
                  <div className="w-40">
                    <ScoreBar value={result.details.semantic_similarity} color="bg-cyan-500" />
                  </div>
                ) : (
                  <span className="text-[11px] font-medium text-cyan-300/80">Не рассчитано</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">{semanticLabel}</p>
            </div>
          )}
          {result.data_gaps?.length > 0 && (
            <div className="flex items-start gap-2 text-[11px] text-slate-500">
              <Info size={12} className="flex-shrink-0 mt-0.5" />
              <span>Не хватает данных: {result.data_gaps.join(', ').toLowerCase()} — для этих компонентов взято нейтральное значение.</span>
            </div>
          )}
          <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-3 space-y-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Параметры назначения</p>
            {isTaskMatch ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1 uppercase">Задача</label>
                  <p className="text-xs text-slate-200 bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 truncate" title={taskContext?.name}>
                    {taskContext?.name ?? 'Не выбрана'}
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1 uppercase">Проект задачи</label>
                  <p className="text-xs text-slate-200 bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 truncate" title={taskContext?.project.name}>
                    {taskContext?.project.name ?? 'Не найден'}
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1 uppercase">Расчётный период</label>
                  <p className="text-xs text-slate-200 bg-slate-900 border border-slate-800 rounded-lg px-2 py-2">
                    {taskContext?.start} — {taskContext?.end}
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1 uppercase">Дедлайн задачи</label>
                  <p className="text-xs text-slate-200 bg-slate-900 border border-slate-800 rounded-lg px-2 py-2">
                    {taskContext?.dueDate ? formatDateKey(taskContext.dueDate) : 'не задан'}
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase">Проект</label>
                <select
                  value={assignProjectId}
                  onChange={event => setAssignProjectId(Number(event.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500"
                >
                  <option value="">— Выбрать проект —</option>
                  {projects.filter(project => project.status === 'ACTIVE' || project.status === 'AT_RISK').map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>
            )}
            {isTaskMatch && taskContext && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
                <p>
                  Расчётный период: {formatDateKey(taskContext.start)} — {formatDateKey(taskContext.end)}
                  {' · '}{taskPeriodSourceLabel(taskContext.periodSource, taskContext.deadlineStatus)}.
                </p>
                {taskContext.deadlineStatus === 'overdue' && (
                  <p className="text-amber-300 mt-1">
                    Дедлайн {formatDateKey(taskContext.dueDate)} просрочен. Для расчёта и назначения используется
                    нормативный период; проверьте срок задачи.
                  </p>
                )}
                {taskContext.deadlineStatus === 'today' && (
                  <p className="text-amber-300/90 mt-1">
                    Срок истекает сегодня. Для расчёта и назначения используется нормативный период.
                  </p>
                )}
                {taskContext.deadlineStatus === 'missing' && (
                  <p className="text-amber-300/90 mt-1">
                    Срок не задан. Для расчёта и назначения использован нормативный срок.
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase">Должность в проекте</label>
              <MemberRoleSelect
                value={assignRole}
                onChange={setAssignRole}
                positions={globalRoles}
                allowManager={projectPerms(selectedProject).is_manager}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500 appearance-none"
              />
            </div>
            <AllocationInput
              projectId={selectedProject?.id ?? ''}
              userId={result.user_id}
              start={assignStart}
              end={assignEnd}
              onPeriodChange={(start, end) => { setAssignStart(start); setAssignEnd(end); }}
              value={assignLoad}
              onChange={setAssignLoad}
              periodLocked={isTaskMatch}
              availabilityConfirmed={availabilityKnown}
            />
            {isTaskMatch && taskContext?.assignedToName && !alreadyAssignedToTask && (
              <p className="text-[10px] text-amber-300/90">
                Текущий исполнитель задачи: {taskContext.assignedToName}. Назначение заменит его после подтверждения.
              </p>
            )}
            <button
              type="button"
              disabled={!selectedProject || alreadyAssignedToTask}
              onClick={submitAssignment}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 group"
            >
              {isTaskMatch ? <TrendingUp size={16} className="group-hover:translate-y-[-1px] transition-transform" /> : <Zap size={16} className="group-hover:scale-110 transition-transform" />}
              {alreadyAssignedToTask
                ? 'Уже назначен на задачу'
                : !selectedProject
                  ? 'Проект задачи не найден'
                  : isTaskMatch ? 'Назначить на задачу' : 'Назначить на проект'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { AlertTriangle, Info, Sparkles } from 'lucide-react';
import type { ScoreResult } from '../../types/matching';
import {
  unavailabilityWarnings,
  currentWorkloadLabel,
  explanationSourceLabel,
  explanationText,
  formatDateKey,
  formatSemanticSimilarity,
  getGradient,
  getInitials,
  isAvailabilityKnown,
  requiredSkillChips,
} from '../../utils/matchingPresentation';

interface Props {
  result: ScoreResult;
  rank: number;
  selected: boolean;
  dueDate?: string | null;
  competenceFilterApplied: boolean;
  onSelect: () => void;
}

const skillStyle = (state: 'matched' | 'below_minimum' | 'missing') => {
  if (state === 'matched') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (state === 'below_minimum') return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  return 'bg-red-500/10 text-red-300 border-red-500/20';
};

export default function DraftCandidateCard({
  result, rank, selected, dueDate, competenceFilterApplied, onSelect,
}: Props) {
  const availabilityKnown = isAvailabilityKnown(result.details);
  const chips = requiredSkillChips(result.details);
  const experience = result.details?.experience;
  const availabilityRisks = unavailabilityWarnings(result.conflicts);
  const risks = [
    ...result.conflicts.filter(conflict => !availabilityRisks.includes(conflict)),
    ...result.data_gaps.map(gap => `Не хватает данных: ${gap.toLowerCase()}`),
  ].map(risk => risk.trim()).filter(Boolean);
  const compactSkills = chips.slice(0, 3);
  const remainingSkills = Math.max(0, chips.length - compactSkills.length);
  const scoreColor = result.total_score >= 0.8 ? 'text-emerald-400' : result.total_score >= 0.6 ? 'text-amber-400' : 'text-red-400';
  const scoreBg = result.total_score >= 0.8 ? 'bg-emerald-500/10 border-emerald-500/20' : result.total_score >= 0.6 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <article
      className={`rounded-xl border p-3 transition-colors ${
        selected ? 'bg-violet-500/[0.07] border-violet-400/50 shadow-md shadow-violet-950/10' : 'bg-slate-950/45 border-slate-800/90 hover:bg-slate-900/70 hover:border-slate-700'
      }`}
    >
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg focus-within:ring-2 focus-within:ring-violet-400/50">
        <input
          type="radio" name="assistant-assignee" className="sr-only"
          checked={selected} onChange={onSelect}
          aria-label={`Выбрать ${result.full_name}`}
        />
        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ${selected ? 'bg-violet-500' : 'bg-slate-700'}`}>
          {rank}
        </span>
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold text-white ${getGradient(result.employee_id)}`}>
          {getInitials(result.full_name)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-xs font-semibold text-slate-100">
              {result.full_name}
            </span>
            <span className={`flex-shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${scoreBg} ${scoreColor}`}>
              {Math.round(result.total_score * 100)}%
            </span>
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-400">
            {result.position || 'должность не указана'}
            {' · '}загрузка {currentWorkloadLabel(result)}
            {!result.already_member && <span className="text-amber-300"> · не в команде проекта</span>}
          </span>
        </span>
      </label>

      <div className="ml-6 mt-2 flex flex-wrap items-center gap-1">
        {!competenceFilterApplied ? (
          <span className="text-[10px] text-amber-300">Навыки не извлечены</span>
        ) : compactSkills.length > 0 ? compactSkills.map(chip => (
          <span key={`${chip.state}-${chip.label}`} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${skillStyle(chip.state)}`}>
            {chip.label}
          </span>
        )) : (
          <span className="text-[10px] text-slate-500">Требования не заданы</span>
        )}
        {remainingSkills > 0 && <span className="text-[9px] text-slate-500">+{remainingSkills}</span>}
        {!availabilityKnown && <span className="ml-auto text-[9px] text-amber-300">доступность н/д</span>}
      </div>

      <details className="ml-6 mt-2 border-t border-slate-800/80 pt-1.5">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[10px] font-medium text-slate-400 marker:hidden hover:text-slate-200">
          <Info size={11} /> Подробности оценки
        </summary>
        <div className="space-y-2 pt-2">
          <div className="rounded-lg bg-slate-900/70 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-violet-300">
                <Sparkles size={10} /> Объяснение
              </span>
              <span className="text-[9px] text-slate-500">{explanationSourceLabel(result.details?.explanation_source)}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">{explanationText(result.explanation)}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 text-[10px] text-slate-400 sm:grid-cols-2">
            <span className="flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 flex-shrink-0" />
              Опыт: {experience?.domain || 'домен не задан'} · проектов {experience?.domain_projects ?? 0}
              {' · '}задач {experience?.domain_done_tasks ?? 0}
            </span>
            <span>{formatSemanticSimilarity(result.details)}</span>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.map(chip => (
                <span key={`${chip.state}-${chip.label}`} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${skillStyle(chip.state)}`}>
                  {chip.label}
                </span>
              ))}
            </div>
          )}
          {availabilityRisks.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
              <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-200">
                <AlertTriangle size={10} /> Ограничение доступности
              </p>
              {availabilityRisks.map(risk => (
                <p key={risk} className="mt-1 text-[10px] leading-relaxed text-amber-200/90">{risk}</p>
              ))}
              <p className="mt-1 text-[10px] leading-relaxed text-amber-200/80">
                {dueDate ? `Дедлайн: ${formatDateKey(dueDate)}. ` : ''}
                Проверьте, успеет ли сотрудник выполнить задачу к сроку.
              </p>
            </div>
          )}
          {risks.map((risk, index) => (
            <p key={`${index}-${risk}`} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-300/90">
              <AlertTriangle size={10} className="mt-0.5 flex-shrink-0" />
              <span>{risk}</span>
            </p>
          ))}
        </div>
      </details>
    </article>
  );
}

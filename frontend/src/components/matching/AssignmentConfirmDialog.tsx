import { AlertTriangle, Check, X } from 'lucide-react';
import type { AssignmentRequest } from '../../types/matching';
import { formatDateKey, taskPeriodSourceLabel } from '../../utils/matchingPresentation';
import { memberRoleLabel } from '../../utils/roles';

interface Props {
  request: AssignmentRequest | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function AssignmentConfirmDialog({ request, submitting, onCancel, onConfirm }: Props) {
  if (!request) return null;

  const sameAssignee = request.isTaskAssignment
    && request.currentAssigneeId != null
    && request.currentAssigneeId === request.employeeUserId;
  const deadlineWarning = request.isTaskAssignment
    && request.deadlineStatus != null
    && request.deadlineStatus !== 'future';
  const availabilityUnconfirmed = request.availabilityKnown === false;
  const competenceSkipped = request.competenceFilterApplied === false;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignment-confirm-title"
      onClick={() => { if (!submitting) onCancel(); }}
    >
      <div
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-800">
          <div>
            <h2 id="assignment-confirm-title" className="text-lg font-bold text-white">
              Подтвердить назначение
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Проверьте сотрудника и объект назначения. Изменение будет сохранено на сервере.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-slate-500 hover:text-white transition-colors p-1.5 bg-slate-800 rounded-lg hover:bg-slate-700 disabled:opacity-50"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="sm:col-span-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Сотрудник</dt>
              <dd className="text-sm font-semibold text-white">{request.employeeName}</dd>
              <dd className="text-slate-400">{request.employeePosition || 'Должность не указана'}</dd>
            </div>

            {request.isTaskAssignment && (
              <div className="sm:col-span-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-violet-300/80 mb-1">Задача</dt>
                <dd className="text-sm font-semibold text-white">{request.taskName ?? 'Задача не выбрана'}</dd>
              </div>
            )}

            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                {request.isTaskAssignment ? 'Проект задачи' : 'Проект'}
              </dt>
              <dd className="text-slate-200 font-medium">{request.projectName}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Должность</dt>
              <dd className="text-slate-200 font-medium">{memberRoleLabel(request.role)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Загрузка</dt>
              <dd className="text-slate-200 font-medium">{request.load}%</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                {request.isTaskAssignment ? 'Расчётный период' : 'Период'}
              </dt>
              <dd className="text-slate-200 font-medium">
                {formatDateKey(request.start)} — {formatDateKey(request.end)}
              </dd>
              {request.isTaskAssignment && request.periodSource && (
                <dd className="text-[10px] text-slate-500 mt-0.5">
                  {taskPeriodSourceLabel(request.periodSource, request.deadlineStatus ?? 'future')}
                </dd>
              )}
            </div>
            {request.isTaskAssignment && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Дедлайн задачи</dt>
                <dd className={`font-medium ${
                  request.deadlineStatus === 'overdue' ? 'text-red-400' : 'text-slate-200'
                }`}>
                  {request.deadlineDate ? formatDateKey(request.deadlineDate) : 'не задан'}
                </dd>
                {request.deadlineStatus && request.deadlineStatus !== 'future' && (
                  <dd className="text-[10px] text-amber-300/90 mt-0.5">
                    {request.deadlineStatus === 'overdue'
                      ? 'Срок уже истёк'
                      : request.deadlineStatus === 'today'
                        ? 'Срок истекает сегодня'
                        : 'Дедлайн отсутствует'}
                  </dd>
                )}
              </div>
            )}
          </dl>

          {request.isTaskAssignment && request.currentAssigneeName && (
            <div className={`rounded-xl border p-3 text-xs ${
              sameAssignee
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200'
                : 'border-amber-500/20 bg-amber-500/5 text-amber-200'
            }`}>
              <p className="flex items-start gap-2">
                {sameAssignee ? <Check size={14} className="flex-shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />}
                <span>
                  {sameAssignee
                    ? 'Этот сотрудник уже назначен на задачу.'
                    : `Текущий исполнитель: ${request.currentAssigneeName}. Он будет заменён после подтверждения.`}
                </span>
              </p>
            </div>
          )}

          {request.alreadyMember && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-200">
              Сотрудник уже состоит в команде этого проекта. Назначение обновит его участие.
            </div>
          )}

          {deadlineWarning && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              <p className="flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  {request.deadlineStatus === 'overdue'
                    ? 'Срок задачи уже истёк. Период назначения рассчитан по нормативному сроку — проверьте актуальность даты.'
                    : request.deadlineStatus === 'today'
                      ? 'Срок задачи истекает сегодня. Период назначения рассчитан по нормативному сроку.'
                      : 'Срок задачи не задан. Период назначения рассчитан по нормативному сроку.'}
                </span>
              </p>
            </div>
          )}

          {availabilityUnconfirmed && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              <p className="flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  За период нет подтверждённых записей о загрузке. Загрузка рассчитана по календарю
                  и может быть неточной.
                </span>
              </p>
            </div>
          )}

          {competenceSkipped && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              <p className="flex items-start gap-2">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  Навыки не были извлечены из задачи, поэтому фильтр компетенций не применялся.
                  Проверьте требования к задаче вручную.
                </span>
              </p>
            </div>
          )}

          <p className="text-[11px] text-slate-500 leading-relaxed">
            После подтверждения изменится только выбранное назначение. Формула подбора, оценки и база данных не изменяются.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || sameAssignee}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Сохраняем…
              </>
            ) : (
              <>
                <Check size={14} />
                Подтвердить назначение
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ArrowRight, Check, Package, Scaling, Calendar, Loader2, Info } from 'lucide-react';
import { useAppContext, type PlanningBlock, type Project } from '../context/AppContext';
import { toast } from 'react-hot-toast';
import { projectPerms } from '../utils/roles';
import { startOfToday, toDateKey } from '../utils/dates';

/** Корневая задача этапа (с подзадачами) в том виде, в каком её отдаёт API */
interface SourceTask {
  id: number;
  name: string;
  duration_days: number;
  estimated_hours: number;
  subtasks?: SourceTask[];
}

interface TransferWizardProps {
  source: PlanningBlock | Project;
  isOpen: boolean;
  onClose: () => void;
  targetProjectId?: number;
}

export default function TransferWizard({ source, isOpen, onClose, targetProjectId: initialTargetId }: TransferWizardProps) {
  const { projects, transferBlock } = useAppContext();
  const navigate = useNavigate();
  const [step, setStep] = useState(initialTargetId ? 2 : 1);
  const [submitting, setSubmitting] = useState(false);

  // Configuration
  const [targetProjectId, setTargetProjectId] = useState<number | ''>(initialTargetId || '');
  const [scalingFactor, setScalingFactor] = useState(1.0);
  const [startDateOverride, setStartDateOverride] = useState('');

  const sourceName = source.name;
  // Корневые задачи этапа; подзадачи переносятся вместе с родителем
  const sourceTasks: SourceTask[] = (source as PlanningBlock).tasks ?? [];
  // Мастер создаётся заново при каждом открытии, поэтому начальный выбор — все задачи
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>(() => sourceTasks.map(t => t.id));

  // Дата начала по умолчанию — начало целевого проекта, но не в прошлом; пользователь может изменить
  const defaultStartDate = (() => {
    const target = projects.find(p => p.id === Number(targetProjectId));
    const today = toDateKey(startOfToday());
    return target?.start_date && target.start_date > today ? target.start_date : today;
  })();
  const startDate = startDateOverride || defaultStartDate;

  const countWithSubtasks = (task: SourceTask): number =>
    1 + (task.subtasks ?? []).reduce((sum, t) => sum + countWithSubtasks(t), 0);
  const sumHours = (task: SourceTask): number =>
    (task.estimated_hours || 0) + (task.subtasks ?? []).reduce((sum, t) => sum + sumHours(t), 0);
  const selectedRoots = sourceTasks.filter(t => selectedTaskIds.includes(t.id));
  const totalTasks = selectedRoots.reduce((sum, t) => sum + countWithSubtasks(t), 0);
  const totalHours = selectedRoots.reduce((sum, t) => sum + sumHours(t), 0) * scalingFactor;

  const handleFinish = async () => {
    if (!targetProjectId) {
      toast.error('Выберите целевой проект');
      return;
    }

    setSubmitting(true);
    try {
      const target = projects.find(p => p.id === Number(targetProjectId));
      if (!target) return;

      if (!startDate) {
        toast.error('Укажите дату начала этапа');
        return;
      }

      await transferBlock(
        source.id,
        target.id,
        startDate,
        scalingFactor,
        selectedTaskIds
      );
      
      toast.success(`Этап «${sourceName}» перенесен в проект «${target.name}»`);
      onClose();
      navigate('/projects');
    } catch {
      // Ошибку уже показал transferBlock
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500/10 rounded-lg text-violet-400">
              <Package size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Мастер переноса этапа</h2>
              <p className="text-xs text-slate-500">Источник: {sourceName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-xl text-slate-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Steps Progress */}
        <div className="px-6 py-4 bg-slate-800/20 flex items-center gap-4 border-b border-slate-800">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                step >= i ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}>
                {step > i ? <Check size={12} /> : i}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                step >= i ? 'text-slate-200' : 'text-slate-600'
              }`}>
                {i === 1 ? 'Цель' : i === 2 ? 'Настройка' : 'Задачи'}
              </span>
              {i < 3 && <div className="w-8 h-px bg-slate-800" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-2 text-center mb-8">
                <div className="w-16 h-16 bg-violet-500/10 rounded-2xl flex items-center justify-center text-violet-400 mx-auto mb-4">
                  <ArrowRight size={32} />
                </div>
                <h3 className="text-xl font-bold text-white">Куда импортируем?</h3>
                <p className="text-sm text-slate-500">Выберите проект, в который будет добавлен данный этап</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {projects.filter(p => p.status !== 'COMPLETED' && p.status !== 'CANCELLED' && projectPerms(p).can_edit_tasks).map(p => (
                  <button
                    key={p.id}
                    onClick={() => setTargetProjectId(p.id)}
                    className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${
                      targetProjectId === p.id 
                        ? 'bg-violet-500/10 border-violet-500/50 shadow-lg shadow-violet-500/5' 
                        : 'bg-slate-800/30 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400">
                        {p.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{p.name}</p>
                        <p className="text-[10px] text-slate-500">{p.domain}</p>
                      </div>
                    </div>
                    {targetProjectId === p.id && <Check className="text-violet-500" size={20} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                    <Scaling size={14} className="text-violet-400" />
                    Масштабирование трудозатрат
                  </label>
                  <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm text-slate-300">Коэффициент: <span className="text-violet-400 font-bold">{scalingFactor}x</span></span>
                      <span className="text-[10px] text-slate-500">Адаптация под объем проекта</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="5.0" step="0.1" 
                      value={scalingFactor} onChange={e => setScalingFactor(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <div className="flex justify-between mt-2 text-[10px] text-slate-600 font-bold">
                      <span>0.1x (Мини)</span>
                      <span>1.0x (Норма)</span>
                      <span>5.0x (Макси)</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                    <Calendar size={14} className="text-violet-400" />
                    Дата начала этапа
                  </label>
                  <input
                    type="date" value={startDate} onChange={e => setStartDateOverride(e.target.value)}
                    className="w-full bg-slate-800/40 border border-slate-800 rounded-2xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
                  />
                  <p className="text-[11px] text-slate-500">От этой даты считаются сроки всех задач этапа по рабочему календарю проекта.</p>
                </div>
              </div>

              <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <p className="text-[11px] text-amber-400/80 leading-relaxed flex items-start gap-2">
                  <Info size={13} className="flex-shrink-0 mt-0.5" />
                  Коэффициент меняет длительность и трудозатраты каждой задачи. Даты пересчитываются по рабочему календарю целевого проекта (без выходных и праздников). Исполнители не копируются — назначайте их уже в проекте.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Выбор задач ({selectedTaskIds.length})</h3>
                <button 
                  onClick={() => setSelectedTaskIds(selectedTaskIds.length === sourceTasks.length ? [] : sourceTasks.map((t: SourceTask) => t.id))}
                  className="text-[10px] font-bold text-violet-400 uppercase hover:text-violet-300"
                >
                  {selectedTaskIds.length === sourceTasks.length ? 'Снять все' : 'Выбрать все'}
                </button>
              </div>

              <div className="space-y-2">
                {sourceTasks.length > 0 ? sourceTasks.map((task: SourceTask) => {
                  const checked = selectedTaskIds.includes(task.id);
                  const subtasks = task.subtasks ?? [];
                  return (
                    <div key={task.id}>
                      <div
                        onClick={() => setSelectedTaskIds(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [...prev, task.id])}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                          checked ? 'bg-slate-800/50 border-violet-500/30' : 'bg-slate-900 border-slate-800/50 opacity-60 grayscale'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                          checked ? 'bg-violet-600 border-violet-600' : 'border-slate-700'
                        }`}>
                          {checked && <Check size={12} className="text-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-200">{task.name}</p>
                          <p className="text-[10px] text-slate-500">
                            {Math.max(1, Math.round(task.duration_days * scalingFactor))} дн. · {task.estimated_hours > 0 ? `${Math.round(task.estimated_hours * scalingFactor * 10) / 10} ч` : 'трудозатраты не оценены'}
                            {subtasks.length > 0 && ` · подзадач: ${subtasks.length}`}
                          </p>
                        </div>
                      </div>
                      {checked && subtasks.map((sub: SourceTask) => (
                        <p key={sub.id} className="ml-11 mt-1 text-[11px] text-slate-500">↳ {sub.name}</p>
                      ))}
                    </div>
                  );
                }) : (
                  <p className="text-center py-8 text-slate-500 text-sm">В этом этапе нет вложенных задач</p>
                )}
              </div>

              {sourceTasks.length > 0 && (
                <p className="text-xs text-slate-400 pt-2 border-t border-slate-800">
                  Будет создано задач: <b className="text-slate-200">{totalTasks}</b>
                  {totalHours > 0 && <> · трудозатраты ≈ <b className="text-slate-200">{Math.round(totalHours * 10) / 10} ч</b></>}
                  {' · '}масштаб <b className="text-slate-200">{scalingFactor}×</b>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <button
            onClick={() => setStep(prev => Math.max(initialTargetId ? 2 : 1, prev - 1))}
            disabled={(initialTargetId ? step === 2 : step === 1) || submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-400 hover:text-white disabled:opacity-0 transition-all"
          >
            <ArrowLeft size={16} /> Назад
          </button>
          
          {step < 3 ? (
            <button
              onClick={() => setStep(prev => prev + 1)}
              disabled={step === 1 && !targetProjectId}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
            >
              Далее <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={submitting || selectedTaskIds.length === 0}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-8 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 shadow-lg shadow-violet-500/20"
            >
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
              {submitting ? 'Импортируем...' : 'Завершить импорт'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

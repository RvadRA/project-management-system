import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ArrowRight, Check, Package, Scaling, Calendar, ListChecks, Loader2 } from 'lucide-react';
import { useAppContext, type PlanningBlock, type Project } from '../context/AppContext';
import { toast } from 'react-hot-toast';

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
  const [copyTeam, setCopyTeam] = useState(false);
  const [copyDates, setCopyDates] = useState(true);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);

  const isTemplate = 'is_template' in source && (source as PlanningBlock).is_template;
  const sourceName = source.name;
  const sourceTasks = (source as any).tasks || [];

  useEffect(() => {
    if (sourceTasks.length > 0) {
      setSelectedTaskIds(sourceTasks.map((t: any) => t.id));
    }
  }, [sourceTasks]);

  const handleFinish = async () => {
    if (!targetProjectId) {
      toast.error('Выберите целевой проект');
      return;
    }

    setSubmitting(true);
    try {
      const target = projects.find(p => p.id === Number(targetProjectId));
      if (!target) return;

      const startDate = target.start_date || new Date().toISOString().split('T')[0];

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
    } catch (err) {
      // Toast handled in context
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
                {projects.filter(p => p.status !== 'COMPLETED' && p.status !== 'CANCELLED').map(p => (
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      <Calendar size={14} className="text-violet-400" />
                      Сроки
                    </label>
                    <button 
                      onClick={() => setCopyDates(!copyDates)}
                      className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                        copyDates ? 'bg-violet-500/10 border-violet-500/30' : 'bg-slate-800/30 border-slate-800 text-slate-500'
                      }`}
                    >
                      <span className="text-xs font-medium">Копировать даты</span>
                      <div className={`w-8 h-4 rounded-full transition-colors relative ${copyDates ? 'bg-violet-600' : 'bg-slate-700'}`}>
                        <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${copyDates ? 'right-1' : 'left-1'}`} />
                      </div>
                    </button>
                  </div>

                  {!isTemplate && (
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                        <ListChecks size={14} className="text-violet-400" />
                        Ресурсы
                      </label>
                      <button 
                        onClick={() => setCopyTeam(!copyTeam)}
                        className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${
                          copyTeam ? 'bg-violet-500/10 border-violet-500/30' : 'bg-slate-800/30 border-slate-800 text-slate-500'
                        }`}
                      >
                        <span className="text-xs font-medium">Копировать команду</span>
                        <div className={`w-8 h-4 rounded-full transition-colors relative ${copyTeam ? 'bg-violet-600' : 'bg-slate-700'}`}>
                          <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${copyTeam ? 'right-1' : 'left-1'}`} />
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <p className="text-[11px] text-amber-400/80 leading-relaxed italic">
                  * Система автоматически пересчитает даты задач с учетом рабочего календаря целевого проекта (исключая выходные и праздники).
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Выбор задач ({selectedTaskIds.length})</h3>
                <button 
                  onClick={() => setSelectedTaskIds(selectedTaskIds.length === sourceTasks.length ? [] : sourceTasks.map((t: any) => t.id))}
                  className="text-[10px] font-bold text-violet-400 uppercase hover:text-violet-300"
                >
                  {selectedTaskIds.length === sourceTasks.length ? 'Снять все' : 'Выбрать все'}
                </button>
              </div>

              <div className="space-y-2">
                {sourceTasks.length > 0 ? sourceTasks.map((task: any) => (
                  <div 
                    key={task.id}
                    onClick={() => setSelectedTaskIds(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [...prev, task.id])}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedTaskIds.includes(task.id) 
                        ? 'bg-slate-800/50 border-violet-500/30' 
                        : 'bg-slate-900 border-slate-800/50 opacity-60 grayscale'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      selectedTaskIds.includes(task.id) ? 'bg-violet-600 border-violet-600' : 'border-slate-700'
                    }`}>
                      {selectedTaskIds.includes(task.id) && <Check size={12} className="text-white" />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">{task.name}</p>
                      <p className="text-[10px] text-slate-500">{task.task_type} • {task.estimated_hours} ч.</p>
                    </div>
                  </div>
                )) : (
                  <p className="text-center py-8 text-slate-500 text-sm">В этом этапе нет вложенных задач</p>
                )}
              </div>
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

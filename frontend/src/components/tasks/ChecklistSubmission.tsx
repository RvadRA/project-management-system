import { useState } from 'react';
import { 
  AlertTriangle, 
  Send, Loader2, ChevronDown, ChevronUp 
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppContext } from '../../context/AppContext';

interface ChecklistSubmissionProps {
  task: any;
  onClose: () => void;
}

export function ChecklistSubmission({ task, onClose }: ChecklistSubmissionProps) {
  const { submitTaskReport } = useAppContext();
  const [items, setItems] = useState(() => {
    // Initialize from task checklist
    return (task.checklist || task.report?.checklist || []).map((item: any) => ({
      ...item,
      is_done: item.is_done || false,
    }));
  });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const allRequiredDone = items
    .filter((item: any) => item.is_required !== false)
    .every((item: any) => item.is_done);

  const completedCount = items.filter((item: any) => item.is_done).length;
  const progressPercent = items.length > 0 
    ? Math.round((completedCount / items.length) * 100) 
    : 0;

  // Group by category
  const categories = items.reduce((acc: any, item: any) => {
    const cat = item.category || 'Основное';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const toggleItem = (itemId: number) => {
    setItems((prev: any[]) =>
      prev.map(item =>
        item.id === itemId ? { ...item, is_done: !item.is_done } : item
      )
    );
  };

  const handleSubmit = async () => {
    if (!allRequiredDone) {
      const undone = items.filter(
        (item: any) => item.is_required !== false && !item.is_done
      );
      toast.error(
        `Не все обязательные пункты выполнены! Осталось: ${undone.length}`
      );
      return;
    }

    setSubmitting(true);
    try {
      await submitTaskReport(task.id, {
        text_content: comment,
        checklist: items.map((item: any) => ({
          id: item.id,
          text: item.text,
          is_done: item.is_done,
        })),
      });
      toast.success('Чек-лист отправлен на проверку');
      onClose();
    } catch (err: any) {
      toast.error('Ошибка при отправке чек-листа');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between p-4 bg-slate-800/30 border border-slate-800 rounded-xl">
        <div>
          <p className="text-sm font-bold text-white">
            Прогресс: {completedCount} / {items.length}
          </p>
          <p className="text-xs text-slate-500">
            {allRequiredDone ? '✓ Все обязательные пункты выполнены' : 'Есть невыполненные пункты'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-violet-400">{progressPercent}%</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            progressPercent === 100 ? 'bg-emerald-500' : 'bg-violet-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Checklist items by category */}
      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        {Object.entries(categories).map(([category, categoryItems]: [string, any]) => {
          const catCompleted = categoryItems.filter((item: any) => item.is_done).length;
          const catTotal = categoryItems.length;
          const isExpanded = expandedCategories.has(category);

          return (
            <div key={category} className="bg-slate-800/20 border border-slate-800 rounded-xl overflow-hidden">
              {/* Category header */}
              <button
                onClick={() => {
                  const newExpanded = new Set(expandedCategories);
                  if (newExpanded.has(category)) {
                    newExpanded.delete(category);
                  } else {
                    newExpanded.add(category);
                  }
                  setExpandedCategories(newExpanded);
                }}
                className="w-full flex items-center justify-between p-3 hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                  <span className="text-sm font-bold text-white">{category}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  catCompleted === catTotal 
                    ? 'bg-emerald-500/10 text-emerald-400' 
                    : 'bg-slate-700 text-slate-400'
                }`}>
                  {catCompleted}/{catTotal}
                </span>
              </button>

              {/* Category items */}
              {isExpanded && (
                <div className="divide-y divide-slate-800">
                  {categoryItems.map((item: any) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-3 p-3 hover:bg-slate-800/20 cursor-pointer transition-colors group"
                    >
                      <input
                        type="checkbox"
                        checked={item.is_done}
                        onChange={() => toggleItem(item.id)}
                        className="w-5 h-5 rounded border-2 border-slate-600 text-violet-500 focus:ring-0 focus:ring-offset-0 mt-0.5 cursor-pointer"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm transition-all ${
                            item.is_done ? 'text-slate-500 line-through' : 'text-slate-200'
                          }`}>
                            {item.text}
                            {item.is_required !== false && (
                              <span className="text-red-400 ml-1">*</span>
                            )}
                          </p>
                          
                          {item.is_required !== false && !item.is_done && (
                            <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                          )}
                        </div>
                        
                        {item.description && (
                          <p className="text-[10px] text-slate-600 mt-1">{item.description}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Comment */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">
          Комментарий к выполнению
        </label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Дополнительная информация о выполнении чек-листа..."
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg"
        >
          Отмена
        </button>

        <button
          onClick={handleSubmit}
          disabled={!allRequiredDone || submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
          {submitting ? 'Отправка...' : 'Отправить чек-лист'}
        </button>
      </div>
    </div>
  );
}

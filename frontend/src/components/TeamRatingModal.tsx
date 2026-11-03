import { useEffect, useState } from 'react';
import { Star, X, Award, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';

interface RatingRow {
  user_id: number;
  full_name: string;
  position: string;
  stars: number | null;
  comment: string;
  rated_at: string | null;
  rated_by: string | null;
}

interface Props {
  projectId: number;
  projectName: string;
  onClose: () => void;
}

const STAR_HINTS = ['', 'Слабо', 'Ниже ожиданий', 'Нормально', 'Хорошо', 'Отлично'];

/**
 * Оценка участников по итогам проекта (1–5). Оценки сохраняются в историю сотрудника
 * и учитываются в подборе команды как составляющая «Результативность».
 */
export default function TeamRatingModal({ projectId, projectName, onClose }: Props) {
  const { user } = useAuth();
  const { extractError } = useAppContext();
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [draft, setDraft] = useState<Record<number, { stars: number | null; comment: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<{ ratings: RatingRow[] }>(`/projects/list/${projectId}/ratings/`)
      .then(res => {
        if (cancelled) return;
        // Себя оценивать нельзя
        const others = res.data.ratings.filter(r => r.user_id !== user?.id);
        setRows(others);
        setDraft(Object.fromEntries(others.map(r => [r.user_id, { stars: r.stars, comment: r.comment }])));
      })
      .catch(err => { if (!cancelled) { toast.error(extractError(err, 'Не удалось загрузить участников')); onClose(); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const rated = rows.filter(r => draft[r.user_id]?.stars);

  const save = async () => {
    if (rated.length === 0) { toast.error('Поставьте оценку хотя бы одному участнику'); return; }
    setSaving(true);
    try {
      await api.post(`/projects/list/${projectId}/ratings/`, {
        ratings: rated.map(r => ({ user_id: r.user_id, stars: draft[r.user_id].stars, comment: draft[r.user_id].comment })),
      });
      toast.success(`Оценки сохранены: ${rated.length}`);
      onClose();
    } catch (err) {
      toast.error(extractError(err, 'Не удалось сохранить оценки'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-slate-800 flex items-start justify-between flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Award size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Оценка команды</h2>
              <p className="text-xs text-slate-400 mt-0.5">«{projectName}» завершён. Оценки попадут в историю сотрудников и повлияют на подбор команды.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={20} /></button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar space-y-3 flex-1">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-violet-400" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">В проекте нет других участников для оценки.</p>
          ) : rows.map(row => {
            const item = draft[row.user_id] ?? { stars: null, comment: '' };
            return (
              <div key={row.user_id} className="p-3.5 bg-slate-800/30 border border-slate-800 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">{row.full_name}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">{row.position}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" role="radiogroup" aria-label={`Оценка: ${row.full_name}`}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button
                        key={n} type="button" role="radio" aria-checked={item.stars === n}
                        title={STAR_HINTS[n]}
                        onClick={() => setDraft(d => ({ ...d, [row.user_id]: { ...item, stars: item.stars === n ? null : n } }))}
                        className="p-0.5"
                      >
                        <Star size={20} className={item.stars && n <= item.stars ? 'fill-amber-400 text-amber-400' : 'text-slate-600 hover:text-amber-300'} />
                      </button>
                    ))}
                  </div>
                </div>
                {item.stars && (
                  <>
                    <p className="text-[11px] text-amber-300 font-medium">{STAR_HINTS[item.stars]}</p>
                    <input
                      type="text" value={item.comment} maxLength={1000}
                      onChange={e => setDraft(d => ({ ...d, [row.user_id]: { ...item, comment: e.target.value } }))}
                      placeholder="Комментарий (необязательно)"
                      className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500"
                    />
                  </>
                )}
                {row.rated_at && (
                  <p className="text-[10px] text-slate-600">Оценено {new Date(row.rated_at).toLocaleDateString('ru-RU')}{row.rated_by ? ` · ${row.rated_by}` : ''}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-500">Оценено: {rated.length} из {rows.length}</span>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">Позже</button>
            <button
              onClick={save} disabled={saving || rated.length === 0}
              className="px-6 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all"
            >
              {saving ? 'Сохранение…' : 'Сохранить оценки'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

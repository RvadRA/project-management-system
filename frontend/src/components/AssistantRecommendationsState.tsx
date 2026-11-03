import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { assistantRecommendationsEmptyMessage } from '../utils/assistantWorkflow';

interface Props {
  state: 'empty' | 'loading' | 'error';
  error?: string | null;
  previousDraftKept?: boolean;
  retryDisabled?: boolean;
  onRetry: () => void;
}

export default function AssistantRecommendationsState({
  state, error, previousDraftKept = false, retryDisabled = false, onRetry,
}: Props) {
  return (
    <section
      className="flex min-h-40 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-6 text-center lg:h-full lg:min-h-0"
      aria-live="polite"
    >
      {state === 'loading' ? (
        <>
          <Loader2 size={20} className="animate-spin text-violet-400" />
          <p className="text-sm font-medium text-slate-200">Разбираю поручение…</p>
          <p className="max-w-sm text-xs leading-relaxed text-slate-400">
            {previousDraftKept
              ? 'Предыдущий черновик сохранён, обновлённые рекомендации появятся после ответа.'
              : 'Черновик и рекомендации появятся здесь после обработки.'}
          </p>
        </>
      ) : state === 'error' ? (
        <>
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm font-medium text-red-200">Не удалось разобрать поручение</p>
          <p role="alert" className="max-w-sm text-xs leading-relaxed text-slate-300">{error}</p>
          {previousDraftKept && (
            <p className="max-w-sm text-xs leading-relaxed text-slate-400">Предыдущий черновик сохранён и не перезаписан.</p>
          )}
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="mt-1 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500/50 hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={13} /> Повторить разбор
          </button>
        </>
      ) : (
        <>
          <Sparkles size={20} className="text-violet-400" />
          <p className="text-sm font-medium text-slate-300">{assistantRecommendationsEmptyMessage}</p>
          <p className="max-w-sm text-xs leading-relaxed text-slate-500">Сначала опишите или продиктуйте задачу — здесь появятся Top-3 и предупреждения по исполнителям.</p>
        </>
      )}
    </section>
  );
}

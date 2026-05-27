import { useState } from 'react';
import {
  Zap, Play, RotateCw, CheckCircle2, XCircle,
  Loader2, Copy, Eye, EyeOff, Send
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppContext } from '../../context/AppContext';

interface IntegrationSubmissionProps {
  task: any;
  onClose: () => void;
}

interface ExecutionResult {
  status: 'success' | 'failure' | 'pending';
  status_code?: number;
  response_body?: string;
  response_headers?: Record<string, string>;
  duration_ms?: number;
  error?: string;
  timestamp: string;
  attempt: number;
}

export function IntegrationSubmission({ task, onClose }: IntegrationSubmissionProps) {
  const { submitTaskReport } = useAppContext();
  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [executing, setExecuting] = useState(false);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showHeaders, setShowHeaders] = useState(false);
  const [showBody, setShowBody] = useState(false);

  const maxRetries = task.retry_count || 3;
  const retryDelay = task.retry_delay_seconds || 5;
  const currentAttempt = results.length;
  const lastResult = results[results.length - 1];
  const isSuccess = lastResult?.status === 'success';
  const canRetry = !isSuccess && currentAttempt < maxRetries;

  const executeRequest = async (attempt: number) => {
    setExecuting(true);
    const startTime = Date.now();

    try {
      // Simulate API call (in real app, this calls your backend)
      const result: ExecutionResult = {
        status: 'success',
        status_code: 200,
        response_body: JSON.stringify({ message: 'Integration successful', timestamp: new Date().toISOString() }),
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        attempt: attempt + 1,
      };

      setResults(prev => [...prev, result]);
      
      if (result.status === 'success') {
        toast.success('Интеграция выполнена успешно!');
      }
    } catch (err: any) {
      const result: ExecutionResult = {
        status: 'failure',
        error: err.message || 'Unknown error',
        timestamp: new Date().toISOString(),
        attempt: attempt + 1,
      };
      setResults(prev => [...prev, result]);
      toast.error(`Ошибка интеграции: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleRetry = async () => {
    if (!canRetry) return;
    
    // Wait for retry delay
    toast(`Повторная попытка через ${retryDelay}с...`, { icon: '⏳' });
    await new Promise(resolve => setTimeout(resolve, retryDelay * 1000));
    await executeRequest(currentAttempt);
  };

  const handleSubmit = async () => {
    if (!isSuccess) {
      toast.error('Интеграция должна быть успешно выполнена перед отправкой');
      return;
    }

    setSubmitting(true);
    try {
      await submitTaskReport(task.id, {
        text_content: JSON.stringify({
          integration_result: lastResult,
          comment,
          attempts: results.length,
        }),
      });
      toast.success('Результат интеграции отправлен');
      onClose();
    } catch (err: any) {
      toast.error('Ошибка при отправке');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Integration info */}
      <div className="p-4 bg-pink-500/5 border border-pink-500/20 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
            <Zap size={20} className="text-pink-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Интеграционная задача</h3>
            <p className="text-xs text-slate-400">
              {task.http_method || 'POST'} {task.webhook_url || 'https://api.example.com/webhook'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2 bg-slate-800/30 rounded-lg">
            <p className="text-slate-500 mb-1">Метод</p>
            <p className="text-white font-bold">{task.http_method || 'POST'}</p>
          </div>
          <div className="p-2 bg-slate-800/30 rounded-lg">
            <p className="text-slate-500 mb-1">Таймаут</p>
            <p className="text-white font-bold">{task.timeout_seconds || 30}с</p>
          </div>
          <div className="p-2 bg-slate-800/30 rounded-lg">
            <p className="text-slate-500 mb-1">Повторов</p>
            <p className="text-white font-bold">{currentAttempt}/{maxRetries}</p>
          </div>
          <div className="p-2 bg-slate-800/30 rounded-lg">
            <p className="text-slate-500 mb-1">Задержка</p>
            <p className="text-white font-bold">{retryDelay}с</p>
          </div>
        </div>

        {/* URL */}
        <div className="mt-3 p-2 bg-slate-800/30 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-500 uppercase">URL</p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(task.webhook_url || 'https://api.example.com/webhook');
                toast.success('URL скопирован');
              }}
              className="text-slate-500 hover:text-white"
            >
              <Copy size={12} />
            </button>
          </div>
          <p className="text-xs text-slate-300 font-mono break-all">{task.webhook_url || 'https://api.example.com/webhook'}</p>
        </div>

        {/* Headers */}
        {task.headers && Object.keys(task.headers).length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowHeaders(!showHeaders)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-white"
            >
              {showHeaders ? <EyeOff size={12} /> : <Eye size={12} />}
              Headers ({Object.keys(task.headers).length})
            </button>
            {showHeaders && (
              <div className="mt-2 p-2 bg-slate-800/30 rounded-lg font-mono text-xs">
                {Object.entries(task.headers).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-violet-400">{key}:</span>
                    <span className="text-slate-300">{value as string}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Execution button */}
      {!lastResult && (
        <button
          onClick={() => executeRequest(0)}
          disabled={executing}
          className="w-full flex items-center justify-center gap-3 p-6 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white rounded-xl transition-all shadow-lg shadow-pink-600/20"
        >
          {executing ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Выполнение...
            </>
          ) : (
            <>
              <Play size={20} />
              Выполнить интеграцию
            </>
          )}
        </button>
      )}

      {/* Execution results */}
      {results.map((result, idx) => (
        <div
          key={idx}
          className={`p-4 rounded-xl border-2 ${
            result.status === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-red-500/30 bg-red-500/5'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {result.status === 'success' ? (
                <CheckCircle2 size={20} className="text-emerald-400" />
              ) : (
                <XCircle size={20} className="text-red-400" />
              )}
              <div>
                <p className={`text-sm font-bold ${result.status === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.status === 'success' ? 'Успешно' : 'Ошибка'}
                </p>
                <p className="text-[10px] text-slate-500">
                  Попытка {result.attempt} · {result.duration_ms}ms
                </p>
              </div>
            </div>
            <span className="text-[10px] text-slate-500">
              {new Date(result.timestamp).toLocaleTimeString('ru-RU')}
            </span>
          </div>

          {result.status_code && (
            <div className="mb-2">
              <span className="text-xs text-slate-400">Status: </span>
              <span className={`text-xs font-bold ${
                result.status_code < 400 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {result.status_code}
              </span>
            </div>
          )}

          {result.error && (
            <p className="text-sm text-red-400 bg-red-500/10 p-2 rounded-lg">
              {result.error}
            </p>
          )}

          {result.response_body && (
            <div>
              <button
                onClick={() => setShowBody(!showBody)}
                className="text-xs text-slate-500 hover:text-white mb-1"
              >
                {showBody ? 'Скрыть' : 'Показать'} ответ
              </button>
              {showBody && (
                <pre className="text-xs text-slate-300 bg-slate-800/50 p-2 rounded-lg overflow-x-auto max-h-40">
                  {result.response_body}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Retry button */}
      {canRetry && !executing && (
        <button
          onClick={handleRetry}
          disabled={executing}
          className="w-full flex items-center justify-center gap-2 p-4 bg-amber-600/10 border border-amber-500/30 text-amber-400 hover:bg-amber-600/20 rounded-xl transition-all"
        >
          <RotateCw size={16} />
          Повторить (попытка {currentAttempt + 1} из {maxRetries})
        </button>
      )}

      {/* Comment */}
      {isSuccess && (
        <div>
          <label className="text-xs text-slate-400 block mb-2">
            Комментарий
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Дополнительная информация..."
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-violet-500 resize-none"
          />
        </div>
      )}

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
          disabled={!isSuccess || submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl"
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
          {submitting ? 'Отправка...' : 'Отправить результат'}
        </button>
      </div>
    </div>
  );
}

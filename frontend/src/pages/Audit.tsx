import { useAppContext } from '../context/AppContext';
import { History, User, Calendar, Box, Package, ArrowLeft, Edit2, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const actionIcons: Record<string, any> = {
  PROJECT_CREATED: Box,
  PROJECT_UPDATED: Edit2,
  PROJECT_DELETED: Trash2,
  MEMBER_ADDED: User,
  PLANNING_IMPORTED: Package,
};

// Fallback icon
const DefaultIcon = History;

export default function Audit() {
  const { globalAuditLogs, loading } = useAppContext();
  const navigate = useNavigate();

  if (loading) return <div className="p-8 text-white">Загрузка логов...</div>;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <History size={22} className="text-violet-400" /> Журнал аудита
            </h1>
            <p className="text-sm text-slate-400 mt-1">Отслеживание всех изменений в системе</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/50">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Дата и время</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Пользователь</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Действие</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Детали</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {globalAuditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <Calendar size={12} className="text-slate-500" />
                      {new Date(log.created_at).toLocaleString('ru-RU')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-violet-400 border border-slate-700">
                        {log.username.substring(0, 2).toUpperCase()}
                      </div>
                      <span className="text-xs font-medium text-slate-100">{log.username}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const Icon = actionIcons[log.action] || DefaultIcon;
                        return <Icon size={14} className="text-slate-500" />;
                      })()}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        log.action.includes('CREATED') ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        log.action.includes('DELETED') ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {log.action}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-slate-400 max-w-md truncate" title={JSON.stringify(log.detail)}>
                      {Object.entries(log.detail).map(([k, v]) => (
                        <span key={k} className="mr-3">
                          <span className="text-slate-500">{k}:</span> {String(v)}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {globalAuditLogs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 text-sm">
                    Журнал аудита пуст
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

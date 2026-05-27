import { useState } from 'react';
import { 
  Search, Clock, History, BookOpen, FolderOpen, Users,
  Plus, Zap, AlertTriangle, Shield, Calendar, Edit2, Trash2, X, Settings as SettingsIcon
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { toast } from 'react-hot-toast';
import { niceConfirm } from '../utils/confirm';

type TabType = 'skills' | 'risks' | 'roles' | 'domains' | 'calendars' | 'blocks' | 'audit' | 'users' | 'system';

export default function Settings() {
  const { 
    skills, risks, globalRoles, domains, calendars, planningBlocks, globalAuditLogs, projects, users,
    globalSettings, updateGlobalSetting,
    createSkill, updateSkill, deleteSkill,
    createRisk, updateRisk, deleteRisk,
    createGlobalRole, updateGlobalRole, deleteGlobalRole,
    createDomain, updateDomain, deleteDomain,
    createCalendar, updateCalendar, deleteCalendar,
    createHoliday, deleteHoliday, extractError,
    createUser, updateUser, deleteUser
  } = useAppContext();

  const [activeTab, setActiveTab] = useState<TabType>('skills');
  const [search, setSearch] = useState('');

  // ─── Modal States ───────────────────────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);

  // ─── Render Helpers ─────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingId(null);
    setFormData({});
    setIsModalOpen(true);
  };

  const openEdit = (item: any) => {
    setEditingId(item.id);
    setFormData(item);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (activeTab === 'skills') {
        editingId ? await updateSkill(editingId, formData) : await createSkill(formData);
      } else if (activeTab === 'risks') {
        editingId ? await updateRisk(editingId, formData) : await createRisk(formData);
      } else if (activeTab === 'roles') {
        editingId ? await updateGlobalRole(editingId, formData) : await createGlobalRole(formData);
      } else if (activeTab === 'domains') {
        editingId ? await updateDomain(editingId, formData) : await createDomain(formData);
      } else if (activeTab === 'calendars') {
        editingId ? await updateCalendar(editingId, formData) : await createCalendar(formData);
      } else if (activeTab === 'users') {
        editingId ? await updateUser(editingId, formData) : await createUser(formData);
      } else if (activeTab === 'system') {
        if (editingId) await updateGlobalSetting(editingId, formData);
      }
      toast.success(editingId ? 'Обновлено' : 'Создано');
      setIsModalOpen(false);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка сохранения'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!await niceConfirm('Вы уверены?')) return;
    try {
      if (activeTab === 'skills') await deleteSkill(id);
      else if (activeTab === 'risks') await deleteRisk(id);
      else if (activeTab === 'roles') await deleteGlobalRole(id);
      else if (activeTab === 'domains') await deleteDomain(id);
      else if (activeTab === 'calendars') await deleteCalendar(id);
      else if (activeTab === 'users') await deleteUser(id);
      toast.success('Удалено');
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка удаления'));
    }
  };

  // ─── Specialized: Holiday Modal ──────────────────────────────────────────────
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);
  const [selectedCalendarId, setSelectedCalendarId] = useState<number | null>(null);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCalendarId || !holidayDate) return;
    try {
      await createHoliday({ calendar: selectedCalendarId, date: holidayDate, name: holidayName });
      toast.success('Праздник добавлен');
      setIsHolidayModalOpen(false);
      setHolidayDate('');
      setHolidayName('');
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка добавления'));
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Настройки системы</h1>
          <p className="text-slate-400 mt-1.5 text-sm">Управление глобальными справочниками и конфигурацией платформы.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-violet-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Поиск..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-slate-900/50 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 w-64 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 transition-all"
            />
          </div>
          {(activeTab !== 'blocks' && activeTab !== 'audit' && activeTab !== 'system') && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all"
            >
              <Plus size={14} /> Добавить
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 overflow-x-auto no-scrollbar">
        {[
          { id: 'skills', label: 'Навыки', icon: Zap },
          { id: 'risks', label: 'Риски', icon: AlertTriangle },
          { id: 'roles', label: 'Роли', icon: Shield },
          { id: 'domains', label: 'Домены', icon: FolderOpen },
          { id: 'calendars', label: 'Календари', icon: Calendar },
          { id: 'blocks', label: 'Каталог блоков', icon: BookOpen },
          { id: 'users', label: 'Пользователи', icon: Users },
          { id: 'system', label: 'Конфигурация', icon: SettingsIcon },
          { id: 'audit', label: 'Журнал аудита', icon: History },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as TabType)}
            className={`flex items-center gap-2.5 px-6 py-4 text-sm font-medium transition-all relative whitespace-nowrap ${
              activeTab === t.id ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <t.icon size={16} />
            {t.label}
            {activeTab === t.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-8">
      {(activeTab === 'skills' || activeTab === 'risks' || activeTab === 'roles' || activeTab === 'domains' || activeTab === 'calendars') && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeTab === 'skills' && skills.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map(skill => (
              <div key={skill.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-violet-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 bg-violet-400/10 px-2 py-0.5 rounded">{skill.category}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(skill)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Edit2 size={14}/></button>
                    <button onClick={() => handleDelete(skill.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
                <h3 className="text-white font-semibold">{skill.name}</h3>
              </div>
            ))}

            {activeTab === 'risks' && risks.filter(r => r.name.toLowerCase().includes(search.toLowerCase())).map(risk => (
              <div key={risk.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${risk.probability === 'HIGH' ? 'bg-red-500' : risk.probability === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <span className="text-xs text-slate-400 font-medium">Risk: {risk.probability}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(risk)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Edit2 size={14}/></button>
                    <button onClick={() => handleDelete(risk.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
                <h3 className="text-white font-semibold mb-2">{risk.name}</h3>
                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{risk.description}</p>
              </div>
            ))}

            {activeTab === 'roles' && globalRoles.filter(r => r.name.toLowerCase().includes(search.toLowerCase())).map(role => (
              <div key={role.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group">
                <div className="flex justify-between items-center mb-3">
                  <Shield size={20} className="text-violet-400" />
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(role)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Edit2 size={14}/></button>
                    <button onClick={() => handleDelete(role.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
                <h3 className="text-white font-semibold mb-1">{role.name}</h3>
                <p className="text-xs text-slate-500">{role.description || 'Нет описания'}</p>
              </div>
            ))}

            {activeTab === 'domains' && domains.filter(d => d.name.toLowerCase().includes(search.toLowerCase())).map(domain => {
              const projectCount = projects.filter(p => p.domain === domain.name).length;
              return (
                <div key={domain.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${projectCount > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      {projectCount} проектов
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-3">
                    <FolderOpen size={20} className="text-blue-400" />
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(domain)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Edit2 size={14}/></button>
                      <button onClick={() => handleDelete(domain.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={14}/></button>
                    </div>
                  </div>
                  <h3 className="text-white font-semibold mb-1">{domain.name}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2">{domain.description || 'Нет описания'}</p>
                </div>
              );
            })}

            {activeTab === 'calendars' && calendars.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).map(cal => (
              <div key={cal.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar size={20} className="text-blue-400" />
                    {cal.is_default && <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 font-bold uppercase">Default</span>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(cal)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Edit2 size={14}/></button>
                    <button onClick={() => deleteCalendar(cal.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
                <h3 className="text-white font-semibold mb-4">{cal.name}</h3>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    <span>Праздники</span>
                    <button 
                      onClick={() => { setSelectedCalendarId(cal.id); setIsHolidayModalOpen(true); }}
                      className="text-blue-400 hover:text-blue-300"
                    >+ Добавить</button>
                  </div>
                  <div className="max-h-32 overflow-y-auto pr-1 space-y-1.5 thin-scrollbar">
                    {cal.holidays && cal.holidays.length > 0 ? cal.holidays.map(h => (
                      <div key={h.id} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg group/h">
                        <div className="flex items-center gap-2">
                          <Clock size={10} className="text-slate-500" />
                          <span className="text-[11px] text-slate-300 font-medium">{h.date}</span>
                          <span className="text-[11px] text-slate-500">{h.name}</span>
                        </div>
                        <button onClick={() => deleteHoliday(h.id)} className="opacity-0 group-hover/h:opacity-100 text-slate-500 hover:text-red-400 transition-all"><X size={12} /></button>
                      </div>
                    )) : (
                      <p className="text-[11px] text-slate-600 italic">Нет праздников</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || u.full_name.toLowerCase().includes(search.toLowerCase())).map(user => (
              <div key={user.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-violet-600/20 flex items-center justify-center text-violet-400 font-bold border border-violet-500/20">
                      {user.username.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-sm">{user.full_name}</h3>
                      <p className="text-[10px] text-slate-500">@{user.username}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(user)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"><Edit2 size={14}/></button>
                    <button onClick={() => handleDelete(user.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={14}/></button>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-800/50">
                  <p className="text-[11px] text-slate-400 flex items-center gap-2">
                    <Shield size={12} className="text-slate-500" />
                    {user.email}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'blocks' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {planningBlocks.filter(b => b.is_template && b.name.toLowerCase().includes(search.toLowerCase())).map(b => (
              <div key={b.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] font-bold bg-violet-500/10 text-violet-400 px-2 py-0.5 rounded uppercase tracking-widest">
                    {b.domain}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                    {Math.round(b.success_rate * 100)}% SUCCESS
                  </div>
                </div>
                <h3 className="text-white font-bold mb-1 group-hover:text-violet-400 transition-colors">{b.name}</h3>
                <p className="text-xs text-slate-500 mb-6 line-clamp-2">{b.complexity} complexity · {b.avg_duration} days avg</p>
                <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                   <div className="flex items-center gap-2">
                      <Clock size={14} className="text-slate-600" />
                      <span className="text-[11px] text-slate-400">Dev: {b.analytics?.avg_actual_duration || '—'}d</span>
                   </div>
                   <div className="flex items-center gap-2">
                      <Zap size={14} className="text-slate-600" />
                      <span className="text-[11px] text-slate-400">Used: {b.analytics?.usage_count || 0}x</span>
                   </div>
                </div>
              </div>
            ))}
            {planningBlocks.filter(b => b.is_template).length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-600">Каталог планирования пуст</div>
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {globalSettings.map(setting => (
              <div key={setting.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition-all group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">System Config</span>
                  <button onClick={() => openEdit(setting)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100"><Edit2 size={14}/></button>
                </div>
                <h3 className="text-white font-bold mb-1 font-mono text-sm">{setting.key}</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">{setting.description}</p>
                <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
                  <SettingsIcon size={16} className="text-amber-500" />
                  <span className="text-lg font-bold text-slate-200">{setting.value}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-800/30">
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Пользователь</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Действие</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Дата</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Детали</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {globalAuditLogs.filter(l => l.username.toLowerCase().includes(search.toLowerCase()) || l.action.toLowerCase().includes(search.toLowerCase())).map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-[11px] font-bold text-slate-400 uppercase border border-slate-700">
                            {log.username?.substring(0, 2) || '??'}
                          </div>
                          <span className="text-xs font-semibold text-slate-200">{log.username}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          log.action.includes('CREATED') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          log.action.includes('DELETED') ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {new Date(log.created_at).toLocaleString('ru-RU')}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs text-slate-400 truncate max-w-[300px]" title={JSON.stringify(log.detail)}>
                          {JSON.stringify(log.detail)}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {globalAuditLogs.length === 0 && (
              <div className="p-20 text-center">
                 <History size={40} className="mx-auto text-slate-800 mb-4" />
                 <p className="text-slate-600 text-sm">История действий пуста</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Add/Edit Item */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">{editingId ? 'Редактировать' : 'Добавить'} {activeTab === 'system' ? 'настройку' : activeTab.slice(0, -1)}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {activeTab !== 'system' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Название</label>
                  <input 
                    type="text" required autoFocus
                    value={formData.name || ''}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500 transition-all"
                  />
                </div>
              )}

              {activeTab === 'system' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">{formData.key}</label>
                  <input 
                    type="text" required autoFocus
                    value={formData.value || ''}
                    onChange={e => setFormData({...formData, value: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-500 transition-all"
                  />
                  <p className="text-[10px] text-slate-500 mt-2">{formData.description}</p>
                </div>
              )}

              {activeTab === 'skills' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Категория</label>
                  <select 
                    value={formData.category || ''}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500 transition-all"
                  >
                    <option value="Frontend">Frontend</option>
                    <option value="Backend">Backend</option>
                    <option value="DevOps">DevOps</option>
                    <option value="Design">Design</option>
                    <option value="Analytics">Analytics</option>
                    <option value="Management">Management</option>
                  </select>
                </div>
              )}

              {activeTab === 'risks' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Вероятность</label>
                      <select 
                        value={formData.probability || 'MEDIUM'}
                        onChange={e => setFormData({...formData, probability: e.target.value})}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Влияние</label>
                      <select 
                        value={formData.impact || 'MEDIUM'}
                        onChange={e => setFormData({...formData, impact: e.target.value})}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                    <textarea 
                      value={formData.description || ''}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 h-24 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </>
              )}

              {activeTab === 'roles' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                  <textarea 
                    value={formData.description || ''}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 h-24 focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              {activeTab === 'domains' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Описание</label>
                  <textarea 
                    value={formData.description || ''}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 h-24 focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              {activeTab === 'calendars' && (
                <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl border border-slate-700">
                  <input 
                    type="checkbox"
                    checked={formData.is_default || false}
                    onChange={e => setFormData({...formData, is_default: e.target.checked})}
                    className="w-4 h-4 rounded text-violet-600 focus:ring-violet-500 bg-slate-900 border-slate-700"
                  />
                  <span className="text-sm text-slate-200">По умолчанию</span>
                </div>
              )}

              {activeTab === 'users' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Имя</label>
                      <input 
                        type="text" required
                        value={formData.first_name || ''}
                        onChange={e => setFormData({...formData, first_name: e.target.value})}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Фамилия</label>
                      <input 
                        type="text" required
                        value={formData.last_name || ''}
                        onChange={e => setFormData({...formData, last_name: e.target.value})}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Username</label>
                    <input 
                      type="text" required
                      value={formData.username || ''}
                      onChange={e => setFormData({...formData, username: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Email</label>
                    <input 
                      type="email" required
                      value={formData.email || ''}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  {!editingId && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Пароль</label>
                      <input 
                        type="password" required
                        value={formData.password || ''}
                        onChange={e => setFormData({...formData, password: e.target.value})}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Telegram Chat ID (для пуш-уведомлений)</label>
                    <input 
                      type="text"
                      placeholder="Напр. 123456789"
                      value={formData.telegram_chat_id || ''}
                      onChange={e => setFormData({...formData, telegram_chat_id: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Роль</label>
                    <select 
                      value={formData.role || 'EMPLOYEE'}
                      onChange={e => setFormData({...formData, role: e.target.value})}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-violet-500"
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="MANAGER">Manager</option>
                      <option value="EMPLOYEE">Employee</option>
                    </select>
                  </div>
                </>
              )}

              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">Отмена</button>
                <button 
                  type="submit" 
                  disabled={submitting}
                  className="px-6 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/20"
                >
                  {submitting ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Specialized: Holiday Modal */}
      {isHolidayModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h2 className="text-lg font-bold text-white mb-6">Добавить праздник</h2>
            <form onSubmit={handleAddHoliday} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Дата</label>
                <input 
                  type="date" required
                  value={holidayDate}
                  onChange={e => setHolidayDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Название (необязательно)</label>
                <input 
                  type="text"
                  value={holidayName}
                  onChange={e => setHolidayName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsHolidayModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white">Отмена</button>
                <button type="submit" className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-blue-600/20">Добавить</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

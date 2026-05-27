import { useState, useEffect } from 'react';
import { 
  User, Mail, Bell, Send, Shield, Save, 
  ToggleLeft, ToggleRight, AlertCircle,
  Hash, ExternalLink, Bot, Calendar, ClipboardCheck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import api from '../api/client';

export default function Profile() {
  const { user, updateUserLocal } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    telegram_chat_id: '',
    notify_telegram: true,
    notify_email: true,
    notify_daily_digest: true,
    bio: ''
  });

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        telegram_chat_id: user.telegram_chat_id || '',
        notify_telegram: user.notify_telegram !== false,
        notify_email: user.notify_email !== false,
        notify_daily_digest: user.notify_daily_digest !== false,
        bio: user.bio || ''
      });
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await api.patch(`/users/${user?.id}/`, formData);
      updateUserLocal(response.data);
      toast.success('Профиль успешно обновлен');
    } catch (err: any) {
      toast.error('Ошибка при сохранении настроек');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const toggleField = (field: keyof typeof formData) => {
    setFormData(prev => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-6 pb-6 border-b border-slate-800">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-3xl font-bold text-white shadow-xl shadow-violet-500/20 border-2 border-white/10">
          {user?.first_name?.charAt(0).toUpperCase() || 'U'}
        </div>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Настройки профиля</h1>
          <p className="text-slate-400 mt-1.5 flex items-center gap-2">
            <Shield size={14} className="text-violet-400" />
            {user?.role === 'ADMIN' ? 'Администратор системы' : user?.role === 'MANAGER' ? 'Менеджер проектов' : 'Сотрудник'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Col: Main Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-6 backdrop-blur-sm">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <User size={18} className="text-violet-400" />
              Личная информация
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Имя</label>
                <div className="relative">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input 
                    type="text" 
                    value={formData.first_name}
                    onChange={e => setFormData({...formData, first_name: e.target.value})}
                    className="w-full bg-slate-800/50 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 transition-all"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Фамилия</label>
                <div className="relative">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input 
                    type="text" 
                    value={formData.last_name}
                    onChange={e => setFormData({...formData, last_name: e.target.value})}
                    className="w-full bg-slate-800/50 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="email" 
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full bg-slate-800/50 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-slate-200 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 transition-all"
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-6 backdrop-blur-sm">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Bot size={18} className="text-blue-400" />
              Интеграция Telegram
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Telegram Chat ID</label>
                <a 
                  href="https://t.me/userinfobot" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[10px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 uppercase bg-blue-400/10 px-2 py-1 rounded-lg transition-colors"
                >
                  Узнать мой ID <ExternalLink size={10} />
                </a>
              </div>
              <div className="relative">
                <Hash size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Напр. 857617675"
                  value={formData.telegram_chat_id}
                  onChange={e => setFormData({...formData, telegram_chat_id: e.target.value})}
                  className="w-full bg-slate-800/50 border border-slate-700/50 rounded-2xl pl-11 pr-4 py-3 text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all font-mono"
                />
              </div>
              <p className="text-[11px] text-slate-500 px-1 leading-relaxed">
                Введите ваш Chat ID для получения мгновенных уведомлений. Наш бот: <span className="text-blue-400 font-bold">@pms_notifications_bot</span>
              </p>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-6 backdrop-blur-sm">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <ClipboardCheck size={18} className="text-indigo-400" />
              О себе
            </h2>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Биография / Достижения</label>
              <textarea 
                rows={4}
                value={formData.bio}
                onChange={e => setFormData({...formData, bio: e.target.value})}
                placeholder="Расскажите немного о себе, ваших ключевых навыках и интересах..."
                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4 text-slate-200 focus:outline-none focus:border-violet-500 transition-all resize-none text-sm leading-relaxed"
              />
            </div>
          </div>
        </div>

        {/* Right Col: Notifications Toggles */}
        <div className="space-y-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-6 backdrop-blur-sm">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Bell size={18} className="text-amber-400" />
              Уведомления
            </h2>

            <div className="space-y-4">
              <div 
                onClick={() => toggleField('notify_telegram')}
                className="flex items-center justify-between p-4 bg-slate-800/30 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${formData.notify_telegram ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-700 text-slate-500'}`}>
                    <Send size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Telegram</p>
                    <p className="text-[10px] text-slate-500">Мгновенные пуши</p>
                  </div>
                </div>
                {formData.notify_telegram ? (
                  <ToggleRight size={32} className="text-violet-500" />
                ) : (
                  <ToggleLeft size={32} className="text-slate-600" />
                )}
              </div>

              <div 
                onClick={() => toggleField('notify_email')}
                className="flex items-center justify-between p-4 bg-slate-800/30 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${formData.notify_email ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    <Mail size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Email</p>
                    <p className="text-[10px] text-slate-500">Важные отчеты</p>
                  </div>
                </div>
                {formData.notify_email ? (
                  <ToggleRight size={32} className="text-violet-500" />
                ) : (
                  <ToggleLeft size={32} className="text-slate-600" />
                )}
              </div>

              <div 
                onClick={() => toggleField('notify_daily_digest')}
                className="flex items-center justify-between p-4 bg-slate-800/30 rounded-2xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${formData.notify_daily_digest ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-700 text-slate-500'}`}>
                    <Calendar size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Дайджест</p>
                    <p className="text-[10px] text-slate-500">Утренняя сводка</p>
                  </div>
                </div>
                {formData.notify_daily_digest ? (
                  <ToggleRight size={32} className="text-violet-500" />
                ) : (
                  <ToggleLeft size={32} className="text-slate-600" />
                )}
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-violet-600/20 active:scale-[0.98]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save size={18} />
                  Сохранить всё
                </>
              )}
            </button>
          </div>

          {/* Status info */}
          <div className="bg-slate-900/30 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-violet-400 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Все изменения вступают в силу мгновенно. Если вы не получаете уведомления, проверьте правильность Chat ID.
            </p>
          </div>

          <div className="bg-gradient-to-br from-indigo-600/10 to-violet-600/10 border border-indigo-500/20 rounded-3xl p-6 space-y-4">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Советы по заполнению</p>
            <ul className="space-y-3">
              {[
                'Привяжите Telegram для быстрой реакции на задачи',
                'Заполните биографию для лучшего мэтчинга в проекты',
                'Используйте корпоративный Email для отчетности',
                'Включите дайджест, чтобы быть в курсе плана на день'
              ].map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
                  <span className="w-1 h-1 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </form>
    </div>
  );
}

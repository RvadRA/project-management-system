import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Zap, ChevronRight, UserPlus, X, Plus, Edit2, Trash2, Save } from 'lucide-react';
import { useAppContext, type Employee } from '../context/AppContext';
import { toast } from 'react-hot-toast';
import { niceConfirm } from '../utils/confirm';
import api from '../api/client';

const levelLabels = ['', 'Нач.', 'Баз.', 'Сред.', 'Прод.', 'Эксп.'];
const categoryColors: Record<string, string> = {
  Frontend: 'bg-violet-500/10 text-violet-400',
  Backend: 'bg-blue-500/10 text-blue-400',
  DevOps: 'bg-emerald-500/10 text-emerald-400',
  Design: 'bg-amber-500/10 text-amber-400',
  Analytics: 'bg-cyan-500/10 text-cyan-400',
  Database: 'bg-teal-500/10 text-teal-400',
  Management: 'bg-pink-500/10 text-pink-400',
  Data: 'bg-indigo-500/10 text-indigo-400',
  Tools: 'bg-slate-500/10 text-slate-400',
};

const GRADIENTS = [
  'from-violet-500 to-indigo-500', 'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500',
  'from-blue-500 to-cyan-500', 'from-purple-500 to-violet-500',
];
const getGradient = (id: number) => GRADIENTS[id % GRADIENTS.length];

const getInitials = (name: string) => {
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.substring(0, 2).toUpperCase();
};

function LoadBadge({ load }: { load: number }) {
  const color = load > 100
    ? 'text-red-400 bg-red-500/10 border-red-500/20'
    : load > 70
    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
    : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${color}`}>{load}% загружен</span>;
}

export default function Team() {
  const { employees, skills, domains, createEmployee, updateEmployee, deleteEmployee, addSkillToEmployee, deleteEmployeeSkill, addCertificateToEmployee, deleteEmployeeCertificate, addUnavailabilityToEmployee, deleteEmployeeUnavailability, extractError, refreshData } = useAppContext();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'members' | 'availability'>('members');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    position: '',
    domain: '',
    bio: '',
  });

  const [certForm, setCertForm] = useState({
    name: '',
    issuer: '',
    credential_id: '',
    issued_date: '',
    expiry_date: '',
  });
  const [unavailForm, setUnavailForm] = useState({
    type: 'VACATION' as any,
    start_date: '',
    end_date: '',
    note: '',
  });

  // Form fields
  const [formFirstName, setFormFirstName] = useState('');
  const [formLastName, setFormLastName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('password123');
  const [formPosition, setFormPosition] = useState('');
  const [formDomain, setFormDomain] = useState('');
  const [formBio, setFormBio] = useState('');

  // Skill form
  const [selectedSkillId, setSelectedSkillId] = useState<number | ''>('');
  const [selectedSkillLevel, setSelectedSkillLevel] = useState(3);
  const [formSkills, setFormSkills] = useState<{ skill_id: number; level: number; name: string }[]>([]);

  const filtered = employees.filter(e =>
    e.full_name.toLowerCase().includes(search.toLowerCase()) ||
    e.position.toLowerCase().includes(search.toLowerCase()) ||
    (e.domain && e.domain.toLowerCase().includes(search.toLowerCase()))
  );

  const addSkillToForm = () => {
    if (!selectedSkillId) return;
    const skill = skills.find(s => s.id === Number(selectedSkillId));
    if (!skill) return;
    if (formSkills.find(s => s.skill_id === skill.id)) return;
    setFormSkills(prev => [...prev, { skill_id: skill.id, level: selectedSkillLevel, name: skill.name }]);
    setSelectedSkillId('');
  };

  const removeSkillFromForm = (skillId: number) => {
    setFormSkills(prev => prev.filter(s => s.skill_id !== skillId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFirstName.trim() || !formLastName.trim() || !formUsername.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createEmployee(
        {
          username: formUsername.trim(),
          first_name: formFirstName.trim(),
          last_name: formLastName.trim(),
          email: formEmail.trim(),
          password: formPassword,
          role: 'EMPLOYEE',
        },
        {
          position: formPosition.trim(),
          bio: formBio.trim(),
          hourly_rate: 0,
          domain: formDomain,
        },
        formSkills.map(s => ({ skill_id: s.skill_id, level: s.level })),
      );
      setIsModalOpen(false);
      // Reset
      setFormFirstName(''); setFormLastName(''); setFormUsername('');
      setFormEmail(''); setFormPassword('password123');
      setFormPosition(''); setFormDomain(''); setFormBio('');
      setFormSkills([]);
    } catch (err: any) {
      setError(extractError(err, 'Ошибка при создании сотрудника'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMatchEmployee = (emp: Employee) => {
    navigate('/matching', { state: { employeeId: emp.id } });
  };

  const handleStartEdit = (emp: Employee) => {
    setEditForm({
      position: emp.position,
      domain: emp.domain || '',
      bio: emp.bio,
    });
    setCertForm({
      name: '',
      issuer: '',
      credential_id: '',
      issued_date: '',
      expiry_date: '',
    });
    setIsEditing(true);
  };

  const handleUpdate = async () => {
    if (!selected) return;
    try {
      await updateEmployee(selected.id, editForm);
      setIsEditing(false);
      // Update local selection to show new data
      const updated = employees.find(e => e.id === selected.id);
      if (updated) setSelected(updated);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при обновлении профиля'));
    }
  };

  const handleDelete = async (emp: Employee) => {
    if (!await niceConfirm(`Удалить сотрудника ${emp.full_name}? Это также удалит его аккаунт.`)) return;
    try {
      await deleteEmployee(emp.id);
      setSelected(null);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при удалении сотрудника'));
    }
  };

  const handleDeleteSkill = async (employeeSkillId: number) => {
    if (!selected) return;
    try {
      await deleteEmployeeSkill(selected.id, employeeSkillId);
      const updated = employees.find(e => e.id === selected.id);
      if (updated) setSelected(updated);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при удалении навыка'));
    }
  };

  const handleDeleteCertificate = async (certId: number) => {
    if (!selected) return;
    try {
      await deleteEmployeeCertificate(selected.id, certId);
      const updated = employees.find(e => e.id === selected.id);
      if (updated) setSelected(updated);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при удалении сертификата'));
    }
  };

  return (
    <div className="flex h-full relative">
      {/* Left */}
      <div className="flex-1 p-8 space-y-6 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Команда</h1>
            <p className="text-sm text-slate-400 mt-1">Профили сотрудников и их компетенции</p>
          </div>
          <div className="flex items-center gap-3">
             <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1">
                <button 
                  onClick={() => setActiveTab('members')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'members' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Участники
                </button>
                <button 
                  onClick={() => setActiveTab('availability')}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'availability' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Доступность
                </button>
             </div>
             <button
               onClick={() => { setIsModalOpen(true); setError(''); }}
               className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors shadow-lg shadow-violet-500/20"
             >
               <UserPlus size={16} /> Добавить сотрудника
             </button>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Поиск по имени, должности..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500"
          />
        </div>
        
        {activeTab === 'members' ? (
          <div className="grid grid-cols-2 gap-4">
            {filtered.map(emp => (
              <div
                key={emp.id}
                onClick={() => setSelected(emp)}
                className={`bg-slate-900 border rounded-xl p-5 cursor-pointer transition-all duration-200 group ${
                  selected?.id === emp.id
                    ? 'border-violet-500/60 shadow-lg shadow-violet-500/10'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${getGradient(emp.id)} flex items-center justify-center text-sm font-bold text-white flex-shrink-0`}>
                    {getInitials(emp.full_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-100 truncate">{emp.full_name}</h3>
                      <ChevronRight size={14} className="text-slate-600 group-hover:text-violet-400 flex-shrink-0" />
                    </div>
                    <p className="text-xs font-bold text-violet-400 mt-0.5 truncate">
                      {emp.memberships?.length > 0 
                        ? Array.from(new Set(emp.memberships.map(m => m.role_info?.name || m.role))).map(r => r === 'MANAGER' ? 'Менеджер' : r).join(', ')
                        : emp.position || 'Сотрудник'}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{emp.domain}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <LoadBadge load={emp.current_workload_percentage} />
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    Задачи: {emp.active_task_hours || 0} / 160 ч.
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {emp.skills.slice(0, 4).map(s => (
                    <span
                      key={s.id}
                      className={`text-xs px-2 py-0.5 rounded-md font-medium ${categoryColors[s.skill.category] || 'bg-slate-700/50 text-slate-400'}`}
                    >
                      {s.skill.name} · {levelLabels[s.level_score]}
                    </span>
                  ))}
                  {emp.skills.length > 4 && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-500">
                      +{emp.skills.length - 4}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/50 border-b border-slate-700">
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Сотрудник</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Домен / Роль</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Загрузка</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Окно доступности</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filtered.map(emp => {
                  const load = emp.current_workload_percentage;
                  const isCritical = load > 95;
                  const isHigh = load > 75;
                  
                  return (
                    <tr key={emp.id} className="hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                           <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${getGradient(emp.id)} flex items-center justify-center text-[10px] font-bold text-white`}>
                              {getInitials(emp.full_name)}
                           </div>
                           <div>
                              <p className="text-sm font-medium text-slate-100">{emp.full_name}</p>
                              <p className="text-[10px] text-slate-500">{emp.position}</p>
                           </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                         <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-bold px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700 w-fit">
                               {emp.domain || 'N/A'}
                            </span>
                            <p className="text-[10px] text-slate-500 font-medium">
                               {emp.memberships?.length > 0 
                                 ? Array.from(new Set(emp.memberships.map(m => m.role_info?.name || m.role))).map(r => r === 'MANAGER' ? 'Менеджер' : r).join(', ')
                                 : emp.position || 'Сотрудник'}
                            </p>
                         </div>
                      </td>
                      <td className="px-6 py-4">
                         <div className="flex flex-col items-center gap-1.5">
                            <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                               <div 
                                 className={`h-full transition-all duration-1000 ${isCritical ? 'bg-red-500' : isHigh ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                 style={{ width: `${Math.min(100, load)}%` }}
                               />
                            </div>
                            <span className={`text-[10px] font-bold ${isCritical ? 'text-red-400' : isHigh ? 'text-amber-400' : 'text-emerald-400'}`}>
                               {load}% ({emp.active_task_hours} ч.)
                            </span>
                         </div>
                      </td>
                      <td className="px-6 py-4">
                         {load < 50 ? (
                           <div className="flex items-center gap-2 text-emerald-400">
                              <Zap size={14} className="fill-emerald-400/20" />
                              <span className="text-[10px] font-bold uppercase tracking-widest">Доступен сейчас</span>
                           </div>
                         ) : (
                           <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-slate-500">Следующее окно:</span>
                              <span className="text-[11px] font-bold text-slate-300">~ через {Math.max(1, Math.floor((160 - emp.active_task_hours) / 8))} дней</span>
                           </div>
                         )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="py-20 flex flex-col items-center text-slate-600">
            <UserPlus size={32} className="mb-3 opacity-40" />
            <p className="text-sm">Сотрудников не найдено</p>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-80 border-l border-slate-800 bg-slate-900/50 p-6 overflow-y-auto flex-shrink-0 sticky top-0 h-full">
          <div className="flex justify-between items-center mb-6">
            <button 
              onClick={() => { setSelected(null); setIsEditing(false); }}
              className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Закрыть"
            >
              <X size={18} />
            </button>
            <div className="flex gap-2">
              {isEditing ? (
                <button onClick={handleUpdate} className="p-2 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors">
                  <Save size={16} />
                </button>
              ) : (
                <button onClick={() => handleStartEdit(selected)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                  <Edit2 size={16} />
                </button>
              )}
              <button onClick={() => handleDelete(selected)} className="p-2 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <div className="flex flex-col items-center text-center mb-6">
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${getGradient(selected.id)} flex items-center justify-center text-xl font-bold text-white mb-3`}>
              {getInitials(selected.full_name)}
            </div>
            <h2 className="text-base font-semibold text-white">{selected.full_name}</h2>
            {isEditing ? (
              <div className="w-full space-y-2 mt-3 text-left">
                <input type="text" value={editForm.position} onChange={e => setEditForm({ ...editForm, position: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" placeholder="Должность" />
                <select value={editForm.domain} onChange={e => setEditForm({ ...editForm, domain: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none">
                  <option value="">— Домен —</option>
                  {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-400 mt-0.5">{selected.position}</p>
                <p className="text-xs text-slate-500 mt-0.5">{selected.domain}</p>
              </>
            )}
            <p className="text-xs text-slate-600 mt-1">{selected.user.email}</p>
          </div>

          {/* Workload */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-slate-400">Текущая загрузка</span>
              <div className="flex items-center gap-2">
                <LoadBadge load={selected.current_workload_percentage} />
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {selected.active_task_hours || 0}/160 ч.
                </span>
              </div>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  selected.current_workload_percentage > 100 ? 'bg-red-500' : 
                  selected.current_workload_percentage > 70 ? 'bg-amber-500' : 
                  'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, selected.current_workload_percentage)}%` }}
              />
            </div>
            {isEditing && (
              <button 
                onClick={async () => {
                  try {
                    await api.post(`/employees/profiles/${selected.id}/reset-load/`);
                    toast.success('Нагрузка сброшена');
                    await refreshData();
                  } catch (err: any) {
                    toast.error(extractError(err, 'Ошибка при сбросе нагрузки'));
                  }
                }}
                className="mt-3 w-full text-[10px] uppercase font-bold tracking-wider py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Сбросить расчет нагрузки
              </button>
            )}
          </div>

          {/* Current Projects */}
          {selected.memberships?.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Текущие проекты</h3>
              <div className="space-y-2">
                {selected.memberships.map(m => (
                  <div key={m.id} className="p-2.5 bg-slate-800/40 border border-slate-800 rounded-lg">
                    <div className="flex justify-between items-start mb-1">
                      <p className="text-xs font-bold text-slate-200 truncate">{m.project_name}</p>
                      <span className="text-[9px] font-bold text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded uppercase">
                        {m.role_info?.name || (m.role === 'MANAGER' ? 'Менеджер' : m.role)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Навыки</h4>
            <div className="space-y-3">
              {selected.skills.length > 0 ? selected.skills.map(s => (
                <div key={s.id} className="group/skill">
                  <div className="flex justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-300 font-medium">{s.skill.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">{levelLabels[s.level_score]}</span>
                      {isEditing && (
                        <button onClick={() => handleDeleteSkill(s.skill.id)} className="text-red-400/0 group-hover/skill:text-red-400/60 hover:!text-red-400 transition-all">
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className={`flex-1 h-1.5 rounded-full ${i <= s.level_score ? 'bg-violet-500' : 'bg-slate-700'}`} />
                    ))}
                  </div>
                </div>
              )) : <p className="text-xs text-slate-500">Нет навыков</p>}
            </div>
          </div>

          {/* Certificates */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Сертификаты</h4>
            <div className="space-y-2">
              {selected.certificates?.length > 0 ? selected.certificates.map(cert => (
                <div key={cert.id} className="group/cert p-2 bg-slate-800/40 border border-slate-800 rounded-lg relative">
                  <div className="pr-6">
                    <p className="text-xs font-bold text-slate-200">{cert.name}</p>
                    {cert.issuer && <p className="text-[10px] text-slate-400 mt-0.5">{cert.issuer}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      {cert.issued_date && <span className="text-[10px] text-slate-500">Выдан: {cert.issued_date}</span>}
                      {cert.is_expired ? (
                        <span className="text-[9px] font-bold text-red-400 bg-red-500/10 px-1 py-0.5 rounded">Истёк</span>
                      ) : cert.expiry_date ? (
                        <span className="text-[10px] text-emerald-400/80">До: {cert.expiry_date}</span>
                      ) : (
                        <span className="text-[10px] text-emerald-400/80">Бессрочный</span>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <button onClick={() => handleDeleteCertificate(cert.id)} className="absolute top-2 right-2 text-red-400/0 group-hover/cert:text-red-400/60 hover:!text-red-400 transition-all">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )) : <p className="text-xs text-slate-500">Нет сертификатов</p>}
            </div>
          </div>

          {/* Unavailability */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Отпуска и недоступность</h4>
            <div className="space-y-2">
              {selected.unavailability?.length > 0 ? selected.unavailability.map(item => (
                <div key={item.id} className="group/unavail p-2 bg-slate-800/40 border border-slate-800 rounded-lg relative">
                  <div className="pr-6">
                    <p className="text-xs font-bold text-slate-200">{item.type_display}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">{item.start_date} — {item.end_date}</span>
                    </div>
                    {item.note && <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-1">{item.note}</p>}
                  </div>
                  {isEditing && (
                        <button onClick={() => deleteEmployeeUnavailability(selected.id, item.id)} className="absolute top-2 right-2 text-red-400/0 group-hover/unavail:text-red-400/60 hover:!text-red-400 transition-all">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )) : <p className="text-xs text-slate-500">Нет записей</p>}
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-4 mb-4">
              <textarea rows={4} value={editForm.bio} onChange={e => setEditForm({ ...editForm, bio: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 text-xs text-slate-300 rounded p-2 focus:border-violet-500 outline-none resize-none" placeholder="Биография/О себе" />
              
              <div className="border-t border-slate-800 pt-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Добавить навык</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-2 py-1.5 focus:outline-none focus:border-violet-500"
                      id="edit-skill-select"
                    >
                      <option value="">— Выбрать навык —</option>
                      {skills.filter(s => !selected.skills.some(es => es.skill.id === s.id)).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <select id="edit-skill-level" defaultValue={3} className="w-20 bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded px-1 py-1.5">
                      {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>{levelLabels[l]}</option>)}
                    </select>
                  </div>
                    <button
                      type="button"
                      className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded text-[10px] font-bold transition-colors"
                      onClick={async () => {
                        const sId = (document.getElementById('edit-skill-select') as HTMLSelectElement).value;
                        const lvl = (document.getElementById('edit-skill-level') as HTMLSelectElement).value;
                        if (sId && selected) {
                          try {
                            await addSkillToEmployee(selected.id, Number(sId), Number(lvl), 0);
                            const updated = employees.find(emp => emp.id === selected.id);
                            if (updated) setSelected(updated);
                            (document.getElementById('edit-skill-select') as HTMLSelectElement).value = '';
                          } catch (err: any) { toast.error(extractError(err, 'Ошибка')); }
                        }
                      }}
                    >
                      + Добавить
                    </button>
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Добавить сертификат</p>
                <div className="space-y-2">
                  <input type="text" value={certForm.name} onChange={e => setCertForm({ ...certForm, name: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" placeholder="Название сертификата *" />
                  <input type="text" value={certForm.issuer} onChange={e => setCertForm({ ...certForm, issuer: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" placeholder="Организация (например, AWS)" />
                  <div className="flex gap-2">
                    <input type="date" value={certForm.issued_date} onChange={e => setCertForm({ ...certForm, issued_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-slate-400 rounded p-1.5 focus:border-violet-500 outline-none" title="Дата выдачи" />
                    <input type="date" value={certForm.expiry_date} onChange={e => setCertForm({ ...certForm, expiry_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-slate-400 rounded p-1.5 focus:border-violet-500 outline-none" title="Годен до" />
                  </div>
                  <button
                    type="button"
                    className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded text-[10px] font-bold transition-colors w-full"
                    disabled={!certForm.name.trim()}
                    onClick={async () => {
                      if (selected && certForm.name.trim()) {
                        try {
                          await addCertificateToEmployee(selected.id, {
                            name: certForm.name,
                            issuer: certForm.issuer,
                            issued_date: certForm.issued_date || null,
                            expiry_date: certForm.expiry_date || null,
                          });
                          const updated = employees.find(emp => emp.id === selected.id);
                          if (updated) setSelected(updated);
                          setCertForm({ name: '', issuer: '', credential_id: '', issued_date: '', expiry_date: '' });
                          toast.success('Сертификат добавлен');
                        } catch (err: any) { toast.error(extractError(err, 'Ошибка добавления сертификата')); }
                      }
                    }}
                  >
                    + Добавить сертификат
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Добавить недоступность</p>
                <div className="space-y-2">
                  <select value={unavailForm.type} onChange={e => setUnavailForm({ ...unavailForm, type: e.target.value as any })}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none">
                    <option value="VACATION">Отпуск</option>
                    <option value="SICK_LEAVE">Больничный</option>
                    <option value="UNPAID_LEAVE">За свой счет</option>
                    <option value="OTHER">Другое</option>
                  </select>
                  <div className="flex gap-2">
                    <input type="date" value={unavailForm.start_date} onChange={e => setUnavailForm({ ...unavailForm, start_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-slate-400 rounded p-1.5 focus:border-violet-500 outline-none" title="С" />
                    <input type="date" value={unavailForm.end_date} onChange={e => setUnavailForm({ ...unavailForm, end_date: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 text-xs text-slate-400 rounded p-1.5 focus:border-violet-500 outline-none" title="По" />
                  </div>
                  <input type="text" value={unavailForm.note} onChange={e => setUnavailForm({ ...unavailForm, note: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-white rounded p-1.5 focus:border-violet-500 outline-none" placeholder="Заметка (необязательно)" />
                  <button
                    type="button"
                    className="bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded text-[10px] font-bold transition-colors w-full"
                    disabled={!unavailForm.start_date || !unavailForm.end_date}
                    onClick={async () => {
                      if (selected && unavailForm.start_date && unavailForm.end_date) {
                        try {
                          await addUnavailabilityToEmployee(selected.id, unavailForm);
                          setUnavailForm({ type: 'VACATION', start_date: '', end_date: '', note: '' });
                          toast.success('Запись добавлена');
                        } catch (err: any) { toast.error(extractError(err, 'Ошибка добавления записи')); }
                      }
                    }}
                  >
                    + Добавить период
                  </button>
                </div>
              </div>
            </div>
          ) : (
            selected.bio && (
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">{selected.bio}</p>
            )
          )}

          <button
            onClick={() => handleMatchEmployee(selected)}
            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            <Zap size={14} /> Подобрать на проект
          </button>
        </div>
      )}

      {/* Add Employee Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Добавить сотрудника</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">{error}</div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Имя</label>
                  <input type="text" required value={formFirstName} onChange={e => setFormFirstName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    placeholder="Иван" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Фамилия</label>
                  <input type="text" required value={formLastName} onChange={e => setFormLastName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    placeholder="Иванов" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Username (логин)</label>
                <input type="text" required value={formUsername} onChange={e => setFormUsername(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                  placeholder="i.ivanov" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Email</label>
                <input type="email" required value={formEmail} onChange={e => setFormEmail(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                  placeholder="ivan@company.com" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Пароль</label>
                <input type="text" required value={formPassword} onChange={e => setFormPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500" />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Должность</label>
                  <input type="text" value={formPosition} onChange={e => setFormPosition(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500"
                    placeholder="Developer" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Область (Домен)</label>
                <select value={formDomain} onChange={e => setFormDomain(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500">
                  <option value="">— Выбрать домен —</option>
                  {domains.map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Skills */}
              <div className="border-t border-slate-800 pt-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Навыки</p>
                {formSkills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {formSkills.map(s => (
                      <span key={s.skill_id} className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-300 text-xs px-2 py-1 rounded-md">
                        {s.name} · {levelLabels[s.level]}
                        <button type="button" onClick={() => removeSkillFromForm(s.skill_id)} className="hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <select
                    value={selectedSkillId}
                    onChange={e => setSelectedSkillId(Number(e.target.value))}
                    className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">— Навык —</option>
                    {skills.map(s => <option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
                  </select>
                  <select
                    value={selectedSkillLevel}
                    onChange={e => setSelectedSkillLevel(Number(e.target.value))}
                    className="w-28 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500"
                  >
                    {[1, 2, 3, 4, 5].map(l => <option key={l} value={l}>{levelLabels[l]}</option>)}
                  </select>
                  <button type="button" onClick={addSkillToForm}
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 p-2 rounded-lg">
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-slate-300 hover:text-white">Отмена</button>
                <button type="submit" disabled={submitting}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {submitting ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
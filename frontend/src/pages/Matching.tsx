import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Zap, TrendingUp, AlertTriangle, ChevronUp, ChevronDown, Info, X } from 'lucide-react';
import api from '../api/client';
import { useAppContext } from '../context/AppContext';
import { toast } from 'react-hot-toast';

interface ScoreResult {
  employee_id: number;
  full_name: string;
  position: string;
  current_workload: number;
  total_score: number;
  competence_fit: number;
  experience_similarity: number;
  availability: number;
  past_performance: number;
  cost_fit: number;
  conflicts: string[];
  explanation: string;
}

const AVATAR_GRADIENTS = [
  'from-violet-500 to-indigo-500',
  'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-blue-500 to-cyan-500',
  'from-purple-500 to-violet-500',
];

const getInitials = (name: string) => {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.substring(0, 2).toUpperCase();
};

const getGradient = (id: number) => AVATAR_GRADIENTS[id % AVATAR_GRADIENTS.length];

interface Weights {
  w1: number; w2: number; w3: number; w4: number; w5: number;
}

const ScoreBar = ({ value, color }: { value: number; color: string }) => (
  <div className="flex items-center gap-2">
    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value * 100}%` }} />
    </div>
    <span className="text-xs text-slate-400 w-8 text-right">{Math.round(value * 100)}%</span>
  </div>
);

function CandidateCard({ result, rank, projects, onAssign, highlightedEmpId, defaultStart, defaultEnd, globalRoles, isTaskMatch, isChecked, onCheck }: {
  result: ScoreResult; rank: number;
  projects: { id: number; name: string; status: string }[];
  onAssign: (empId: number, projectId: number, role: string, load: number, start: string, end: string, roleRefId?: number) => void;
  highlightedEmpId?: number | null;
  defaultStart: string;
  defaultEnd: string;
  globalRoles: any[];
  isTaskMatch?: boolean;
  isChecked: boolean;
  onCheck: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [assignProjectId, setAssignProjectId] = useState<number | ''>(Number(sessionStorage.getItem('targetProjectId')) || '');
  const [assignRole, setAssignRole] = useState('');
  
  // Suggested load = 100 - current_load (availability is 1.0 - load/100)
  const maxCapacity = isTaskMatch ? 160 : 100;
  const currentLoad = Math.round((1 - result.availability) * maxCapacity);
  const suggestedLoad = Math.max(0, maxCapacity - currentLoad);
  
  const [assignLoad, setAssignLoad] = useState(suggestedLoad);

  useEffect(() => {
    if (expanded) setAssignLoad(suggestedLoad);
  }, [expanded, suggestedLoad]);

  const [assignStart, setAssignStart] = useState(defaultStart);
  const [assignEnd, setAssignEnd] = useState(defaultEnd);
  
  const scoreColor = result.total_score >= 0.8 ? 'text-emerald-400' : result.total_score >= 0.6 ? 'text-amber-400' : 'text-red-400';
  const scoreBg = result.total_score >= 0.8 ? 'bg-emerald-500/10 border-emerald-500/20' : result.total_score >= 0.6 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div className={`bg-slate-900 border rounded-xl overflow-hidden transition-all duration-200 ${
      result.conflicts.length > 0 ? 'border-amber-500/20' : 'border-slate-800'
    } ${result.employee_id === highlightedEmpId ? 'ring-2 ring-violet-500 shadow-lg shadow-violet-500/20' : ''}`}>
      <div className="flex items-center gap-4 p-4">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={onCheck}
          className="w-4 h-4 rounded border-slate-700 bg-slate-805 bg-slate-800 text-violet-650 text-violet-600 focus:ring-violet-500 focus:ring-offset-slate-900 cursor-pointer"
        />
        <div className="w-6 text-center text-sm font-bold text-slate-600">#{rank}</div>
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getGradient(result.employee_id)} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
          {getInitials(result.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-base font-bold text-white truncate">{result.full_name}</h4>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Задачи: {(result as any).active_task_hours || 0}/160ч.
            </span>
          </div>
          <p className="text-xs text-slate-400">{result.position || 'Кандидат'}</p>
        </div>
        <div className={`text-sm font-bold px-3 py-1 rounded-lg border ${scoreBg} ${scoreColor}`}>
          {Math.round(result.total_score * 100)}
        </div>
        {result.conflicts.length > 0 && (
          <div className="flex items-center gap-1 text-amber-400 text-xs">
            <AlertTriangle size={13} /><span>{result.conflicts.length} конфликт</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            result.current_workload > 100 ? 'bg-red-500/10 text-red-400 border-red-500/20' :
            result.current_workload > 70 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
            'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            {result.current_workload}%
          </span>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-slate-600 hover:text-slate-300 transition-colors">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-3 bg-slate-900/50">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Разбивка оценок</p>
            {[
              { label: 'Компетенции', value: result.competence_fit, color: 'bg-violet-500' },
              { label: 'Опыт в домене', value: result.experience_similarity, color: 'bg-blue-500' },
              { label: 'Доступность', value: result.availability, color: 'bg-emerald-500' },
              { label: 'Результативность', value: result.past_performance, color: 'bg-amber-500' },
              { label: 'Соответствие бюджету', value: result.cost_fit, color: 'bg-pink-500' },
            ].map(item => (
              <div key={item.label} className="grid grid-cols-[140px_1fr] items-center gap-3">
                <span className="text-xs text-slate-400">{item.label}</span>
                <ScoreBar value={item.value} color={item.color} />
              </div>
            ))}
          </div>
          {result.conflicts.length > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-400 mb-1.5 flex items-center gap-1.5"><AlertTriangle size={12} /> Предупреждения</p>
              {result.conflicts.map((c, i) => <p key={i} className="text-xs text-amber-300/80">{c}</p>)}
            </div>
          )}
          <div className="flex items-start gap-2 text-xs text-slate-400">
            <Info size={12} className="flex-shrink-0 mt-0.5" />{result.explanation}
          </div>

          <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-3 space-y-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Параметры назначения</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase">Проект</label>
                <select
                  value={assignProjectId}
                  onChange={e => setAssignProjectId(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500"
                >
                  <option value="">— Выбрать проект —</option>
                  {projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase">Роль</label>
                <select
                  value={assignRole}
                  onChange={e => setAssignRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-violet-500 appearance-none"
                >
                  <option value="">— Выбрать роль —</option>
                  {globalRoles.map(r => (
                    <option key={r.id} value={r.id.toString()}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  <label className="text-[10px] text-emerald-400 font-bold uppercase mb-1 block">
                    {isTaskMatch ? 'Нагрузка (часы)' : 'Загрузка на этот проект (%)'}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range" min={isTaskMatch ? "8" : "0"} max={maxCapacity} step={isTaskMatch ? "8" : "5"}
                      value={assignLoad}
                      onChange={e => setAssignLoad(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 h-1.5 bg-emerald-500/20 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm text-slate-100 font-bold w-10">{assignLoad}{isTaskMatch ? 'ч.' : '%'}</span>
                  </div>
                  </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase">С</label>
                <input type="date" value={assignStart} onChange={e => setAssignStart(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded p-1.5 focus:border-violet-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 uppercase">По</label>
                <input type="date" value={assignEnd} onChange={e => setAssignEnd(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded p-1.5 focus:border-violet-500 outline-none" />
              </div>
            </div>
            <button
              disabled={!assignProjectId}
              onClick={() => {
                if (!assignProjectId) return;
                const roleId = parseInt(assignRole);
                const isGlobal = !isNaN(roleId) && globalRoles.some(r => r.id === roleId);
                const roleName = isGlobal ? globalRoles.find(r => r.id === roleId)?.name || 'OTHER' : assignRole;
                onAssign(result.employee_id, Number(assignProjectId), roleName, assignLoad, assignStart, assignEnd, isGlobal ? roleId : undefined);
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 group"
            >
              {isTaskMatch ? <TrendingUp size={16} className="group-hover:translate-y-[-1px] transition-transform" /> : <Zap size={16} className="group-hover:scale-110 transition-transform" />}
              {isTaskMatch ? 'Назначить на задачу' : 'Назначить на проект'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Matching() {
  const { employees, projects, skills: skillsFromContext, assignEmployeeToProject, globalRoles, domains, extractError, updateWorkflowTask } = useAppContext();
  const location = useLocation();
  const state = location.state as { employeeId?: number } | null;
  
  const [domain, setDomain] = useState('IT');
  
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScoreResult[]>([]);
  const [highlightedEmpId, setHighlightedEmpId] = useState<number | null>(null);
  const [, setError] = useState('');

  const [skills, setSkills] = useState<string[]>(['React', 'TypeScript']);
  const [weights, setWeights] = useState<Weights>({ w1: 35, w2: 20, w3: 25, w4: 15, w5: 5 });

  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [matchingMode, setMatchingMode] = useState<'general' | 'task'>('general');
  const [selectedTaskId, setSelectedTaskId] = useState<number | ''>('');
  const { allTasks, getTaskRecommendations } = useAppContext();
  const targetProject = projects.find(p => p.id === selectedProjectId) || null;

  // Selection and Comparison States
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<number[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [comparisonResults, setComparisonResults] = useState<ScoreResult[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [compareAssignConfig, setCompareAssignConfig] = useState<Record<number, {
    projectId: number | '';
    role: string;
    load: number;
    start: string;
    end: string;
  }>>({});

  useEffect(() => {
    setSelectedCandidateIds([]);
  }, [matchingMode]);

  const handleCompareClick = async () => {
    setLoadingCompare(true);
    setIsCompareModalOpen(true);
    try {
      const selectedSkillIds = skills.map(sName => {
        const sObj = skillsFromContext.find(s => s.name === sName);
        return sObj?.id;
      }).filter(Boolean);

      const response = await api.post('/matching/compare/', {
        candidate_ids: selectedCandidateIds,
        required_skill_ids: selectedSkillIds,
        domain: domain,
        date_from: dateFrom,
        date_to: dateTo,
        max_hourly_rate: targetProject?.budget ? Number(targetProject.budget) / (160 * 3) : undefined,
        weights: {
          w1_competence: weights.w1 / 100,
          w2_experience: weights.w2 / 100,
          w3_availability: weights.w3 / 100,
          w4_performance: weights.w4 / 100,
          w5_cost: weights.w5 / 100
        }
      });
      setComparisonResults(response.data);
      
      // Initialize configurations
      const initialConfigs: typeof compareAssignConfig = {};
      response.data.forEach((r: ScoreResult) => {
        const currentLoad = Math.round((1 - r.availability) * (matchingMode === 'task' ? 160 : 100));
        const suggestedLoad = Math.max(0, (matchingMode === 'task' ? 160 : 100) - currentLoad);
        initialConfigs[r.employee_id] = {
          projectId: selectedProjectId || '',
          role: '',
          load: suggestedLoad,
          start: dateFrom,
          end: dateTo
        };
      });
      setCompareAssignConfig(initialConfigs);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при сравнении кандидатов'));
      setIsCompareModalOpen(false);
    } finally {
      setLoadingCompare(false);
    }
  };

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    const id = state?.employeeId || sessionStorage.getItem('matchingEmployeeId');
    const stateProjId = (state as any)?.projectId || sessionStorage.getItem('targetProjectId');
    const stateTaskId = (state as any)?.taskId || sessionStorage.getItem('targetTaskId');
    
    if (stateTaskId && allTasks.length > 0) {
      setSelectedTaskId(Number(stateTaskId));
      setMatchingMode('task');
      handleTaskRun(Number(stateTaskId));
    } else if (stateProjId && projects.length > 0) {
      setSelectedProjectId(Number(stateProjId));
    }
    
    if (id && employees.length > 0) {
      setHighlightedEmpId(Number(id));
      sessionStorage.removeItem('matchingEmployeeId');
      const emp = employees.find(e => e.id === Number(id));
      if (emp && emp.skills.length > 0) {
        setSkills(emp.skills.slice(0, 3).map(s => s.skill.name));
      }
      if (!stateTaskId) handleRun();
    }
    initialized.current = true;
  }, [state, employees, allTasks]);

  useEffect(() => {
    if (targetProject && targetProject.domain) {
      setDomain(targetProject.domain);
    }
  }, [targetProject]);

  const handleTaskRun = async (tid?: number) => {
    const id = tid || Number(selectedTaskId);
    if (!id) return;
    setLoading(true);
    setRan(false);
    setSelectedCandidateIds([]);
    try {
      const data = await getTaskRecommendations(id);
      const mapped = data.map((r: any) => {
        const emp = employees.find(e => e.id === r.employee_id);
        return {
          employee_id: r.employee_id,
          full_name: r.full_name,
          position: emp?.position || '',
          current_workload: emp?.current_workload_percentage || 0,
          active_task_hours: emp?.active_task_hours || 0,
          total_score: r.total_score,
          competence_fit: r.breakdown.competence,
          experience_similarity: r.breakdown.experience,
          availability: r.breakdown.availability,
          past_performance: r.breakdown.performance,
          cost_fit: r.breakdown.cost,
          conflicts: [],
          explanation: 'Оценка на основе параметров задачи'
        };
      });
      setResults(mapped);
      setRan(true);
    } catch (err: any) {
      console.error(err);
      toast.error(extractError(err, 'Ошибка при подборе для задачи'));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setSkills(prev => prev.filter(s => s !== skill));
  };

  const handleRun = async () => {
    if (skills.length === 0) { toast.error('Добавьте хотя бы один навык'); return; }
    setLoading(true);
    setError('');
    setSelectedCandidateIds([]);
    
    try {
      const selectedSkillIds = skills.map(sName => {
        const sObj = skillsFromContext.find(s => s.name === sName);
        return sObj?.id;
      }).filter(Boolean);

      const response = await api.post('/matching/rank/', {
        required_skill_ids: selectedSkillIds,
        domain: domain,
        date_from: dateFrom,
        date_to: dateTo,
        max_hourly_rate: targetProject?.budget ? Number(targetProject.budget) / (160 * 3) : undefined,
        weights: {
          w1_competence: weights.w1 / 100,
          w2_experience: weights.w2 / 100,
          w3_availability: weights.w3 / 100,
          w4_performance: weights.w4 / 100,
          w5_cost: weights.w5 / 100
        }
      });
      
      setResults(response.data);
      setRan(true);
    } catch (err: any) {
      console.error("Matching error:", err);
      toast.error(extractError(err, 'Ошибка при выполнении матчинга'));
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (empId: number, projId: number, role: string, load: number, start: string, end: string, roleRefId?: number) => {
    if (!projId) {
      toast.error('Пожалуйста, выберите проект');
      return;
    }
    if (new Date(start) > new Date(end)) {
      toast.error('Дата начала не может быть больше даты окончания');
      return;
    }
    const emp = employees.find(e => e.id === empId);
    const proj = projects.find(p => p.id === projId);
    if (!emp || !proj) {
      toast.error('Сотрудник или проект не найдены');
      return;
    }
    
    setLoading(true);
    try {
      if (matchingMode === 'task' && selectedTaskId) {
         // 1. Убеждаемся, что сотрудник в проекте
         const isMember = proj.members?.some(m => m.user.id === emp.user.id);
         if (!isMember) {
            await assignEmployeeToProject(empId, projId, role, load, roleRefId);
         }
         // 2. Назначаем на задачу (используем user id)
         await updateWorkflowTask(Number(selectedTaskId), { 
           assigned_to: emp.user.id,
           status: 'IN_PROGRESS'
         });
         toast.success(`${emp.user.full_name} назначен на задачу и проект «${proj.name}»`);
      } else {
         await assignEmployeeToProject(empId, projId, role, load, roleRefId);
         toast.success(`${emp.user.full_name} успешно назначен на проект «${proj.name}» с загрузкой ${load}%`);
      }
      setHighlightedEmpId(empId);
    } catch (err: any) {
      toast.error(extractError(err, 'Ошибка при назначении'));
    } finally {
      setLoading(false);
    }
  };

  const handleWeightChange = (key: keyof Weights, value: number) => {
    setWeights(prev => ({ ...prev, [key]: value }));
  };

  const weightSum = weights.w1 + weights.w2 + weights.w3 + weights.w4 + weights.w5;

  return (
    <div className="p-8 space-y-6 flex flex-col h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Zap size={22} className="text-violet-400" /> Подбор команды
        </h1>
        <p className="text-sm text-slate-400 mt-1">Умный матчинг сотрудников по компетенциям, загрузке и результативности</p>
      </div>

      <div className="grid grid-cols-3 gap-6 flex-1 items-start">
        <div className="col-span-1 space-y-4 sticky top-0">
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setMatchingMode('general')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${matchingMode === 'general' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Общий подбор
            </button>
            <button 
              onClick={() => setMatchingMode('task')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${matchingMode === 'task' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Под задачу
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 max-h-[calc(100vh-180px)] overflow-y-auto thin-scrollbar">
            <h3 className="text-sm font-semibold text-white">Параметры поиска</h3>

            {matchingMode === 'task' ? (
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Выберите задачу</label>
                <select 
                  value={selectedTaskId} 
                  onChange={e => setSelectedTaskId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="">— Выбрать задачу —</option>
                  {allTasks.filter(t => t.status !== 'DONE').map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Целевой проект (для бюджета)</label>
                  <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors">
                    <option value="">— Не выбран —</option>
                    {projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Домен проекта</label>
                  <select value={domain} onChange={e => setDomain(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors">
                    <option value="">— Выбрать —</option>
                    {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Начало</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500 transition-colors" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Конец</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500 transition-colors" />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Необходимые навыки</label>
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {skills.map(skill => (
                        <span key={skill} className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-300 text-xs px-2 py-1 rounded-md">
                          {skill}
                          <button type="button" onClick={() => handleRemoveSkill(skill)} className="text-violet-400 hover:text-red-400 transition-colors ml-0.5">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={e => {
                        const s = e.target.value;
                        if (s && !skills.includes(s)) {
                          setSkills(prev => [...prev, s]);
                        }
                      }}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500 transition-colors"
                    >
                      <option value="">— Добавить навык из базы —</option>
                      {skillsFromContext.filter(s => !skills.includes(s.name)).map(s => (
                        <option key={s.id} value={s.name}>{s.name} ({s.category})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Веса формулы</h4>
                    <span className={`text-xs font-medium ${Math.abs(weightSum - 100) < 1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      Σ = {weightSum}%
                    </span>
                  </div>
                  {([
                    { key: 'w1' as const, label: 'w₁ Компетенции' },
                    { key: 'w2' as const, label: 'w₂ Опыт' },
                    { key: 'w3' as const, label: 'w₃ Доступность' },
                    { key: 'w4' as const, label: 'w₄ Результаты' },
                    { key: 'w5' as const, label: 'w₅ Бюджет' },
                  ]).map(({ key, label }) => (
                    <div key={key} className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400">{label}</span>
                        <span className="text-xs font-medium text-violet-400">{weights[key]}%</span>
                      </div>
                      <input
                        type="range" min={0} max={100} step={5}
                        value={weights[key]}
                        onChange={e => handleWeightChange(key, Number(e.target.value))}
                        className="w-full accent-violet-500"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            <button onClick={matchingMode === 'general' ? handleRun : () => handleTaskRun()} disabled={loading || (matchingMode === 'task' && !selectedTaskId)}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2">
              {loading ? <><span className="animate-spin">⟳</span> Анализируем...</> : <><TrendingUp size={15} /> Запустить подбор</>}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="col-span-2 space-y-3 pb-8">
          {!ran ? (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center py-24 bg-slate-900 border border-slate-800 border-dashed rounded-xl">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
                <Zap size={24} className="text-violet-400" />
              </div>
              <p className="text-sm font-medium text-slate-300">Настройте параметры и запустите подбор</p>
              <p className="text-xs text-slate-600 mt-1">Алгоритм проанализирует компетенции, загрузку и историю</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-slate-300">
                  Найдено <span className="font-semibold text-white">{results.length}</span> кандидатов
                </p>
                <p className="text-xs text-slate-500">Домен: <span className="text-slate-300">{domain}</span> · {dateFrom} – {dateTo}</p>
              </div>
              {results.map((r, i) => (
                <CandidateCard 
                  key={r.employee_id} result={r} rank={i + 1} 
                  projects={projects} onAssign={handleAssign} 
                  highlightedEmpId={highlightedEmpId}
                  defaultStart={dateFrom}
                  defaultEnd={dateTo}
                  globalRoles={globalRoles}
                  isTaskMatch={matchingMode === 'task'}
                  isChecked={selectedCandidateIds.includes(r.employee_id)}
                  onCheck={() => {
                    if (selectedCandidateIds.includes(r.employee_id)) {
                      setSelectedCandidateIds(prev => prev.filter(id => id !== r.employee_id));
                    } else {
                      setSelectedCandidateIds(prev => [...prev, r.employee_id]);
                    }
                  }}
                />
              ))}

              {/* Floating Compare Button */}
              {selectedCandidateIds.length >= 2 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-slate-900 border border-slate-800 rounded-2xl px-6 py-4 shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-5 duration-200">
                  <span className="text-sm font-semibold text-slate-350">
                    Выбрано кандидатов для сравнения: <strong className="text-white">{selectedCandidateIds.length}</strong>
                  </span>
                  <button
                    onClick={handleCompareClick}
                    className="bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-violet-600/20"
                  >
                    Сравнить выбранных ({selectedCandidateIds.length})
                  </button>
                </div>
              )}

              {/* Modal: Compare Candidates */}
              {isCompareModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                    <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
                      <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Zap size={20} className="text-violet-400" /> Сравнение выбранных кандидатов
                      </h2>
                      <button 
                        onClick={() => setIsCompareModalOpen(false)} 
                        className="text-slate-500 hover:text-white transition-colors p-1 bg-slate-800 rounded-lg hover:bg-slate-700"
                      >
                        <X size={20} />
                      </button>
                    </div>
                    
                    {loadingCompare ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3 flex-1 animate-pulse">
                        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm">Загрузка параметров сравнения...</p>
                      </div>
                    ) : (
                      <div className="flex-1 overflow-x-auto p-6 custom-scrollbar">
                        <div className="flex gap-6 min-w-max pb-4">
                          {comparisonResults.map(r => {
                            const config = compareAssignConfig[r.employee_id] || {
                              projectId: selectedProjectId || '',
                              role: '',
                              load: matchingMode === 'task' ? 160 : 100,
                              start: dateFrom,
                              end: dateTo
                            };
                            const maxCapacity = matchingMode === 'task' ? 160 : 100;
                            
                            const scoreColor = r.total_score >= 0.8 ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10' : r.total_score >= 0.6 ? 'text-amber-400 border-amber-500/20 bg-amber-500/10' : 'text-red-400 border-red-500/20 bg-red-500/10';

                            return (
                              <div key={r.employee_id} className="w-[300px] bg-slate-950 border border-slate-850 rounded-2xl p-5 flex flex-col gap-4">
                                {/* Header */}
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getGradient(r.employee_id)} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}>
                                    {getInitials(r.full_name)}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <h4 className="text-sm font-bold text-white truncate leading-snug">{r.full_name}</h4>
                                    <p className="text-[10px] text-slate-500">{r.position || 'Кандидат'}</p>
                                  </div>
                                  <div className={`text-xs font-bold px-2 py-1 rounded-lg border ${scoreColor}`}>
                                    {Math.round(r.total_score * 100)}
                                  </div>
                                </div>

                                {/* Metrics */}
                                <div className="space-y-2.5 pt-3 border-t border-slate-850">
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Компетенции</span>
                                      <span className="font-bold">{Math.round(r.competence_fit * 100)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div className="h-full bg-violet-500 rounded-full" style={{ width: `${r.competence_fit * 100}%` }} />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Опыт</span>
                                      <span className="font-bold">{Math.round(r.experience_similarity * 100)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${r.experience_similarity * 100}%` }} />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Доступность</span>
                                      <span className="font-bold">{Math.round(r.availability * 100)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${r.availability * 100}%` }} />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Результативность</span>
                                      <span className="font-bold">{Math.round(r.past_performance * 100)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${r.past_performance * 100}%` }} />
                                    </div>
                                  </div>
                                  <div>
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                      <span>Соответствие бюджету</span>
                                      <span className="font-bold">{Math.round(r.cost_fit * 100)}%</span>
                                    </div>
                                    <div className="h-1.5 bg-slate-850 rounded-full overflow-hidden">
                                      <div className="h-full bg-pink-500 rounded-full" style={{ width: `${r.cost_fit * 100}%` }} />
                                    </div>
                                  </div>
                                </div>

                                {/* Workload and conflicts */}
                                <div className="text-[11px] text-slate-400 space-y-1.5 pt-3 border-t border-slate-850 flex-1">
                                  <div className="flex justify-between">
                                    <span>Текущая загрузка:</span>
                                    <span className={`font-semibold ${r.current_workload > 100 ? 'text-red-400' : r.current_workload > 70 ? 'text-amber-400' : 'text-emerald-400'}`}>{r.current_workload}%</span>
                                  </div>
                                  {r.conflicts.length > 0 && (
                                    <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-2 mt-1">
                                      <p className="text-[10px] text-amber-400 font-bold mb-1">Предупреждения:</p>
                                      {r.conflicts.map((c, i) => <p key={i} className="text-[9px] text-amber-300/80 leading-relaxed">{c}</p>)}
                                    </div>
                                  )}
                                </div>

                                {/* Form controls */}
                                <div className="space-y-3 bg-slate-900 border border-slate-850 rounded-xl p-3 pt-2">
                                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Назначение</p>
                                  <div>
                                    <label className="block text-[9px] text-slate-500 mb-1 uppercase">Проект</label>
                                    <select
                                      value={config.projectId}
                                      onChange={e => setCompareAssignConfig({
                                        ...compareAssignConfig,
                                        [r.employee_id]: { ...config, projectId: e.target.value ? Number(e.target.value) : '' }
                                      })}
                                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500"
                                    >
                                      <option value="">— Выбрать проект —</option>
                                      {projects.filter(p => p.status === 'ACTIVE' || p.status === 'AT_RISK').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[9px] text-slate-500 mb-1 uppercase">Роль</label>
                                    <select
                                      value={config.role}
                                      onChange={e => setCompareAssignConfig({
                                        ...compareAssignConfig,
                                        [r.employee_id]: { ...config, role: e.target.value }
                                      })}
                                      className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-500"
                                    >
                                      <option value="">— Выбрать роль —</option>
                                      {globalRoles.map(gr => <option key={gr.id} value={gr.id.toString()}>{gr.name}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="flex justify-between text-[9px] text-slate-500 mb-1 uppercase">
                                      <span>{matchingMode === 'task' ? 'Нагрузка (часы)' : 'Загрузка (%)'}</span>
                                      <span className="text-white font-bold">{config.load}</span>
                                    </label>
                                    <input
                                      type="range" min={matchingMode === 'task' ? "8" : "0"} max={maxCapacity} step={matchingMode === 'task' ? "8" : "5"}
                                      value={config.load}
                                      onChange={e => setCompareAssignConfig({
                                        ...compareAssignConfig,
                                        [r.employee_id]: { ...config, load: Number(e.target.value) }
                                      })}
                                      className="w-full accent-violet-500 h-1 bg-slate-850 rounded-lg appearance-none cursor-pointer"
                                    />
                                  </div>

                                  <button
                                    disabled={!config.projectId}
                                    onClick={() => {
                                      if (!config.projectId) return;
                                      const roleId = parseInt(config.role);
                                      const isGlobal = !isNaN(roleId) && globalRoles.some(gr => gr.id === roleId);
                                      const roleName = isGlobal ? globalRoles.find(gr => gr.id === roleId)?.name || 'OTHER' : config.role;
                                      handleAssign(
                                        r.employee_id, 
                                        Number(config.projectId), 
                                        roleName, 
                                        config.load, 
                                        config.start, 
                                        config.end, 
                                        isGlobal ? roleId : undefined
                                      );
                                    }}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-lg transition-all shadow shadow-emerald-950/20 flex items-center justify-center gap-1.5"
                                  >
                                    <TrendingUp size={12} />
                                    {matchingMode === 'task' ? 'Назначить на задачу' : 'Назначить'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    <div className="p-4 border-t border-slate-800 flex justify-end flex-shrink-0">
                      <button 
                        onClick={() => setIsCompareModalOpen(false)}
                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg border border-slate-750 transition-colors"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
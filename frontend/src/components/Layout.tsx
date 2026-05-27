import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, FolderKanban, Users, Zap,
  GitBranch, BarChart3, ClipboardCheck, LogOut, Shield, Briefcase, UserCheck, Settings, History,
  ChevronLeft, ChevronRight, Package, CalendarDays
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAppContext } from '../context/AppContext';
import { OnboardingTour } from './OnboardingTour';
import { CommandPalette } from './CommandPalette';
import { HelpCenter } from './HelpCenter';

// Role-based nav items
const ALL_NAV_ITEMS = [
  { to: '/',          icon: LayoutDashboard, label: 'Дашборд',       roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
  { to: '/workspace', icon: ClipboardCheck,  label: 'Мой кабинет',   roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
  { to: '/projects',  icon: FolderKanban,    label: 'Проекты',        roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
  { to: '/workflows', icon: GitBranch,       label: 'Процессы',       roles: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
  { to: '/team',      icon: Users,           label: 'Команда',        roles: ['ADMIN', 'MANAGER'] },
  { to: '/matching',  icon: Zap,             label: 'Подбор команды', roles: ['ADMIN', 'MANAGER'] },
  { to: '/analytics', icon: BarChart3,       label: 'Аналитика',      roles: ['ADMIN', 'MANAGER'] },
  { to: '/calendar',  icon: CalendarDays,    label: 'Календарь',      roles: ['ADMIN', 'MANAGER'] },

  { to: '/catalog',   icon: Package,         label: 'Библиотека WBS', roles: ['ADMIN', 'MANAGER'] },
  { to: '/audit',     icon: History,         label: 'Журнал аудита',  roles: ['ADMIN', 'MANAGER'] },
  { to: '/settings',  icon: Settings,        label: 'Настройки',      roles: ['ADMIN'] },
];

const ROLE_META: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  ADMIN:    { label: 'Администратор', color: 'text-violet-400', icon: Shield },
  MANAGER:  { label: 'Менеджер',      color: 'text-blue-400',   icon: Briefcase },
  EMPLOYEE: { label: 'Сотрудник',     color: 'text-emerald-400', icon: UserCheck },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { unreadCount } = useAppContext();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const role = user?.role ?? 'EMPLOYEE';
  const navItems = ALL_NAV_ITEMS.filter(item => item.roles.includes(role));
  const roleMeta = ROLE_META[role] ?? ROLE_META.EMPLOYEE;
  const RoleIcon = roleMeta.icon;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside 
        className={`${isCollapsed ? 'w-20' : 'w-64'} flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300 ease-in-out relative`}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-violet-600 transition-all z-10"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Logo */}
        <div className={`h-16 flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-6'} border-b border-slate-800`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h8M2 12h5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          {!isCollapsed && (
            <span className="text-base font-semibold tracking-tight text-white animate-in fade-in duration-500">
              ProJect<span className="text-violet-400">MS</span>
            </span>
          )}
        </div>
        

        {/* Role badge */}
        <div className={`mx-3 mt-3 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 flex items-center ${isCollapsed ? 'justify-center' : 'gap-2'}`}>
          <RoleIcon size={13} className={roleMeta.color} />
          {!isCollapsed && (
            <span className={`text-xs font-semibold ${roleMeta.color} animate-in fade-in duration-300`}>{roleMeta.label}</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative ${
                  isActive
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-600/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 border border-transparent'
                }`
              }
            >
              <div className="flex items-center gap-3">
                <Icon size={18} className="flex-shrink-0" />
                {!isCollapsed && <span className="animate-in fade-in slide-in-from-left-2 duration-300">{label}</span>}
              </div>
              
              {to === '/workspace' && unreadCount > 0 && (
                <span className={`rounded-full bg-violet-600 text-[10px] flex items-center justify-center text-white font-bold animate-pulse shadow-lg shadow-violet-600/40 ${
                  isCollapsed ? 'absolute -top-1 -right-1 w-4 h-4' : 'w-4 h-4'
                }`}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}

              {isCollapsed && (
                <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700">
                  {label}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom: user info + logout */}
        <div className={`px-3 py-4 border-t border-slate-800 bg-slate-900/50`}>
          <button
            onClick={logout}
            className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 group relative`}
          >
            <LogOut size={18} />
            {!isCollapsed && <span>Выйти</span>}
            {isCollapsed && (
              <div className="absolute left-full ml-4 px-2 py-1 bg-red-500 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl">
                Выйти
              </div>
            )}
          </button>
          
          {user && (
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `mt-3 flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg transition-all duration-200 group relative border ${
                  isActive 
                    ? 'bg-violet-600/10 border-violet-500/30' 
                    : 'border-transparent hover:bg-slate-800/50 hover:border-slate-700/50'
                }`
              }
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-lg border border-white/10 group-hover:scale-110 transition-transform">
                {user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
              </div>
              {!isCollapsed && (
                <div className="flex-1 truncate animate-in fade-in duration-300">
                  <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-0.5">Профиль</p>
                  <p className="text-xs font-semibold text-slate-200 truncate">{user.full_name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
                </div>
              )}
              {!isCollapsed && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <Settings size={14} className="text-slate-500 hover:text-violet-400" />
                </div>
              )}
              {isCollapsed && (
                <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-xl border border-slate-700">
                  Профиль
                </div>
              )}
            </NavLink>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-slate-950 relative">
        {children}
      </main>

      <OnboardingTour />
      <CommandPalette />
      <HelpCenter />
    </div>
  );
}
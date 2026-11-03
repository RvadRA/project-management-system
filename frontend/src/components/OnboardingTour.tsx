import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isStaff } from '../utils/roles';
import { START_TOUR_EVENT } from './HelpCenter';

interface TourStep {
  title: string;
  description: string;
  emoji: string;
  /** Показывать только менеджерам и выше */
  staffOnly?: boolean;
}

const TOUR_STEPS: TourStep[] = [
  { emoji: '👋', title: 'Добро пожаловать', description: 'Это краткий обзор. Меню слева зависит от вашей роли в системе; в любой момент нажмите «?», чтобы открыть справку по текущей странице.' },
  { emoji: '📊', title: 'Дашборд', description: 'Сводка по проектам, задачам и уведомлениям — всё, что требует внимания сегодня.' },
  { emoji: '✅', title: 'Мой кабинет', description: 'Ваши задачи: возьмите задачу в работу, отправьте результат (текст, чек-лист или файлы) и следите за сроком. Задачи, ждущие предыдущих этапов, запустятся сами.' },
  { emoji: '📁', title: 'Проекты', description: 'Создавайте проекты, ведите план (WBS и диаграмму Ганта), добавляйте команду и задавайте права участников флажками. Завершив проект, оцените команду.', staffOnly: true },
  { emoji: '🎯', title: 'Подбор команды', description: 'Система ранжирует сотрудников по компетенциям, опыту, доступности, результативности и стоимости и подсказывает, какую загрузку на проект назначить.', staffOnly: true },
  { emoji: '🔀', title: 'Бизнес-процессы', description: 'Канбан-доска процесса: задача идёт «В работе» → «На проверке» → «Выполнено», а следующий этап запускается после утверждения.' },
  { emoji: '📈', title: 'Аналитика и календарь', description: 'Динамика задач, статус и прогноз проектов, загрузка областей и календарь ресурсов с отпусками и дедлайнами.', staffOnly: true },
  { emoji: '📚', title: 'База знаний и файлы', description: 'Общие регламенты и файлы проектов — ТЗ, документы, инструкции. Доступ определяется правами в проекте.' },
];

const STORAGE_KEY = 'onboarding_completed';

export function OnboardingTour() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(() => !localStorage.getItem(STORAGE_KEY));

  const steps = useMemo(() => TOUR_STEPS.filter(s => !s.staffOnly || isStaff(user)), [user]);

  // Тур можно запустить заново из справочного центра
  useEffect(() => {
    const start = () => { setCurrentStep(0); setIsVisible(true); };
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, []);

  const complete = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsVisible(false);
  };

  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { localStorage.setItem(STORAGE_KEY, 'true'); setIsVisible(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isVisible]);

  if (!isVisible) return null;

  const step = steps[Math.min(currentStep, steps.length - 1)];
  const isLast = currentStep >= steps.length - 1;

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-label="Обучающий тур">
      <div className="bg-slate-900 border border-violet-500/30 rounded-2xl p-8 max-w-md w-full shadow-2xl relative">
        <button onClick={complete} className="absolute top-4 right-4 text-slate-500 hover:text-white" aria-label="Закрыть тур"><X size={18} /></button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl">{step.emoji}</div>
          <div>
            <p className="text-xs text-violet-400 font-bold uppercase">Шаг {currentStep + 1} из {steps.length}</p>
            <h3 className="text-lg font-bold text-white">{step.title}</h3>
          </div>
        </div>

        <p className="text-sm text-slate-400 mb-6 leading-relaxed">{step.description}</p>

        <div className="flex items-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <span key={i} className={`h-1 rounded-full transition-all ${i === currentStep ? 'w-6 bg-violet-500' : 'w-2 bg-slate-700'}`} />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button onClick={complete} className="text-xs text-slate-500 hover:text-slate-300">Пропустить</button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button onClick={() => setCurrentStep(prev => prev - 1)} className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white" aria-label="Назад">
                <ChevronLeft size={16} />
              </button>
            )}
            {!isLast ? (
              <button onClick={() => setCurrentStep(prev => prev + 1)} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold rounded-lg flex items-center gap-2">
                Далее <ChevronRight size={16} />
              </button>
            ) : (
              <button onClick={complete} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg">
                Начать работу!
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';

interface TourStep {
  target: string; // CSS selector for highlighted element
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="dashboard"]',
    title: 'Дашборд',
    description: 'Здесь вы видите сводку по всем проектам и задачам',
    position: 'bottom',
  },
  {
    target: '[data-tour="projects"]',
    title: 'Проекты',
    description: 'Создавайте и управляйте проектами, используйте мастер переноса для быстрого старта',
    position: 'right',
  },
  {
    target: '[data-tour="workflows"]',
    title: 'Бизнес-процессы',
    description: 'Запускайте процессы по шаблонам, отслеживайте задачи на канбан-доске',
    position: 'bottom',
  },
  {
    target: '[data-tour="matching"]',
    title: 'Подбор команды',
    description: 'Алгоритм подберёт лучших сотрудников под ваш проект',
    position: 'left',
  },
];

export function OnboardingTour() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(() => {
    return !localStorage.getItem('onboarding_completed');
  });

  if (!isVisible) return null;

  const step = TOUR_STEPS[currentStep];

  const complete = () => {
    localStorage.setItem('onboarding_completed', 'true');
    setIsVisible(false);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm">
      <div className="absolute" style={{ 
        top: '50%', 
        left: '50%', 
        transform: 'translate(-50%, -50%)' 
      }}>
        <div className="bg-slate-900 border border-violet-500/30 rounded-2xl p-8 max-w-md shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-2xl">
              👋
            </div>
            <div>
              <p className="text-xs text-violet-400 font-bold uppercase">
                Шаг {currentStep + 1} из {TOUR_STEPS.length}
              </p>
              <h3 className="text-lg font-bold text-white">{step.title}</h3>
            </div>
          </div>
          
          <p className="text-sm text-slate-400 mb-8">{step.description}</p>
          
          <div className="flex items-center justify-between">
            <button
              onClick={complete}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Пропустить
            </button>
            
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={() => setCurrentStep(prev => prev - 1)}
                  className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                >
                  <ChevronLeft size={16} />
                </button>
              )}
              
              {currentStep < TOUR_STEPS.length - 1 ? (
                <button
                  onClick={() => setCurrentStep(prev => prev + 1)}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold rounded-lg flex items-center gap-2"
                >
                  Далее <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={complete}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg"
                >
                  Начать работу!
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

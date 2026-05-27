import { useNavigate } from 'react-router-dom';

// 404 Page
export function NotFoundPage() {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-slate-800 mb-4">404</div>
        <h1 className="text-2xl font-bold text-white mb-2">Страница не найдена</h1>
        <p className="text-slate-500 mb-8">Возможно, она была удалена или перемещена</p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl"
          >
            Назад
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl"
          >
            На главную
          </button>
        </div>
      </div>
    </div>
  );
}

// 403 Forbidden
export function ForbiddenPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-red-900/30 mb-4">403</div>
        <h1 className="text-2xl font-bold text-white mb-2">Доступ запрещён</h1>
        <p className="text-slate-500">У вас нет прав для просмотра этой страницы</p>
      </div>
    </div>
  );
}

// 500 Error
export function ServerErrorPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl font-bold text-amber-900/30 mb-4">500</div>
        <h1 className="text-2xl font-bold text-white mb-2">Ошибка сервера</h1>
        <p className="text-slate-500 mb-4">Что-то пошло не так. Мы уже работаем над этим.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}

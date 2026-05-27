import { useState } from 'react';
import { HelpCircle, BookOpen, MessageCircle, Video, Search, X } from 'lucide-react';

const HELP_ARTICLES = [
  {
    id: 1,
    title: 'Как создать проект',
    content: `1. Перейдите в раздел "Проекты"\n2. Нажмите кнопку "Новый проект"\n3. Заполните название, описание и сроки\n4. Выберите домен и менеджера\n5. Нажмите "Сохранить"`,
    category: 'projects',
  },
  {
    id: 2,
    title: 'Как использовать мастер переноса',
    content: `Мастер переноса позволяет скопировать структуру из существующего проекта:\n1. Нажмите "Мастер переноса" в разделе проектов\n2. Выберите источник (проект или шаблон)\n3. Настройте масштабирование и параметры\n4. Выберите задачи для переноса\n5. Завершите импорт`,
    category: 'projects',
  },
  {
    id: 3,
    title: 'Как подобрать команду',
    content: `Система автоматически подбирает сотрудников:\n1. Перейдите в "Подбор команды"\n2. Укажите требуемые навыки и домен\n3. Настройте веса критериев\n4. Нажмите "Запустить подбор"\n5. Назначьте выбранных кандидатов`,
    category: 'matching',
  },
  {
    id: 4,
    title: 'Как работать с бизнес-процессами',
    content: `1. Создайте процесс из шаблона или вручную\n2. Задачи появятся на канбан-доске\n3. Перетаскивайте задачи между колонками\n4. Отправляйте отчёты о выполнении\n5. Утверждайте завершённые задачи`,
    category: 'workflows',
  },
];

export function HelpCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeArticle, setActiveArticle] = useState<number | null>(null);
  const [searchHelp, setSearchHelp] = useState('');

  const filteredArticles = HELP_ARTICLES.filter(a =>
    a.title.toLowerCase().includes(searchHelp.toLowerCase())
  );

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl shadow-2xl flex items-center justify-center transition-all hover:scale-105"
        title="Помощь"
      >
        <HelpCircle size={24} />
      </button>

      {/* Help panel */}
      {isOpen && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <div 
            className="fixed right-0 top-0 h-full w-[420px] bg-slate-900 border-l border-slate-800 shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <BookOpen size={20} className="text-violet-400" />
                  Справочный центр
                </h2>
                <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <div className="relative mb-6">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Поиск по справке..."
                  value={searchHelp}
                  onChange={e => setSearchHelp(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-violet-500"
                />
              </div>

              <div className="space-y-3">
                {filteredArticles.map(article => (
                  <div key={article.id}>
                    <button
                      onClick={() => setActiveArticle(activeArticle === article.id ? null : article.id)}
                      className="w-full text-left p-4 bg-slate-800/30 border border-slate-800 rounded-xl hover:border-violet-500/30 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">{article.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          article.category === 'projects' ? 'bg-violet-500/10 text-violet-400' :
                          article.category === 'matching' ? 'bg-emerald-500/10 text-emerald-400' :
                          'bg-blue-500/10 text-blue-400'
                        }`}>
                          {article.category}
                        </span>
                      </div>
                    </button>
                    
                    {activeArticle === article.id && (
                      <div className="mt-2 p-4 bg-slate-800/20 border border-slate-800 rounded-xl">
                        <p className="text-sm text-slate-300 whitespace-pre-line">{article.content}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-slate-800">
                <p className="text-xs text-slate-500 mb-3">Нужна дополнительная помощь?</p>
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex items-center gap-2 p-3 bg-slate-800/30 border border-slate-800 rounded-xl text-sm text-slate-300 hover:border-violet-500/30">
                    <MessageCircle size={16} className="text-violet-400" />
                    Чат с поддержкой
                  </button>
                  <button className="flex items-center gap-2 p-3 bg-slate-800/30 border border-slate-800 rounded-xl text-sm text-slate-300 hover:border-violet-500/30">
                    <Video size={16} className="text-violet-400" />
                    Видео-гайды
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

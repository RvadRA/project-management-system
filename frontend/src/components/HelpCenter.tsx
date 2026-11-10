import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HelpCircle, BookOpen, Search, X, ChevronDown, ArrowRight, Lightbulb, PlayCircle, Keyboard, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../utils/roles';
import { openAssistant } from '../utils/events';
import { ARTICLES, CATEGORIES, GLOSSARY, PAGE_ARTICLES, SHORTCUTS, type Article, type CategoryId } from './helpContent';

type Tab = 'articles' | 'glossary' | 'keys';

export const OPEN_HELP_EVENT = 'pms:open-help';
export const START_TOUR_EVENT = 'pms:start-tour';

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
};

/** Подходит ли статья поисковому запросу: по заголовку, описанию, шагам, подсказкам и ключевым словам */
const matches = (article: Article, query: string) => {
  const examples = (article.examples ?? []).flatMap(e => [e.phrase, e.result]);
  const haystack = [article.title, article.summary, ...(article.steps ?? []), ...(article.tips ?? []), ...(article.keywords ?? []), ...examples]
    .join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
};

export function HelpCenter() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('articles');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const role = (user?.role ?? 'EMPLOYEE') as UserRole;
  const available = useMemo(() => ARTICLES.filter(a => !a.roles || a.roles.includes(role)), [role]);
  const pageHelp = PAGE_ARTICLES.find(p => p.match(location.pathname));
  const pageArticles = useMemo(
    () => (pageHelp?.ids ?? []).map(id => available.find(a => a.id === id)).filter((a): a is Article => !!a),
    [pageHelp, available],
  );

  const open = (articleId?: string) => {
    setTab('articles');
    setQuery('');
    setCategory('all');
    setActiveId(articleId ?? null);
    setIsOpen(true);
  };

  // «?» или F1 — справка на статье о текущей странице; Esc — закрыть
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setIsOpen(false); return; }
      const wantsHelp = e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.metaKey && !isTyping(e.target));
      if (!wantsHelp) return;
      e.preventDefault();
      open(pageArticles[0]?.id);
    };
    const onOpen = (e: Event) => open((e as CustomEvent<string | undefined>).detail);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_HELP_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_HELP_EVENT, onOpen);
    };
  }, [pageArticles]);

  const trimmed = query.trim();
  const found = useMemo(() => available.filter(a => (category === 'all' || a.category === category) && (!trimmed || matches(a, trimmed))), [available, category, trimmed]);
  const foundTerms = useMemo(
    () => GLOSSARY.filter(g => !trimmed || `${g.term} ${g.definition}`.toLowerCase().includes(trimmed.toLowerCase())),
    [trimmed],
  );
  const categoryLabel = (id: CategoryId) => CATEGORIES.find(c => c.id === id)?.label ?? id;

  const renderArticle = (article: Article) => {
    const expanded = activeId === article.id;
    return (
      <div key={article.id} className="bg-slate-800/30 border border-slate-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setActiveId(expanded ? null : article.id)}
          aria-expanded={expanded}
          className="w-full text-left p-3.5 flex items-start gap-3 hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-100">{article.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{article.summary}</p>
          </div>
          <ChevronDown size={16} className={`text-slate-500 flex-shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-1 space-y-3">
            {article.steps && (
              <ol className="space-y-2">
                {article.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] text-slate-300 leading-relaxed">
                    <span className="w-5 h-5 rounded-full bg-violet-500/15 text-violet-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {article.examples && article.examples.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Примеры фраз</p>
                {article.examples.map(example => (
                  <div key={example.phrase} className="p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                    <p className="text-[13px] text-slate-100 leading-relaxed">«{example.phrase}»</p>
                    <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">Что получится: {example.result}</p>
                    <button
                      onClick={() => { setIsOpen(false); openAssistant({ tab: example.tab ?? 'task', text: example.phrase }); }}
                      className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-violet-400 hover:text-violet-300 transition-colors"
                      title="Открыть ассистента с этой фразой — ничего не создаётся, пока вы не подтвердите"
                    >
                      <Sparkles size={12} /> Попробовать
                    </button>
                  </div>
                ))}
              </div>
            )}
            {article.tips && article.tips.length > 0 && (
              <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg space-y-1.5">
                {article.tips.map((tip, i) => (
                  <p key={i} className="text-xs text-amber-200/90 leading-relaxed flex gap-2">
                    <Lightbulb size={12} className="flex-shrink-0 mt-0.5 text-amber-400" /> <span>{tip}</span>
                  </p>
                ))}
              </div>
            )}
            {article.link && (
              <button
                onClick={() => { navigate(article.link!.to); setIsOpen(false); }}
                className="flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition-colors"
              >
                {article.link.label} <ArrowRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => open(pageArticles[0]?.id)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl shadow-2xl flex items-center justify-center transition-all hover:scale-105"
        title="Справка (клавиша ?)"
        aria-label="Открыть справочный центр"
      >
        <HelpCircle size={24} />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <div
            className="fixed right-0 top-0 h-full w-full max-w-[460px] bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
            role="dialog" aria-label="Справочный центр"
          >
            <div className="p-5 pb-3 flex-shrink-0 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <BookOpen size={20} className="text-violet-400" />
                  Справочный центр
                </h2>
                <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white" aria-label="Закрыть"><X size={20} /></button>
              </div>

              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text" autoFocus
                  placeholder="Поиск: помощник, фразы, загрузка, права, сроки…"
                  value={query}
                  onChange={e => { setQuery(e.target.value); if (tab === 'keys') setTab('articles'); }}
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-10 pr-4 py-2.5 outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg" role="tablist">
                {([['articles', 'Статьи'], ['glossary', 'Словарь'], ['keys', 'Клавиши']] as [Tab, string][]).map(([id, label]) => (
                  <button
                    key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${tab === id ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-4 space-y-3">
              {tab === 'articles' && (
                <>
                  {!trimmed && pageHelp && pageArticles.length > 0 && category === 'all' && (
                    <section className="space-y-2">
                      <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">Для этой страницы — {pageHelp.title}</p>
                      {pageArticles.map(renderArticle)}
                    </section>
                  )}

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {[{ id: 'all' as const, label: 'Все' }, ...CATEGORIES.filter(c => available.some(a => a.category === c.id))].map(c => (
                      <button
                        key={c.id} onClick={() => setCategory(c.id)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                          category === c.id ? 'bg-violet-600/20 text-violet-300 border-violet-500/40' : 'bg-slate-800/50 text-slate-400 border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {found.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-sm text-slate-400">Ничего не найдено</p>
                      <p className="text-xs text-slate-600 mt-1">Попробуйте другое слово или загляните в «Словарь»</p>
                    </div>
                  ) : (
                    <section className="space-y-2">
                      {trimmed && <p className="text-[10px] text-slate-500">Найдено статей: {found.length}</p>}
                      {(category === 'all' && !trimmed ? CATEGORIES : [{ id: category as CategoryId, label: '' }])
                        .map(c => {
                          const list = found.filter(a => (category === 'all' && !trimmed ? a.category === c.id : true));
                          if (list.length === 0) return null;
                          return (
                            <div key={c.id} className="space-y-2">
                              {category === 'all' && !trimmed && (
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pt-2">{categoryLabel(c.id)}</p>
                              )}
                              {list.map(renderArticle)}
                            </div>
                          );
                        })}
                    </section>
                  )}
                </>
              )}

              {tab === 'glossary' && (
                foundTerms.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-10">Такого термина нет</p>
                ) : (
                  <dl className="space-y-2.5 pt-1">
                    {foundTerms.map(g => (
                      <div key={g.term} className="p-3 bg-slate-800/30 border border-slate-800 rounded-xl">
                        <dt className="text-sm font-bold text-slate-100">{g.term}</dt>
                        <dd className="text-xs text-slate-400 mt-1 leading-relaxed">{g.definition}</dd>
                      </div>
                    ))}
                  </dl>
                )
              )}

              {tab === 'keys' && (
                <div className="space-y-2 pt-1">
                  {SHORTCUTS.map(s => (
                    <div key={s.keys} className="flex items-center justify-between gap-3 p-3 bg-slate-800/30 border border-slate-800 rounded-xl">
                      <span className="text-xs text-slate-300">{s.action}</span>
                      <kbd className="text-[11px] font-mono font-bold text-violet-300 bg-slate-800 border border-slate-700 rounded px-2 py-1 whitespace-nowrap">{s.keys}</kbd>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 flex items-center gap-3 flex-shrink-0">
              <button
                onClick={() => { setIsOpen(false); window.dispatchEvent(new Event(START_TOUR_EVENT)); }}
                className="flex-1 flex items-center justify-center gap-2 p-2.5 bg-slate-800/40 border border-slate-800 rounded-xl text-sm text-slate-300 hover:border-violet-500/40 hover:text-white transition-colors"
              >
                <PlayCircle size={16} className="text-violet-400" /> Обучающий тур
              </button>
              <button
                onClick={() => { setTab('keys'); }}
                className="flex items-center justify-center gap-2 p-2.5 bg-slate-800/40 border border-slate-800 rounded-xl text-sm text-slate-300 hover:border-violet-500/40 hover:text-white transition-colors"
                title="Горячие клавиши"
              >
                <Keyboard size={16} className="text-violet-400" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

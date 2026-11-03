import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AssistantRecommendationsState from './AssistantRecommendationsState';

describe('AssistantRecommendationsState', () => {
  it('renders the requested empty state before parsing', () => {
    const html = renderToStaticMarkup(
      <AssistantRecommendationsState state="empty" onRetry={() => undefined} />,
    );

    expect(html).toContain('Рекомендации появятся после разбора поручения');
    expect(html).not.toContain('Повторить разбор');
  });

  it('renders an API error and retry action without hiding a previous draft', () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(
      <AssistantRecommendationsState
        state="error"
        error="Сервис временно недоступен"
        previousDraftKept
        onRetry={onRetry}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Сервис временно недоступен');
    expect(html).toContain('Предыдущий черновик сохранён и не перезаписан.');
    expect(html).toContain('Повторить разбор');
  });

  it('keeps loading state explicit and accessible', () => {
    const html = renderToStaticMarkup(
      <AssistantRecommendationsState state="loading" onRetry={() => undefined} />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Разбираю поручение…');
  });
});

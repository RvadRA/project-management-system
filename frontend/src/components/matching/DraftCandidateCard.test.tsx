import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ScoreResult } from '../../types/matching';
import DraftCandidateCard from './DraftCandidateCard';

const longExplanation =
  'Кандидат подходит, потому что подтверждены навыки SQL и Pandas, есть опыт интеграции прогнозных моделей, '
  + 'загрузка позволяет выделить время на задачу, а в прошлых проектах он сдавал похожие работы в срок.';

const result: ScoreResult = {
  employee_id: 11,
  user_id: 7,
  full_name: 'Очень Длинное Имя Сотрудника Для Проверки Переноса Строк',
  position: 'Ведущий аналитик данных',
  current_workload: 35,
  active_task_hours: 10,
  open_task_count: 2,
  unestimated_task_count: 0,
  already_member: false,
  data_gaps: ['Нет записи загрузки на весь период'],
  details: {
    competence: { required: 2, matched: ['SQL', 'Pandas'], below_minimum: [], missing: [] },
    experience: { domain: 'EdTech', domain_projects: 3, domain_done_tasks: 5 },
    availability: {
      avg_load_percent: 35,
      peak_load_percent: 40,
      free_percent: 65,
      unavailable_days: 0,
      period_days: 30,
      working_days: 22,
      available_hours: 160,
      workload_known: true,
      current_workload_known: true,
    },
    semantic_similarity: 0.82,
    semantic_available: true,
    explanation_source: 'llm',
  },
  total_score: 0.82,
  competence_fit: 0.9,
  experience_similarity: 0.8,
  availability: 0.7,
  past_performance: 0.8,
  cost_fit: 0.7,
  conflicts: [],
  explanation: longExplanation,
};

describe('DraftCandidateCard', () => {
  it('keeps the compact card concise and preserves the full explanation in details', () => {
    const html = renderToStaticMarkup(
      <DraftCandidateCard
        result={result}
        rank={1}
        selected={false}
        competenceFilterApplied
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('<details');
    expect(html).toContain('Подробности оценки');
    expect(html).toContain(longExplanation);
    expect(html).toContain('не в команде проекта');
    expect(html.toLowerCase()).toContain('нет записи загрузки');
    expect(html).not.toContain('truncate');
  });

  it('does not present unknown workload as an unavailability period', () => {
    const html = renderToStaticMarkup(
      <DraftCandidateCard
        result={{
          ...result,
          conflicts: ['Нет записей загрузки; фактическая занятость по проектам неизвестна'],
          current_workload: 0,
          details: {
            ...result.details,
            availability: {
              avg_load_percent: 35,
              peak_load_percent: 40,
              free_percent: 65,
              unavailable_days: 0,
              period_days: 30,
              working_days: 22,
              available_hours: 160,
              workload_known: false,
              current_workload_known: false,
            },
          },
          availability: 0.5,
        }}
        rank={1}
        selected={false}
        dueDate="2030-02-01"
        competenceFilterApplied
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('Нет записей загрузки');
    expect(html).toContain('загрузка 10 ч задач / загрузка н/д');
    expect(html).toContain('доступность н/д');
    expect(html).not.toContain('Ограничение доступности');
  });

  it('renders a clear availability warning with the deadline', () => {
    const html = renderToStaticMarkup(
      <DraftCandidateCard
        result={{
          ...result,
          conflicts: ['Недоступен: Больничный с 2030-02-01 по 2030-02-10'],
          availability: 0.95,
        }}
        rank={1}
        selected={false}
        dueDate="2030-02-01"
        competenceFilterApplied
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('Ограничение доступности');
    expect(html).toContain('Дедлайн: 01.02.2030');
    expect(html).toContain('Больничный с 2030-02-01 по 2030-02-10');
    expect(html.split('Недоступен').length - 1).toBe(1);
  });
});

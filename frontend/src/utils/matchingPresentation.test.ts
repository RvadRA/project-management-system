import { describe, expect, it } from 'vitest';

import type { ScoreDetails } from '../types/matching';
import {
  assignmentStateLabel,
  availabilityWarnings,
  currentWorkloadLabel,
  dataQualityIssues,
  effectiveWeightPercent,
  explainScore,
  explanationSourceLabel,
  explanationText,
  formatAvailabilityScore,
  formatDateKey,
  formatSemanticSimilarity,
  getCandidateAssignmentState,
  isCompetenceEvaluated,
  isCostAssumed,
  isCostNeutral,
  isPerformanceNeutral,
  isSemanticAvailable,
  requiredSkillChips,
  suggestLoad,
  taskMatchPeriod,
  taskPeriodSourceLabel,
  unavailabilityWarnings,
} from './matchingPresentation';

const unknownAvailability: ScoreDetails = {
  availability: {
    avg_load_percent: null,
    peak_load_percent: null,
    free_percent: null,
    unavailable_days: 0,
    period_days: 30,
    working_days: 22,
    available_hours: 176,
    workload_known: false,
    current_workload_known: false,
    open_task_hours: 12,
    unestimated_open_tasks: 1,
  },
};

describe('matching presentation', () => {
  it('renders a calculated semantic score as a percentage', () => {
    expect(formatSemanticSimilarity({ semantic_similarity: 0.5913, semantic_available: true }))
      .toBe('Семантическое сходство: 59%');
    expect(isSemanticAvailable({ semantic_similarity: 0.5913, semantic_available: true })).toBe(true);
  });

  it('does not present a missing semantic score as zero', () => {
    expect(formatSemanticSimilarity({ semantic_similarity: null, semantic_available: false }))
      .toBe('Семантическая оценка не рассчитана');
    expect(isSemanticAvailable({ semantic_similarity: null, semantic_available: false })).toBe(false);
    expect(formatSemanticSimilarity({})).toBe('Семантическая оценка не рассчитана');
  });

  it('renders the candidate explanation and its source', () => {
    expect(explanationText('Кандидат подходит по навыкам и доступности.'))
      .toBe('Кандидат подходит по навыкам и доступности.');
    expect(explanationText('')).toBe('Объяснение недоступно.');
    expect(explanationSourceLabel('llm')).toBe('Объяснение qwen3:4b');
    expect(explanationSourceLabel('deterministic')).toBe('Детерминированное объяснение');
  });

  it('never renders unknown availability as one hundred percent', () => {
    expect(formatAvailabilityScore(1, unknownAvailability)).toBe('н/д');
    expect(formatAvailabilityScore(0.73, { availability: { ...unknownAvailability.availability!, workload_known: true } }))
      .toBe('73%');
    expect(currentWorkloadLabel({
      current_workload: 0,
      active_task_hours: 12,
      details: unknownAvailability,
    })).toBe('12 ч задач / загрузка н/д');
    expect(explainScore(unknownAvailability).availability).toContain('WorkloadEntry');
  });

  it('suggests a conservative load when availability is unknown', () => {
    expect(suggestLoad(1, unknownAvailability.availability)).toBe(5);
    expect(suggestLoad(1, { ...unknownAvailability.availability!, task_estimated_load_percent: 50 })).toBe(50);
    expect(suggestLoad(0.83, { ...unknownAvailability.availability!, workload_known: true })).toBe(85);
  });

  it('builds visible skill chips in a stable order', () => {
    expect(requiredSkillChips({
      competence: {
        required: 3,
        matched: ['Python (4)'],
        below_minimum: ['SQL (2 из 3)'],
        missing: ['Docker'],
      },
    })).toEqual([
      { label: 'Python (4)', state: 'matched' },
      { label: 'SQL (2 из 3)', state: 'below_minimum' },
      { label: 'Docker', state: 'missing' },
    ]);
    expect(requiredSkillChips({})).toEqual([]);
  });

  it('shows availability conflicts without unrelated conflicts', () => {
    expect(availabilityWarnings([
      'Высокая средняя загрузка за период: 85%',
      'Уже состоит в команде этого проекта',
      'Нет записей загрузки; фактическая занятость по проектам неизвестна',
      'Недоступен: отпуск с 2026-10-01 по 2026-10-05',
    ])).toEqual([
      'Высокая средняя загрузка за период: 85%',
      'Нет записей загрузки; фактическая занятость по проектам неизвестна',
      'Недоступен: отпуск с 2026-10-01 по 2026-10-05',
    ]);
    expect(unavailabilityWarnings([
      'Высокая средняя загрузка за период: 85%',
      'Нет записей загрузки; фактическая занятость по проектам неизвестна',
      'Недоступен: больничный с 2026-10-01 по 2026-10-05',
    ])).toEqual([
      'Недоступен: больничный с 2026-10-01 по 2026-10-05',
    ]);
  });

  it('mirrors the backend task period for future, current, overdue and missing deadlines', () => {
    const today = new Date(2026, 9, 20);
    expect(taskMatchPeriod({ due_date: '2026-10-25', sla_hours: 2 }, today)).toMatchObject({
      start: '2026-10-20',
      end: '2026-10-25',
      dueDate: '2026-10-25',
      source: 'due_date',
      deadlineStatus: 'future',
      overdue: false,
    });
    expect(taskMatchPeriod({ due_date: '2026-10-20', sla_hours: 2 }, today)).toMatchObject({
      end: '2026-10-21',
      source: 'sla',
      deadlineStatus: 'today',
      slaDays: 1,
    });
    expect(taskMatchPeriod({ due_date: '2026-04-25', sla_hours: 2 }, today)).toMatchObject({
      end: '2026-10-21',
      source: 'sla',
      deadlineStatus: 'overdue',
      overdue: true,
    });
    expect(taskMatchPeriod({ due_date: null, sla_hours: 20 }, today)).toMatchObject({
      end: '2026-10-23',
      dueDate: null,
      source: 'sla',
      deadlineStatus: 'missing',
      slaDays: 3,
    });
    expect(formatDateKey('2026-10-21')).toBe('21.10.2026');
    expect(taskPeriodSourceLabel('due_date', 'future')).toBe('до дедлайна задачи');
    expect(taskPeriodSourceLabel('sla', 'missing')).toBe('SLA: дедлайн не задан');
  });

  it('shows raw and effective weights after competence is excluded', () => {
    const weights = { w1: 0, w2: 0.31, w3: 0.38, w4: 0.23, w5: 0.08 };
    expect(effectiveWeightPercent(weights, 'w1')).toBe(0);
    expect(effectiveWeightPercent(weights, 'w2')).toBe(31);
    expect(effectiveWeightPercent(undefined, 'w3')).toBeNull();
    expect(isCompetenceEvaluated({ competence: { required: 2 } }, true)).toBe(true);
    expect(isCompetenceEvaluated({ competence: { required: 2 }, weights }, true)).toBe(false);
    expect(isCompetenceEvaluated({ competence: { required: 2 } }, false)).toBe(false);
  });

  it('labels neutral performance and cost instead of showing a false zero', () => {
    const neutral: ScoreDetails = {
      performance: { done_on_time: 0, done_late: 0, overdue_open: 0, manual_ratings: 0 },
      cost: { hourly_rate: null, rate_limit: null, note: 'Ставки не указаны' },
    };
    expect(isPerformanceNeutral(neutral)).toBe(true);
    expect(isCostNeutral(neutral)).toBe(true);
    expect(isCostAssumed(neutral)).toBe(false);
    expect(isPerformanceNeutral({ performance: { done_on_time: 3, done_late: 1, overdue_open: 0, manual_ratings: 2 } }))
      .toBe(false);
    expect(isCostNeutral({ cost: { hourly_rate: 1200, rate_limit: 1500, note: '' } })).toBe(false);
    expect(isCostAssumed({ cost: { hourly_rate: null, assumed_rate: 1000, rate_limit: null } })).toBe(true);
    expect(dataQualityIssues({ details: neutral }, false)).toEqual(expect.arrayContaining([
      expect.stringContaining('Компетенции не оценивались'),
      expect.stringContaining('нет истории задач'),
      expect.stringContaining('ставка не указана'),
    ]));
  });

  it('distinguishes recommended, assigned and ordinary candidates', () => {
    const candidate = { user_id: 7, already_member: false };
    expect(getCandidateAssignmentState(candidate, {
      isTaskMode: true,
      assignedUserId: 7,
      isTopThree: true,
    })).toBe('assigned');
    expect(getCandidateAssignmentState(candidate, {
      isTaskMode: true,
      assignedUserId: 8,
      isTopThree: true,
    })).toBe('recommended');
    expect(getCandidateAssignmentState(candidate, {
      isTaskMode: true,
      assignedUserId: 8,
      isTopThree: false,
    })).toBe('candidate');
    expect(getCandidateAssignmentState({ user_id: 7, already_member: true }, {
      isTaskMode: false,
      isTopThree: false,
    })).toBe('assigned');
    expect(assignmentStateLabel('assigned', true)).toBe('Назначен на задачу');
    expect(assignmentStateLabel('assigned', false)).toBe('В команде проекта');
    expect(assignmentStateLabel('recommended', true)).toBe('Рекомендован');
  });
});

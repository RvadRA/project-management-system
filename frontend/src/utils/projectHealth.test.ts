import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../context/AppContext';
import { projectHealthAlerts } from './projectHealth';

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 1,
  name: 'Проект',
  description: '',
  status: 'ACTIVE',
  domain: '',
  start_date: '2030-01-01',
  end_date: '2030-02-01',
  budget: null,
  manager: null,
  members: [],
  progress_percentage: 40,
  created_at: '2030-01-01T00:00:00Z',
  ...overrides,
});

describe('projectHealthAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 11));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows active projects with schedule risks and late forecasts in priority order', () => {
    const alerts = projectHealthAlerts([
      makeProject({ id: 1, name: 'Forecast delay', progress_percentage: 25 }),
      makeProject({ id: 2, name: 'On track', progress_percentage: 40 }),
      makeProject({ id: 3, name: 'Behind', progress_percentage: 0 }),
      makeProject({ id: 4, name: 'Risk', status: 'AT_RISK' }),
      makeProject({ id: 5, name: 'Overdue', end_date: '2030-01-10', progress_percentage: 20 }),
      makeProject({ id: 6, name: 'Completed', status: 'COMPLETED', end_date: '2030-01-10' }),
    ]);

    expect(alerts.map(({ project }) => project.name)).toEqual([
      'Overdue',
      'Risk',
      'Behind',
      'Forecast delay',
    ]);
    expect(alerts[3].forecast.kind).toBe('estimate');
    if (alerts[3].forecast.kind === 'estimate') {
      expect(alerts[3].forecast.delayDays).toBeGreaterThan(0);
    }
  });
});

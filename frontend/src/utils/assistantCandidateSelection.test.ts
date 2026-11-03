import { describe, expect, it } from 'vitest';

import {
  canCreateTaskWithAssignee,
  excludedReasonText,
  excludedRowsWithReasons,
  isMembershipConfirmed,
  resolveCandidateSelection,
} from './assistantCandidateSelection';

const top = [
  { user_id: 103, full_name: 'Employee 09', already_member: false },
  { user_id: 115, full_name: 'Employee 21', already_member: true },
  { user_id: 130, full_name: 'Employee 31', already_member: false },
];
const base = [
  { user_id: 121, full_name: 'Employee 27', already_member: false },
];

describe('assistant candidate selection', () => {
  it('resolves a candidate only from the visible Top-3', () => {
    expect(resolveCandidateSelection(103, top, base).candidate?.full_name).toBe('Employee 09');
    expect(resolveCandidateSelection(115, top, base).candidate?.full_name).toBe('Employee 21');
  });

  it('does not silently use a base-list candidate hidden from Top-3', () => {
    const selection = resolveCandidateSelection(121, top, base);
    expect(selection.candidate).toBeUndefined();
    expect(selection.missing).toBe(true);
    expect(canCreateTaskWithAssignee(121, selection.candidate, null)).toBe(false);
  });

  it('uses the base list only when Top-3 is absent', () => {
    expect(resolveCandidateSelection(121, [], base).candidate?.full_name).toBe('Employee 27');
    expect(resolveCandidateSelection(121, [], base).missing).toBe(false);
  });

  it('does not fall back when a completed Top-3 has zero eligible candidates', () => {
    const selection = resolveCandidateSelection(121, [], base, true);
    expect(selection.candidate).toBeUndefined();
    expect(selection.missing).toBe(true);
    expect(selection.external).toBe(false);
    expect(canCreateTaskWithAssignee(121, selection.candidate, null)).toBe(false);
  });

  it('marks a stale assignee as missing instead of treating it as a member', () => {
    const selection = resolveCandidateSelection(999, top, base);
    expect(selection.candidate).toBeUndefined();
    expect(selection.missing).toBe(true);
    expect(selection.external).toBe(false);
    expect(canCreateTaskWithAssignee(999, selection.candidate, null)).toBe(false);
  });

  it('requires confirmation for the exact external candidate', () => {
    const selection = resolveCandidateSelection(103, top, base);
    expect(selection.external).toBe(true);
    expect(canCreateTaskWithAssignee(103, selection.candidate, null)).toBe(false);
    expect(isMembershipConfirmed(103, selection.candidate, 103)).toBe(true);
    expect(canCreateTaskWithAssignee(103, selection.candidate, 103)).toBe(true);
  });

  it('does not transfer confirmation to another candidate', () => {
    const next = resolveCandidateSelection(130, top, base);
    expect(isMembershipConfirmed(130, next.candidate, 103)).toBe(false);
    expect(canCreateTaskWithAssignee(130, next.candidate, 103)).toBe(false);
  });

  it('does not require confirmation for an existing project member', () => {
    const selection = resolveCandidateSelection(115, top, base);
    expect(selection.external).toBe(false);
    expect(canCreateTaskWithAssignee(115, selection.candidate, null)).toBe(true);
  });

  it('allows creating a task without an assignee', () => {
    expect(canCreateTaskWithAssignee('', undefined, null)).toBe(true);
  });
});

describe('excluded candidate reasons', () => {
  it('renders structured reasons and skips empty ones', () => {
    expect(excludedReasonText({
      employee_id: 1,
      full_name: 'Employee 29',
      reasons: [{ code: 'missing_required_skills', message: 'Нет обязательных навыков: SQL' }],
    })).toBe('Нет обязательных навыков: SQL');
    expect(excludedReasonText({ employee_id: 2, full_name: 'Empty', reasons: [{ code: 'x' }] })).toBe('');
  });

  it('does not leave blank rows in the exclusion list', () => {
    const rows = excludedRowsWithReasons([
      { employee_id: 1, full_name: 'With reason', reasons: [{ message: 'Больничный' }] },
      { employee_id: 2, full_name: 'Without reason', reasons: [] },
      { employee_id: 3, full_name: 'Missing reasons' },
    ]);
    expect(rows.map(row => row.item.full_name)).toEqual(['With reason']);
  });
});

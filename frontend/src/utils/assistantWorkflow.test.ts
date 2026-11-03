import { describe, expect, it } from 'vitest';
import {
  AssistantRequestEpoch,
  assistantRecommendationsEmptyMessage,
  assistantTaskFooterClass,
  assistantTaskGridClass,
  assistantTaskWorkspaceState,
  canCreateAssistantTask,
  shouldConfirmTaskReset,
} from './assistantWorkflow';

describe('assistant task workspace', () => {
  it('starts with the input and recommendation empty state, then reveals the draft after parsing', () => {
    expect(assistantTaskWorkspaceState(false, false)).toBe('empty');
    expect(assistantRecommendationsEmptyMessage).toBe('Рекомендации появятся после разбора поручения');
    expect(assistantTaskWorkspaceState(true, false)).toBe('draft');
  });

  it('keeps a responsive two-column workspace on desktop and a single default column on narrow screens', () => {
    expect(assistantTaskGridClass).toContain('grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]');
    expect(assistantTaskGridClass).toContain('lg:grid-cols-');
    expect(assistantTaskGridClass).not.toContain('grid-cols-2');
  });

  it('keeps the action footer as a non-overlapping flex sibling of the scrollable content', () => {
    expect(assistantTaskFooterClass).toContain('flex-shrink-0');
    expect(assistantTaskFooterClass).toContain('border-t');
    expect(assistantTaskGridClass).toContain('min-h-0');
  });

  it('shows parse errors without replacing them with the empty state', () => {
    expect(assistantTaskWorkspaceState(false, true)).toBe('error');
  });

  it('asks before discarding entered text or a parsed draft', () => {
    expect(shouldConfirmTaskReset('', false)).toBe(false);
    expect(shouldConfirmTaskReset('   ', false)).toBe(false);
    expect(shouldConfirmTaskReset('new request', false)).toBe(true);
    expect(shouldConfirmTaskReset('', true)).toBe(true);
  });

  it('ignores replies belonging to an earlier request after a newer request or reset', () => {
    const requests = new AssistantRequestEpoch();
    const oldRequest = requests.begin();
    const currentRequest = requests.begin();

    expect(requests.isCurrent(oldRequest)).toBe(false);
    expect(requests.isCurrent(currentRequest)).toBe(true);

    requests.invalidate();
    expect(requests.isCurrent(currentRequest)).toBe(false);
  });

  it('blocks creation until required fields and the assignee state are valid', () => {
    const valid = {
      canCreate: true,
      placeChosen: true,
      title: 'Task',
      assigneeReady: true,
      creating: false,
    };

    expect(canCreateAssistantTask(valid)).toBe(true);
    expect(canCreateAssistantTask({ ...valid, title: ' ' })).toBe(false);
    expect(canCreateAssistantTask({ ...valid, placeChosen: false })).toBe(false);
    expect(canCreateAssistantTask({ ...valid, canCreate: false })).toBe(false);
    expect(canCreateAssistantTask({ ...valid, assigneeReady: false })).toBe(false);
    expect(canCreateAssistantTask({ ...valid, creating: true })).toBe(false);
  });
});

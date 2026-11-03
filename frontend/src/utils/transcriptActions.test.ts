import { describe, expect, it, vi } from 'vitest';
import {
  applyRecognizedText,
  runCorrectionAction,
  runDraftAction,
} from './transcriptActions';

describe('transcript actions', () => {
  it('puts recognized speech into the editor and automatically requests correction once', () => {
    const correctionRequest = vi.fn((text: string) => text);
    const updateEditor = vi.fn();
    const recognized = 'Проверить дату 22.10.2026 и API v2.';

    expect(applyRecognizedText('', recognized, updateEditor, correctionRequest)).toBe(recognized);
    expect(updateEditor).toHaveBeenCalledWith(recognized);
    expect(correctionRequest).toHaveBeenCalledOnce();
    expect(correctionRequest).toHaveBeenCalledWith(recognized);
  });

  it('runs auto-correction on the complete editor text when speech is appended', () => {
    const correctionRequest = vi.fn((text: string) => text);
    const updateEditor = vi.fn();
    const current = 'Сохранить имеющиеся уточнения.';
    const recognized = 'Проверить дату 22.10.2026.';
    const expected = `${current} ${recognized}`;

    expect(applyRecognizedText(current, recognized, updateEditor, correctionRequest)).toBe(expected);
    expect(updateEditor).toHaveBeenCalledWith(expected);
    expect(correctionRequest).toHaveBeenCalledOnce();
    expect(correctionRequest).toHaveBeenCalledWith(expected);
  });

  it('does not automatically correct manually entered text when draft analysis is requested', async () => {
    const correctionRequest = vi.fn();
    const createDraft = vi.fn(async (text: string) => text);

    await runDraftAction('Ручной текст без изменений', createDraft);

    expect(createDraft).toHaveBeenCalledOnce();
    expect(createDraft).toHaveBeenCalledWith('Ручной текст без изменений');
    expect(correctionRequest).not.toHaveBeenCalled();
  });

  it('calls the correction endpoint once for an explicit correction action', async () => {
    const requestCorrection = vi.fn(async (text: string) => `${text} исправлен`);

    await runCorrectionAction('Распознанный текст', requestCorrection);

    expect(requestCorrection).toHaveBeenCalledOnce();
    expect(requestCorrection).toHaveBeenCalledWith('Распознанный текст');
  });

  it('parses current text directly without invoking correction a second time', async () => {
    const correctionRequest = vi.fn();
    const createDraft = vi.fn(async (text: string) => text);

    await runDraftAction('Принятый исправленный текст', createDraft);

    expect(createDraft).toHaveBeenCalledOnce();
    expect(createDraft).toHaveBeenCalledWith('Принятый исправленный текст');
    expect(correctionRequest).not.toHaveBeenCalled();
  });

  it('disables both correction and draft actions for empty text', () => {
    const requestCorrection = vi.fn(async () => undefined);
    const createDraft = vi.fn(async () => undefined);

    expect(runCorrectionAction(' \n ', requestCorrection)).toBeUndefined();
    expect(runDraftAction(' \n ', createDraft)).toBeUndefined();
    expect(requestCorrection).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });
});

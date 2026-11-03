import { describe, expect, it } from 'vitest';
import {
  acceptTranscriptCorrection,
  confirmTranscriptManualReview,
  createTranscriptCorrectionReview,
  failedTranscriptCorrection,
  transcriptCorrectionRequestError,
} from './transcriptCorrection';

describe('transcript correction review', () => {
  it('keeps the original unchanged until the user explicitly applies the suggestion', () => {
    const original = 'Создать задачу для Race IP и Postgre SQL.';
    let taskText = original;
    const review = createTranscriptCorrectionReview({
      original,
      suggested: 'Создать задачу для REST API и PostgreSQL.',
      available: true,
      error: '',
    });

    expect(review.original).toBe(original);
    expect(review.suggested).not.toBe(original);
    expect(review.accepted).toBe(false);
    expect(taskText).toBe(original);

    const accepted = acceptTranscriptCorrection(review);
    taskText = accepted.suggested ?? taskText;
    expect(taskText).toBe('Создать задачу для REST API и PostgreSQL.');
  });

  it('marks a suggestion accepted only after the explicit accept action', () => {
    const review = createTranscriptCorrectionReview({
      original: 'Race IP',
      suggested: 'REST API',
      available: true,
      error: '',
      requires_manual_review: false,
      uncertain_fragments: [],
    });

    expect(acceptTranscriptCorrection(review)).toEqual({
      ...review,
      accepted: true,
    });
    expect(review.accepted).toBe(false);
  });

  it('requires acknowledgement before applying a suggestion with uncertain fragments', () => {
    const review = createTranscriptCorrectionReview({
      original: 'Исходный текст rsip для назначения 3.',
      suggested: 'Исходный текст REST API для назначения 3.',
      available: true,
      error: '',
      requires_manual_review: true,
      uncertain_fragments: ['для назначения 3'],
    });

    expect(acceptTranscriptCorrection(review)).toBe(review);
    const acknowledged = confirmTranscriptManualReview(review, true);
    expect(acknowledged.manualReviewConfirmed).toBe(true);
    expect(acceptTranscriptCorrection(acknowledged).accepted).toBe(true);
    expect(review.accepted).toBe(false);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('keeps the original on %s timeout', code => {
    const original = 'Дедлайн 22.10.2026, API v2, бюджет 12500.';
    const error = transcriptCorrectionRequestError({ code });
    const review = failedTranscriptCorrection(original, error);

    expect(review).toMatchObject({
      original,
      suggested: null,
      available: false,
      accepted: false,
    });
    expect(review.error).toContain('время ожидания');
    expect(review.original).toBe(original);
    expect(acceptTranscriptCorrection(review)).toBe(review);
  });

  it('shows a safe explanation for a backend request failure', () => {
    const message = transcriptCorrectionRequestError({
      response: { status: 500, data: { error: 'C:\\private\\server\\traceback' } },
    });

    expect(message).toContain('Сервер не смог обработать запрос');
    expect(message).not.toContain('C:\\private');
  });

  it('explains a correction endpoint that is missing on the backend', () => {
    expect(transcriptCorrectionRequestError({ response: { status: 404 } }))
      .toContain('backend обновлён');
  });
});

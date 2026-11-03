export interface TranscriptCorrectionResponse {
  original: string;
  suggested: string | null;
  available: boolean;
  error: string;
  requires_manual_review?: boolean;
  uncertain_fragments?: string[];
}

export interface TranscriptCorrectionReview extends TranscriptCorrectionResponse {
  requires_manual_review: boolean;
  uncertain_fragments: string[];
  accepted: boolean;
  manualReviewConfirmed: boolean;
}

export function transcriptCorrectionRequestError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Не удалось выполнить запрос исправления. Исходная расшифровка сохранена.';
  }

  const requestError = error as {
    code?: unknown;
    response?: { status?: unknown; data?: unknown };
  };
  const status = requestError.response?.status;
  const data = requestError.response?.data;
  const responseError = data && typeof data === 'object'
    ? (data as { error?: unknown }).error
    : null;

  if (typeof status === 'number') {
    if (status === 400 && typeof responseError === 'string') return responseError;
    if (status === 401) return 'Сеанс завершён. Войдите снова и повторите запрос.';
    if (status === 403) return 'Недостаточно прав для запроса исправления.';
    if (status === 404) return 'Сервер не распознал запрос исправления. Проверьте, что backend обновлён.';
    if (status === 429) return 'Слишком много запросов. Подождите и попробуйте ещё раз.';
    if (status >= 500) return 'Сервер не смог обработать запрос. Исходная расшифровка сохранена.';
    return `Запрос исправления не выполнен (код ${status}). Исходная расшифровка сохранена.`;
  }

  if (requestError.code === 'ECONNABORTED' || requestError.code === 'ETIMEDOUT') {
    return 'Превышено время ожидания ответа приложения. Исходная расшифровка сохранена.';
  }
  return 'Не удалось связаться с сервером приложения. Исходная расшифровка сохранена.';
}

export function createTranscriptCorrectionReview(response: TranscriptCorrectionResponse): TranscriptCorrectionReview {
  return {
    ...response,
    requires_manual_review: response.requires_manual_review ?? true,
    uncertain_fragments: response.uncertain_fragments ?? [],
    accepted: false,
    manualReviewConfirmed: false,
  };
}

export function failedTranscriptCorrection(
  original: string,
  error: string,
): TranscriptCorrectionReview {
  return createTranscriptCorrectionReview({
    original,
    suggested: null,
    available: false,
    error,
    requires_manual_review: false,
  });
}

export function confirmTranscriptManualReview(
  review: TranscriptCorrectionReview,
  confirmed: boolean,
): TranscriptCorrectionReview {
  return { ...review, manualReviewConfirmed: confirmed };
}

export function acceptTranscriptCorrection(review: TranscriptCorrectionReview): TranscriptCorrectionReview {
  if (!review.available || !review.suggested) return review;
  if (review.requires_manual_review && !review.manualReviewConfirmed) return review;
  return { ...review, accepted: true };
}

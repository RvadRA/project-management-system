export function applyRecognizedText(
  currentText: string,
  recognizedText: string,
  updateEditor: (text: string) => void,
  requestCorrection?: (text: string) => void,
): string {
  const nextText = currentText.trim()
    ? `${currentText.trimEnd()} ${recognizedText}`
    : recognizedText;
  updateEditor(nextText);
  requestCorrection?.(nextText);
  return nextText;
}

export function runCorrectionAction<T>(
  currentText: string,
  requestCorrection: (text: string) => Promise<T>,
): Promise<T> | undefined {
  if (!currentText.trim()) return undefined;
  return requestCorrection(currentText);
}

export function runDraftAction<T>(
  currentText: string,
  createDraft: (text: string) => Promise<T>,
): Promise<T> | undefined {
  if (!currentText.trim()) return undefined;
  return createDraft(currentText);
}

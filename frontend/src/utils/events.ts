// События, которыми части интерфейса открывают друг друга (справка ↔ ассистент ↔ тур).

/** Открыть ИИ-ассистента; detail: { tab?: 'task' | 'ask', text?: string } — что подставить в поле */
export const OPEN_ASSISTANT_EVENT = 'pms:open-assistant';

export interface OpenAssistantDetail {
  tab?: 'task' | 'ask';
  text?: string;
}

export const openAssistant = (detail: OpenAssistantDetail = {}) =>
  window.dispatchEvent(new CustomEvent<OpenAssistantDetail>(OPEN_ASSISTANT_EVENT, { detail }));

export type AssistantTaskWorkspaceState = 'empty' | 'error' | 'draft';
export const assistantTaskGridClass =
  'grid min-w-0 gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]';
export const assistantTaskFooterClass =
  'flex-shrink-0 border-t border-slate-800 bg-slate-950/95 px-4 py-2.5 sm:px-6';
export const assistantRecommendationsEmptyMessage = 'Рекомендации появятся после разбора поручения';

export const assistantTaskWorkspaceState = (
  hasDraft: boolean,
  hasError: boolean,
): AssistantTaskWorkspaceState => hasDraft ? 'draft' : hasError ? 'error' : 'empty';

export const shouldConfirmTaskReset = (text: string, hasDraft: boolean): boolean =>
  text.trim().length > 0 || hasDraft;

export const canCreateAssistantTask = ({
  canCreate,
  placeChosen,
  title,
  assigneeReady,
  creating,
}: {
  canCreate: boolean;
  placeChosen: boolean;
  title: string;
  assigneeReady: boolean;
  creating: boolean;
}): boolean => canCreate && placeChosen && title.trim().length > 0 && assigneeReady && !creating;

export class AssistantRequestEpoch {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  invalidate(): void {
    this.current += 1;
  }

  isCurrent(request: number): boolean {
    return request === this.current;
  }
}

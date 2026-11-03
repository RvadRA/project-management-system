export interface SelectableCandidate {
  user_id: number;
  already_member?: boolean;
}

export interface ExcludedCandidateLike {
  employee_id: number;
  full_name: string;
  reasons?: { code?: string; message?: string; skills?: string[] }[];
}

export interface CandidateSelection<T extends SelectableCandidate> {
  candidate: T | undefined;
  missing: boolean;
  external: boolean;
}

export function resolveCandidateSelection<
  A extends SelectableCandidate,
  B extends SelectableCandidate = A,
>(
  assignee: number | '' | null | undefined,
  primary: readonly A[],
  secondary: readonly B[] = [],
  primaryAuthoritative = primary.length > 0,
): CandidateSelection<A | B> {
  if (assignee === '' || assignee == null) {
    return { candidate: undefined, missing: false, external: false };
  }
  const id = Number(assignee);
  // Завершённый Top-3 авторитетен даже при нуле кандидатов: нельзя незаметно
  // подставлять базовый список, в котором обязательные навыки не проверялись.
  const visible = primaryAuthoritative ? primary : secondary;
  const candidate = Number.isFinite(id)
    ? visible.find(item => Number(item.user_id) === id)
    : undefined;
  return {
    candidate,
    missing: !candidate,
    external: Boolean(candidate && candidate.already_member === false),
  };
}

export function isMembershipConfirmed(
  assignee: number | '' | null | undefined,
  candidate: SelectableCandidate | undefined,
  addToTeamFor: number | null,
): boolean {
  if (assignee === '' || assignee == null || !candidate || candidate.already_member !== false) {
    return false;
  }
  return addToTeamFor !== null && Number(assignee) === addToTeamFor;
}

export function canCreateTaskWithAssignee(
  assignee: number | '' | null | undefined,
  candidate: SelectableCandidate | undefined,
  addToTeamFor: number | null,
): boolean {
  if (assignee === '' || assignee == null) return true;
  if (!candidate) return false;
  if (candidate.already_member !== false) return true;
  return isMembershipConfirmed(assignee, candidate, addToTeamFor);
}

export function excludedReasonText(item: ExcludedCandidateLike): string {
  return (item.reasons ?? [])
    .map(reason => reason.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join('; ');
}

export function excludedRowsWithReasons<T extends ExcludedCandidateLike>(
  items: T[],
): { item: T; reason: string }[] {
  return items
    .map(item => ({ item, reason: excludedReasonText(item) }))
    .filter(row => row.reason.length > 0);
}

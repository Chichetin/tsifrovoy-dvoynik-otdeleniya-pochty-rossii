/**
 * What finishing an edit of the plan name in the header means (D-350).
 * The name is sent as typed: `plan.rename` trims only to check for emptiness,
 * trimming here would eat a space typed between words (D-152).
 */
export type RenameOutcome = { kind: 'cancel' } | { kind: 'empty' } | { kind: 'rename'; name: string };

export function renameOutcome(draft: string, current: string): RenameOutcome {
  if (draft === current) return { kind: 'cancel' };
  if (draft.trim() === '') return { kind: 'empty' };
  return { kind: 'rename', name: draft };
}

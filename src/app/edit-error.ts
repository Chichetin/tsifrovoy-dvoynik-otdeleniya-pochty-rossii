import type { Issue, PlanDocument, Ref } from '../contracts/model';
import { idOwners } from '../domain/commands';

/**
 * The plaque over the canvas (D-274). `edit` — a refused command: it speaks
 * about the document at `revision` and about the entities in `refs`.
 * `document` — a note about the opened document as a whole (the team catalog
 * did not apply to the organizers' example): edits do not make it untrue.
 */
export type EditError = {
  scope: 'edit' | 'document';
  message: string;
  refs: readonly Ref[];
  revision: number;
};

export function refusalOf(issues: readonly Issue[], revision: number): EditError {
  return {
    scope: 'edit',
    message: issues.map((issue) => issue.message).join('; '),
    refs: issues.flatMap((issue) => issue.refs),
    revision,
  };
}

export function documentNotice(message: string, revision: number): EditError {
  return { scope: 'document', message, refs: [], revision };
}

/**
 * Whether the plaque still describes the plan on screen. A refusal is about
 * the state it was refused in: any new revision (an edit, undo, redo, another
 * document) makes it stale, and so does the disappearance of every entity it
 * named. The revision of one store only grows, so a stale refusal never comes
 * back.
 */
export function isEditErrorCurrent(error: EditError, document: PlanDocument, revision: number): boolean {
  if (error.scope === 'document') return true;
  if (revision !== error.revision) return false;
  if (error.refs.length === 0) return true;
  const owners = idOwners(document);
  return error.refs.some((ref) => owners.get(ref.id) === ref.kind);
}

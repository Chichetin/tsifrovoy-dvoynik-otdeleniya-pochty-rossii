/**
 * #121: what «Удалить» does to the selection, said before the click.
 *
 * The button sits in the card of the selected thing and carries its name. The
 * consequence is read from the very command the button sends: the command is
 * tried on the plan, so a refusal (a locked object, a hidden layer, the last
 * entrance) and the objects a zone leaves without a zone come from the domain,
 * not from a copy of its rules.
 */

import type { Command } from '../contracts/commands';
import type { Id, PlanDocument, Ref } from '../contracts/model';
import { applyCommand } from '../domain/commands';
import { deleteIntent } from '../features/plan-tools/delete-key';

export type SelectionDeletion = {
  /** The accusative the button says: «Удалить зону». */
  label: string;
  /** What else goes or breaks, said before the click; null when nothing. */
  consequence: string | null;
  /** Why nothing can be deleted; null when it can. */
  refusal: string | null;
  /** Null exactly when there is a refusal. */
  command: Command | null;
};

const KIND_LABEL: Partial<Record<Ref['kind'], string>> = {
  zone: 'зону',
  wall: 'перегородку',
  opening: 'проём',
};

export function selectionDeletion(
  selection: Ref | null,
  picked: ReadonlySet<Id>,
  plan: PlanDocument,
): SelectionDeletion | null {
  if (selection === null) return null;

  let command: Command;
  let label: string;
  if (selection.kind === 'object') {
    if (!plan.objects.some((object) => object.id === selection.id)) return null;
    const ids = picked.size > 1 && picked.has(selection.id) ? [...picked] : [selection.id];
    label = ids.length > 1 ? `выбранные объекты (${ids.length})` : 'объект';
    command =
      ids.length > 1
        ? { type: 'batch', commands: ids.map((id) => ({ type: 'object.delete', id })) }
        : { type: 'object.delete', id: selection.id };
  } else {
    const intent = deleteIntent(selection, plan);
    const name = KIND_LABEL[selection.kind];
    if (intent === null || name === undefined) return null;
    label = name;
    if (intent.kind === 'refused') return { label, consequence: null, refusal: intent.notice, command: null };
    command = intent.command;
  }

  const result = applyCommand(plan, command);
  if (!result.ok) {
    return { label, consequence: null, refusal: result.issues.map((issue) => issue.message).join('; '), command: null };
  }

  let consequence: string | null = null;
  if (selection.kind === 'zone') {
    const without = (document: PlanDocument): number => document.objects.filter((object) => object.zoneId === null).length;
    const lost = without(result.value) - without(plan);
    if (lost > 0) consequence = `Объектов, которые останутся вне зон: ${lost}. «Проверка» покажет находки.`;
  }
  if (selection.kind === 'wall') {
    const openings = plan.openings.filter((opening) => opening.wallId === selection.id).length;
    if (openings > 0) consequence = `Вместе с перегородкой удалятся проёмы на ней: ${openings}.`;
  }
  return { label, consequence, refusal: null, command };
}

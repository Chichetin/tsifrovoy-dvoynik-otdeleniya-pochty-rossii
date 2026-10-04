/**
 * #30: one attribute edit for every selected object at once.
 *
 * The card of a group shows only the attributes that every member's type
 * declares with the same key and value type. One edit is one `batch` command,
 * so the store keeps it as one undo step.
 */

import type { Command } from '../../contracts/commands';
import type { AttributeDef, Attributes, Catalog, Equipment } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';

/** Attributes common to the group, in the order of the first member's type. */
export function sharedAttributeDefs(catalog: Catalog, members: readonly Equipment[]): AttributeDef[] {
  const lists = members.map((member) => findObjectType(catalog, member.typeId)?.attributes ?? []);
  const [first = [], ...rest] = lists;
  return first.filter((def) =>
    rest.every((defs) => defs.some((other) => other.key === def.key && other.type === def.type)),
  );
}

/** Keys whose shown value differs inside the group: the card shows them as «разные». */
export function mixedAttributeKeys(
  members: readonly Equipment[],
  defs: readonly AttributeDef[],
  shown: (attributes: Attributes, def: AttributeDef) => string,
): Set<string> {
  return new Set(
    defs
      .filter((def) => new Set(members.map((member) => shown(member.attributes, def))).size > 1)
      .map((def) => def.key),
  );
}

/** Sets one attribute on every member: one batch, one undo step. */
export function groupAttributeCommand(
  members: readonly Equipment[],
  key: string,
  value: Attributes[string],
): Command {
  return {
    type: 'batch',
    commands: members.map((member) => ({
      type: 'object.put',
      object: { ...member, attributes: { ...member.attributes, [key]: value } },
    })),
  };
}

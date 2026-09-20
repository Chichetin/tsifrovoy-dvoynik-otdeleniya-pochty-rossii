/** Human-readable facts shown while the pointer rests on an object. */

import type { Equipment, Issue } from '../../contracts/model';
import { formatShort } from '../../domain/number-format';
import type { PlanIndex } from '../../domain/plan-index';

export type EquipmentHoverSummary = {
  title: string;
  lines: string[];
};

function inventoryNumber(object: Equipment): string {
  const value = object.attributes.inventoryNumber;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '—';
}

function named(value: string | null, id: string): string {
  return value === null ? id : `${value} (${id})`;
}

/**
 * Keeps the canvas component free of naming and validation rules. Errors go
 * before warnings, matching the validation panel; every relevant message is
 * present because one object can violate several independent rules.
 */
export function equipmentHoverSummary(
  names: PlanIndex,
  object: Equipment,
  issues: readonly Issue[],
): EquipmentHoverSummary {
  const related = issues
    .filter((issue) => issue.refs.some((ref) => ref.kind === 'object' && ref.id === object.id))
    .sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1));

  const lines = [
    `Тип: ${named(names.objectTypeLabel(object.typeId), object.typeId)}`,
    `ID: ${object.id}`,
    `Инв. №: ${inventoryNumber(object)}`,
    `Зона: ${object.zoneId === null ? 'не назначена' : named(names.zoneName(object.zoneId), object.zoneId)}`,
    `Размер: ${formatShort(object.size_m[0], 2)} × ${formatShort(object.size_m[1], 2)} м`,
    `Поворот: ${formatShort(object.rotation_deg, 2)}°`,
    ...related.map((issue) => `Проверка: ${issue.message}`),
  ];

  return { title: object.label, lines };
}

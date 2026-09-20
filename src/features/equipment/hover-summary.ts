/** Human-readable facts shown while the pointer rests on an object. */

import type { Equipment, Issue, PlanDocument } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';

export type EquipmentHoverSummary = {
  title: string;
  lines: string[];
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);

function inventoryNumber(object: Equipment): string {
  const value = object.attributes.inventoryNumber;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return '—';
}

function named(value: string | undefined, id: string): string {
  return value === undefined ? id : `${value} (${id})`;
}

/**
 * Keeps the canvas component free of naming and validation rules. Errors go
 * before warnings, matching the validation panel; every relevant message is
 * present because one object can violate several independent rules.
 */
export function equipmentHoverSummary(
  plan: PlanDocument,
  object: Equipment,
  issues: readonly Issue[],
): EquipmentHoverSummary {
  const type = findObjectType(plan.catalog, object.typeId);
  const zone = object.zoneId === null ? undefined : plan.zones.find((entry) => entry.id === object.zoneId);
  const related = issues
    .filter((issue) => issue.refs.some((ref) => ref.kind === 'object' && ref.id === object.id))
    .sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1));

  const lines = [
    `Тип: ${named(type?.label, object.typeId)}`,
    `ID: ${object.id}`,
    `Инв. №: ${inventoryNumber(object)}`,
    `Зона: ${object.zoneId === null ? 'не назначена' : named(zone?.name, object.zoneId)}`,
    `Размер: ${formatNumber(object.size_m[0])} × ${formatNumber(object.size_m[1])} м`,
    `Поворот: ${formatNumber(object.rotation_deg)}°`,
    ...related.map((issue) => `Проверка: ${issue.message}`),
  ];

  return { title: object.label, lines };
}

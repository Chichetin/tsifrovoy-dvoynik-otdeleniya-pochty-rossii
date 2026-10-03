/**
 * #25: what the Ctrl+K window finds. Pure function over the plan: objects by
 * name, id, inventory number, type and zone; zones by name, id and type; and
 * commands — arm the placement of a type, show or hide a layer. The window
 * (`QuickSearchDialog.tsx`) only draws the list and runs the chosen item.
 */

import type { Id, PlanDocument, Ref } from '../contracts/model';
import { inventoryNumberOf } from '../domain/commands';

export type SearchItem =
  | { kind: 'ref'; key: string; ref: Ref; title: string; detail: string }
  | { kind: 'place'; key: string; typeId: Id; title: string; detail: string }
  | { kind: 'layer'; key: string; layerId: Id; title: string; detail: string };

export const SEARCH_LIMIT = 30;

function normalize(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е');
}

type Entry = { item: SearchItem; title: string; haystack: string };

/** Everything searchable, once per plan revision: the window recalculates only the match. */
export function searchEntries(plan: PlanDocument): Entry[] {
  const typeLabel = new Map(plan.catalog.objectTypes.map((type) => [type.id, type.label]));
  const zoneTypeLabel = new Map(plan.catalog.zoneTypes.map((type) => [type.id, type.label]));
  const zoneName = new Map(plan.zones.map((zone) => [zone.id, zone.name]));
  const entries: Entry[] = [];
  const add = (item: SearchItem, extra: readonly (string | null | undefined)[]): void => {
    entries.push({
      item,
      title: normalize(item.title),
      haystack: normalize([item.title, item.detail, ...extra].filter((part) => part != null).join(' ')),
    });
  };

  for (const object of plan.objects) {
    const inventory = inventoryNumberOf(object);
    const type = typeLabel.get(object.typeId) ?? object.typeId;
    const zone = object.zoneId === null ? 'вне зон' : (zoneName.get(object.zoneId) ?? object.zoneId);
    add(
      {
        kind: 'ref',
        key: `object:${object.id}`,
        ref: { kind: 'object', id: object.id },
        title: object.label,
        detail: [inventory, type, zone, object.id].filter((part) => part !== null).join(' · '),
      },
      [object.zoneId],
    );
  }
  for (const zone of plan.zones) {
    add(
      {
        kind: 'ref',
        key: `zone:${zone.id}`,
        ref: { kind: 'zone', id: zone.id },
        title: zone.name,
        detail: ['зона', zoneTypeLabel.get(zone.typeId) ?? zone.typeId, zone.id].join(' · '),
      },
      [],
    );
  }
  for (const type of plan.catalog.objectTypes) {
    add(
      { kind: 'place', key: `place:${type.id}`, typeId: type.id, title: `Поставить «${type.label}»`, detail: 'команда · клик по плану ставит объект' },
      ['добавить', type.id],
    );
  }
  for (const layer of plan.layers) {
    add(
      {
        kind: 'layer',
        key: `layer:${layer.id}`,
        layerId: layer.id,
        title: `${layer.visible ? 'Скрыть' : 'Показать'} слой «${layer.name}»`,
        detail: 'команда · видимость слоя',
      },
      ['слой', layer.id],
    );
  }
  return entries;
}

/**
 * Every word of the query must occur somewhere in the entry. Ranked: a title
 * that starts with the query, then a title that contains it, then the rest;
 * plan entities before commands; the plan's own order inside a rank.
 */
export function searchPlan(entries: readonly Entry[], query: string, limit = SEARCH_LIMIT): SearchItem[] {
  const text = normalize(query.trim());
  if (text === '') return [];
  const words = text.split(/\s+/);
  const ranked: { item: SearchItem; rank: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    if (!words.every((word) => entry.haystack.includes(word))) return;
    const titleRank = entry.title.startsWith(text) ? 0 : entry.title.includes(text) ? 1 : 2;
    ranked.push({ item: entry.item, rank: titleRank * 2 + (entry.item.kind === 'ref' ? 0 : 1), order });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return ranked.slice(0, limit).map((entry) => entry.item);
}

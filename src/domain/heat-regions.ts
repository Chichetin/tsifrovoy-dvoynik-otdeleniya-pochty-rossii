/**
 * U05: какие области закрашивает тепловой слой.
 *
 * Зоны вложены друг в друга, и раньше слой красил каждую зону с атрибутом
 * целиком. Область вложенной зоны получала заливку дважды — родителя и свою, —
 * поэтому выглядела насыщеннее, чем велит её собственное значение: слой врал о
 * данных. Здесь площадь делится так, что каждая точка принадлежит ровно одной
 * зоне — самой глубокой из тех, у кого есть значение.
 *
 * Вырезание области детей даёт кольца с дырами, поэтому результат — список
 * колец с нормализованным направлением обхода: внешнее против часовой, дыры по
 * часовой. Такой набор канва заливает правилом nonzero без дополнительных
 * оговорок на стороне отрисовки.
 */

import * as polyclip from 'polyclip-ts';
import type { Attributes, Id, Polygon, Zone } from '../contracts/model';
import { signedArea } from './geometry';

/** Область одной зоны: внешнее кольцо и дыры под вложенными зонами. */
export type HeatRegion = { zoneId: Id; value: number; rings: Polygon[] };

/** Предел обхода родителей: цикл в `parentId` не должен уводить в бесконечность. */
const MAX_DEPTH = 64;

function numberAttribute(attributes: Attributes, key: string): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Замкнутое кольцо в том виде, который ждёт polyclip. */
function closed(polygon: Polygon): [number, number][] {
  const ring = polygon.map((point): [number, number] => [point[0], point[1]]);
  const first = ring[0];
  const last = ring.at(-1);
  if (first !== undefined && last !== undefined && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** Лежит ли `zone` внутри `ancestorId` по цепочке `parentId`. */
function descendsFrom(zone: Zone, ancestorId: Id, byId: Map<Id, Zone>): boolean {
  let current = zone.parentId;
  for (let step = 0; step < MAX_DEPTH && current !== null; step += 1) {
    if (current === ancestorId) return true;
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/** Направление обхода: внешнее кольцо против часовой, дыра по часовой. */
function oriented(ring: [number, number][], hole: boolean): Polygon {
  const points: Polygon = ring.map((point): [number, number] => [point[0], point[1]]);
  // Замыкающая точка нужна polyclip, но не нужна ни канве, ни площади.
  const first = points[0];
  const last = points.at(-1);
  if (first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  const counterClockwise = signedArea(points) > 0;
  return counterClockwise === !hole ? points : points.reverse();
}

/**
 * Области теплового слоя в порядке от внешних зон к вложенным. Зона без
 * значения ничего не закрашивает и не вырезает: там остаётся значение
 * родителя, потому что своего у неё нет.
 */
export function heatRegions(zones: Zone[], attribute: string): HeatRegion[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const painted = zones.flatMap((zone) => {
    const value = numberAttribute(zone.attributes, attribute);
    return value === null ? [] : [{ zone, value }];
  });

  return painted.flatMap(({ zone, value }): HeatRegion[] => {
    const holes = painted
      .filter((entry) => entry.zone.id !== zone.id && descendsFrom(entry.zone, zone.id, byId))
      .map((entry) => [closed(entry.zone.polygon)]);

    if (holes.length === 0) {
      return [{ zoneId: zone.id, value, rings: [oriented(closed(zone.polygon), false)] }];
    }

    // difference принимает вычитаемые как отдельные аргументы-геометрии.
    const remaining = polyclip.difference([closed(zone.polygon)], ...holes);
    const rings = remaining.flatMap((polygon) =>
      polygon.map((ring, index) => oriented(ring as [number, number][], index > 0)),
    );
    // Зона, полностью накрытая вложенными, не закрашивается вовсе.
    return rings.length === 0 ? [] : [{ zoneId: zone.id, value, rings }];
  });
}

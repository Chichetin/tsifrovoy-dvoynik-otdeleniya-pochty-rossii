/**
 * Допуск правки проёма (D-286, #66). Проём не объект, но его правка тоже
 * может создать то, что помещение не держит: наложение на соседний проём,
 * выход за стену или потолок, торец другой стены в проёме, стену поверх
 * оборудования. Здесь — одна проверка для store и для превью инструмента:
 * отказ называется одними словами, где бы его ни показали.
 *
 * Прежнее нарушение импортированного плана правку не запирает: его можно
 * уменьшать, нельзя только усилить.
 */

import * as polyclip from 'polyclip-ts';
import type { Equipment, Issue, Opening, PlanDocument, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import {
  footprint,
  intersects,
  intervalsOverlap,
  objectHitsWall,
  objectInterval,
  polygonArea,
  wallLength,
  wallObstacles,
  wallSpanPolygon,
} from '../geometry';
import { isPhysical } from '../validation';

/** Geometric intersection of two openings on the same wall, including height. */
export function openingsOverlap(a: Opening, b: Opening): boolean {
  return a.id !== b.id && a.wallId === b.wallId &&
    intervalsOverlap({ base_m: a.offset_m, top_m: a.offset_m + a.width_m }, { base_m: b.offset_m, top_m: b.offset_m + b.width_m }) &&
    intervalsOverlap({ base_m: a.sill_m, top_m: a.sill_m + a.height_m }, { base_m: b.sill_m, top_m: b.sill_m + b.height_m });
}

/** Opening intersection in the wall's horizontal/vertical plane, in square metres. */
function overlapArea(a: Opening, b: Opening): number {
  if (!openingsOverlap(a, b)) return 0;
  const width = Math.min(a.offset_m + a.width_m, b.offset_m + b.width_m) - Math.max(a.offset_m, b.offset_m);
  const height = Math.min(a.sill_m + a.height_m, b.sill_m + b.height_m) - Math.max(a.sill_m, b.sill_m);
  return width * height;
}

/** Allow gradual repair, but refuse new or increased overlap with each neighbour. */
export function introducesOpeningOverlap(candidate: Opening, before: Opening, openings: Opening[]): boolean {
  return openings.some((other) => openingsOverlap(candidate, other) &&
    (!openingsOverlap(before, other) || overlapArea(candidate, other) > overlapArea(before, other) + TOLERANCE.area_m2));
}

/** Slice at every aperture height so a partly obstructed imported object can be repaired. */
function occupiedWallVolume(object: Equipment, wall: Wall, openings: Opening[], walls: Wall[]): number {
  const low = Math.max(0, object.base_m), high = Math.min(wall.height_m, object.base_m + object.height_m);
  if (high - low <= TOLERANCE.coordinate_m) return 0;
  const levels = [low, high, ...openings.filter((opening) => opening.wallId === wall.id)
    .flatMap((opening) => [opening.sill_m, opening.sill_m + opening.height_m])
    .filter((height) => height > low && height < high)].sort((a, b) => a - b);
  const closed = (polygon: Polygon): polyclip.Geom => [[[...polygon, polygon[0]!]]];
  const shape = footprint(object);
  let volume = 0;
  for (let i = 1; i < levels.length; i++) {
    const base = levels[i - 1]!, top = levels[i]!;
    if (top - base <= TOLERANCE.coordinate_m) continue;
    for (const part of wallObstacles(wall, openings, { base_m: base, top_m: top }, walls)) {
      if (!intersects(shape, part)) continue;
      const clipped = polyclip.intersection(closed(shape), closed(part));
      for (const polygon of clipped) polygon.forEach((ring, index) => {
        volume += (index === 0 ? 1 : -1) * polygonArea(ring) * (top - base);
      });
    }
  }
  return volume;
}

function worsensObjectCollision(object: Equipment, wall: Wall, before: Opening[], after: Opening[], walls: Wall[]): boolean {
  if (!objectHitsWall(object, wall, after, walls)) return false;
  if (!objectHitsWall(object, wall, before, walls)) return true;
  const tolerance = TOLERANCE.area_m2 * Math.max(1, object.height_m);
  return occupiedWallVolume(object, wall, after, walls) > occupiedWallVolume(object, wall, before, walls) + tolerance;
}

/** The plan's openings with this one put: replaced in place, or appended when new. */
function withOpening(openings: Opening[], opening: Opening): Opening[] {
  return openings.some((entry) => entry.id === opening.id)
    ? openings.map((entry) => (entry.id === opening.id ? opening : entry))
    : [...openings, opening];
}

/**
 * Отказ `opening.put`: новый проём или правка существующего. Структурные
 * ошибки (нет стены, неверные числа, шире стены) остаются за командой —
 * у неё свой текст с полем.
 */
export function openingRejection(plan: PlanDocument, candidate: Opening): Issue | null {
  const before = plan.openings.find((opening) => opening.id === candidate.id);
  const wall = plan.walls.find((entry) => entry.id === candidate.wallId);
  if (wall === undefined) return null;
  const values = [candidate.offset_m, candidate.width_m, candidate.height_m, candidate.sill_m];
  if (values.some((value) => !Number.isFinite(value)) || candidate.offset_m < 0 || candidate.width_m <= 0 ||
    candidate.height_m <= 0 || candidate.sill_m < 0) return null;
  const length = wallLength(wall);
  if (candidate.width_m > length) return null;

  const ref = { kind: 'opening' as const, id: candidate.id };
  const fail = (message: string, refs: Issue['refs'] = [ref]): Issue =>
    ({ code: 'OPENING_EDIT_BLOCKED', severity: 'error', message, refs });
  const beforeWall = before === undefined ? undefined : plan.walls.find((entry) => entry.id === before.wallId);

  const oldEndExcess = before === undefined ? 0
    : Math.max(0, before.offset_m + before.width_m - wallLength(beforeWall ?? wall));
  if (Math.max(0, candidate.offset_m + candidate.width_m - length) > oldEndExcess + TOLERANCE.coordinate_m)
    return fail('Проём выходит за конец стены. Уменьшите отступ или ширину.');

  const overlaps = before === undefined
    ? plan.openings.some((other) => openingsOverlap(candidate, other))
    : introducesOpeningOverlap(candidate, before, plan.openings);
  if (overlaps) return fail('Проём наложился на другой проём. Выберите свободный участок стены.');

  const limit = Math.min(wall.height_m, plan.room.ceilingHeight_m);
  const oldLimit = Math.min(beforeWall?.height_m ?? wall.height_m, plan.room.ceilingHeight_m);
  const oldHeightExcess = before === undefined ? 0 : Math.max(0, before.sill_m + before.height_m - oldLimit);
  if (Math.max(0, candidate.sill_m + candidate.height_m - limit) > oldHeightExcess + TOLERANCE.coordinate_m)
    return fail('Высота проёма выходит за стену или потолок. Уменьшите высоту или отступ от пола.');

  // The proposed aperture also changes neighbouring T-junction footprints.
  const blockedByWall = (opening: Opening, host: Wall | undefined, other: Wall): boolean => {
    if (host === undefined || host.id === other.id) return false;
    const polygon = wallSpanPolygon(host, opening.offset_m, opening.offset_m + opening.width_m);
    const interval = { base_m: opening.sill_m, top_m: opening.sill_m + opening.height_m };
    return wallObstacles(other, withOpening(plan.openings, opening), interval, plan.walls)
      .some((part) => intersects(polygon, part));
  };
  const blockingWall = plan.walls.find((other) => blockedByWall(candidate, wall, other) &&
    (before === undefined || !blockedByWall(before, beforeWall, other)));
  if (blockingWall !== undefined)
    return fail('Проём перекрывает другая стена. Выберите свободный участок.', [ref, { kind: 'wall', id: blockingWall.id }]);

  const solid = plan.objects.filter((object) => isPhysical(plan.catalog, object));
  if (before === undefined) {
    // A new hole only removes wall, so it cannot wall anything in; it still
    // must not open onto equipment standing in its span.
    const polygon = wallSpanPolygon(wall, candidate.offset_m, candidate.offset_m + candidate.width_m);
    const interval = { base_m: candidate.sill_m, top_m: candidate.sill_m + candidate.height_m };
    const blocked = solid.find((object) =>
      intervalsOverlap(objectInterval(object), interval) && intersects(footprint(object), polygon));
    return blocked === undefined ? null : fail(
      'Проём перекрывает оборудование «' + blocked.label + '». Сначала переместите предмет или выберите другое место.',
      [ref, { kind: 'object', id: blocked.id }],
    );
  }

  // Editing a hole can restore solid wall around an object that was inside it.
  const openings = withOpening(plan.openings, candidate);
  const walled = solid.find((object) => worsensObjectCollision(object, wall, plan.openings, openings, plan.walls));
  return walled === undefined ? null : fail(
    'После изменения проёма стена перекрывает оборудование «' + walled.label + '». Переместите предмет или оставьте проход шире.',
    [ref, { kind: 'object', id: walled.id }, { kind: 'wall', id: wall.id }],
  );
}

/** Removing a hole restores solid wall, unless another opening still covers it. */
export function openingDeleteRejection(plan: PlanDocument, id: string): Issue | null {
  const opening = plan.openings.find((entry) => entry.id === id);
  if (opening === undefined) return null;
  const wall = plan.walls.find((entry) => entry.id === opening.wallId);
  if (wall === undefined) return null;
  const openings = plan.openings.filter((entry) => entry.id !== id);
  const blocked = plan.objects.find((object) => isPhysical(plan.catalog, object) &&
    worsensObjectCollision(object, wall, plan.openings, openings, plan.walls));
  return blocked === undefined ? null : {
    code: 'OPENING_DELETE_BLOCKED', severity: 'error',
    message: 'Нельзя удалить проём: восстановленная стена перекроет оборудование «' + blocked.label + '». Сначала переместите предмет.',
    refs: [{ kind: 'opening', id }, { kind: 'wall', id: wall.id }, { kind: 'object', id: blocked.id }],
  };
}

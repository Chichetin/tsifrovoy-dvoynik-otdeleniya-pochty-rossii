/**
 * U03 (создание): новая перегородка и новый проём.
 *
 * Правка стен и проёмов уже была, а создания не было: перегородка попадала в
 * план только из открытого файла. Здесь — чистая арифметика этого создания,
 * без React и без Konva, чтобы её проверял тест, а не браузер.
 *
 * Размеры, которых пользователь не называет, — допущения команды, собранные в
 * одном месте и подписанные (D-103). Высота перегородки не выдумывается: она
 * берётся из высоты потолка помещения, потому что перегородка делит именно это
 * помещение.
 */

import type { Id, Opening, OpeningKind, Point, Room, Wall } from '../../contracts/model';
import { nextFreeId } from '../../domain/commands';
import { moveOpeningTo, snapPoint, wallLength } from './vertex-edit';

/**
 * Значения, которых нет в жесте пользователя. Это допущения команды, а не
 * нормативы Почты России; карточка свойств позволяет их изменить.
 */
export const WALL_DEFAULTS = {
  /** Внутренняя перегородка тоньше наружной стены (0.25 м в новом плане). */
  partitionThickness_m: 0.1,
} as const;

export const OPENING_DEFAULTS: Readonly<Record<OpeningKind, { width_m: number; sill_m: number; height_m: number }>> = {
  entrance: { width_m: 1.5, sill_m: 0, height_m: 2.1 },
  door: { width_m: 0.9, sill_m: 0, height_m: 2.1 },
  window: { width_m: 1.2, sill_m: 0.9, height_m: 1.2 },
};

/** Короче этого отрезок считается промахом, а не перегородкой. */
export const MIN_WALL_LENGTH_M = 0.2;

/** Дальше этого от стены клик проёмом в неё не попал. */
export const OPENING_HIT_RADIUS_M = 0.6;

/**
 * Перегородка по двум точкам. Концы притягиваются к сетке — тем же шагом, что
 * и вершины контуров, иначе стена, нарисованная вдоль зоны, не сойдётся с ней
 * на десятых долях метра.
 *
 * Слишком короткий отрезок — это промах мышью, а не перегородка нулевой длины:
 * такой план схема примет, а пользователь получит невидимую стену.
 */
export function createWall(
  from: Point,
  to: Point,
  room: Room,
  taken: Set<Id>,
): Wall | null {
  const start = snapPoint(from);
  const end = snapPoint(to);
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < MIN_WALL_LENGTH_M) return null;

  return {
    id: nextFreeId('w_', taken),
    from: start,
    to: end,
    thickness_m: WALL_DEFAULTS.partitionThickness_m,
    // Перегородка делит это помещение, поэтому её высота — его высота.
    height_m: room.ceilingHeight_m,
  };
}

export type WallHit = { wall: Wall; distance_m: number };

/** Расстояние от точки до отрезка стены. */
function distanceToWall(wall: Wall, point: Point): number {
  const [ax, ay] = wall.from;
  const [bx, by] = wall.to;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - ax, point[1] - ay);

  const t = Math.min(1, Math.max(0, ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSquared));
  return Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy));
}

/**
 * Ближайшая к точке стена, если клик в неё вообще попал. Проём живёт на стене,
 * поэтому «поставить проём в пустоту» — не действие, а промах, и вызывающий
 * обязан объяснить это пользователю.
 */
export function nearestWall(walls: Wall[], point: Point, limit_m = OPENING_HIT_RADIUS_M): WallHit | null {
  let best: WallHit | null = null;
  for (const wall of walls) {
    const distance = distanceToWall(wall, point);
    if (distance > limit_m) continue;
    if (best === null || distance < best.distance_m) best = { wall, distance_m: distance };
  }
  return best;
}

/**
 * Проём на стене под точкой клика. Ширина и высота — умолчания вида проёма;
 * положение считает `moveOpeningTo`, который уже умеет держать проём в пределах
 * стены и притягивать его к сетке.
 *
 * Стена короче самого проёма — отказ: проём, обрезанный до стены, выглядел бы
 * как успешно поставленный, а стена осталась бы сплошной.
 */
export function createOpening(
  wall: Wall,
  point: Point,
  kind: OpeningKind,
  taken: Set<Id>,
): Opening | null {
  const defaults = OPENING_DEFAULTS[kind];
  if (wallLength(wall) < defaults.width_m) return null;

  const opening: Opening = {
    id: nextFreeId('op_', taken),
    wallId: wall.id,
    offset_m: 0,
    width_m: defaults.width_m,
    kind,
    sill_m: defaults.sill_m,
    height_m: defaults.height_m,
  };
  return moveOpeningTo(opening, wall, point);
}

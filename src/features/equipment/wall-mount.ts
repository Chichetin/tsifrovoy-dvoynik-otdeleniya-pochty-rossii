/**
 * UI-3: настенное оборудование — что это такое и куда оно смотрит (D-228).
 *
 * Камера, поставленная кликом, раньше получала `rotation_deg: 0` и смотрела
 * «вверх» независимо от того, где её поставили: сектор обзора уходил в стену.
 * Здесь считается осмысленная постановка — объект прижимается к ближайшей
 * стене и разворачивается от неё, то есть внутрь помещения.
 *
 * Чистые функции над метрами мира: ни экрана, ни React. Соглашение осей —
 * D-010 (X вправо, Y вверх, `position` — центр, положительный угол по часовой,
 * при 0° объект смотрит по локальному +Y), поэтому нормали (0,1) отвечает 0°,
 * а (-1,0) — 270°; та же арифметика, что в `transform.ts` и `viewSector`.
 *
 * Что считать настенным, решает справочник, а не список типов в коде: правило
 * читает `occupiesFloor` и `defaultBase_m`, и новый настенный тип начинает
 * вести себя так же в момент появления в `data/catalog/object-types.json`.
 */

import type { Id, ObjectType, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { locatePoint, normalizeAngle, projectOnSegment } from '../../domain/geometry';

/**
 * Высота рабочей поверхности в справочнике: у стола `ot_workplace`
 * `defaultHeight_m` 0,75 м, и ровно 0,75 м стоит в `defaultBase_m` у всей
 * настольной техники (компьютер, принтер, этикеточник, терминал оплаты, весы).
 * Всё, что крепится выше, висит уже не на мебели, а на стене: от щита 0,8 м до
 * датчика 2,9 м. Известное ограничение: розетка (0,3 м) ниже стола и под
 * правило не попадает — она ставится там, где кликнули.
 */
export const SUPPORT_SURFACE_M = 0.75;

/**
 * Крепится к стене: не занимает пол и поднято выше рабочей поверхности.
 * Из этого следуют оба поведения пакета — разворот при постановке и
 * отсутствие ручек размера (габариты такого прибора — его собственные,
 * а не решение планировщика).
 */
export function isWallMounted(type: ObjectType | null | undefined): boolean {
  if (type === null || type === undefined) return false;
  return !type.occupiesFloor && type.defaultBase_m > SUPPORT_SURFACE_M;
}

/** Куда встать и куда смотреть; `wallId` — стена, к которой прижались. */
export type WallMountPlacement = { position: Point; rotation_deg: number; wallId: Id };

/** Сантиметры в позиции и десятые доли градуса в угле — как у остальных жестов. */
function roundTo(value: number, units: number): number {
  return Math.round(value * units) / units || 0;
}

/** Угол, при котором «перёд» объекта (локальный +Y) смотрит по `normal` (D-010). */
function facing(normal: Point): number {
  return normalizeAngle(roundTo((Math.atan2(normal[0], normal[1]) * 180) / Math.PI, 10)) || 0;
}

/**
 * Постановка настенного объекта по клику: ближайшая стена плана, сторона —
 * та, где кликнули (у перегородки помещение с обеих сторон), разворот — от
 * стены внутрь. Клик снаружи наружной стены разворачивает объект в помещение:
 * настенный прибор не вешают с улицы.
 *
 * Равные расстояния решаются порядком стен в плане — так выбор повторяем.
 * Стен нет (или все вырождены) — `null`: вызывающий ставит объект как ставил.
 *
 * `size_m` — габариты объекта до поворота; к стене прижимается его задняя
 * кромка, поэтому от грани стены отступается половина глубины `size_m[1]`.
 */
export function wallMountPlacement(
  walls: readonly Wall[],
  boundary: Polygon,
  size_m: Point,
  point: Point,
): WallMountPlacement | null {
  let nearest: { wall: Wall; foot: Point; distance: number } | null = null;
  for (const wall of walls) {
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    if (length <= TOLERANCE.coordinate_m) continue;
    const { foot, distance } = projectOnSegment(point, wall.from, wall.to);
    if (nearest === null || distance < nearest.distance) nearest = { wall, foot, distance };
  }
  if (nearest === null) return null;

  const { wall, foot } = nearest;
  const dx = wall.to[0] - wall.from[0];
  const dy = wall.to[1] - wall.from[1];
  const length = Math.hypot(dx, dy);
  // Единичная нормаль стены; знак выбирается ниже.
  const normal: Point = [dy / length, -dx / length];
  const offset_m = wall.thickness_m / 2 + size_m[1] / 2;
  const centre = (sign: number): Point => [
    roundTo(foot[0] + sign * normal[0] * offset_m, 100),
    roundTo(foot[1] + sign * normal[1] * offset_m, 100),
  ];

  // Сторона клика. Точно на оси стены стороны нет — тогда берётся та, что
  // внутри помещения: объект не должен оказаться в стене или за ней.
  const side = normal[0] * (point[0] - foot[0]) + normal[1] * (point[1] - foot[1]);
  let sign = side >= TOLERANCE.coordinate_m ? 1 : side <= -TOLERANCE.coordinate_m ? -1 : 0;
  if (sign === 0) sign = locatePoint(centre(1), boundary) === 'outside' ? -1 : 1;
  else if (
    locatePoint(centre(sign), boundary) === 'outside' &&
    locatePoint(centre(-sign), boundary) !== 'outside'
  ) {
    sign = -sign;
  }

  return {
    position: centre(sign),
    rotation_deg: facing([sign * normal[0], sign * normal[1]]),
    wallId: wall.id,
  };
}

/**
 * UI-3: настенное оборудование — что это такое и куда оно смотрит (D-228).
 *
 * Камера, поставленная кликом, раньше получала `rotation_deg: 0` и смотрела
 * «вверх» независимо от того, где её поставили: сектор обзора уходил в стену.
 * Здесь считается осмысленная постановка — объект разворачивается от
 * ближайшей стены, то есть внутрь помещения, и прижимается к ней, если клик
 * был к стене ближе `WALL_SNAP_REACH_M`.
 *
 * Чистые функции над метрами мира: ни экрана, ни React. Соглашение осей —
 * D-010 (X вправо, Y вверх, `position` — центр, положительный угол по часовой,
 * при 0° объект смотрит по локальному +Y), поэтому нормали (0,1) отвечает 0°,
 * а (-1,0) — 270°. Сам угол считает `rotationFromPointer` из `transform.ts` —
 * та же функция, что стоит за ручкой поворота: второй копии соглашения нет.
 *
 * Что считать настенным, решает справочник, а не список типов в коде: правило
 * читает `occupiesFloor` и `defaultBase_m`, и новый настенный тип начинает
 * вести себя так же в момент появления в `data/catalog/object-types.json`.
 */

import type { Id, ObjectType, Point, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { locatePoint, projectOnSegment } from '../../domain/geometry';
import { rotationFromPointer, snapPosition } from './transform';

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

/**
 * Куда встать и куда смотреть; `wallId` — стена, от которой считали.
 * `attached` — прижали к стене (клик был ближе порога) или оставили под
 * курсором, развернув от стены.
 */
export type WallMountPlacement = {
  position: Point;
  rotation_deg: number;
  wallId: Id;
  attached: boolean;
};

/**
 * Насколько близко надо кликнуть, чтобы прибор прыгнул к стене.
 *
 * Прилипание без предела ломает повтор собственного демо-плана: в
 * `demo/before.json` приборы, поставленные посреди зала, стоят от ближайшей
 * стены на 1,2 м (`eq_46`), 1,4 м (`eq_53`), 2,3 м (`eq_8`), 2,4 м (`eq_7`),
 * 2,5 м (`eq_27`) и 2,7 м (`eq_40`) — при пороге 1,5–2 м два из шести всё ещё
 * уезжали бы к стене, и план нельзя было бы повторить кликами (D-058). Метр —
 * ближе любого из них с запасом 0,2 м и при этом шире, чем промах мышью:
 * клик в метре от стены осмысленно читается как «на эту стену». Порог — в
 * метрах модели, а не в пикселях (в отличие от привязки переноса D-208):
 * прибор притягивается к стене, а не к узлу сетки, и поведение не должно
 * зависеть от текущего zoom.
 */
export const WALL_SNAP_REACH_M = 1;

/**
 * Постановка настенного объекта по клику: ближайшая стена плана, сторона —
 * та, где кликнули (у перегородки помещение с обеих сторон), разворот — от
 * стены внутрь. Клик снаружи наружной стены разворачивает объект в помещение:
 * настенный прибор не вешают с улицы.
 *
 * Поворот считается всегда, позиция прилипает только в пределах
 * `WALL_SNAP_REACH_M`: датчик, поставленный посреди зала, остаётся там, куда
 * ткнули, но смотрит от ближайшей стены, а не «вверх».
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

  const { wall, foot, distance } = nearest;
  const dx = wall.to[0] - wall.from[0];
  const dy = wall.to[1] - wall.from[1];
  const length = Math.hypot(dx, dy);
  // Единичная нормаль стены; знак выбирается ниже.
  const normal: Point = [dy / length, -dx / length];
  const offset_m = wall.thickness_m / 2 + size_m[1] / 2;
  const centre = (sign: number): Point =>
    snapPosition([foot[0] + sign * normal[0] * offset_m, foot[1] + sign * normal[1] * offset_m]);

  // Сторона клика. Клик точно по оси стены стороны не задаёт — он достаётся
  // «плюсу», а проверка ниже всё равно уводит объект внутрь помещения, если
  // с этой стороны улица.
  const side = normal[0] * (point[0] - foot[0]) + normal[1] * (point[1] - foot[1]);
  let sign = side >= 0 ? 1 : -1;
  if (
    locatePoint(centre(sign), boundary) === 'outside' &&
    locatePoint(centre(-sign), boundary) !== 'outside'
  ) {
    sign = -sign;
  }

  const attached = distance <= WALL_SNAP_REACH_M;
  return {
    // Тот же угол, что даёт ручка поворота: направление «перёд объекта на
    // точку» живёт в transform.ts (D-010), второй копии соглашения здесь нет.
    // Точка — в метре от стены по выбранной нормали.
    rotation_deg: rotationFromPointer(
      foot,
      [foot[0] + sign * normal[0], foot[1] + sign * normal[1]],
      false,
      0,
    ),
    position: attached ? centre(sign) : snapPosition(point),
    wallId: wall.id,
    attached,
  };
}

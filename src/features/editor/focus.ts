/**
 * U02: «покажи мне это». Панели проверки, инвентаризации и ассистента умеют
 * только назвать `Ref` — во что его превратить и куда для этого посмотреть,
 * решает этот модуль.
 *
 * Здесь нет ни React, ни Konva: переход к объекту — арифметика над мировыми
 * координатами, и её видно в тестах целиком. Компоненту остаётся отрисовать то,
 * что посчитано.
 *
 * Два правила, ради которых модуль и существует:
 *
 * - объект, который и так виден целиком, вид не двигает (`focusViewport`
 *   возвращает тот же viewport) — иначе каждый клик по списку дёргает план;
 * - масштаб уменьшается только тогда, когда фигура при текущем масштабе не
 *   помещается; приближать «для наглядности» холст не имеет права, это уже
 *   решение пользователя.
 */

import type { Id, PlanDocument, Point, Polygon, Ref, Viewport } from '../../contracts/model';
import {
  boundingBox,
  footprint,
  modelToScreen,
  openingCentre,
  wallPolygon,
} from '../../domain/geometry';
import { type CanvasSize, fitToExtent } from './viewport';

/** Поля вокруг найденного: у самого края холста объект считается ненайденным. */
export const FOCUS_MARGIN_PX = 32;

/** Проём — точка на стене; показываем его квадратом не уже этого. */
const MIN_OPENING_EXTENT_M = 0.6;

function byId<T extends { id: Id }>(items: T[], id: Id): T | undefined {
  return items.find((item) => item.id === id);
}

function squareAround(centre: Point, side: number): Polygon {
  const half = side / 2;
  return [
    [centre[0] - half, centre[1] - half],
    [centre[0] + half, centre[1] - half],
    [centre[0] + half, centre[1] + half],
    [centre[0] - half, centre[1] + half],
  ];
}

/**
 * Мировая фигура, которую стоит показать по ссылке, или `null`, если такой
 * сущности в плане нет. Несуществующая ссылка — обычное дело: панель могла
 * остаться от прошлого документа, и это не повод падать.
 */
export function refExtent(plan: PlanDocument, ref: Ref): Polygon | null {
  if (ref.kind === 'room') {
    return plan.room.id === ref.id ? plan.room.boundary : null;
  }
  if (ref.kind === 'zone') {
    return byId(plan.zones, ref.id)?.polygon ?? null;
  }
  if (ref.kind === 'object') {
    const object = byId(plan.objects, ref.id);
    return object === undefined ? null : footprint(object);
  }
  if (ref.kind === 'wall') {
    const wall = byId(plan.walls, ref.id);
    return wall === undefined ? null : wallPolygon(wall, plan.walls, plan.openings);
  }
  if (ref.kind === 'opening') {
    const opening = byId(plan.openings, ref.id);
    if (opening === undefined) return null;
    const wall = byId(plan.walls, opening.wallId);
    if (wall === undefined) return null;
    return squareAround(
      openingCentre(opening, wall),
      Math.max(opening.width_m, MIN_OPENING_EXTENT_M),
    );
  }
  // Слой не имеет собственной геометрии: он владеет объектами, а не местом.
  return null;
}

/**
 * Охват всего документа прямоугольником — то, что вписывается в холст при
 * открытии плана. Объект, уехавший за стену, входит сюда наравне с помещением:
 * вписывание по одной границе комнаты прячет ровно то, что нужно найти.
 */
export function planExtent(plan: PlanDocument): Polygon {
  const points: Point[] = [...plan.room.boundary];
  for (const zone of plan.zones) points.push(...zone.polygon);
  for (const object of plan.objects) points.push(...footprint(object));
  for (const wall of plan.walls) points.push(wall.from, wall.to);
  if (points.length === 0) return [];

  const box = boundingBox(points);
  return [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
}

/** Тот же масштаб, но фигура посередине холста. */
function centreOn(extent: Polygon, scale: number, canvas: CanvasSize): Viewport {
  const box = boundingBox(extent);
  const centre: Point = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  return {
    scale,
    origin: [canvas.width / 2 - centre[0] * scale, canvas.height / 2 + centre[1] * scale],
  };
}

/**
 * Вид, в котором фигура видна целиком. Возвращает исходный viewport (тот же
 * объект), если двигать нечего — так вызывающий компонент отличает «уже видно»
 * от настоящего перехода, не сравнивая числа.
 */
export function focusViewport(
  extent: Polygon,
  viewport: Viewport,
  canvas: CanvasSize,
  margin = FOCUS_MARGIN_PX,
): Viewport {
  if (extent.length === 0 || canvas.width <= 0 || canvas.height <= 0) return viewport;

  const box = boundingBox(extent);
  // Экран: Y вниз, поэтому верхний левый угол — это (minX, maxY) мира.
  const topLeft = modelToScreen([box.minX, box.maxY], viewport);
  const bottomRight = modelToScreen([box.maxX, box.minY], viewport);
  const visible =
    topLeft[0] >= margin &&
    topLeft[1] >= margin &&
    bottomRight[0] <= canvas.width - margin &&
    bottomRight[1] <= canvas.height - margin;
  if (visible) return viewport;

  const usableWidth = Math.max(1, canvas.width - margin * 2);
  const usableHeight = Math.max(1, canvas.height - margin * 2);
  const fitsAsIs =
    (box.maxX - box.minX) * viewport.scale <= usableWidth &&
    (box.maxY - box.minY) * viewport.scale <= usableHeight;

  return fitsAsIs ? centreOn(extent, viewport.scale, canvas) : fitToExtent(extent, canvas, margin, 0);
}

/**
 * G01 acceptance. Pins the conventions every other package depends on: which
 * way a positive angle turns, that Y is flipped only here, that touching is not
 * a collision, and that height is part of a collision.
 */

import { describe, expect, test } from 'vitest';
import type { Equipment, Opening, Polygon, Viewport, Wall } from '../../contracts/model';
import {
  contains,
  footprint,
  footprintArea,
  intersects,
  intervalsOverlap,
  locatePoint,
  modelToScreen,
  normalizeAngle,
  objectHitsWall,
  objectInterval,
  objectsShareSpace,
  polygonArea,
  rotateOffset,
  screenToModel,
  wallObstacles,
  wallPolygon,
} from './index';

const CLOSE = 9;

function equipment(over: Partial<Equipment> = {}): Equipment {
  return {
    id: 'eq_test',
    typeId: 'ot_workplace',
    label: 'Объект',
    position: [0, 0],
    size_m: [1, 1],
    rotation_deg: 0,
    base_m: 0,
    height_m: 1,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...over,
  };
}

const square = (cx: number, cy: number, side: number): Polygon => [
  [cx - side / 2, cy - side / 2],
  [cx + side / 2, cy - side / 2],
  [cx + side / 2, cy + side / 2],
  [cx - side / 2, cy + side / 2],
];

describe('координаты и поворот', () => {
  test('положительный угол поворачивает по часовой: (1,0) при +90° даёт (0,-1)', () => {
    const [x, y] = rotateOffset([1, 0], 90);
    expect(x).toBeCloseTo(0, CLOSE);
    expect(y).toBeCloseTo(-1, CLOSE);
  });

  test('поворот на 180° и 270° остаётся согласованным', () => {
    const [x180, y180] = rotateOffset([1, 0], 180);
    expect(x180).toBeCloseTo(-1, CLOSE);
    expect(y180).toBeCloseTo(0, CLOSE);
    const [x270, y270] = rotateOffset([1, 0], 270);
    expect(x270).toBeCloseTo(0, CLOSE);
    expect(y270).toBeCloseTo(1, CLOSE);
  });

  test('угол нормализуется в [0,360)', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
  });

  test('отражение Y происходит только при переходе на экран и обратимо', () => {
    const viewport: Viewport = { origin: [100, 500], scale: 40 };
    expect(modelToScreen([3, 2], viewport)).toEqual([220, 420]);
    const back = screenToModel(modelToScreen([3.25, -1.5], viewport), viewport);
    expect(back[0]).toBeCloseTo(3.25, CLOSE);
    expect(back[1]).toBeCloseTo(-1.5, CLOSE);
  });
});

describe('отпечаток объекта', () => {
  test('поворот на 90° меняет местами стороны, но не площадь', () => {
    const rack = equipment({ position: [5, 4], size_m: [2, 0.6], rotation_deg: 90 });
    const shape = footprint(rack);
    const xs = shape.map(([x]) => x);
    const ys = shape.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(4.7, CLOSE);
    expect(Math.max(...xs)).toBeCloseTo(5.3, CLOSE);
    expect(Math.min(...ys)).toBeCloseTo(3, CLOSE);
    expect(Math.max(...ys)).toBeCloseTo(5, CLOSE);
    expect(footprintArea(rack)).toBeCloseTo(1.2, CLOSE);
  });

  test('площадь помещения 10×8 равна 80 м²', () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 8], [0, 8]])).toBeCloseTo(80, CLOSE);
  });
});

describe('принадлежность и вогнутые зоны', () => {
  // L-shaped zone: the notch x∈(2,6), y∈(2,6) is outside it.
  const lShape: Polygon = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];

  test('точка в выемке вогнутой зоны считается снаружи', () => {
    expect(locatePoint([1, 1], lShape)).toBe('inside');
    expect(locatePoint([4, 1], lShape)).toBe('inside');
    expect(locatePoint([4, 4], lShape)).toBe('outside');
    expect(locatePoint([2, 1], lShape)).toBe('inside');
    expect(locatePoint([0, 3], lShape)).toBe('boundary');
  });

  test('проверяется весь отпечаток, а не центр: центр внутри, угол в выемке', () => {
    expect(contains(lShape, square(1, 1, 1))).toBe(true);
    expect(contains(lShape, square(1.5, 1.5, 3))).toBe(false);
    expect(contains(lShape, square(4, 4, 1))).toBe(false);
  });
});

describe('пересечения', () => {
  test('касание сторонами не коллизия', () => {
    expect(intersects(square(0, 0, 2), square(2, 0, 2))).toBe(false);
    expect(intersects(square(0, 0, 2), square(2, 2, 2))).toBe(false);
  });

  test('перекрытие площадью — коллизия', () => {
    expect(intersects(square(0, 0, 2), square(1.5, 0, 2))).toBe(true);
  });

  test('перекрытие меньше допуска не считается коллизией', () => {
    expect(intersects(square(0, 0, 2), square(2 - 2e-9, 0, 2))).toBe(false);
  });

  test('совпадающие и вложенные полигоны пересекаются', () => {
    expect(intersects(square(0, 0, 2), square(0, 0, 2))).toBe(true);
    expect(intersects(square(0, 0, 4), square(0, 0, 1))).toBe(true);
  });

  test('далёкие полигоны не пересекаются', () => {
    expect(intersects(square(0, 0, 1), square(10, 10, 1))).toBe(false);
  });
});

describe('высотные интервалы', () => {
  const desk = equipment({ position: [2, 2], size_m: [1.4, 0.8], height_m: 0.75 });

  test('интервал объекта считается от пола', () => {
    expect(objectInterval(desk)).toEqual({ base_m: 0, top_m: 0.75 });
  });

  test('соприкосновение по высоте не перекрытие', () => {
    expect(intervalsOverlap({ base_m: 0, top_m: 1 }, { base_m: 1, top_m: 2 })).toBe(false);
    expect(intervalsOverlap({ base_m: 0, top_m: 1 }, { base_m: 0.5, top_m: 2 })).toBe(true);
  });

  test('камера над столом не коллизия, а второй стол — коллизия', () => {
    const camera = equipment({
      id: 'eq_cam',
      position: [2, 2],
      size_m: [0.2, 0.2],
      base_m: 2.5,
      height_m: 0.2,
    });
    const secondDesk = equipment({ id: 'eq_desk_2', position: [2.4, 2.1], size_m: [1.4, 0.8], height_m: 0.75 });
    expect(objectsShareSpace(desk, camera)).toBe(false);
    expect(objectsShareSpace(desk, secondDesk)).toBe(true);
  });
});

describe('стена с дверью и окном', () => {
  const wall: Wall = { id: 'w_north', from: [0, 8], to: [10, 8], thickness_m: 0.2, height_m: 3 };
  const door: Opening = { id: 'op_door', wallId: 'w_north', offset_m: 4, width_m: 1.2, kind: 'entrance', sill_m: 0, height_m: 2.1 };
  const window: Opening = { id: 'op_window', wallId: 'w_north', offset_m: 7, width_m: 1.5, kind: 'window', sill_m: 1, height_m: 1.2 };
  const openings = [door, window];

  test('стена целиком — прямоугольник своей толщины', () => {
    expect(polygonArea(wallPolygon(wall))).toBeCloseTo(2, CLOSE);
  });

  test('на высоте стола проём даёт дверь, но не окно', () => {
    const parts = wallObstacles(wall, openings, { base_m: 0, top_m: 0.75 });
    expect(parts).toHaveLength(2);
    expect(parts.reduce((sum, part) => sum + polygonArea(part), 0)).toBeCloseTo(8.8 * 0.2, CLOSE);
  });

  test('на высоте окна проёма два', () => {
    const parts = wallObstacles(wall, openings, { base_m: 1.2, top_m: 1.8 });
    expect(parts).toHaveLength(3);
  });

  test('объект упирается в стену, но проходит в дверном проёме', () => {
    const atWall = equipment({ position: [2, 8], size_m: [1, 0.6], height_m: 0.75 });
    const atDoor = equipment({ id: 'eq_door', position: [4.6, 8], size_m: [1, 0.6], height_m: 0.75 });
    expect(objectHitsWall(atWall, wall, openings)).toBe(true);
    expect(objectHitsWall(atDoor, wall, openings)).toBe(false);
  });

  test('полка на высоте окна проходит, та же полка у пола — нет', () => {
    const atWindow = equipment({ id: 'eq_shelf', position: [7.7, 8], size_m: [1, 0.4], base_m: 1.2, height_m: 0.6 });
    const atFloor = equipment({ id: 'eq_shelf_low', position: [7.7, 8], size_m: [1, 0.4], base_m: 0, height_m: 0.75 });
    expect(objectHitsWall(atWindow, wall, openings)).toBe(false);
    expect(objectHitsWall(atFloor, wall, openings)).toBe(true);
  });
});

describe('регрессия: ряд выровненных объектов', () => {
  // Two desks in a row share their full Y range, so every edge intersection
  // lands on an endpoint and neither has a vertex strictly inside the other.
  test('выровненные по стороне столы с перекрытием считаются коллизией', () => {
    const left = equipment({ position: [2, 2], size_m: [2, 0.8] });
    const right = equipment({ id: 'eq_right', position: [3.5, 2], size_m: [2, 0.8] });
    expect(objectsShareSpace(left, right)).toBe(true);

    const apart = equipment({ id: 'eq_apart', position: [4, 2], size_m: [2, 0.8] });
    expect(objectsShareSpace(left, apart)).toBe(false);
  });
});

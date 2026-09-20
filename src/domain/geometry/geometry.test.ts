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
  isSimplePolygon,
  locatePoint,
  modelToScreen,
  normalizeAngle,
  objectHitsWall,
  objectInterval,
  objectsShareSpace,
  pointSegmentDistance,
  polygonArea,
  projectOnSegment,
  segmentLength,
  wallLength,
  wallSpanPolygon,
  polygonSegmentDistance,
  rotateOffset,
  screenToModel,
  viewSector,
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

  test('прямоугольник в вырезе не принадлежит зоне, даже когда все углы на границе', () => {
    const outline: Polygon = [[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4]];
    const cutout: Polygon = [[1, 1], [3, 1], [3, 4], [1, 4]];
    expect(contains(outline, cutout)).toBe(false);
    expect(intersects(outline, cutout)).toBe(false);
    expect(contains(outline, outline)).toBe(true);
  });
});

describe('простой контур', () => {
  test.each<Polygon>([
    [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4], [2, 2]],
    [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]],
    [[0, 0], [4, 0], [2, 0], [4, 4], [0, 4]],
    [[0, 0], [4, 0], [4, 0], [4, 4], [0, 4]],
  ])('самокасание, возврат по ребру и нулевое ребро не допускаются: %j', (...polygon) => {
    expect(isSimplePolygon(polygon)).toBe(false);
  });

  test('промежуточная вершина на прямой стороне допустима', () => {
    expect(isSimplePolygon([[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]])).toBe(true);
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

  test('объект над низкой перегородкой не сталкивается с ней', () => {
    const lowWall = { ...wall, height_m: 1 };
    const above = equipment({ position: [2, 8], base_m: 1, height_m: 0.2 });
    expect(objectHitsWall(above, lowWall, [])).toBe(false);
    expect(objectHitsWall({ ...above, base_m: 0.9 }, lowWall, [])).toBe(true);
  });

  test('проёму достаточно освободить общую высоту стены и объекта', () => {
    const lowWall = { ...wall, height_m: 1 };
    const gap = { ...door, height_m: 1 };
    const tall = equipment({ position: [4.6, 8], height_m: 2 });
    expect(objectHitsWall(tall, lowWall, [gap])).toBe(false);
  });

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

describe('сектор обзора', () => {
  test('при нулевом повороте смотрит в +Y, при 90° — в +X', () => {
    const north = viewSector([0, 0], 0, 60, 4);
    const east = viewSector([0, 0], 90, 60, 4);

    // Середина дуги — это направление взгляда.
    const middle = (sector: Polygon): Polygon[number] => sector[1 + Math.floor((sector.length - 1) / 2)]!;
    expect(middle(north)[0]).toBeCloseTo(0, CLOSE);
    expect(middle(north)[1]).toBeCloseTo(4, CLOSE);
    expect(middle(east)[0]).toBeCloseTo(4, CLOSE);
    expect(middle(east)[1]).toBeCloseTo(0, CLOSE);
  });

  test('первая вершина — сама камера, остальные лежат на дальности', () => {
    const sector = viewSector([2, 3], 45, 90, 5);
    expect(sector[0]).toEqual([2, 3]);
    for (const point of sector.slice(1)) {
      expect(Math.hypot(point[0] - 2, point[1] - 3)).toBeCloseTo(5, CLOSE);
    }
  });

  test('площадь сектора — доля круга по углу', () => {
    const quarter = polygonArea(viewSector([0, 0], 0, 90, 4, 720));
    expect(quarter).toBeCloseTo((Math.PI * 16) / 4, 3);
  });

  test('обзор 360° — замкнутый круг без вершины в центре', () => {
    const circle = viewSector([1, 1], 0, 360, 2, 720);
    expect(circle).not.toContainEqual([1, 1]);
    // Замыкающая точка совпала бы с первой: кольцо не хранит её дважды.
    expect(circle).toHaveLength(720);
    expect(polygonArea(circle)).toBeCloseTo(Math.PI * 4, 3);
  });

  test('угол вне диапазона не ломает многоугольник', () => {
    expect(viewSector([0, 0], 0, 0, 3)).toHaveLength(26);
    expect(polygonArea(viewSector([0, 0], 0, 0, 3))).toBeCloseTo(0, CLOSE);
    expect(polygonArea(viewSector([0, 0], 0, 540, 3, 720))).toBeCloseTo(Math.PI * 9, 3);
  });
});

describe('расстояние до отрезка', () => {
  const square: Polygon = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];

  test('отрезок в стороне — расстояние до ближайшего ребра', () => {
    expect(polygonSegmentDistance(square, [5, 0], [5, 2])).toBeCloseTo(3, CLOSE);
    expect(polygonSegmentDistance(square, [0, 5], [2, 5])).toBeCloseTo(3, CLOSE);
  });

  test('ближайшая точка может лежать внутри отрезка, а не в его конце', () => {
    // Отрезок наклонён: перпендикуляр из угла (2,2) падает в его середину (4,4).
    expect(polygonSegmentDistance(square, [2, 6], [6, 2])).toBeCloseTo(2 * Math.SQRT2, CLOSE);
  });

  test('касание, пересечение и отрезок внутри — ноль', () => {
    expect(polygonSegmentDistance(square, [2, 0], [2, 2])).toBeCloseTo(0, CLOSE);
    expect(polygonSegmentDistance(square, [-1, 1], [3, 1])).toBeCloseTo(0, CLOSE);
    expect(polygonSegmentDistance(square, [0.5, 0.5], [1.5, 1.5])).toBeCloseTo(0, CLOSE);
  });

  test('вырожденный отрезок — это точка', () => {
    expect(polygonSegmentDistance(square, [5, 1], [5, 1])).toBeCloseTo(3, CLOSE);
  });
});

describe('примитивы отрезка', () => {
  test('длина, проекция и расстояние — одно вычисление', () => {
    expect(segmentLength([0, 0], [3, 4])).toBe(5);
    const inside = projectOnSegment([2, 5], [0, 0], [10, 0]);
    expect(inside.t).toBeCloseTo(0.2);
    expect(inside.foot).toEqual([2, 0]);
    expect(inside.distance).toBe(5);
    // За концом отрезка проекция прижимается к концу.
    const past = projectOnSegment([13, 4], [0, 0], [10, 0]);
    expect(past.t).toBe(1);
    expect(past.foot).toEqual([10, 0]);
    expect(past.distance).toBe(5);
    expect(pointSegmentDistance([5, -2], [0, 0], [10, 0])).toBe(2);
    // Вырожденный отрезок — расстояние до точки.
    expect(projectOnSegment([3, 4], [0, 0], [0, 0])).toEqual({ t: 0, foot: [0, 0], distance: 5 });
  });

  test('полоса стены: по всей длине и по пролёту с другой толщиной', () => {
    const wall: Wall = { id: 'w', from: [0, 0], to: [10, 0], thickness_m: 0.2, height_m: 3 };
    expect(wallLength(wall)).toBe(10);
    const span = wallSpanPolygon(wall, 2, 5, 0.1);
    expect(span.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])).toEqual([
      [2, 0.05],
      [5, 0.05],
      [5, -0.05],
      [2, -0.05],
    ]);
    expect(polygonArea(span)).toBeCloseTo(0.3);
  });
});

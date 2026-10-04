/**
 * G01 acceptance. Pins the conventions every other package depends on: which
 * way a positive angle turns, that Y is flipped only here, that touching is not
 * a collision, and that height is part of a collision.
 */

import { describe, expect, test } from 'vitest';
import type { Equipment, Opening, PlanDocument, Point, Polygon, Viewport, Wall } from '../../contracts/model';
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
  ringArea,
  segmentLength,
  wallLength,
  wallSpanPolygon,
  polygonSegmentDistance,
  rotateOffset,
  screenToModel,
  viewSector,
  pointInViewSector,
  wallObstacles,
  wallPolygon,
  boundingBox,
  boxesOverlap,
  symbolOutline,
  dragObstacles,
  nearestGap,
  objectGaps,
  objectGuides,
  polygonGap,
  snapObjectCentre,
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

/**
 * An honest area or none at all (D-242). `polygonArea` is the absolute value of
 * the shoelace sum: on a self-crossing ring its halves carry opposite signs and
 * cancel out, so a 4 m bow tie reports a flat 0 m². Showing that number to a
 * clerk is lying with a figure, so the area meant for the interface answers the
 * same way for every unusable ring: null.
 */
describe('площадь кольца', () => {
  test('простое кольцо отдаёт свою площадь', () => {
    expect(ringArea([[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(16);
    expect(ringArea([[0, 0], [4, 0], [0, 3]])).toBe(6);
    expect(ringArea([[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]])).toBe(16);
  });

  test('направление обхода на площадь не влияет', () => {
    const ring: Polygon = [[0, 0], [4, 0], [4, 3], [0, 3]];
    const reversed: Polygon = [...ring].reverse();
    expect(ringArea(ring)).toBe(12);
    expect(ringArea(reversed)).toBe(12);
  });

  test.each<[string, Polygon]>([
    ['пустой контур', []],
    ['одна вершина', [[0, 0]]],
    ['две вершины', [[0, 0], [4, 0]]],
    ['совпадающие соседние точки', [[0, 0], [4, 0], [4, 0], [4, 4], [0, 4]]],
    ['все точки в одной', [[2, 2], [2, 2], [2, 2]]],
    ['нулевая площадь: точки на одной прямой', [[0, 0], [2, 0], [4, 0]]],
    ['восьмёрка', [[0, 0], [4, 0], [0, 4], [4, 4]]],
    ['касание рёбер в одной точке', [[0, 4], [4, 4], [4, 0], [2, 4], [0, 0]]],
    ['возврат по ребру', [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4], [2, 2]]],
  ])('%s — площади нет', (_case, polygon) => {
    expect(ringArea(polygon)).toBeNull();
  });

  test('«бабочка» именно та, на которой формула площади врёт нулём', () => {
    const bowtie: Polygon = [[0, 0], [4, 0], [0, 4], [4, 4]];
    expect(polygonArea(bowtie)).toBe(0);
    expect(ringArea(bowtie)).toBeNull();
  });

  test('кольцо годное — ответ тот же, что у формулы площади', () => {
    const ring: Polygon = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
    expect(ringArea(ring)).toBe(polygonArea(ring));
    expect(ringArea(ring)).toBe(20);
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

describe('контур объекта (D-277)', () => {
  const L_SHAPE: Polygon = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0], [0, 0], [0, 0.5], [-0.5, 0.5]];
  const circle = symbolOutline('circle')!;
  const triangle = symbolOutline('triangle')!;

  test('без контура след — прямоугольник size_m, как раньше', () => {
    const shape = footprint(equipment({ position: [3, 2], size_m: [1.4, 0.8] }));
    expect(shape).toEqual([[2.3, 1.6], [3.7, 1.6], [3.7, 2.4], [2.3, 2.4]].map(([x, y]) => [
      expect.closeTo(x!, CLOSE),
      expect.closeTo(y!, CLOSE),
    ]));
  });

  test('площадь эллипса: вписанный 24-угольник, в пределах 1,5 % от πab', () => {
    const table = equipment({ size_m: [1.2, 0.8], outline: circle });
    // n/2 · sin(2π/n) · a · b for n = 24; vertices are stored to 1e-6.
    const inscribed = 12 * Math.sin(Math.PI / 12) * 0.6 * 0.4;
    expect(footprintArea(table)).toBeCloseTo(inscribed, 5);
    expect(footprintArea(table) / (Math.PI * 0.6 * 0.4)).toBeGreaterThan(0.985);
    expect(footprintArea(table)).toBeLessThan(Math.PI * 0.6 * 0.4);
  });

  test('площадь треугольника — половина габарита, Г-образной формы — три четверти', () => {
    expect(footprintArea(equipment({ size_m: [0.6, 0.4], outline: triangle }))).toBeCloseTo(0.12, CLOSE);
    expect(footprintArea(equipment({ size_m: [2, 1.6], outline: L_SHAPE, rotation_deg: 33 }))).toBeCloseTo(2.4, CLOSE);
  });

  test('контур масштабируется размером и поворачивается как объект: вершина треугольника смотрит по направлению объекта', () => {
    const upright = footprint(equipment({ position: [1, 1], size_m: [0.4, 1], outline: triangle }));
    expect(upright[0]![0]).toBeCloseTo(1, CLOSE);
    expect(upright[0]![1]).toBeCloseTo(1.5, CLOSE);
    // +90 turns clockwise: local +Y (the apex) points to world +X.
    const turned = footprint(equipment({ position: [1, 1], size_m: [0.4, 1], outline: triangle, rotation_deg: 90 }));
    expect(turned[0]![0]).toBeCloseTo(1.5, CLOSE);
    expect(turned[0]![1]).toBeCloseTo(1, CLOSE);
  });

  test('Г-образный стол не сталкивается с тумбой в своём вырезе, хотя рамки пересекаются', () => {
    // L occupies all but the upper-right quarter of its 2×2 box centred at 0,0.
    const desk = equipment({ id: 'eq_desk', size_m: [2, 2], outline: L_SHAPE });
    const pedestal = equipment({ id: 'eq_ped', position: [0.5, 0.5], size_m: [0.8, 0.8] });
    expect(boxesOverlap(boundingBox(footprint(desk)), boundingBox(footprint(pedestal)))).toBe(true);
    expect(objectsShareSpace(desk, pedestal)).toBe(false);
    // Moved into the arm of the L it does collide.
    expect(objectsShareSpace(desk, { ...pedestal, position: [-0.5, 0.5] })).toBe(true);
  });

  test('круглый стол в углу: рамка задевает соседа, круг — нет', () => {
    const table = equipment({ id: 'eq_round', size_m: [1, 1], outline: circle });
    const box = equipment({ id: 'eq_box', position: [0.65, 0.65], size_m: [0.5, 0.5] });
    expect(objectsShareSpace(table, box)).toBe(false);
    expect(objectsShareSpace({ ...table, outline: undefined }, box)).toBe(true);
  });

  test('принадлежность зоне — по контуру: Г-образный объект лежит в Г-образной зоне, его рамка — нет', () => {
    const zone: Polygon = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    const desk = equipment({ position: [2, 2], size_m: [4, 4], outline: L_SHAPE });
    expect(contains(zone, footprint(desk))).toBe(true);
    expect(contains(zone, footprint({ ...desk, outline: undefined }))).toBe(false);
    // Turned by 90° the L no longer matches the zone.
    expect(contains(zone, footprint({ ...desk, rotation_deg: 90 }))).toBe(false);
  });

  test('треугольник у стены: рамка упирается в перегородку, контур — нет', () => {
    const partition = square(0.9, 0.9, 0.2);
    const camera = equipment({ size_m: [2, 2], outline: triangle });
    expect(intersects(footprint({ ...camera, outline: undefined }), partition)).toBe(true);
    expect(intersects(footprint(camera), partition)).toBe(false);
  });
});

describe('точка в секторе обзора', () => {
  test('при нулевом повороте видит точку по +Y и не видит за спиной', () => {
    expect(pointInViewSector([0, 0], 0, 90, 5, [0, 3])).toBe(true);
    expect(pointInViewSector([0, 0], 0, 90, 5, [0, -3])).toBe(false);
  });

  test('поворот на 90° по часовой переводит взгляд на +X', () => {
    expect(pointInViewSector([0, 0], 90, 60, 5, [3, 0])).toBe(true);
    expect(pointInViewSector([0, 0], 90, 60, 5, [0, 3])).toBe(false);
    expect(pointInViewSector([0, 0], 270, 60, 5, [-3, 0])).toBe(true);
  });

  test('граница угла входит, за ней — нет', () => {
    // 90° sector looking at +Y: the edges run along ±45°.
    expect(pointInViewSector([0, 0], 0, 90, 5, [2, 2])).toBe(true);
    expect(pointInViewSector([0, 0], 0, 90, 5, [2.1, 1.9])).toBe(false);
  });

  test('граница дальности входит, дальше — нет', () => {
    expect(pointInViewSector([1, 1], 0, 90, 4, [1, 5])).toBe(true);
    expect(pointInViewSector([1, 1], 0, 90, 4, [1, 5.1])).toBe(false);
  });

  test('сама камера в секторе, обзор 360° видит всё в пределах дальности', () => {
    expect(pointInViewSector([1, 1], 0, 30, 2, [1, 1])).toBe(true);
    expect(pointInViewSector([1, 1], 0, 360, 2, [1, -0.5])).toBe(true);
    expect(pointInViewSector([1, 1], 0, 360, 2, [1, -1.5])).toBe(false);
  });

  test('совпадает с нарисованным сектором: середина дуги внутри', () => {
    const sector = viewSector([2, 3], 45, 90, 5);
    const middle = sector[1 + Math.floor((sector.length - 1) / 2)]!;
    const inner: Point = [2 + (middle[0] - 2) * 0.9, 3 + (middle[1] - 3) * 0.9];
    expect(pointInViewSector([2, 3], 45, 90, 5, inner)).toBe(true);
  });
});

describe('умные направляющие и расстояния при перетаскивании (#20)', () => {
  const wall: Wall = { id: 'w_east', from: [10, 0], to: [10, 10], thickness_m: 0.2, height_m: 3 };
  // Повёрнутый на 90° сосед 2 × 0,5 м: его рамка — 0,5 по X и 2 по Y.
  const turned = equipment({ id: 'eq_turned', position: [5, 5], size_m: [2, 0.5], rotation_deg: 90 });
  const plan = (objects: Equipment[], hiddenLayer = false): PlanDocument => ({
    schemaVersion: 1,
    id: 'plan_test',
    name: 'Тест',
    room: { id: 'room', boundary: [[0, 0], [10, 0], [10, 10], [0, 10]], ceilingHeight_m: 3 },
    walls: [wall],
    openings: [],
    layers: [{ id: 'l_base', name: 'Основной', visible: !hiddenLayer, locked: false, order: 0, typeId: null }],
    zones: [],
    objects,
    catalog: { version: '1', objectTypes: [], zoneTypes: [], layerTypes: [], rules: [] },
    extensions: {},
  });

  test('направляющие соседа — края и центр его повёрнутой рамки, без самого перемещаемого', () => {
    const moving = equipment({ id: 'eq_moving', position: [2, 2] });
    const guides = objectGuides(plan([turned, moving]), new Set(['eq_moving']));
    for (const x of [4.75, 5, 5.25]) expect(guides.xs.some((guide) => Math.abs(guide - x) < 1e-9)).toBe(true);
    for (const y of [4, 5, 6]) expect(guides.ys.some((guide) => Math.abs(guide - y) < 1e-9)).toBe(true);
    expect(guides.xs.some((guide) => Math.abs(guide - 2) < 1e-9)).toBe(false);
  });

  test('центр прилипает к центру соседа', () => {
    const moving = equipment({ id: 'eq_moving', position: [5.03, 8] });
    const guides = objectGuides(plan([turned, moving]), new Set(['eq_moving']));
    const { centre, snap } = snapObjectCentre(moving, [5.03, 8], guides, null, 0.1);
    expect(centre[0]).toBeCloseTo(5, CLOSE);
    expect(snap.x?.kind).toBe('guide');
  });

  test('зазор повёрнутого на 45° объекта до грани стены — от вершины ромба по перпендикуляру', () => {
    const diamond = footprint(equipment({ position: [8, 5], rotation_deg: 45 }));
    const gap = polygonGap(diamond, [[9.9, 0], [10.1, 0], [10.1, 10], [9.9, 10]]);
    expect(gap?.distance).toBeCloseTo(1.9 - Math.SQRT1_2, CLOSE);
    expect(gap?.from[0]).toBeCloseTo(8 + Math.SQRT1_2, CLOSE);
    expect(gap?.from[1]).toBeCloseTo(5, CLOSE);
    expect(gap?.to).toEqual([9.9, 5]);
  });

  test('ближайший сосед выбран по контуру, пересечение — ноль', () => {
    const near = equipment({ id: 'eq_near', position: [3, 5] });
    const obstacles = dragObstacles(plan([turned, near]), new Set());
    // Объект 1 × 1 в (5, 2): до повёрнутого соседа (x 4,75…5,25; y 4…6) — 1,5 по Y,
    // до eq_near (x 2,5…3,5; y 4,5…5,5) — √(1² + 2²).
    const gap = nearestGap(footprint(equipment({ position: [5, 2] })), obstacles.objects);
    expect(gap?.id).toBe('eq_turned');
    expect(gap?.distance).toBeCloseTo(1.5, CLOSE);
    const overlap = nearestGap(footprint(equipment({ position: [5, 5.2] })), obstacles.objects);
    expect(overlap).toMatchObject({ id: 'eq_turned', distance: 0 });
  });

  test('расстояния до стены и соседа без скрытых и перемещаемых объектов', () => {
    const moving = equipment({ id: 'eq_moving', position: [8, 5], size_m: [1, 0.5], rotation_deg: 90 });
    const gaps = objectGaps(moving, dragObstacles(plan([turned, moving]), new Set(['eq_moving'])));
    // Повёрнутый 1 × 0,5: правый край на 8,25, грань стены на 9,9.
    expect(gaps.wall).toMatchObject({ id: 'w_east' });
    expect(gaps.wall?.distance).toBeCloseTo(1.65, CLOSE);
    expect(gaps.object?.id).toBe('eq_turned');
    expect(gaps.object?.distance).toBeCloseTo(7.75 - 5.25, CLOSE);
    expect(dragObstacles(plan([turned], true), new Set()).objects).toHaveLength(0);
  });

  test('наложение на соседа — зазора нет, линию «0 м» не рисуем', () => {
    const over = equipment({ id: 'eq_over', position: [5, 5.2] });
    const gaps = objectGaps(over, dragObstacles(plan([turned, over]), new Set(['eq_over'])));
    expect(gaps.object).toBeNull();
  });
});

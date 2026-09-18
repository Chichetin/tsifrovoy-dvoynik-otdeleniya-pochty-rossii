/**
 * Outer walls follow the room outline; partitions and their openings stay.
 *
 * The case from the operator's report is the first test: a user draws an
 * L-shaped room over the starter 12×9 box and expects the box's walls and
 * entrance to be gone — not a frame around the new room with a door outside it.
 */

import { describe, expect, test } from 'vitest';
import type { Opening, Polygon, Wall } from '../../contracts/model';
import { outerWallIds, rebuildOuterWalls } from './room-walls';

const BOX: Polygon = [
  [0, 0],
  [12, 0],
  [12, 9],
  [0, 9],
];

function wall(id: string, from: [number, number], to: [number, number], thickness = 0.25): Wall {
  return { id, from, to, thickness_m: thickness, height_m: 3 };
}

const boxWalls: Wall[] = [
  wall('w_south', [0, 0], [12, 0]),
  wall('w_east', [12, 0], [12, 9]),
  wall('w_north', [12, 9], [0, 9]),
  wall('w_west', [0, 9], [0, 0]),
];

const partition: Wall = wall('w_inner', [6, 0], [6, 5], 0.1);

/** Entrance in the middle of the north wall: 1.5 m wide, centred at x = 6. */
const entrance: Opening = {
  id: 'op_entrance',
  wallId: 'w_north',
  offset_m: 12 / 2 - 0.75,
  width_m: 1.5,
  kind: 'entrance',
  sill_m: 0,
  height_m: 2.1,
};

const partitionDoor: Opening = {
  id: 'op_door',
  wallId: 'w_inner',
  offset_m: 3,
  width_m: 0.9,
  kind: 'door',
  sill_m: 0,
  height_m: 2.1,
};

const fallback = { thickness_m: 0.25, height_m: 3 };

describe('какая стена наружная', () => {
  test('стены на рёбрах контура — наружные, перегородка — нет', () => {
    const outer = outerWallIds([...boxWalls, partition], BOX);
    expect([...outer].sort()).toEqual(['w_east', 'w_north', 'w_south', 'w_west']);
  });

  test('стена вдоль ребра, но торчащая за угол, наружной не считается', () => {
    const sticking = wall('w_long', [0, 0], [15, 0]);
    expect(outerWallIds([sticking], BOX).size).toBe(0);
  });

  test('стена вдоль двух коллинеарных рёбер — наружная, а не перегородка', () => {
    // План, сохранённый до того, как стены пошли за контуром: в южное ребро
    // вставлена вершина, а стена по-прежнему одна на всю длину.
    const split: Polygon = [
      [0, 0],
      [6, 0],
      [12, 0],
      [12, 9],
      [0, 9],
    ];
    expect(outerWallIds(boxWalls, split).has('w_south')).toBe(true);
    // И после пересборки старая южная стена не остаётся дублем поверх новых.
    const { walls } = rebuildOuterWalls(boxWalls, [], split, split, fallback);
    expect(walls.find((w) => w.id === 'w_south')).toBeUndefined();
    expect(walls).toHaveLength(5);
  });

  test('направление отрезка роли не играет', () => {
    const reversed = wall('w_rev', [12, 0], [0, 0]);
    expect(outerWallIds([reversed], BOX).has('w_rev')).toBe(true);
  });
});

describe('свой контур вместо стартовой коробки', () => {
  const L: Polygon = [
    [0, 0],
    [8, 0],
    [8, 4],
    [4, 4],
    [4, 7],
    [0, 7],
  ];

  test('стены коробки уходят, по каждому ребру нового контура — стена', () => {
    const { walls } = rebuildOuterWalls(boxWalls, [entrance], BOX, L, fallback);

    expect(walls).toHaveLength(6);
    for (const w of walls) expect(['w_south', 'w_east', 'w_north', 'w_west']).not.toContain(w.id);
    // Каждая новая стена лежит на ребре нового контура.
    expect(outerWallIds(walls, L).size).toBe(6);
  });

  test('толщина и высота новых стен — от старых наружных', () => {
    const thick = boxWalls.map((w) => ({ ...w, thickness_m: 0.4, height_m: 3.3 }));
    const { walls } = rebuildOuterWalls(thick, [], BOX, L, fallback);
    for (const w of walls) {
      expect(w.thickness_m).toBe(0.4);
      expect(w.height_m).toBe(3.3);
    }
  });

  test('без старых наружных стен берутся умолчания', () => {
    const { walls } = rebuildOuterWalls([partition], [], BOX, L, { thickness_m: 0.3, height_m: 2.8 });
    const outer = walls.filter((w) => w.id !== 'w_inner');
    expect(outer).toHaveLength(6);
    expect(outer[0]?.thickness_m).toBe(0.3);
  });

  test('перегородка и её дверь остаются как были', () => {
    const { walls, openings } = rebuildOuterWalls(
      [...boxWalls, partition],
      [entrance, partitionDoor],
      BOX,
      L,
      fallback,
    );
    expect(walls.find((w) => w.id === 'w_inner')).toEqual(partition);
    expect(openings.find((o) => o.id === 'op_door')).toEqual(partitionDoor);
  });

  test('новые идентификаторы не сталкиваются с перегородками', () => {
    const named = { ...partition, id: 'w_1' };
    const { walls } = rebuildOuterWalls([...boxWalls, named], [], BOX, L, fallback);
    const ids = walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('проёмы наружных стен', () => {
  test('вход остаётся на своей стене при растяжении помещения', () => {
    // Коробка стала шире: 12 → 18 м. Северная стена — ребро 2 (12,9)→(0,9).
    const wider: Polygon = [
      [0, 0],
      [18, 0],
      [18, 9],
      [0, 9],
    ];
    const { walls, openings } = rebuildOuterWalls(boxWalls, [entrance], BOX, wider, fallback);

    expect(openings).toHaveLength(1);
    const moved = openings[0] as Opening;
    const host = walls.find((w) => w.id === moved.wallId) as Wall;
    // Стена-хозяин — северная (y = 9), вход в её середине.
    expect(host.from[1]).toBe(9);
    expect(host.to[1]).toBe(9);
    expect(moved.offset_m + moved.width_m / 2).toBeCloseTo(18 / 2, 1);
  });

  test('вход на исчезнувшем ребре пропадает вместе со стеной', () => {
    // Треугольник: у нового контура всего три ребра, ребра 3 нет.
    const triangle: Polygon = [
      [0, 0],
      [12, 0],
      [6, 9],
    ];
    const westDoor: Opening = { ...entrance, id: 'op_west', wallId: 'w_west', offset_m: 4 };
    const { openings } = rebuildOuterWalls(boxWalls, [westDoor], BOX, triangle, fallback);
    expect(openings.find((o) => o.id === 'op_west')).toBeUndefined();
  });

  test('вход не вылезает за короткое новое ребро', () => {
    const narrow: Polygon = [
      [0, 0],
      [2, 0],
      [2, 9],
      [0, 9],
    ];
    const { openings } = rebuildOuterWalls(boxWalls, [entrance], BOX, narrow, fallback);
    const moved = openings[0] as Opening;
    expect(moved.offset_m).toBeGreaterThanOrEqual(0);
    expect(moved.offset_m + moved.width_m).toBeLessThanOrEqual(2 + 1e-9);
  });

  test('ребро короче проёма — проём не переносится', () => {
    const tiny: Polygon = [
      [0, 0],
      [12, 0],
      [12, 9],
      [11, 9],
    ];
    const { openings } = rebuildOuterWalls(boxWalls, [entrance], BOX, tiny, fallback);
    // Северное ребро (12,9)→(11,9) длиной 1 м короче входа 1.5 м.
    expect(openings.find((o) => o.id === 'op_entrance')).toBeUndefined();
  });

  // Ревью MR !64: перенос «по номеру ребра» ломался на штатном жесте — клик по
  // ребру вставляет вершину и сдвигает индексы всех следующих рёбер, и вход с
  // северной стены молча уезжал на восточную. Ребро ищется по геометрии.
  test('вставка вершины в южное ребро не сдвигает вход с северной стены', () => {
    const split: Polygon = [
      [0, 0],
      [6, 0],
      [12, 0],
      [12, 9],
      [0, 9],
    ];
    const { walls, openings } = rebuildOuterWalls(boxWalls, [entrance], BOX, split, fallback);
    const moved = openings[0] as Opening;
    const host = walls.find((w) => w.id === moved.wallId) as Wall;
    expect(host.from[1]).toBe(9);
    expect(host.to[1]).toBe(9);
    expect(moved.offset_m + moved.width_m / 2).toBeCloseTo(6, 1);
  });

  test('удаление вершины перед северным ребром не сдвигает вход', () => {
    // Контур с лишней вершиной на юге → без неё: индексы уменьшаются на 1.
    const withExtra: Polygon = [
      [0, 0],
      [6, 0],
      [12, 0],
      [12, 9],
      [0, 9],
    ];
    const wallsOnExtra: Wall[] = [
      wall('w_s1', [0, 0], [6, 0]),
      wall('w_s2', [6, 0], [12, 0]),
      wall('w_east', [12, 0], [12, 9]),
      wall('w_north', [12, 9], [0, 9]),
      wall('w_west', [0, 9], [0, 0]),
    ];
    const { walls, openings } = rebuildOuterWalls(wallsOnExtra, [entrance], withExtra, BOX, fallback);
    const moved = openings[0] as Opening;
    const host = walls.find((w) => w.id === moved.wallId) as Wall;
    expect(host.from[1]).toBe(9);
    expect(host.to[1]).toBe(9);
  });

  test('потянули угол северной стены — вход остаётся на ней', () => {
    // Вершина (12,9) → (14,10): северное ребро сменило и начало, и наклон.
    const dragged: Polygon = [
      [0, 0],
      [12, 0],
      [14, 10],
      [0, 9],
    ];
    const { walls, openings } = rebuildOuterWalls(boxWalls, [entrance], BOX, dragged, fallback);
    const moved = openings[0] as Opening;
    const host = walls.find((w) => w.id === moved.wallId) as Wall;
    // Хозяин — ребро, заканчивающееся в нетронутой вершине (0,9).
    expect(host.to).toEqual([0, 9]);
    expect(host.from).toEqual([14, 10]);
  });

  test('неизменённый контур: стены пересобраны на тех же местах, вход на месте', () => {
    const { walls, openings } = rebuildOuterWalls(boxWalls, [entrance], BOX, BOX, fallback);
    expect(walls).toHaveLength(4);
    expect(openings).toHaveLength(1);
    const moved = openings[0] as Opening;
    expect(moved.offset_m).toBeCloseTo(entrance.offset_m, 2);
  });
});

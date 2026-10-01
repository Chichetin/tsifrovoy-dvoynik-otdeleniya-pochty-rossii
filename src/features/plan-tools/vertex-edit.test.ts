import { describe, expect, it } from 'vitest';
import type { Opening, Point, Polygon, Wall, Zone } from '../../contracts/model';
import {
  canCommitRing,
  extrudeEdge,
  insertVertex,
  insertionOnEdge,
  moveOpeningTo,
  moveVertex,
  moveWallEnd,
  nearestEdge,
  parentForRing,
  removeVertex,
  roundPoint,
} from './vertex-edit';

const square: Polygon = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

const wall: Wall = { id: 'w_1', from: [0, 0], to: [10, 0], thickness_m: 0.2, height_m: 3 };
const door: Opening = {
  id: 'op_1',
  wallId: 'w_1',
  offset_m: 2,
  width_m: 1,
  kind: 'door',
  sill_m: 0,
  height_m: 2.1,
};

describe('правка вершин контура', () => {
  it('moveVertex двигает только одну вершину и хранит точку как дал слой (D-211: грань стены 14,875 не округляется)', () => {
    const moved = moveVertex(square, 2, [5.125, 4.996]);
    expect(moved).toEqual([
      [0, 0],
      [4, 0],
      [5.125, 4.996],
      [0, 4],
    ]);
    // Округление до сантиметра — отдельная функция для точек без привязки.
    expect(roundPoint([5.004, 4.996])).toEqual([5, 5]);
    expect(roundPoint([2.3, 70 * 0.01])).toEqual([2.3, 0.7]);
    // Исходный контур не тронут: команда получает новый массив.
    expect(square[2]).toEqual([4, 4]);
  });

  it('insertVertex вставляет точку после ребра с данным индексом', () => {
    const grown = insertVertex(square, 1, [4, 2]);
    expect(grown).toEqual([
      [0, 0],
      [4, 0],
      [4, 2],
      [4, 4],
      [0, 4],
    ]);
    // Последнее ребро замыкает кольцо: вставка после него — в конец.
    expect(insertVertex(square, 3, [0, 2])).toHaveLength(5);
    expect(insertVertex(square, 3, [0, 2])[4]).toEqual([0, 2]);
  });

  it('removeVertex удаляет при четырёх и более вершинах, иначе отказывает', () => {
    expect(removeVertex(square, 1)).toEqual([
      [0, 0],
      [4, 4],
      [0, 4],
    ]);
    const triangle: Polygon = [
      [0, 0],
      [3, 0],
      [0, 3],
    ];
    expect(removeVertex(triangle, 0)).toBeNull();
    expect(removeVertex(square, 4)).toBeNull();
    expect(removeVertex(square, -1)).toBeNull();
  });

  it('nearestEdge находит ближайшее ребро и проекцию на него', () => {
    const hit = nearestEdge(square, [4.3, 1.5]);
    expect(hit.index).toBe(1);
    expect(hit.point).toEqual([4, 1.5]);
    expect(hit.distance).toBeCloseTo(0.3, 9);

    // За концом ребра проекция прижимается к вершине, расстояние — до неё.
    const corner = nearestEdge(square, [5, -1]);
    expect(corner.point).toEqual([4, 0]);
    expect(corner.distance).toBeCloseTo(Math.SQRT2, 9);
  });

  it('canCommitRing отвергает бабочку и вырожденный контур', () => {
    expect(canCommitRing(square)).toBe(true);
    // Вершина (0,0) уходит за правое ребро: ребро (0,4)→(6,2) пересекает x = 4.
    const bowtie = moveVertex(square, 0, [6, 2]);
    expect(canCommitRing(bowtie)).toBe(false);
    expect(
      canCommitRing([
        [0, 0],
        [1, 0],
        [2, 0],
      ]),
    ).toBe(false);
  });

  it('insertionOnEdge вставляет вершину в середине ребра', () => {
    const hit = insertionOnEdge(square, [4.1, 2]);
    expect(hit?.index).toBe(1);
    expect(hit?.point).toEqual([4, 2]);
  });

  it('insertionOnEdge молчит у вершины: там целились в угол, а не в ребро', () => {
    // Ребро (4,0)→(4,4): клик в 0,5 м от вершины ближе к ней, чем к середине.
    expect(insertionOnEdge(square, [4.1, 0.5])).toBeNull();
    expect(insertionOnEdge(square, [4.1, 3.5])).toBeNull();
    // Граница — четверть ребра: до неё ближе вершина, после — середина.
    expect(insertionOnEdge(square, [4, 0.9])).toBeNull();
    expect(insertionOnEdge(square, [4, 1])?.index).toBe(1);
    expect(insertionOnEdge(square, [4, 1.1])?.index).toBe(1);
  });

  it('insertionOnEdge берёт то же ребро, что и nearestEdge', () => {
    const point: [number, number] = [2, 3.9];
    expect(insertionOnEdge(square, point)?.index).toBe(nearestEdge(square, point).index);
  });
});

describe('правка стен и проёмов', () => {
  it('moveWallEnd двигает выбранный конец, второй остаётся', () => {
    expect(moveWallEnd(wall, 'to', [10.004, 3]).to).toEqual([10.004, 3]);
    expect(moveWallEnd(wall, 'to', [10, 3]).from).toEqual([0, 0]);
    expect(moveWallEnd(wall, 'from', [1, 1]).from).toEqual([1, 1]);
  });

  it('moveOpeningTo держит проём в пределах стены', () => {
    // Центр проёма под курсором: offset — ближний к from край.
    expect(moveOpeningTo(door, wall, [5, 0.4]).offset_m).toBe(4.5);
    // За концами стены проём прижимается к краю, не вылезая.
    expect(moveOpeningTo(door, wall, [-3, 0]).offset_m).toBe(0);
    expect(moveOpeningTo(door, wall, [30, 0]).offset_m).toBe(9);
    // Стена и остальные поля не меняются.
    const moved = moveOpeningTo(door, wall, [7, 0]);
    expect(moved.wallId).toBe('w_1');
    expect(moved.width_m).toBe(1);
    expect(moved.kind).toBe('door');
  });

  it('округление не выводит проём за конец стены', () => {
    const slanted = { ...wall, to: [10.004, 0] as Point };
    expect(moveOpeningTo(door, slanted, [30, 0]).offset_m + door.width_m).toBeLessThanOrEqual(10.004);
  });

  it('moveOpeningTo на стене короче проёма оставляет offset 0', () => {
    const stub: Wall = { ...wall, to: [0.5, 0] };
    expect(moveOpeningTo(door, stub, [0.4, 0]).offset_m).toBe(0);
    const point: Wall = { ...wall, to: [0, 0] };
    expect(moveOpeningTo(door, point, [3, 3]).offset_m).toBe(0);
  });
});

describe('родитель новой зоны', () => {
  const zone = (id: string, parentId: string | null, polygon: Polygon): Zone => ({
    id,
    parentId,
    polygon,
    typeId: 'zt_client',
    name: id,
    layerId: 'l_base',
    attributes: {},
  });
  const zones: Zone[] = [
    zone('z_hall', null, square),
    zone('z_wait', 'z_hall', [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]),
    zone('z_other', null, [
      [10, 10],
      [12, 10],
      [12, 12],
      [10, 12],
    ]),
  ];

  it('берёт самую глубокую зону, целиком содержащую контур', () => {
    const inner: Polygon = [
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 1.5],
      [0.5, 1.5],
    ];
    expect(parentForRing(inner, zones)).toBe('z_wait');
    const mid: Polygon = [
      [2.5, 2.5],
      [3.5, 2.5],
      [3.5, 3.5],
      [2.5, 3.5],
    ];
    expect(parentForRing(mid, zones)).toBe('z_hall');
  });

  it('контур вне зон или через их границу — самостоятельная зона', () => {
    expect(
      parentForRing(
        [
          [20, 20],
          [21, 20],
          [21, 21],
        ],
        zones,
      ),
    ).toBeNull();
    expect(
      parentForRing(
        [
          [3, 3],
          [6, 3],
          [6, 6],
          [3, 6],
        ],
        zones,
      ),
    ).toBeNull();
  });
});

describe('выступ из ребра (D-232)', () => {
  it('вершина появляется на том ребре, куда ткнули, и её место возвращается', () => {
    // Низ квадрата — ребро 0 между (0,0) и (4,0).
    const pulled = extrudeEdge(square, [2, 0.05]);
    if (pulled === null) throw new Error('на середине ребра выступ должен начинаться');

    expect(pulled.polygon).toHaveLength(square.length + 1);
    expect(pulled.index).toBe(1);
    expect(pulled.polygon[pulled.index]).toEqual([2, 0]);
    // Остальные вершины на месте и в прежнем порядке.
    expect(pulled.polygon.filter((_, at) => at !== pulled.index)).toEqual(square);
  });

  it('у самого угла выступ не начинается: там уже есть вершина', () => {
    expect(extrudeEdge(square, [0.02, 0.02])).toBeNull();
  });

  it('вытянутая вершина двигается, а не плодит соседние', () => {
    const pulled = extrudeEdge(square, [2, 0]);
    if (pulled === null) throw new Error('выступ должен начинаться');

    const shaped = moveVertex(pulled.polygon, pulled.index, [2, -1.5]);
    expect(shaped).toHaveLength(square.length + 1);
    expect(shaped[pulled.index]).toEqual([2, -1.5]);
    // Выступ наружу квадрат не ломает: кольцо остаётся простым.
    expect(canCommitRing(shaped)).toBe(true);
  });

  it('выступ, заведённый на другое ребро, кольцо не коммитит', () => {
    const pulled = extrudeEdge(square, [2, 0]);
    if (pulled === null) throw new Error('выступ должен начинаться');

    // Тянем нижнюю вершину выше верхнего ребра — стороны пересекаются.
    const crossed = moveVertex(pulled.polygon, pulled.index, [2, 6]);
    expect(canCommitRing(crossed)).toBe(false);
  });
});

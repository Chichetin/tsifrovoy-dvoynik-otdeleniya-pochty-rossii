/**
 * D01: the scene is a pure projection of the plan. Every prism here is derived
 * from the same geometry the 2D canvas draws, so a rotated object has the same
 * footprint in both views and moving it in the plan moves it in the scene.
 */

import { describe, expect, test } from 'vitest';
import type {
  Catalog,
  Equipment,
  Opening,
  PlanDocument,
  Polygon,
  Wall,
  Zone,
} from '../../contracts/model';
import { SCHEMA_VERSION } from '../../contracts/model';
import { footprint, rotateOffset } from '../../domain/geometry';
import { buildScene, type ScenePrism } from './scene';
import { visitorStep } from './visitor';

const catalog: Catalog = {
  version: '1.0.0',
  objectTypes: [
    {
      id: 'ot_rack',
      label: 'Стеллаж',
      category: 'Хранение',
      defaultSize_m: [2, 0.6],
      defaultHeight_m: 2,
      defaultBase_m: 0,
      physical: true,
      occupiesFloor: true,
      symbol: 'rect',
      color: '#8B5E34',
      attributes: [],
      provenance: 'test',
    },
    {
      id: 'ot_camera',
      label: 'Камера',
      category: 'Безопасность',
      defaultSize_m: [0.2, 0.2],
      defaultHeight_m: 0.2,
      defaultBase_m: 2.5,
      physical: false,
      occupiesFloor: false,
      symbol: 'circle',
      color: '#1C7ED6',
      attributes: [],
      provenance: 'test',
    },
  ],
  zoneTypes: [
    { id: 'zt_client', label: 'Клиентская', color: '#E7F5FF', attributes: [] },
    { id: 'zt_queue', label: 'Очередь', color: '#FFF3BF', attributes: [] },
  ],
  layerTypes: [],
  rules: [],
};

const rack: Equipment = {
  id: 'eq_rack',
  typeId: 'ot_rack',
  label: 'Стеллаж 37°',
  position: [3.5, 2.25],
  size_m: [2, 0.6],
  rotation_deg: 37,
  base_m: 0,
  height_m: 2,
  zoneId: 'z_client',
  layerId: 'l_base',
  attributes: {},
};

const camera: Equipment = {
  id: 'eq_cam',
  typeId: 'ot_camera',
  label: 'Камера',
  position: [1, 1],
  size_m: [0.2, 0.2],
  rotation_deg: 0,
  base_m: 2.5,
  height_m: 0.2,
  zoneId: 'z_client',
  layerId: 'l_base',
  attributes: {},
};

const wall: Wall = {
  id: 'w_south',
  from: [0, 0],
  to: [8, 0],
  thickness_m: 0.2,
  height_m: 3,
};

const door: Opening = {
  id: 'op_door',
  wallId: 'w_south',
  offset_m: 3,
  width_m: 1,
  kind: 'door',
  sill_m: 0,
  height_m: 2.1,
};

const client: Zone = {
  id: 'z_client',
  typeId: 'zt_client',
  name: 'Клиентская',
  polygon: [
    [0, 0],
    [8, 0],
    [8, 5],
    [0, 5],
  ],
  parentId: null,
  layerId: 'l_base',
  attributes: {},
};

const queue: Zone = {
  id: 'z_queue',
  typeId: 'zt_queue',
  name: 'Очередь',
  polygon: [
    [5, 0.5],
    [7.5, 0.5],
    [7.5, 3],
    [5, 3],
  ],
  parentId: 'z_client',
  layerId: 'l_base',
  attributes: {},
};

/** L-shaped room: nothing about it is symmetric, so a mirrored axis shows. */
const plan: PlanDocument = {
  schemaVersion: SCHEMA_VERSION,
  id: 'plan_3d',
  name: 'План для 3D',
  room: {
    id: 'room_main',
    boundary: [
      [0, 0],
      [8, 0],
      [8, 5],
      [3, 5],
      [3, 7],
      [0, 7],
    ],
    ceilingHeight_m: 3.2,
  },
  walls: [wall],
  openings: [door],
  layers: [{ id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null }],
  zones: [client, queue],
  objects: [rack, camera],
  catalog,
  extensions: {},
};

function only(prisms: ScenePrism[], kind: ScenePrism['kind'], id?: string): ScenePrism[] {
  return prisms.filter((prism) => prism.kind === kind && (id === undefined || prism.ref.id === id));
}

function roundPolygon(polygon: Polygon): Polygon {
  return polygon.map(([x, y]) => [Number(x.toFixed(9)), Number(y.toFixed(9))]);
}

describe('buildScene: объекты', () => {
  test('объект под 37° даёт тот же отпечаток, что footprint из geometry', () => {
    const [prism] = only(buildScene(plan).prisms, 'object', 'eq_rack');
    expect(prism).toBeDefined();
    expect(roundPolygon(prism!.polygon)).toEqual(roundPolygon(footprint(rack)));
    expect(prism!.base_m).toBe(0);
    expect(prism!.height_m).toBe(2);
    expect(prism!.ref).toEqual({ kind: 'object', id: 'eq_rack' });
  });

  test('призма объекта — по его контуру (D-277): низ и верх совпадают с Г-образным следом на плане', () => {
    const outline: Polygon = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0], [0, 0], [0, 0.5], [-0.5, 0.5]];
    const desk: Equipment = { ...rack, id: 'eq_desk', outline };
    const [prism] = only(buildScene({ ...plan, objects: [desk] }).prisms, 'object', 'eq_desk');
    expect(prism!.polygon).toHaveLength(6);
    expect(roundPolygon(prism!.polygon)).toEqual(roundPolygon(footprint(desk)));
  });

  test('поворот идёт по часовой стрелке, как в модели (D-010)', () => {
    const [prism] = only(buildScene(plan).prisms, 'object', 'eq_rack');
    const [a, b] = prism!.polygon;
    // The long edge of the rack: local +X turned 37° clockwise.
    const edge = [b![0] - a![0], b![1] - a![1]];
    const expected = rotateOffset([2, 0], 37);
    expect(edge[0]).toBeCloseTo(expected[0], 9);
    expect(edge[1]).toBeCloseTo(expected[1], 9);
    // Clockwise means the far end drops below the centre line.
    expect(edge[1]).toBeLessThan(0);
  });

  test('вложенная зона лежит на ступень выше родителя; цикл родителей — плоско, а не бесконечно', () => {
    const [outer] = only(buildScene(plan).prisms, 'zone', 'z_client');
    const [inner] = only(buildScene(plan).prisms, 'zone', 'z_queue');
    expect(outer!.base_m).toBe(0);
    expect(inner!.base_m).toBeCloseTo(outer!.height_m);
    // Глубину считает domain/relations: цикл даёт null → зона остаётся на полу.
    const cyclic: PlanDocument = {
      ...plan,
      zones: [
        { ...client, parentId: 'z_queue' },
        { ...queue, parentId: 'z_client' },
      ],
    };
    for (const prism of only(buildScene(cyclic).prisms, 'zone')) expect(prism.base_m).toBe(0);
  });

  test('объект поднят на base_m: камера висит под потолком, а не стоит на полу', () => {
    const [prism] = only(buildScene(plan).prisms, 'object', 'eq_cam');
    expect(prism!.base_m).toBe(2.5);
    expect(prism!.height_m).toBe(0.2);
    expect(prism!.color).toBe('#1C7ED6');
  });

  test('цвет объекта — из типа справочника; неизвестный тип получает нейтральный', () => {
    const scene = buildScene(plan);
    expect(only(scene.prisms, 'object', 'eq_rack')[0]!.color).toBe('#8B5E34');

    const stranger = { ...rack, id: 'eq_x', typeId: 'ot_missing' };
    const other = buildScene({ ...plan, objects: [stranger] });
    const [prism] = only(other.prisms, 'object', 'eq_x');
    expect(prism!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(prism!.color).not.toBe('#8B5E34');
  });

  test('обновление позиции в плане сдвигает призму и не трогает остальные', () => {
    const before = buildScene(plan);
    const moved = { ...rack, position: [rack.position[0] + 1.5, rack.position[1] - 0.75] as [number, number] };
    const after = buildScene({ ...plan, objects: [moved, camera] });

    const was = only(before.prisms, 'object', 'eq_rack')[0]!.polygon;
    const now = only(after.prisms, 'object', 'eq_rack')[0]!.polygon;
    now.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(was[index]![0] + 1.5, 9);
      expect(y).toBeCloseTo(was[index]![1] - 0.75, 9);
    });

    const rest = (scene: typeof before) => scene.prisms.filter((prism) => prism.ref.id !== 'eq_rack');
    expect(rest(after)).toEqual(rest(before));
  });

  test('план не изменяется при построении сцены', () => {
    const snapshot = JSON.stringify(plan);
    buildScene(plan);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe('buildScene: зоны и помещение', () => {
  test('зона получает цвет типа из справочника и свой контур', () => {
    const scene = buildScene(plan);
    const [prism] = only(scene.prisms, 'zone', 'z_client');
    expect(prism!.color).toBe('#E7F5FF');
    expect(prism!.polygon).toEqual(client.polygon);
    expect(prism!.ref).toEqual({ kind: 'zone', id: 'z_client' });
    expect(only(scene.prisms, 'zone', 'z_queue')[0]!.color).toBe('#FFF3BF');
  });

  test('справочник аргументом переопределяет снимок из плана', () => {
    const recoloured: Catalog = {
      ...catalog,
      zoneTypes: [{ id: 'zt_client', label: 'Клиентская', color: '#FF0000', attributes: [] }],
    };
    const [prism] = only(buildScene(plan, recoloured).prisms, 'zone', 'z_client');
    expect(prism!.color).toBe('#FF0000');
  });

  test('вложенная зона лежит выше родителя, чтобы не тонуть в его полу', () => {
    const scene = buildScene(plan);
    const parent = only(scene.prisms, 'zone', 'z_client')[0]!;
    const child = only(scene.prisms, 'zone', 'z_queue')[0]!;
    expect(child.base_m).toBeGreaterThan(parent.base_m);
    expect(parent.base_m).toBeGreaterThanOrEqual(0);
  });

  test('пол — по контуру помещения, граница сцены и высота потолка — из room', () => {
    const scene = buildScene(plan);
    const [floor] = only(scene.prisms, 'floor');
    expect(floor!.polygon).toEqual(plan.room.boundary);
    expect(floor!.ref).toEqual({ kind: 'room', id: 'room_main' });
    expect(floor!.base_m + floor!.height_m).toBeCloseTo(0, 9);
    expect(scene.ceilingHeight_m).toBe(3.2);
    expect(scene.bounds).toEqual({ minX: 0, minY: 0, maxX: 8, maxY: 7 });
  });
});

describe('buildScene: стены и проёмы', () => {
  test('стена сплошная по всей высоте там, где проёма нет', () => {
    const parts = only(buildScene(plan).prisms, 'wall', 'w_south');
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(part.polygon).toHaveLength(4);
      expect(part.height_m).toBeGreaterThan(0);
    }
    // Sum of covered height on a section with no opening reaches the wall top.
    const covered = coverAt(parts, 1);
    expect(covered).toBeCloseTo(3, 9);
  });

  test('дверной проём — дыра до перемычки, над ней стена продолжается', () => {
    const parts = only(buildScene(plan).prisms, 'wall', 'w_south');
    // At x = 3.5 the door spans 0…2.1 m, so only the 0.9 m above the lintel is solid.
    expect(coverAt(parts, 3.5)).toBeCloseTo(3 - 2.1, 9);
    const above = parts.filter((part) => coversX(part.polygon, 3.5));
    expect(above.length).toBe(1);
    expect(above[0]!.base_m).toBeCloseTo(2.1, 9);
  });

  test('проём показан прозрачной плоскостью со своим id и видом', () => {
    const [pane] = only(buildScene(plan).prisms, 'opening', 'op_door');
    expect(pane).toBeDefined();
    expect(pane!.ref).toEqual({ kind: 'opening', id: 'op_door' });
    expect(pane!.base_m).toBe(0);
    expect(pane!.height_m).toBe(2.1);
    expect(pane!.opacity).toBeLessThan(1);
    // Pane sits on the wall between offset 3 and 4 metres.
    const xs = pane!.polygon.map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(3, 9);
    expect(Math.max(...xs)).toBeCloseTo(4, 9);
  });

  test('стена нулевой длины не даёт призм', () => {
    const degenerate: Wall = { ...wall, id: 'w_zero', to: wall.from };
    const scene = buildScene({ ...plan, walls: [degenerate], openings: [] });
    expect(only(scene.prisms, 'wall')).toEqual([]);
  });
});

describe('buildScene: скрытые слои', () => {
  /** Второй слой, выключенный «глазом» в панели слоёв: на нём очередь и камера. */
  const hidden: PlanDocument = {
    ...plan,
    layers: [
      { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
      { id: 'l_hidden', name: 'Служебный', visible: false, locked: false, order: 1, typeId: null },
    ],
    zones: [client, { ...queue, layerId: 'l_hidden' }],
    objects: [rack, { ...camera, layerId: 'l_hidden' }],
  };

  test('объект и зона скрытого слоя в сцену не попадают', () => {
    const { prisms } = buildScene(hidden);
    expect(only(prisms, 'zone', 'z_queue')).toEqual([]);
    expect(only(prisms, 'object', 'eq_cam')).toEqual([]);
    // Всё, что на показанном слое, на месте — скрывается слой, а не сцена.
    expect(only(prisms, 'zone', 'z_client')).toHaveLength(1);
    expect(only(prisms, 'object', 'eq_rack')).toHaveLength(1);
  });

  test('помещение, стены и проёмы слоёв не имеют и остаются видимыми', () => {
    const { prisms } = buildScene({ ...hidden, layers: hidden.layers.map((l) => ({ ...l, visible: false })) });
    expect(only(prisms, 'floor')).toHaveLength(1);
    expect(only(prisms, 'wall', 'w_south').length).toBeGreaterThan(0);
    expect(only(prisms, 'opening', 'op_door')).toHaveLength(1);
    expect(only(prisms, 'zone')).toEqual([]);
    expect(only(prisms, 'object')).toEqual([]);
  });

  test('слой снова показан — призмы возвращаются', () => {
    const shown: PlanDocument = {
      ...hidden,
      layers: hidden.layers.map((layer) => ({ ...layer, visible: true })),
    };
    const { prisms } = buildScene(shown);
    expect(only(prisms, 'zone', 'z_queue')).toHaveLength(1);
    expect(only(prisms, 'object', 'eq_cam')).toHaveLength(1);
  });

  test('ссылка на несуществующий слой не показывается: как и на холсте 2D', () => {
    const orphan: PlanDocument = {
      ...plan,
      objects: [{ ...rack, layerId: 'l_missing' }],
      zones: [{ ...client, layerId: 'l_missing' }],
    };
    const { prisms } = buildScene(orphan);
    expect(only(prisms, 'object')).toEqual([]);
    expect(only(prisms, 'zone')).toEqual([]);
  });

  test('вложенность считается по всем зонам, даже когда родитель скрыт', () => {
    const childVisible: PlanDocument = {
      ...hidden,
      zones: [{ ...client, layerId: 'l_hidden' }, queue],
    };
    const [child] = only(buildScene(childVisible).prisms, 'zone', 'z_queue');
    expect(child).toBeDefined();
    // Родитель в сцену не попал, но очередь по-прежнему лежит слоем выше него.
    expect(child!.base_m).toBeGreaterThan(0);
  });
});

describe('buildScene: проём на наклонной стене', () => {
  const diagonal: Wall = { id: 'w_diag', from: [0, 0], to: [3, 4], thickness_m: 0.3, height_m: 3 };
  const sash: Opening = {
    id: 'op_win',
    wallId: 'w_diag',
    offset_m: 1.5,
    width_m: 1,
    kind: 'window',
    sill_m: 0.9,
    height_m: 1.2,
  };
  const slanted: PlanDocument = { ...plan, walls: [diagonal], openings: [sash] };

  test('плоскость окна стоит в стене: центр, ширина и толщина по её направлению', () => {
    const [pane] = only(buildScene(slanted).prisms, 'opening', 'op_win');
    expect(pane).toBeDefined();
    expect(pane!.base_m).toBe(0.9);
    expect(pane!.height_m).toBe(1.2);
    expect(pane!.opacity).toBeLessThan(1);

    // Центр — середина проёма вдоль стены длиной 5 м: from + (1.5 + 0.5) * u.
    const centre = pane!.polygon.reduce(
      (sum, [x, y]) => [sum[0] + x / 4, sum[1] + y / 4] as [number, number],
      [0, 0] as [number, number],
    );
    expect(centre[0]).toBeCloseTo(1.2, 9);
    expect(centre[1]).toBeCloseTo(1.6, 9);

    // Четыре стороны: две по ширине проёма и две по доле толщины стены.
    const sides = pane!.polygon.map((point, index) => {
      const next = pane!.polygon[(index + 1) % pane!.polygon.length]!;
      return Math.hypot(next[0] - point[0], next[1] - point[1]);
    });
    expect(sides.map((side) => Number(side.toFixed(9))).sort((a, b) => a - b)).toEqual([
      0.12, 0.12, 1, 1,
    ]);

    // Длинная сторона параллельна стене: векторное произведение с (0.6, 0.8) — ноль.
    const long = pane!.polygon.map((point, index) => {
      const next = pane!.polygon[(index + 1) % pane!.polygon.length]!;
      return [next[0] - point[0], next[1] - point[1]] as [number, number];
    }).filter(([dx, dy]) => Math.hypot(dx, dy) > 0.5);
    for (const [dx, dy] of long) expect(dx * 0.8 - dy * 0.6).toBeCloseTo(0, 9);
  });
});

/** Total solid height of wall parts whose footprint covers x on the south wall. */
function coverAt(parts: ScenePrism[], x: number): number {
  return parts
    .filter((part) => coversX(part.polygon, x))
    .reduce((sum, part) => sum + part.height_m, 0);
}

function coversX(polygon: Polygon, x: number): boolean {
  const xs = polygon.map(([px]) => px);
  return Math.min(...xs) < x && x < Math.max(...xs);
}

describe('шаг посетителя', () => {
  test('скорость не зависит от числа кадров; вправо — поперёк взгляда', () => {
    let position: [number, number] = [0, 0];
    for (let frame = 0; frame < 10; frame += 1) position = visitorStep(position, [1, 0], [0, 1], 0.1, []);
    expect(position[0]).toBeCloseTo(1.4);
    const right = visitorStep([0, 0], [1, 0], [1, 0], 0.1, []);
    expect(right[0]).toBe(0);
    expect(right[1]).toBeCloseTo(-0.14);
    const diagonal = visitorStep([0, 0], [1, 0], [1, 1], 0.1, []);
    expect(Math.hypot(...diagonal)).toBeCloseTo(0.14);
    expect(visitorStep([0, 0], [1, 0], [0, 1], 0.1, [], true)[0]).toBeCloseTo(0.28);
  });

  test('тонкая стена блокирует весь путь шага, а свободный дверной промежуток пропускает', () => {
    const wall: Polygon = [[1, -2], [1.02, -2], [1.02, 2], [1, 2]];
    expect(visitorStep([0.7, 0], [1, 0], [0, 1], 0.1, [wall], true)).toEqual([0.7, 0]);
    const doorway: Polygon[] = [
      [[1, -2], [1.02, -2], [1.02, -0.6], [1, -0.6]],
      [[1, 0.6], [1.02, 0.6], [1.02, 2], [1, 2]],
    ];
    expect(visitorStep([0.85, 0], [1, 0], [0, 1], 0.1, doorway, true)[0]).toBeGreaterThan(1.02);
  });

  test('пауза вкладки не превращается в скачок; нет ввода — нет перемещения', () => {
    expect(visitorStep([0, 0], [1, 0], [0, 1], 10, [])[0]).toBeCloseTo(0.14);
    expect(visitorStep([1, 2], [1, 0], [0, 0], 0.1, [])).toEqual([1, 2]);
    expect(visitorStep([1, 2], [1, 0], [0, 1], NaN, [])).toEqual([1, 2]);
  });
});

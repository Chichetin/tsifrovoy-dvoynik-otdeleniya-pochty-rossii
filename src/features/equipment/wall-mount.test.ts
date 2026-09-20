/**
 * UI-3: настенное оборудование — предикат по справочнику и постановка у стены.
 *
 * Числа в тестах — из `data/catalog/object-types.json`: предикат читается по
 * реальному справочнику, чтобы правка справочника (новый настенный тип,
 * другая высота крепления) ломала тест, а не тихо меняла поведение редактора.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ObjectType, Point, Polygon, Wall } from '../../contracts/model';
import {
  SUPPORT_SURFACE_M,
  WALL_SNAP_REACH_M,
  isWallMounted,
  wallMountPlacement,
} from './wall-mount';

function catalogTypes(): ObjectType[] {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'catalog', 'object-types.json'), 'utf8'),
  ) as ObjectType[];
}

function type(overrides: Partial<ObjectType> = {}): ObjectType {
  return {
    id: 'ot_test',
    label: 'Тип',
    category: 'Тест',
    defaultSize_m: [0.2, 0.2],
    defaultHeight_m: 0.2,
    defaultBase_m: 2,
    physical: true,
    occupiesFloor: false,
    symbol: 'rect',
    color: '#000000',
    attributes: [],
    provenance: 'тест',
    ...overrides,
  };
}

/** Контур и стены демо-плана: прямоугольник с вырезом плюс три перегородки. */
const BOUNDARY: Polygon = [
  [0, 0],
  [15, 0],
  [15, 10],
  [6, 10],
  [6, 7],
  [0, 7],
];

function wall(id: string, from: Point, to: Point, thickness_m = 0.25): Wall {
  return { id, from, to, thickness_m, height_m: 3 };
}

const WALLS: Wall[] = [
  wall('w_south', [0, 0], [15, 0]),
  wall('w_east', [15, 0], [15, 10]),
  wall('w_north', [15, 10], [6, 10]),
  wall('w_notch_east', [6, 10], [6, 7]),
  wall('w_notch_south', [6, 7], [0, 7]),
  wall('w_west', [0, 7], [0, 0]),
  wall('w_hall_back', [9.3, 0], [9.3, 7]),
  wall('w_staff', [6, 7], [9.3, 7]),
  wall('w_storage', [9.3, 6.2], [15, 6.2]),
];

/** Камера из справочника: 0,15 × 0,15 м. */
const CAMERA_SIZE: Point = [0.15, 0.15];

function place(point: Point, size_m: Point = CAMERA_SIZE, walls: Wall[] = WALLS) {
  return wallMountPlacement(walls, BOUNDARY, size_m, point);
}

/** Прижат к стене. */
function attached(position: Point, rotation_deg: number, wallId: string) {
  return { position, rotation_deg, wallId, attached: true };
}

/** Остался под курсором, но развёрнут от стены. */
function free(position: Point, rotation_deg: number, wallId: string) {
  return { position, rotation_deg, wallId, attached: false };
}

describe('что считается настенным', () => {
  test('по справочнику: восемь типов крепятся к стене, настольная техника и мебель — нет', () => {
    const mounted = catalogTypes()
      .filter((entry) => isWallMounted(entry))
      .map((entry) => entry.id);

    expect(mounted).toEqual([
      'ot_info_display',
      'ot_media_panel',
      'ot_camera',
      'ot_alarm_panel',
      'ot_fire_sensor',
      'ot_switchboard',
      'ot_hvac',
      'ot_water_heater',
    ]);
  });

  test('настольная техника стоит на рабочей поверхности 0,75 м и настенной не считается', () => {
    const desktop = catalogTypes().filter((entry) => entry.defaultBase_m === SUPPORT_SURFACE_M);

    expect(desktop.map((entry) => entry.id)).toEqual([
      'ot_computer',
      'ot_pos_terminal',
      'ot_printer',
      'ot_label_printer',
      'ot_scales',
    ]);
    for (const entry of desktop) expect(isWallMounted(entry)).toBe(false);
  });

  test('граница проходит выше рабочей поверхности, а не по нулю', () => {
    expect(isWallMounted(type({ defaultBase_m: SUPPORT_SURFACE_M }))).toBe(false);
    expect(isWallMounted(type({ defaultBase_m: SUPPORT_SURFACE_M + 0.05 }))).toBe(true);
    // Розетка на 0,3 м — известное ограничение правила: она ниже стола.
    expect(isWallMounted(type({ defaultBase_m: 0.3 }))).toBe(false);
  });

  test('стоящее на полу не настенное, даже если поднято высоко', () => {
    expect(isWallMounted(type({ occupiesFloor: true, defaultBase_m: 2.6 }))).toBe(false);
    expect(isWallMounted(null)).toBe(false);
  });
});

describe('постановка у стены', () => {
  test('у каждой наружной стены объект смотрит внутрь помещения', () => {
    expect(place([3, 0.4])).toEqual(attached([3, 0.2], 0, 'w_south'));
    expect(place([14.6, 5])).toEqual(attached([14.8, 5], 270, 'w_east'));
    expect(place([10, 9.6])).toEqual(attached([10, 9.8], 180, 'w_north'));
    expect(place([0.4, 3])).toEqual(attached([0.2, 3], 90, 'w_west'));
  });

  test('объект прижат к грани стены: половина толщины плюс половина своей глубины', () => {
    // Информационное табло 1,1 × 0,1 м: 0,125 + 0,05 = 0,175 → сантиметр.
    expect(place([7, 0.5], [1.1, 0.1])).toEqual(attached([7, 0.18], 0, 'w_south'));
    // Глубокий сплит 0,8 × 0,6 м отодвинут дальше: 0,125 + 0,3.
    expect(place([7, 0.5], [0.8, 0.6])).toEqual(attached([7, 0.43], 0, 'w_south'));
  });

  test('у перегородки сторона выбирается по клику: объект остаётся там, где его ставили', () => {
    expect(place([9, 3])).toEqual(attached([9.1, 3], 270, 'w_hall_back'));
    expect(place([9.6, 3])).toEqual(attached([9.5, 3], 90, 'w_hall_back'));
  });

  test('наклонная перегородка разворачивает объект по своей нормали', () => {
    const diagonal = [wall('w_diagonal', [0, 0], [4, 4])];
    const triangle: Polygon = [
      [0, 0],
      [4, 4],
      [4, 0],
    ];
    const placement = wallMountPlacement(diagonal, triangle, CAMERA_SIZE, [2, 1]);

    expect(placement).toEqual(attached([1.64, 1.36], 135, 'w_diagonal'));
  });

  test('дальше порога объект остаётся под курсором, но смотрит от ближайшей стены', () => {
    // Датчик посреди зала: в demo/before.json такие стоят в 1,2–2,7 м от стен,
    // и клик должен класть их туда, куда ткнули.
    expect(place([3, 3])).toEqual(free([3, 3], 0, 'w_south'));
    // Равные расстояния до южной и западной стены решает порядок стен в плане;
    // чуть ближе к западной — поворот меняется на 90°.
    expect(place([3, 3.2])).toEqual(free([3, 3.2], 90, 'w_west'));
    // Датчик eq_46 демо-плана: над перегородкой склада, смотрит от неё вверх.
    expect(place([12, 7.4])).toEqual(free([12, 7.4], 0, 'w_storage'));
  });

  test('порог прилипания — метр от стены: ближе прижимает, дальше нет', () => {
    expect(WALL_SNAP_REACH_M).toBe(1);
    expect(place([3, WALL_SNAP_REACH_M])).toEqual(attached([3, 0.2], 0, 'w_south'));
    expect(place([3, WALL_SNAP_REACH_M + 0.01])).toEqual(free([3, 1.01], 0, 'w_south'));
  });

  test('клик мимо конца стены прижимает объект к её концу, а не к бесконечной прямой', () => {
    // Перегородка персонала кончается на x = 9,3; клик правее и выше неё.
    const placement = place([10, 7.4], CAMERA_SIZE, [wall('w_staff', [6, 7], [9.3, 7])]);

    expect(placement).toEqual(attached([9.3, 7.2], 0, 'w_staff'));
  });

  test('клик снаружи всё равно ставит объект внутрь помещения', () => {
    expect(place([3, -0.5])).toEqual(attached([3, 0.2], 0, 'w_south'));
  });

  test('клик точно по оси стены не оставляет объект без стороны', () => {
    expect(place([3, 0])).toEqual(attached([3, 0.2], 0, 'w_south'));
  });

  test('обе стороны стены вне помещения — сторона клика остаётся за кликом', () => {
    // Стена в стороне от контура: разворачивать «внутрь» нечего, и объект не
    // должен прыгать на другую её сторону.
    const outside = [wall('w_far', [20, 0], [20, 10])];
    expect(place([19.5, 5], CAMERA_SIZE, outside)).toEqual(attached([19.8, 5], 270, 'w_far'));
    expect(place([20.5, 5], CAMERA_SIZE, outside)).toEqual(attached([20.2, 5], 90, 'w_far'));
  });

  test('без стен постановка ничего не предлагает', () => {
    expect(wallMountPlacement([], BOUNDARY, CAMERA_SIZE, [3, 3])).toBeNull();
    // Вырожденная стена нулевой длины стороны не задаёт и в расчёт не идёт.
    expect(wallMountPlacement([wall('w_dot', [2, 2], [2, 2])], BOUNDARY, CAMERA_SIZE, [3, 3])).toBeNull();
  });
});

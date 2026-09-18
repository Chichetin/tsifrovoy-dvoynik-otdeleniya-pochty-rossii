/**
 * U03 (создание): проверки новой перегородки и нового проёма.
 *
 * Главное здесь — отказы. Стена нулевой длины и проём, поставленный мимо стены,
 * схему проходят, но в редакторе выглядят как исчезнувший клик: пользователь
 * think что поставил, а в плане ничего нет.
 */

import { describe, expect, test } from 'vitest';
import type { Opening, Room, Wall } from '../../contracts/model';
import {
  MIN_WALL_LENGTH_M,
  OPENING_DEFAULTS,
  OPENING_HIT_RADIUS_M,
  WALL_DEFAULTS,
  createOpening,
  createWall,
  nearestWall,
} from './wall-draft';

const room: Room = {
  id: 'room_main',
  boundary: [
    [0, 0],
    [12, 0],
    [12, 9],
    [0, 9],
  ],
  ceilingHeight_m: 3,
};

function wall(id: string, from: [number, number], to: [number, number]): Wall {
  return { id, from, to, thickness_m: 0.25, height_m: 3 };
}

describe('перегородка по двум точкам', () => {
  test('концы притянуты к сетке, высота — от потолка помещения', () => {
    // Сетка — 1 см, та же, что у вершин контуров.
    const created = createWall([3.024, 1.996], [3.017, 6.013], room, new Set());

    expect(created).not.toBeNull();
    expect(created?.from).toEqual([3.02, 2]);
    expect(created?.to).toEqual([3.02, 6.01]);
    expect(created?.height_m).toBe(room.ceilingHeight_m);
    expect(created?.thickness_m).toBe(WALL_DEFAULTS.partitionThickness_m);
  });

  test('перегородка тоньше наружной стены нового плана', () => {
    expect(WALL_DEFAULTS.partitionThickness_m).toBeLessThan(0.25);
  });

  test('промах мышью не создаёт невидимую стену', () => {
    expect(createWall([4, 4], [4, 4], room, new Set())).toBeNull();
    expect(createWall([4, 4], [4, 4 + MIN_WALL_LENGTH_M / 2], room, new Set())).toBeNull();
  });

  test('идентификатор не занимает уже существующий', () => {
    const created = createWall([1, 1], [1, 5], room, new Set(['w_1', 'w_2']));
    expect(created?.id).toBe('w_3');
  });

  test('высота берётся у помещения, а не из константы', () => {
    const tall = createWall([1, 1], [1, 5], { ...room, ceilingHeight_m: 4.2 }, new Set());
    expect(tall?.height_m).toBe(4.2);
  });
});

describe('какая стена под курсором', () => {
  const walls = [wall('w_north', [0, 9], [12, 9]), wall('w_inner', [6, 0], [6, 5])];

  test('клик у стены находит её', () => {
    const hit = nearestWall(walls, [6.1, 2]);
    expect(hit?.wall.id).toBe('w_inner');
    expect(hit?.distance_m).toBeCloseTo(0.1, 9);
  });

  test('из двух стен выбирается ближняя', () => {
    const crossing = [wall('w_a', [0, 4], [12, 4]), wall('w_b', [0, 4.3], [12, 4.3])];
    expect(nearestWall(crossing, [5, 4.25])?.wall.id).toBe('w_b');
  });

  test('клик в пустоту не попадает ни в какую стену', () => {
    expect(nearestWall(walls, [3, 3])).toBeNull();
  });

  test('за концом стены её продолжение не считается стеной', () => {
    // w_inner идёт до y = 5; точка (6, 8) лежит на его продолжении.
    expect(nearestWall(walls, [6, 8])).toBeNull();
  });

  test('граница попадания — объявленный радиус', () => {
    expect(nearestWall(walls, [6 + OPENING_HIT_RADIUS_M - 0.01, 2])).not.toBeNull();
    expect(nearestWall(walls, [6 + OPENING_HIT_RADIUS_M + 0.01, 2])).toBeNull();
  });
});

describe('проём на стене', () => {
  const north = wall('w_north', [0, 9], [12, 9]);

  test('дверь встаёт по клику и держится в пределах стены', () => {
    const opening = createOpening(north, [4, 9], 'door', new Set());

    expect(opening).not.toBeNull();
    expect(opening?.wallId).toBe('w_north');
    expect(opening?.kind).toBe('door');
    expect(opening?.width_m).toBe(OPENING_DEFAULTS.door.width_m);
    // Центр проёма приходится на точку клика.
    expect((opening as Opening).offset_m + (opening as Opening).width_m / 2).toBeCloseTo(4, 1);
  });

  test('клик у самого края не выпускает проём за стену', () => {
    const atEdge = createOpening(north, [0, 9], 'door', new Set());
    expect(atEdge?.offset_m).toBe(0);

    const atEnd = createOpening(north, [12, 9], 'door', new Set());
    const end = (atEnd as Opening).offset_m + (atEnd as Opening).width_m;
    expect(end).toBeLessThanOrEqual(12);
  });

  test('окно приходит со своим подоконником, дверь — без', () => {
    expect(createOpening(north, [4, 9], 'window', new Set())?.sill_m).toBe(
      OPENING_DEFAULTS.window.sill_m,
    );
    expect(createOpening(north, [4, 9], 'door', new Set())?.sill_m).toBe(0);
    expect(OPENING_DEFAULTS.window.sill_m).toBeGreaterThan(0);
  });

  test('вход шире двери', () => {
    expect(OPENING_DEFAULTS.entrance.width_m).toBeGreaterThan(OPENING_DEFAULTS.door.width_m);
  });

  test('в стену короче проёма проём не ставится', () => {
    const stub = wall('w_stub', [0, 0], [0.5, 0]);
    expect(createOpening(stub, [0.25, 0], 'door', new Set())).toBeNull();
  });

  test('идентификатор не занимает уже существующий', () => {
    expect(createOpening(north, [4, 9], 'door', new Set(['op_1']))?.id).toBe('op_2');
  });
});

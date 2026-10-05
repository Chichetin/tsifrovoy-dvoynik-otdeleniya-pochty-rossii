/**
 * IO02 acceptance: the organizers' example opens in our editor without being
 * corrected and without being altered on disk.
 *
 * The numbers pinned here come from `example_plan.json` itself — 78 m² of room,
 * four zones of 56.25 / 21.75 / 10 / 8.75 m². The collisions listed in
 * CLAUDE.md are pinned too, with the opposite expectation: they must survive
 * the import, because they are the test set for the correctness checks.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Equipment, Issue, PlanDocument, Zone } from '../contracts/model';
import { objectsShareSpace, polygonArea } from '../domain/geometry';
import { decodePlan, encodePlan } from './codec';
import { importOrganizerExample } from './organizer-import';

const EXAMPLE_PATH = join(process.cwd(), 'example_plan.json');

function exampleText(): string {
  return readFileSync(EXAMPLE_PATH, 'utf8');
}

function codesOf(issues: Issue[]): string[] {
  return issues.map((entry) => entry.code);
}

function imported(): PlanDocument {
  const result = importOrganizerExample(JSON.parse(exampleText()) as unknown);
  if (!result.ok) throw new Error(`импорт не прошёл: ${codesOf(result.issues).join(', ')}`);
  return result.value;
}

function zoneById(plan: PlanDocument, id: string): Zone {
  const zone = plan.zones.find((entry) => entry.id === id);
  if (zone === undefined) throw new Error(`нет зоны ${id}`);
  return zone;
}

function objectById(plan: PlanDocument, id: string): Equipment {
  const object = plan.objects.find((entry) => entry.id === id);
  if (object === undefined) throw new Error(`нет объекта ${id}`);
  return object;
}

function importNote(plan: PlanDocument): Record<string, unknown> {
  return plan.extensions['organizer-import'] as Record<string, unknown>;
}

describe('пример организаторов остаётся нетронутым', () => {
  test('файл на диске не переписывается импортом', () => {
    const before = exampleText();
    imported();
    expect(exampleText()).toBe(before);
  });

  test('переданный объект не мутируется', () => {
    const input = JSON.parse(exampleText()) as unknown;
    const snapshot = JSON.stringify(input);
    importOrganizerExample(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('геометрия примера переносится как есть', () => {
  test('помещение 78 м² при потолке 3 м', () => {
    const plan = imported();
    expect(polygonArea(plan.room.boundary)).toBeCloseTo(78, 10);
    expect(plan.room.ceilingHeight_m).toBe(3);
  });

  test('четыре зоны с площадями из примера', () => {
    const plan = imported();
    const areas = Object.fromEntries(
      plan.zones.map((zone) => [zone.id, polygonArea(zone.polygon)]),
    );
    expect(areas).toEqual({
      z_client: 56.25,
      z_back: 21.75,
      z_waiting: 10,
      z_queue: 8.75,
    });
  });

  test('вложенность зон восстановлена по геометрии', () => {
    const plan = imported();
    expect(zoneById(plan, 'z_client').parentId).toBeNull();
    expect(zoneById(plan, 'z_back').parentId).toBeNull();
    expect(zoneById(plan, 'z_waiting').parentId).toBe('z_client');
    expect(zoneById(plan, 'z_queue').parentId).toBe('z_client');
  });

  test('идентификаторы и подписи сохранены', () => {
    const plan = imported();
    expect(plan.zones.map((zone) => zone.id)).toEqual([
      'z_client',
      'z_back',
      'z_waiting',
      'z_queue',
    ]);
    expect(plan.objects).toHaveLength(12);
    expect(objectById(plan, 'eq_cashier_1').label).toBe('Окно кассы №1');
    expect(objectById(plan, 'eq_atm').rotation_deg).toBe(90);
  });
});

describe('стены и проёмы связаны', () => {
  test('каждый проём сидит на своей стене с вычисленным отступом', () => {
    const plan = imported();
    const openings = Object.fromEntries(
      plan.openings.map((opening) => [
        opening.id,
        { wallId: opening.wallId, offset_m: opening.offset_m, width_m: opening.width_m, kind: opening.kind },
      ]),
    );

    expect(openings).toEqual({
      // w_outer_n идёт справа налево, поэтому отступ входа считается от x = 10.4.
      d_main: { wallId: 'w_outer_n', offset_m: 8.9, width_m: 1.5, kind: 'entrance' },
      d_staff: { wallId: 'w_outer_e', offset_m: 5.5, width_m: 1, kind: 'door' },
      d_partition: { wallId: 'w_inner_1', offset_m: 4, width_m: 1, kind: 'door' },
      win_1: { wallId: 'w_outer_n', offset_m: 5.4, width_m: 2, kind: 'window' },
      win_2: { wallId: 'w_outer_e', offset_m: 1, width_m: 2, kind: 'window' },
    });
  });

  test('проём вне стен — отказ импорта, а не тихо потерянная дверь', () => {
    const source = JSON.parse(exampleText()) as { doors: { wall: number[] }[] };
    source.doors[0]!.wall = [100, 100, 101, 100];

    const result = importOrganizerExample(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result.issues)).toContain('OPENING_WITHOUT_WALL');
  });
});

describe('допущения подписаны', () => {
  test('толщина стены — допущение команды, а не число из примера', () => {
    const plan = imported();
    const thickness = Object.fromEntries(
      plan.walls.map((wall) => [wall.id, wall.thickness_m]),
    );
    expect(thickness).toEqual({
      w_outer_s: 0.25,
      w_outer_e: 0.25,
      w_outer_n: 0.25,
      w_outer_w: 0.25,
      w_inner_1: 0.1,
    });

    const assumptions = importNote(plan).assumptions as string[];
    expect(assumptions.some((line) => line.includes('Толщина наружной стены 0.25'))).toBe(true);
    expect(assumptions.some((line) => line.includes('перегородки 0.1'))).toBe(true);
    expect(exampleText()).not.toContain('thickness');
  });

  test('каждое допущение названо допущением команды', () => {
    const assumptions = importNote(imported()).assumptions as string[];
    expect(assumptions.length).toBeGreaterThanOrEqual(5);
    for (const line of assumptions) expect(line.length).toBeGreaterThan(20);
  });
});

describe('ошибки примера не исправляются импортом', () => {
  test('три исходные коллизии остаются коллизиями', () => {
    const plan = imported();
    const collisions: [string, string][] = [
      ['eq_cashier_1', 'eq_rack_1'],
      ['eq_cashier_2', 'eq_rack_2'],
      ['eq_atm', 'eq_bench_1'],
    ];

    for (const [left, right] of collisions) {
      expect(objectsShareSpace(objectById(plan, left), objectById(plan, right))).toBe(true);
    }
  });

  test('связь стеллажей с зоной сохранена, хотя геометрия ей противоречит', () => {
    const plan = imported();
    expect(objectById(plan, 'eq_rack_1').zoneId).toBe('z_back');
    expect(objectById(plan, 'eq_rack_2').zoneId).toBe('z_back');
    // Стеллаж заходит за перегородку x = 7.5 — это и есть ошибка примера.
    expect(objectById(plan, 'eq_rack_1').position[0] - objectById(plan, 'eq_rack_1').size_m[0] / 2)
      .toBeLessThan(7.5);
  });
});

describe('ничего не теряется', () => {
  test('неизвестные поля уходят в extensions', () => {
    const note = importNote(imported());
    const rest = note.rest as Record<string, unknown>;
    expect(Object.keys(rest)).toEqual(
      expect.arrayContaining(['_comment', 'flow_hints', '_format_notes']),
    );

    const objects = note.objects as Record<string, Record<string, unknown>>;
    expect(objects.eq_cashier_1).toEqual({ operator_position: [6.5, 0.5] });

    const zones = note.zones as Record<string, Record<string, unknown>>;
    expect(zones.z_client).toEqual({ area_sqm: 56.25 });

    const walls = note.walls as Record<string, Record<string, unknown>>;
    expect(walls.w_inner_1).toEqual({
      type: 'partition',
      label: 'Перегородка клиентская/служебная',
    });
  });

  test('скалярные поля сущности становятся атрибутами', () => {
    const plan = imported();
    expect(objectById(plan, 'eq_bench_1').attributes).toEqual({ capacity_persons: 4 });
    expect(zoneById(plan, 'z_waiting').attributes).toEqual({ expected_capacity_persons: 8 });
  });

  test('справочник покрывает и использованные, и только объявленные типы', () => {
    const plan = imported();
    const ids = new Set(plan.catalog.objectTypes.map((type) => type.id));

    for (const used of ['ot_cashier_window', 'ot_queue_terminal', 'ot_parcel_rack', 'ot_workplace']) {
      expect(ids.has(used)).toBe(true);
    }
    // Объявлены в equipment_types_catalog, но в плане не встречаются.
    for (const announced of ['ot_fitting_room', 'ot_trash_bin', 'ot_potted_plant']) {
      expect(ids.has(announced)).toBe(true);
    }
    for (const type of plan.catalog.objectTypes) {
      expect(type.provenance).toContain('Допущение команды');
    }

    const usedTypeIds = new Set(plan.objects.map((object) => object.typeId));
    for (const typeId of usedTypeIds) expect(ids.has(typeId)).toBe(true);
  });
});

describe('импортированный план живёт в нашем формате', () => {
  test('сохраняется и открывается заново без изменений', () => {
    const plan = imported();
    const saved = encodePlan(plan);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const reopened = decodePlan(saved.value);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toEqual(plan);
  });

  test('не тот формат — отказ с объяснением, а не пустой план', () => {
    const result = importOrganizerExample({ hello: 'world' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(codesOf(result.issues))).toEqual(new Set(['ORGANIZER_UNREADABLE']));
  });
});

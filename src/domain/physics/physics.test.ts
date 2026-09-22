/**
 * D-282: правила физики. Проверяется и сам набор (четыре правила, каждое со
 * своим кодом), и два его применения — находки об одном объекте и отказ
 * команде, которая создаёт новое нарушение.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Equipment, PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { validatePlan, VALIDATION_ISSUE_CODES } from '../validation';
import {
  PHYSICS_ISSUE_CODES,
  PHYSICS_RULES,
  objectPhysicsIssues,
  physicsIssues,
  physicsRejection,
} from './index';

function minimalPlan(): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', 'minimal.json');
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error('fixture minimal.json не проходит схему');
  return parsed.value;
}

/** Ещё одно рабочее место: типы в фикстуре только такие, и они физические. */
function desk(id: string, patch: Partial<Equipment> = {}): Equipment {
  return {
    id,
    typeId: 'ot_workplace',
    label: id,
    position: [5, 5],
    size_m: [1.4, 0.8],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.75,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
    ...patch,
  };
}

function withObjects(plan: PlanDocument, ...objects: Equipment[]): PlanDocument {
  return { ...plan, objects: [...plan.objects, ...objects] };
}

function codes(plan: PlanDocument, object: Equipment): string[] {
  return objectPhysicsIssues(plan, object).map((entry) => entry.code);
}

describe('набор правил', () => {
  test('четыре правила, у каждого свой код', () => {
    expect(PHYSICS_RULES).toHaveLength(4);
    expect(new Set(PHYSICS_RULES.map((rule) => rule.code)).size).toBe(4);
    expect(new Set(PHYSICS_RULES.map((rule) => rule.id)).size).toBe(4);
  });

  test('коды правил — это коды находок проверки плана', () => {
    const known = new Set<string>(Object.values(VALIDATION_ISSUE_CODES));
    for (const rule of PHYSICS_RULES) expect(known.has(rule.code)).toBe(true);
  });

  test('физика отделяется от правил комплектования', () => {
    const plan = minimalPlan();
    const kept = physicsIssues([
      { code: VALIDATION_ISSUE_CODES.OBJECT_COLLISION, severity: 'error', message: '', refs: [] },
      { code: VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN, severity: 'warning', message: '', refs: [] },
    ]);
    expect(kept.map((entry) => entry.code)).toEqual([VALIDATION_ISSUE_CODES.OBJECT_COLLISION]);
    expect(PHYSICS_ISSUE_CODES.has(VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN)).toBe(false);
    // Чистый план физику не нарушает.
    expect(physicsIssues(validatePlan(plan))).toEqual([]);
  });
});

describe('находки об одном объекте', () => {
  test('стул на столе — коллизия, камера под потолком над столом — нет', () => {
    const plan = minimalPlan();
    const table = plan.objects[0]!;

    const chair = desk('eq_chair', { position: table.position, height_m: 0.9 });
    expect(codes(withObjects(plan, chair), chair)).toEqual([
      VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
    ]);

    const camera = desk('eq_camera', { position: table.position, base_m: 2.6, height_m: 0.2 });
    expect(codes(withObjects(plan, camera), camera)).toEqual([]);
  });

  test('вывеска выше потолка', () => {
    const plan = minimalPlan();
    const sign = desk('eq_sign', { position: [8, 6], base_m: 2.8, height_m: 0.4 });
    const found = objectPhysicsIssues(withObjects(plan, sign), sign);
    expect(found.map((entry) => entry.code)).toEqual([
      VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING,
    ]);
    expect(found[0]!.message).toContain('выше потолка');
    // Ровно под потолком — не нарушение.
    const flush = desk('eq_flush', { position: [8, 6], base_m: 2.6, height_m: 0.4 });
    expect(codes(withObjects(plan, flush), flush)).toEqual([]);
  });

  test('объект за границей помещения и объект в стене', () => {
    const plan = minimalPlan();

    const outside = desk('eq_outside', { position: [11, 4] });
    expect(codes(withObjects(plan, outside), outside)).toContain(
      VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM,
    );

    // Стена `w_north` идёт по y = 8 и имеет толщину 0,2 м.
    const inWall = desk('eq_in_wall', { position: [2, 8] });
    expect(codes(withObjects(plan, inWall), inWall)).toContain(
      VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
    );
  });

  test('те же находки, что у проверки всего плана', () => {
    const plan = minimalPlan();
    const chair = desk('eq_chair', { position: plan.objects[0]!.position, height_m: 0.9 });
    const withChair = withObjects(plan, chair);
    const key = (entry: { code: string; refs: { id: string }[] }): string =>
      `${entry.code}|${[...entry.refs.map((ref) => ref.id)].sort().join(',')}`;
    // Порядок участников свой: жест называет первым тот объект, который
    // только что тронули, панель проверки — тот, что раньше в списке.
    expect(objectPhysicsIssues(withChair, chair).map(key)).toEqual(
      physicsIssues(validatePlan(withChair)).map(key),
    );
  });
});

describe('отказ команде', () => {
  test('новая коллизия — отказ, с названиями обоих объектов', () => {
    const plan = minimalPlan();
    const chair = desk('eq_chair', { position: plan.objects[0]!.position, height_m: 0.9 });
    const refused = physicsRejection(plan, withObjects(plan, chair), ['eq_chair']);
    expect(refused?.code).toBe(VALIDATION_ISSUE_CODES.OBJECT_COLLISION);
    expect(refused?.message).toContain('eq_chair');
    expect(refused?.refs.map((ref) => ref.id)).toContain('eq_work_1');
  });

  test('правка без нового нарушения проходит', () => {
    const plan = minimalPlan();
    const free = desk('eq_free', { position: [5, 3] });
    expect(physicsRejection(plan, withObjects(plan, free), ['eq_free'])).toBeNull();
    expect(physicsRejection(plan, plan, [])).toBeNull();
  });

  test('уже нарушающий объект остаётся передвигаемым', () => {
    const plan = minimalPlan();
    // Стеллаж, который принесли файлом уже в стене: своё нарушение он сохраняет.
    const stuck = desk('eq_stuck', { position: [2, 8] });
    const before = withObjects(plan, stuck);
    expect(objectPhysicsIssues(before, stuck)).not.toEqual([]);

    const movedAlongWall = { ...stuck, position: [5, 8] } as Equipment;
    const after = { ...before, objects: [plan.objects[0]!, movedAlongWall] };
    expect(physicsRejection(before, after, ['eq_stuck'])).toBeNull();

    // А вот задвинуть его вдобавок в стол уже нельзя.
    const intoDesk = { ...stuck, position: plan.objects[0]!.position } as Equipment;
    const wrong = { ...before, objects: [plan.objects[0]!, intoDesk] };
    expect(physicsRejection(before, wrong, ['eq_stuck'])?.code).toBe(
      VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
    );
  });

  test('удалённый объект отказа не даёт', () => {
    const plan = minimalPlan();
    expect(physicsRejection(plan, plan, ['eq_missing'])).toBeNull();
  });
});

describe('что сторожит жест, а что только сохранение (D-282)', () => {
  test('стена и граница помещения жест не останавливают, но находками остаются', () => {
    const plan = minimalPlan();
    const inWall = desk('eq_in_wall', { position: [2, 8] });
    const outside = desk('eq_outside', { position: [11, 4] });
    const after = withObjects(plan, inWall, outside);

    expect(physicsRejection(plan, after, ['eq_in_wall', 'eq_outside'])).toBeNull();
    expect(codes(after, inWall)).toContain(VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL);
    expect(codes(after, outside)).toContain(VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM);
    // Сохранение о них знает: гейт файла считает все четыре правила.
    expect(physicsIssues(validatePlan(after)).map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
        VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM,
      ]),
    );
  });
});

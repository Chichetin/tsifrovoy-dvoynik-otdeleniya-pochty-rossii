/**
 * The organizers' example as our test set for the correctness checks.
 *
 * CLAUDE.md lists exactly what is wrong with `example_plan.json`: three pairs
 * of overlapping objects, two racks that cross the partition and stick out of
 * their zone, and a queue terminal about seven metres from the entrance where
 * the equipment list says three. This test pins every one of them — and pins
 * that fixing one of them removes that code and nothing else.
 *
 * It lives in `tests/` rather than next to the validator because it needs both
 * halves at once: the importer from `src/persistence` and the checks from
 * `src/domain`, which are not allowed to import each other.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Catalog, Issue, PlanDocument } from '../src/contracts/model';
import { parseCatalog } from '../src/contracts/schema';
import { applyCommand } from '../src/domain/commands';
import { VALIDATION_ISSUE_CODES, validatePlan } from '../src/domain/validation';
import { importOrganizerExample, withTeamCatalog } from '../src/persistence/organizer-import';

function readJson(...path: string[]): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), ...path), 'utf8')) as unknown;
}

function teamCatalog(): Catalog {
  const parsed = parseCatalog({
    version: '1.0.0',
    objectTypes: readJson('data', 'catalog', 'object-types.json'),
    zoneTypes: readJson('data', 'catalog', 'zone-types.json'),
    layerTypes: readJson('data', 'catalog', 'layer-types.json'),
    rules: readJson('data', 'catalog', 'rules.json'),
  });
  if (!parsed.ok) throw new Error('справочник команды не разобрался');
  return parsed.value;
}

/**
 * The import brings the example's own types but no stocking rules (D-025):
 * the rules come from the team catalog through `withTeamCatalog` — the same
 * path the editor takes when it opens the example.
 */
function examplePlanWithTeamRules(): PlanDocument {
  const importResult = importOrganizerExample(readJson('example_plan.json'));
  if (!importResult.ok) throw new Error('пример не импортировался');
  const merged = withTeamCatalog(importResult.value, teamCatalog());
  if (!merged.ok) {
    throw new Error(`справочники не сомкнулись: ${merged.issues.map((i) => i.code).join(', ')}`);
  }
  return merged.value;
}

function pairsOf(issues: Issue[], code: string): string[][] {
  return issues
    .filter((entry) => entry.code === code)
    .map((entry) => entry.refs.map((ref) => ref.id).sort());
}

function idsOf(issues: Issue[], code: string): string[] {
  return issues
    .filter((entry) => entry.code === code)
    .flatMap((entry) => entry.refs.filter((ref) => ref.kind === 'object').map((ref) => ref.id));
}

const plan = examplePlanWithTeamRules();
const issues = validatePlan(plan);

describe('слияние со справочником команды', () => {
  test('типы примера остаются, наши правила и слои приходят, повторное слияние ничего не дублирует', () => {
    const team = teamCatalog();
    const importResult = importOrganizerExample(readJson('example_plan.json'));
    if (!importResult.ok) throw new Error('пример не импортировался');
    const exampleOnly = importResult.value.catalog.objectTypes
      .map((type) => type.id)
      .filter((id) => !team.objectTypes.some((type) => type.id === id));
    expect(exampleOnly.length).toBeGreaterThan(0);

    const ids = plan.catalog.objectTypes.map((type) => type.id);
    for (const id of exampleOnly) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.catalog.rules.length).toBe(team.rules.length);
    expect(plan.layers.filter((layer) => layer.typeId !== null).map((layer) => layer.typeId)).toEqual(
      team.layerTypes.map((type) => type.id),
    );
    // Every object still resolves to a type after the merge.
    for (const object of plan.objects) expect(ids).toContain(object.typeId);

    const again = withTeamCatalog(plan, team);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.layers.length).toBe(plan.layers.length);
  });
});

describe('известные ошибки примера находятся', () => {
  test('три пары пересекающихся объектов', () => {
    expect(pairsOf(issues, VALIDATION_ISSUE_CODES.OBJECT_COLLISION)).toEqual(
      expect.arrayContaining([
        ['eq_cashier_1', 'eq_rack_1'],
        ['eq_cashier_2', 'eq_rack_2'],
        ['eq_atm', 'eq_bench_1'],
      ]),
    );
  });

  test('стеллажи пересекают перегородку x = 7.5', () => {
    const hits = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
    );
    const racks = hits.filter((entry) =>
      entry.refs.some((ref) => ref.id === 'eq_rack_1' || ref.id === 'eq_rack_2'),
    );

    expect(racks).toHaveLength(2);
    for (const entry of racks) {
      expect(entry.refs.map((ref) => ref.id)).toContain('w_inner_1');
    }
  });

  test('стеллажи не лежат целиком в своей зоне', () => {
    expect(idsOf(issues, VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE)).toEqual(
      expect.arrayContaining(['eq_rack_1', 'eq_rack_2']),
    );
  });

  test('терминал очереди дальше 3 м от входа', () => {
    const far = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE,
    );

    expect(idsOf(far, VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE)).toEqual(['eq_kiosk']);
    // Вход d_main занимает 1.5 м стены; расстояние меряется до его середины
    // (0.75, 7.5), а не до края — от терминала в (0.6, 0.6) это 6.90 м.
    const message = far[0]?.message ?? '';
    expect(message).toContain('6.90 м от входа «d_main»');
    expect(message).toContain('материалы организаторов');
  });

  test('правило организаторов — ошибка, правило команды — предупреждение', () => {
    const organizer = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE,
    );
    const team = issues.filter(
      (entry) => entry.code === VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN,
    );

    for (const entry of organizer) expect(entry.severity).toBe('error');
    for (const entry of team) {
      expect(entry.severity).toBe('warning');
      expect(entry.message).toContain('допущение команды, не норматив Почты');
    }
  });

  test('каждая находка показывается на плане и называет свои id', () => {
    for (const entry of issues) {
      expect(entry.refs.length).toBeGreaterThan(0);
      if (entry.code === VALIDATION_ISSUE_CODES.RULE_ENTRANCE_MISSING) continue;
      expect(entry.polygon?.length ?? 0).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('исправление снимает ровно свой код', () => {
  test('отодвинутый стеллаж перестаёт пересекать и стену, и кассу', () => {
    const rack = plan.objects.find((object) => object.id === 'eq_rack_1');
    if (rack === undefined) throw new Error('нет eq_rack_1');

    const fixed = applyCommand(plan, {
      type: 'object.put',
      // Ширина 2 м: центр на 8.6 уводит левый край на 7.6 — за перегородку,
      // а подъём по Y выводит стеллаж из-под сейфа в углу.
      object: { ...rack, position: [8.6, 1.6] },
    });
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;

    const after = validatePlan(fixed.value);
    const mentionsRack = (entry: Issue): boolean =>
      entry.refs.some((ref) => ref.id === 'eq_rack_1');

    expect(after.filter(mentionsRack).map((entry) => entry.code)).toEqual([]);
    // Вторая пара и терминал никуда не делись.
    expect(pairsOf(after, VALIDATION_ISSUE_CODES.OBJECT_COLLISION)).toEqual(
      expect.arrayContaining([['eq_cashier_2', 'eq_rack_2']]),
    );
    expect(idsOf(after, VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE)).toEqual(['eq_kiosk']);
  });

  test('терминал у входа снимает нарушение расстояния', () => {
    const kiosk = plan.objects.find((object) => object.id === 'eq_kiosk');
    if (kiosk === undefined) throw new Error('нет eq_kiosk');

    const fixed = applyCommand(plan, {
      type: 'object.put',
      // Вход d_main — в точке (0.75, 7.5) на северной стене.
      object: { ...kiosk, position: [1.5, 6.8] },
    });
    expect(fixed.ok).toBe(true);
    if (!fixed.ok) return;

    expect(idsOf(validatePlan(fixed.value), VALIDATION_ISSUE_CODES.RULE_TOO_FAR_FROM_ENTRANCE))
      .toEqual([]);
  });
});

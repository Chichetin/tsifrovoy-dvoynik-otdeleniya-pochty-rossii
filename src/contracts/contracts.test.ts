/**
 * F02 acceptance: the contracts freeze. These tests pin the behaviour other
 * packages are allowed to rely on — what the schema accepts, what it refuses
 * with which code, and which explanations the semantic table permits.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ReasonCode } from './advice';
import {
  INTEGER_METRICS,
  METRIC_UNITS,
  REASON_CODES,
  REASON_CODE_SPECS,
  reasonCodesForScenario,
} from './advice-semantics';
import {
  CONTRACT_ISSUE_CODES,
  LIMITS,
  SCHEMA_VERSION,
  type Issue,
  type PlanDocument,
} from './model';
import { parsePlanDocument } from './schema';

function loadFixture(name: string): unknown {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function loadPlan(name: string): Record<string, unknown> {
  return loadFixture(name) as Record<string, unknown>;
}

function codesOf(issues: Issue[]): string[] {
  return issues.map((entry) => entry.code);
}

function expectRefused(input: unknown): Issue[] {
  const result = parsePlanDocument(input);
  if (result.ok) throw new Error('Документ принят, хотя должен был быть отклонён.');
  return result.issues;
}

function expectAccepted(input: unknown): PlanDocument {
  const result = parsePlanDocument(input);
  if (!result.ok) {
    throw new Error(`Документ отклонён кодами: ${codesOf(result.issues).join(', ')}`);
  }
  return result.value;
}

describe('schema: приём корректного документа', () => {
  test('minimal.json проходит и сохраняет поля', () => {
    const plan = expectAccepted(loadFixture('minimal.json'));
    expect(plan.schemaVersion).toBe(SCHEMA_VERSION);
    expect(plan.objects).toHaveLength(1);
    expect(plan.objects[0]?.zoneId).toBe('z_client');
    expect(plan.objects[0]?.attributes['inventoryNumber']).toBe('ОПС-0001');
    expect(plan.catalog.objectTypes[0]?.id).toBe('ot_workplace');
  });

  test('nested.json: вложенная зона сохраняет parentId', () => {
    const plan = expectAccepted(loadFixture('nested.json'));
    const waiting = plan.zones.find((zone) => zone.id === 'z_waiting');
    expect(waiting?.parentId).toBe('z_client');
    expect(plan.zones.filter((zone) => zone.parentId === null)).toHaveLength(2);
  });

  test('rotated.json: поворот 90° и несимметричный размер переживают разбор', () => {
    const plan = expectAccepted(loadFixture('rotated.json'));
    const rack = plan.objects[0];
    expect(rack?.rotation_deg).toBe(90);
    expect(rack?.size_m).toEqual([2, 0.6]);
  });

  test('collision.json: геометрически неверный, но структурно целый план открывается для исправления', () => {
    const plan = expectAccepted(loadFixture('collision.json'));
    expect(plan.objects).toHaveLength(3);
    expect(plan.objects.some((object) => object.id === 'eq_outside')).toBe(true);
  });
});

describe('schema: точные коды отказа', () => {
  test('дубликат идентификатора и сломанные ссылки названы поимённо', () => {
    const issues = expectRefused(loadFixture('invalid-links.json'));
    expect(codesOf(issues)).toContain(CONTRACT_ISSUE_CODES.DUPLICATE_ID);
    expect(codesOf(issues)).toContain(CONTRACT_ISSUE_CODES.BROKEN_REF);

    const duplicate = issues.find(
      (entry) => entry.code === CONTRACT_ISSUE_CODES.DUPLICATE_ID,
    );
    expect(duplicate?.refs.map((ref) => ref.id)).toEqual(['eq_work_1', 'eq_work_1']);

    const brokenLayer = issues.find((entry) => entry.path === 'objects.2.layerId');
    expect(brokenLayer?.code).toBe(CONTRACT_ISSUE_CODES.BROKEN_REF);
    expect(brokenLayer?.message).toContain('l_missing');
  });

  test('цикл parentId обнаруживается и перечисляет участников', () => {
    const issues = expectRefused(loadFixture('invalid-links.json'));
    const cycle = issues.find(
      (entry) => entry.code === CONTRACT_ISSUE_CODES.ZONE_CYCLE,
    );
    expect(cycle).toBeDefined();
    expect(cycle?.refs.map((ref) => ref.id).sort()).toEqual(['z_loop_a', 'z_loop_b']);
  });

  test('future-version.json отклоняется отдельным кодом, а не как поломка схемы', () => {
    const issues = expectRefused(loadFixture('future-version.json'));
    expect(codesOf(issues)).toEqual([CONTRACT_ISSUE_CODES.FUTURE_VERSION]);
    expect(issues[0]?.path).toBe('schemaVersion');
  });

  test('NaN в числовом поле не проходит', () => {
    const plan = loadPlan('minimal.json');
    (plan['room'] as Record<string, unknown>)['ceilingHeight_m'] = Number.NaN;
    const issues = expectRefused(plan);
    expect(codesOf(issues)).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    expect(issues.some((entry) => entry.path === 'room.ceilingHeight_m')).toBe(true);
  });

  test('отрицательный размер объекта не проходит', () => {
    const plan = loadPlan('minimal.json');
    const objects = plan['objects'] as Record<string, unknown>[];
    objects[0]!['size_m'] = [-1.4, 0.8];
    const issues = expectRefused(plan);
    expect(issues.some((entry) => entry.path === 'objects.0.size_m.0')).toBe(true);
  });

  test('документ без слоёв отклоняется собственным кодом', () => {
    const plan = loadPlan('minimal.json');
    plan['layers'] = [];
    const issues = expectRefused(plan);
    expect(codesOf(issues)).toContain(CONTRACT_ISSUE_CODES.NO_LAYERS);
  });

  test('нечитаемый ввод не притворяется планом', () => {
    expect(codesOf(expectRefused(null))).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    expect(codesOf(expectRefused('не json'))).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
  });

  test('границы числового атрибута: min ≤ max принимается, min > max отклоняется', () => {
    const plan = loadPlan('minimal.json');
    const zoneTypes = (plan['catalog'] as Record<string, unknown>)['zoneTypes'] as Record<string, unknown>[];
    const load = { key: 'loadPercent', label: 'Загрузка зоны, %', type: 'number', required: false, min: 0, max: 100 };
    zoneTypes[0]!['attributes'] = [load];
    const accepted = expectAccepted(plan);
    expect(accepted.catalog.zoneTypes[0]?.attributes[0]?.max).toBe(100);
    zoneTypes[0]!['attributes'] = [{ ...load, min: 100, max: 0 }];
    expect(codesOf(expectRefused(plan))).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
    zoneTypes[0]!['attributes'] = [{ ...load, type: 'string', min: 0, max: 100 }];
    expect(codesOf(expectRefused(plan))).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
  });

  test('полигон сверх предела вершин отклоняется', () => {
    const plan = loadPlan('minimal.json');
    const boundary = Array.from({ length: LIMITS.maxPolygonVertices + 1 }, (_, i) => [i, 0]);
    (plan['room'] as Record<string, unknown>)['boundary'] = boundary;
    expect(codesOf(expectRefused(plan)).length).toBeGreaterThan(0);
  });
});

describe('семантический словарь объяснений', () => {
  test('каждый код описан под своим ключом и несёт ограничение', () => {
    for (const code of REASON_CODES) {
      const spec = REASON_CODE_SPECS[code];
      expect(spec.code).toBe(code);
      expect(spec.scenarios.length).toBeGreaterThan(0);
      expect(spec.requiredLimitation.length).toBeGreaterThan(0);
      expect(spec.requiresNonZeroDelta && spec.requiresAllDeltaZero).toBe(false);
    }
  });

  test('единицы измерения закреплены за метриками', () => {
    expect(METRIC_UNITS['area.free']).toBe('m2');
    expect(METRIC_UNITS['placement.distance']).toBe('m');
    expect(METRIC_UNITS['equipment.count']).toBe('count');
    expect(Object.keys(METRIC_UNITS)).toHaveLength(11);
    expect(INTEGER_METRICS).toContain('equipment.count');
    expect(INTEGER_METRICS).not.toContain('area.free');
  });

  test('сценарий предлагает только свои коды', () => {
    expect(reasonCodesForScenario('place').sort()).toEqual([
      'placement.available',
      'placement.none',
    ]);
    expect(reasonCodesForScenario('equipment').sort()).toEqual([
      'equipment.excess',
      'equipment.missing',
    ]);
    expect(reasonCodesForScenario('compare').sort()).toEqual([
      'comparison.changed',
      'comparison.unchanged',
    ]);
  });
});

type AdviceCase = {
  name: string;
  expect: 'accept' | 'reject';
  rejectCode?: string;
  recommendations: {
    id: string;
    reasonCodes: ReasonCode[];
    limitations: string[];
    candidates: { id: string }[];
    facts: { id: string; metric: string; phase: string; value: number }[];
  }[];
  explanation: {
    recommendationId: string;
    candidateId: string | null;
    reasonCode: ReasonCode;
    factIds: string[];
  };
};

/**
 * Reference check of the corpus, not the A04 implementation: it proves each
 * fixture case is labelled correctly against the table above.
 */
function admissible(entry: AdviceCase): boolean {
  const { explanation } = entry;
  const recommendation = entry.recommendations.find(
    (item) => item.id === explanation.recommendationId,
  );
  if (recommendation === undefined) return false;
  if (!recommendation.reasonCodes.includes(explanation.reasonCode)) return false;

  const spec = REASON_CODE_SPECS[explanation.reasonCode];
  if (!recommendation.limitations.includes(spec.requiredLimitation)) return false;

  const candidateOk =
    spec.candidate === 'required'
      ? recommendation.candidates.some((item) => item.id === explanation.candidateId)
      : explanation.candidateId === null;
  if (!candidateOk) return false;

  const cited = recommendation.facts.filter((item) =>
    explanation.factIds.includes(item.id),
  );
  if (cited.length !== explanation.factIds.length) return false;

  const covered = spec.requiredFacts.every((required) =>
    cited.some(
      (item) => item.metric === required.metric && item.phase === required.phase,
    ),
  );
  if (!covered) return false;

  const deltas = cited.filter((item) => item.phase === 'delta');
  if (spec.requiresNonZeroDelta && !deltas.some((item) => item.value !== 0)) return false;
  if (spec.requiresAllDeltaZero && deltas.some((item) => item.value !== 0)) return false;
  return true;
}

describe('корпус advice.json', () => {
  const corpus = loadFixture('advice.json') as { cases: AdviceCase[] };

  test('каждый код покрыт принимаемым и отвергаемым случаем', () => {
    for (const code of REASON_CODES) {
      const own = corpus.cases.filter((entry) => entry.explanation.reasonCode === code);
      expect(own.some((entry) => entry.expect === 'accept')).toBe(true);
      expect(own.some((entry) => entry.expect === 'reject')).toBe(true);
    }
  });

  test('разметка корпуса совпадает со словарём', () => {
    for (const entry of corpus.cases) {
      expect({ name: entry.name, admissible: admissible(entry) }).toEqual({
        name: entry.name,
        admissible: entry.expect === 'accept',
      });
    }
  });
});

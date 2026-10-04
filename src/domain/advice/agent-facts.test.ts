import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { collectAgentFacts, renderAgentFact, renderAgentFactSelection } from './agent-facts';
import { createAgentToolState, runAgentTool } from './agent-tools';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(path);
  return parsed.value;
}
const before = load('demo/before.json');
const after = load('demo/after.json');

function overview() {
  const state = createAgentToolState(before, null);
  const output = runAgentTool(state, 'plan_overview', {}).output;
  return { state, output, facts: collectAgentFacts(state, [{ name: 'plan_overview', output }]) };
}

describe('факты чата связаны с метрикой и предметом', () => {
  test('свободная и общая площадь имеют разные ключи и неизменяемые значения', () => {
    const { state, facts } = overview();
    const free = facts.find((f) => f.metric === 'area.free' && f.refs[0]?.kind === 'room')!;
    const total = facts.find((f) => f.metric === 'area.total' && f.refs[0]?.kind === 'room')!;
    expect(free.value).toBe(114.73);
    expect(total.value).toBe(132);
    const result = renderAgentFactSelection({ factIds: [free.id] }, facts, state);
    expect(result).toMatchObject({ ok: true, refs: [{ kind: 'room', id: before.room.id }] });
    if (result.ok) {
      expect(result.text).toContain('Свободная площадь');
      expect(result.text).toContain('114,73 м²');
      expect(result.text).not.toContain('132');
    }
  });

  test.each([
    'Свободная площадь — 132 м².',
    'Свободная площадь — сто тридцать два квадратных метра.',
    'Свободная площадь — 99999 м².',
    { factIds: ['read.0.room.area.free'], value: 132 },
    { factIds: ['read.0.room.area.free'], metric: 'area.total' },
    { factIds: ['read.0.room.area.free'], unit: 'm' },
    { factIds: ['read.0.room.area.free'], phase: 'delta' },
    { factIds: ['read.0.room.area.free'], text: 'свободно сто тридцать два' },
    { factIds: ['read.0.room.area.free'], zoneId: 'z_waiting' },
    { factIds: ['99999'] },
    { factIds: [] },
  ])('подмена или непроверяемая проза отклоняется: %j', (input) => {
    const { state, facts } = overview();
    expect(renderAgentFactSelection(input, facts, state).ok).toBe(false);
  });

  test('значение зоны всегда выводится с её именем и ID', () => {
    const { facts } = overview();
    const zoneFacts = facts.filter((f) => f.metric === 'area.free' && f.refs[0]?.kind === 'zone');
    expect(zoneFacts.length).toBe(before.zones.length);
    for (const fact of zoneFacts) {
      const zone = before.zones.find((z) => z.id === fact.refs[0]!.id)!;
      const rendered = renderAgentFact(fact);
      expect(rendered).toContain(zone.id);
      expect(rendered).toContain(zone.name);
      expect(rendered).toContain(String(fact.value).replace('.', ','));
    }
  });

  test('отрицательная дельта свободной площади не превращается в улучшение', () => {
    const state = createAgentToolState(after, before);
    const output = runAgentTool(state, 'compare_with_original', {}).output;
    const facts = collectAgentFacts(state, [{ name: 'compare_with_original', output }]);
    const delta = facts.find((f) => f.metric === 'area.free' && f.phase === 'delta')!;
    expect(renderAgentFact(facts.find((f) => f.metric === 'placement.distance')!)).toContain('Суммарное перемещение');
    expect(delta.value).toBeCloseTo(-0.8);
    const result = renderAgentFactSelection({ factIds: [delta.id] }, facts, state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('-0,8 м² (изменение)');
      for (const recommendation of state.recommendations.values()) {
        for (const limitation of recommendation.limitations) expect(result.text).toContain(limitation);
      }
    }
  });

  test('комплектование сохраняет тип, зону, правило и его допущения', () => {
    const state = createAgentToolState(before, null);
    const output = runAgentTool(state, 'check_equipment', {}).output;
    const facts = collectAgentFacts(state, [{ name: 'check_equipment', output }]);
    expect(facts.length).toBeGreaterThan(0);
    const fact = facts[0]!;
    const recommendation = state.recommendations.get(fact.recommendationId!)!;
    const result = renderAgentFactSelection({ factIds: [fact.id] }, facts, state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain(recommendation.ruleIds[0]);
      for (const note of [...recommendation.assumptions, ...recommendation.limitations]) expect(result.text).toContain(note);
    }
  });

  test('прогноз площади привязан к конкретному кандидату, без подмены на соседний', () => {
    const state = createAgentToolState(before, null);
    const output = runAgentTool(state, 'find_place', { typeId: 'ot_workplace', zoneId: null }).output;
    const facts = collectAgentFacts(state, [{ name: 'find_place', output }]);
    const recommendation = [...state.recommendations.values()][0]!;
    expect(recommendation.candidates.length).toBeGreaterThan(1);
    for (const candidate of recommendation.candidates) {
      const fact = facts.find((f) => f.candidateId === candidate.id && f.metric === 'area.free' && f.phase === 'after')!;
      expect(fact).toBeDefined();
      expect(fact.value).toBe(candidate.facts.find((f) => f.id === fact.sourceFactId)!.value);
      expect(renderAgentFact(fact)).toContain(candidate.object.label);
      expect(renderAgentFact(fact)).toContain('(стало)');
      expect(renderAgentFactSelection({ factIds: [fact.id], candidateId: recommendation.candidates[0]!.id }, facts, state).ok).toBe(false);
    }
  });

  test('два поиска с одинаковым ID кандидата сохраняют разные расстояния и области', () => {
    const state = createAgentToolState(before, null);
    runAgentTool(state, 'find_place', { typeId: 'ot_workplace', zoneId: null });
    runAgentTool(state, 'find_place', { typeId: 'ot_workplace', zoneId: 'z_client' });
    const facts = collectAgentFacts(state, []);
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
    // The two searches share a candidate id; which one depends on the demo geometry.
    const distances = facts.filter((f) => f.sourceFactId?.endsWith('.placement.distance'));
    const sharedId = distances.find((f) => distances.filter((g) => g.sourceFactId === f.sourceFactId).length === 2)?.sourceFactId;
    const shared = distances.filter((f) => f.sourceFactId === sharedId);
    expect(shared).toHaveLength(2);
    expect(shared[0]!.id).not.toBe(shared[1]!.id);
    expect(shared[0]!.value).not.toBe(shared[1]!.value);
    for (const fact of shared) {
      expect(renderAgentFact(fact)).toContain('до середины ограничивающего прямоугольника');
      const rendered = renderAgentFactSelection({ factIds: [fact.id] }, facts, state);
      expect(rendered.ok).toBe(true);
      if (rendered.ok) expect(rendered.text).toContain(fact.scope);
    }
  });

  test('подсчёт при размещении — по всему плану, а не по области правила комплектования', () => {
    const state = createAgentToolState(before, null);
    runAgentTool(state, 'find_place', { typeId: 'ot_bench', zoneId: null });
    const count = collectAgentFacts(state, []).find((f) => f.metric === 'equipment.count')!;
    expect(count.value).toBe(before.objects.filter((o) => o.typeId === 'ot_bench').length);
    expect(count.scope).toContain('ot_bench');
    expect(count.scope).not.toContain('без вложенных зон');
    expect(count.scope).not.toContain('rule_bench_min');
  });

  test('тип сохраняется при пустом поиске без правила комплектования', () => {
    const oversized = structuredClone(before);
    const type = oversized.catalog.objectTypes.find((t) => t.id === 'ot_workplace')!;
    type.defaultSize_m = [100, 100];
    oversized.catalog.rules = oversized.catalog.rules.filter((r) => r.objectTypeId !== type.id);
    const state = createAgentToolState(oversized, null);
    runAgentTool(state, 'find_place', { typeId: type.id, zoneId: null });
    expect([...state.recommendations.values()][0]!.candidates).toEqual([]);
    const count = collectAgentFacts(state, []).find((f) => f.metric === 'equipment.count')!;
    expect(renderAgentFact(count)).toContain(type.label);
    expect(renderAgentFact(count)).toContain(type.id);
  });

  test('произвольные поля, сообщения ошибок и атрибуты не становятся доказательствами', () => {
    const state = createAgentToolState(before, null);
    const facts = collectAgentFacts(state, [
      { name: 'plan_overview', output: { room: { free_m2: null }, query: '99999', invented: 132 } },
      { name: 'zone_details', output: { error: '132 м²', zoneId: 'z_client', free_m2: 99999 } },
      { name: 'unknown', output: { free_m2: 132 } },
    ]);
    expect(facts).toEqual([]);
  });

  test('прямой и вложенный подсчёт зоны не смешиваются', () => {
    const state = createAgentToolState(before, null);
    const records = [
      { name: 'plan_overview', output: runAgentTool(state, 'plan_overview', {}).output },
      { name: 'zone_details', output: runAgentTool(state, 'zone_details', { zoneId: 'z_client' }).output },
    ];
    const counts = collectAgentFacts(state, records).filter((f) => f.metric === 'equipment.count' && f.refs[0]?.id === 'z_client');
    expect(counts).toHaveLength(2);
    expect(counts[0]!.scope).toContain('включая вложенные');
    expect(counts[1]!.scope).toContain('без вложенных');
  });

  test('список объектов сохраняет фильтр типа и зоны вместо подсчёта всего помещения', () => {
    const state = createAgentToolState(before, null);
    const output = runAgentTool(state, 'list_objects', { typeId: 'ot_workplace', zoneId: 'z_client' }).output;
    const facts = collectAgentFacts(state, [{ name: 'list_objects', output }]);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.value).toBe(before.objects.filter((o) => o.typeId === 'ot_workplace' && o.zoneId === 'z_client').length);
    expect(renderAgentFact(facts[0]!)).toContain('ot_workplace');
    expect(renderAgentFact(facts[0]!)).toContain('z_client');
  });

  test('отсутствие нарушений комплектования — факт области, а не обещание нормативного соответствия', () => {
    const state = createAgentToolState(after, null);
    const output = runAgentTool(state, 'check_equipment', { zoneId: 'z_waiting' }).output;
    const facts = collectAgentFacts(state, [{ name: 'check_equipment', output }]);
    expect(facts[0]).toMatchObject({ metric: 'equipment.violations', value: 0, refs: [{ kind: 'zone', id: 'z_waiting' }] });
    expect(renderAgentFact(facts[0]!)).toContain('проверены правила комплектования');
  });
});

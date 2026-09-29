import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Recommendation } from '../../contracts/advice';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { validatePlan } from '../validation';
import { collectAgentFacts, renderAgentFact, renderAgentFactSelection } from './agent-facts';
import { answerWithoutModel } from './agent';
import { routeAgentQuery } from './agent-fallback';
import { createAgentToolState, runAgentTool } from './agent-tools';
import { cameraCoverage, fieldRepresentationFor, type CameraFieldRepresentation } from './camera-coverage';
import { cameraCandidateEffect, cameraPlacementAdvice, coverageWith } from './camera-placement';
import { defaultExplanation, verifyExplanation } from './explanation';
import { calculateAdvice } from './index';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(path);
  return parsed.value;
}

const demo = load('demo/before.json');
const representation = fieldRepresentationFor(demo.catalog, 'ot_camera') as CameraFieldRepresentation;

function place(plan: PlanDocument, zoneId: string | null, anchor?: [number, number]): Recommendation {
  const result = calculateAdvice(
    plan,
    anchor === undefined ? { scenario: 'place', typeId: 'ot_camera', zoneId } : { scenario: 'place', typeId: 'ot_camera', zoneId, anchor },
  );
  if (!result.ok || result.value[0] === undefined) throw new Error('ожидалась рекомендация');
  return result.value[0];
}

describe('куда поставить камеру, чтобы закрыть слепое пятно (D-308)', () => {
  test('демо-план: варианты закрывают пятно, первый — лучший, числа посчитаны кодом', () => {
    const recommendation = place(demo, null);
    const before = cameraCoverage(demo, representation).total.percent!;
    expect(recommendation.reasonCodes).toEqual(['placement.available']);
    expect(recommendation.candidates).toHaveLength(3);
    const after = recommendation.candidates.map((candidate) => coverageWith(demo, representation, candidate.object).total.percent!);
    for (const value of after) expect(value).toBeGreaterThan(before + 30);
    expect(after[0]).toBe(Math.max(...after));
    // Deterministic answer on the demo: a corner of the entrance, looking into the hall.
    const best = recommendation.candidates[0]!.object;
    expect(best).toMatchObject({ position: [8.5, 0.5], rotation_deg: 315, zoneId: 'z_entrance', typeId: 'ot_camera' });
    expect(best.attributes).toMatchObject({ viewAngleDeg: 90, viewRangeM: 6 });
    expect(after[0]).toBeCloseTo(72.12, 2);
    // Variants are at least a metre apart.
    const [a, b, c] = recommendation.candidates.map((candidate) => candidate.object.position);
    for (const [p, q] of [[a!, b!], [a!, c!], [b!, c!]] as const) expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(1);
  });

  test('ссылки — на существующие зоны пятна и камеры, которые видят клиентские зоны сейчас', () => {
    const recommendation = place(demo, null);
    const ids = new Set([...demo.zones.map((zone) => zone.id), ...demo.objects.map((object) => object.id), demo.room.id]);
    for (const ref of recommendation.refs) expect(ids.has(ref.id)).toBe(true);
    expect(recommendation.refs).toEqual(
      expect.arrayContaining([
        { kind: 'zone', id: 'z_queue' },
        { kind: 'zone', id: 'z_entrance' },
        { kind: 'object', id: 'eq_25' },
        { kind: 'object', id: 'eq_26' },
      ]),
    );
    // Cameras of the service rooms see no client zone and are not cited.
    expect(recommendation.refs).not.toContainEqual({ kind: 'object', id: 'eq_39' });
  });

  test('допущения называют метод и эффект «было → стало»; объяснение проходит проверку контракта', () => {
    const recommendation = place(demo, null);
    const text = recommendation.assumptions.join(' ');
    expect(text).toContain('сейчас 29,8 %');
    expect(text).toContain('вариант 1 — 72,1 %');
    expect(text).toContain('стены и мебель обзор не перекрывают, видео не подключается');
    expect(recommendation.limitations[0]).toBe('Проверена геометрия размещения, а не доступность прохода, эргономика или нормативы.');
    const explanation = defaultExplanation(recommendation);
    expect(explanation).not.toBeNull();
    expect(verifyExplanation(JSON.stringify({ explanations: [explanation] }), [recommendation]).ok).toBe(true);
  });

  test('из двух слепых пятен закрывается большее', () => {
    // Hall 10 × 4 m; a 360° camera in the middle cuts the blind area into a
    // wide left patch (x < 3.8) and a narrow right one (x > 8.2).
    const hall = { id: 'z_hall', typeId: 'zt_client', name: 'Зал', polygon: [[0, 0], [10, 0], [10, 4], [0, 4]] as [number, number][], parentId: null, layerId: 'l_base', attributes: {} };
    const middle = { ...demo.objects.find((object) => object.id === 'eq_26')!, id: 'eq_mid', position: [6, 2] as [number, number], attributes: { viewAngleDeg: 360, viewRangeM: 2.2 } };
    const plan = { ...demo, zones: [hall], objects: [middle] };
    const before = cameraCoverage(plan, representation);
    const recommendation = place(plan, null);
    const leftBlind = before.blind.filter((strip) => strip.x < 5).reduce((sum, strip) => sum + strip.width * strip.height, 0);
    expect(recommendation.assumptions[0]).toContain(`${String(leftBlind).replace('.', ',')} м² в зонах «Зал» (z_hall)`);
    const after = coverageWith(plan, representation, recommendation.candidates[0]!.object);
    const leftAfter = after.blind.filter((strip) => strip.x < 5).reduce((sum, strip) => sum + strip.width * strip.height, 0);
    expect(leftAfter).toBeLessThan(leftBlind / 2);
  });

  test('варианты разнесены минимум на метр и на мелкой сетке', () => {
    // In the queue the point grid stays at 0.5 m: neighbours would be 0.5 m apart.
    const recommendation = place(demo, 'z_queue');
    expect(recommendation.assumptions.join(' ')).toContain('точки через 0,5 м');
    const positions = recommendation.candidates.map((candidate) => candidate.object.position);
    expect(positions.length).toBeGreaterThan(1);
    for (const [i, p] of positions.entries()) {
      for (const q of positions.slice(i + 1)) expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(1);
    }
  });

  test('место, где камера упрётся в другой потолочный предмет, не предлагается', () => {
    // Something under the ceiling exactly at the best spot of the demo.
    const shelf = { ...demo.objects.find((object) => object.typeId === 'ot_workplace')!, id: 'eq_high', position: [8.5, 0.5] as [number, number], size_m: [0.6, 0.6] as [number, number], rotation_deg: 0, base_m: 2.5, height_m: 0.3 };
    const plan = { ...demo, objects: [...demo.objects, shelf] };
    const recommendation = place(plan, null);
    expect(recommendation.candidates[0]!.object.position).not.toEqual([8.5, 0.5]);
    const baseline = validatePlan(plan).filter((issue) => issue.severity === 'error').length;
    for (const candidate of recommendation.candidates) {
      const errors = validatePlan({ ...plan, objects: [...plan.objects, candidate.object] }).filter((issue) => issue.severity === 'error');
      expect(errors.length).toBe(baseline);
    }
  });

  test('вариант не добавляет в план новых ошибок проверки', () => {
    const recommendation = place(demo, null);
    const baseline = validatePlan(demo).filter((issue) => issue.severity === 'error').length;
    for (const candidate of recommendation.candidates) {
      const errors = validatePlan({ ...demo, objects: [...demo.objects, candidate.object] }).filter((issue) => issue.severity === 'error');
      expect(errors.length).toBe(baseline);
    }
  });

  test('зона очереди выбрана явно: пятно ищется в ней, её доля растёт', () => {
    const recommendation = place(demo, 'z_queue');
    expect(recommendation.id).toBe('adv_place_ot_camera_z_queue');
    expect(recommendation.assumptions[0]).toContain('7,5 м² в зонах «Зона очереди» (z_queue)');
    for (const candidate of recommendation.candidates) {
      const queue = coverageWith(demo, representation, candidate.object).zones.find((zone) => zone.zoneId === 'z_queue');
      expect(queue?.percent).toBeGreaterThan(50);
    }
  });

  test('не клиентская зона, точка на плане, нет пятна или нет слоя камер — обычный поиск места', () => {
    expect(cameraPlacementAdvice(demo, { typeId: 'ot_camera', zoneId: 'z_back' })).toBeNull();
    expect(place(demo, 'z_back').assumptions.join(' ')).toContain('Перебор: сетка 0.1 м');
    expect(place(demo, null, [4, 4]).assumptions.join(' ')).toContain('кольцами от указанной точки');

    const seeing = {
      ...demo,
      objects: demo.objects.map((object) =>
        object.id === 'eq_26' ? { ...object, attributes: { ...object.attributes, viewAngleDeg: 360, viewRangeM: 20 } } : object,
      ),
    };
    expect(cameraCoverage(seeing, representation).total.percent).toBe(100);
    expect(cameraPlacementAdvice(seeing, { typeId: 'ot_camera', zoneId: null })).toBeNull();

    const noLayer = { ...demo, catalog: { ...demo.catalog, layerTypes: [] } };
    expect(cameraPlacementAdvice(noLayer, { typeId: 'ot_camera', zoneId: null })).toBeNull();
    // Not a sector type at all.
    expect(cameraPlacementAdvice(demo, { typeId: 'ot_workplace', zoneId: null })).toBeNull();
  });

  test('эффект варианта пересчитывается из плана, а не берётся из текста', () => {
    const recommendation = place(demo, null);
    const effect = cameraCandidateEffect(demo, recommendation.candidates[0]!);
    expect(effect?.before.total.covered).toBe(300);
    expect(effect?.after.total.percent).toBeCloseTo(72.12, 2);
    const desk = demo.objects.find((object) => object.typeId === 'ot_workplace')!;
    expect(cameraCandidateEffect(demo, { object: desk })).toBeNull();
  });

  test('эффект считается один раз на план и вариант, у разных вариантов — свой', () => {
    const recommendation = place(demo, null);
    const [first, second] = recommendation.candidates;
    const once = cameraCandidateEffect(demo, first!);
    expect(cameraCandidateEffect(demo, first!)).toBe(once);
    const other = cameraCandidateEffect(demo, second!);
    expect(other?.after.total.percent).not.toBe(once?.after.total.percent);
    expect(other?.before).toBe(once?.before);
    // A changed plan is a new document: counted afresh.
    const edited = { ...demo, objects: demo.objects.filter((object) => object.id !== 'eq_26') };
    expect(cameraCandidateEffect(edited, first!)?.before.total.covered).toBeLessThan(300);
  });

  test('камера не занимает пол: свободная площадь варианта «стало» = «сейчас»', () => {
    for (const candidate of place(demo, null).candidates) {
      const free = (phase: string) => candidate.facts.find((fact) => fact.metric === 'area.free' && fact.phase === phase)!.value;
      expect(free('after')).toBe(free('current'));
    }
  });
});

describe('чат: покрытие камерами в фактах и в ответе без LLM', () => {
  test('сводка плана даёт долю по каждой клиентской зоне и итог со ссылками на камеры', () => {
    const state = createAgentToolState(demo, null);
    const output = runAgentTool(state, 'plan_overview', {}).output;
    const facts = collectAgentFacts(state, [{ name: 'plan_overview', output }]).filter((fact) => fact.metric === 'coverage.percent');
    const total = facts.find((fact) => fact.scope === 'все клиентские зоны')!;
    expect(total.value).toBe(29.76);
    expect(total.refs).toEqual([{ kind: 'room', id: demo.room.id }, { kind: 'object', id: 'eq_25' }, { kind: 'object', id: 'eq_26' }]);
    expect(renderAgentFact(total)).toBe('Доля клиентских зон, видимая камерами — все клиентские зоны: 29,8 % (сейчас).');
    const queue = facts.find((fact) => fact.refs[0]?.id === 'z_queue')!;
    expect(renderAgentFact(queue)).toContain('«Зона очереди» (z_queue): 0 %');
    expect(facts.map((fact) => fact.refs[0]?.id)).not.toContain('z_back');
  });

  test('вариант камеры: было, стало и изменение в п. п. привязаны к своему варианту', () => {
    const state = createAgentToolState(demo, null);
    const output = runAgentTool(state, 'find_place', { typeId: 'ot_camera', zoneId: null }).output;
    const facts = collectAgentFacts(state, [{ name: 'find_place', output }]).filter((fact) => fact.metric === 'coverage.percent');
    const recommendation = [...state.recommendations.values()][0]!;
    expect(facts).toHaveLength(3 * recommendation.candidates.length);
    const first = recommendation.candidates[0]!;
    const of = (phase: string) => facts.find((fact) => fact.candidateId === first.id && fact.phase === phase)!;
    expect(of('before').value).toBeCloseTo(29.76, 2);
    expect(of('after').value).toBeCloseTo(coverageWith(demo, representation, first.object).total.percent!, 9);
    expect(of('delta').value).toBeCloseTo(72.1 - 29.8, 9);
    expect(renderAgentFact(of('delta'))).toContain('+42,3 п. п. (изменение)');
    expect(renderAgentFact(of('after'))).toContain('вариант 1 «Камера видеонаблюдения», центр [8,5; 0,5] м, поворот 315°: 72,1 % (стало)');

    // Selecting a fact brings the recommendation's assumptions — the method goes with the number.
    runAgentTool(state, 'suggest_candidate', { recommendationId: recommendation.id, candidateId: first.id });
    const selected = renderAgentFactSelection({ factIds: [of('after').id] }, facts, state);
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.text).toContain('видео не подключается');
    // A fact of another variant than the one shown on the plan is refused.
    const second = facts.find((fact) => fact.candidateId === recommendation.candidates[1]!.id && fact.phase === 'after')!;
    expect(renderAgentFactSelection({ factIds: [second.id] }, facts, state).ok).toBe(false);
  });

  test('вопрос о слепых пятнах ведёт к расчёту места камеры', () => {
    expect(routeAgentQuery(demo, 'Где слепые пятна у камер?', false)).toEqual([
      { name: 'find_place', args: { typeId: 'ot_camera', zoneId: null } },
    ]);
    // Not about cameras at all: a storage room, a floor covering, a rack next to a camera.
    expect(routeAgentQuery(demo, 'Что лежит в камере хранения?', false)[0]?.args).not.toMatchObject({ typeId: 'ot_camera' });
    expect(routeAgentQuery(demo, 'Какое покрытие пола в зале?', false)[0]?.args).not.toMatchObject({ typeId: 'ot_camera' });
    const rack = routeAgentQuery(demo, 'Куда поставить стеллаж рядом с камерой?', false)[0];
    expect(rack?.name).toBe('find_place');
    expect(rack?.args.typeId).not.toBe('ot_camera');
    // A zone name that resembles another type's label does not steal the question.
    expect(routeAgentQuery(demo, 'Куда поставить камеру в зоне очереди?', false)[0]).toMatchObject({
      name: 'find_place',
      args: { typeId: 'ot_camera', zoneId: 'z_queue' },
    });
  });

  test('ответ без LLM: вариант на плане, «было → стало» и id камер в тексте; слой назван словами, не действием', () => {
    const answer = answerWithoutModel(demo, null, 'Где слепые пятна камер?', 3, 'нет ключа');
    expect(answer.mode).toBe('fallback');
    expect(answer.text).toContain('Клиентские зоны видны камерами на 29,8 %, с этим вариантом — на 72,1 % (+42,3 п. п.).');
    expect(answer.text).toContain('Сейчас их видят камеры eq_25, eq_26.');
    expect(answer.actions).toEqual(
      expect.arrayContaining([
        { kind: 'preview-candidate', recommendationId: 'adv_place_ot_camera_room_main', candidateId: 'adv_ot_camera_1' },
      ]),
    );
    // Showing the layer would change the plan and make «Применить» stale: no such action.
    expect(answer.actions.some((action) => action.kind === 'show-layer')).toBe(false);
    expect(answer.text).toContain('Секторы и слепые пятна покажет слой «Камеры и зоны обзора» в панели «Слои»');
    expect(answer.refs).toEqual(expect.arrayContaining([{ kind: 'object', id: 'eq_25' }, { kind: 'zone', id: 'z_queue' }]));
  });

  test('обычный объект — без процентов покрытия и без слоя камер', () => {
    const answer = answerWithoutModel(demo, null, 'Где поставить ещё одно кассовое окно?', 3, 'нет ключа');
    expect(answer.text).not.toContain('видны камерами');
    expect(answer.actions).not.toContainEqual({ kind: 'show-layer', layerId: 'l_lt_cameras' });
  });
});

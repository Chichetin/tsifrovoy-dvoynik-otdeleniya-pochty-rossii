/**
 * D-258: the plan agent's tools, the check of the model's text and the
 * model-free path, on the demo plan the jury opens first.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { validatePlan } from '../validation';
import {
  answerWithoutModel,
  createAgentToolState,
  routeAgentQuery,
  runAgentTool,
} from './index';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')));
  if (!parsed.ok) throw new Error(`${path} не разобрался`);
  return parsed.value;
}

const before = load('demo/before.json');
const after = load('demo/after.json');
// The demo keeps two displays: the maximum is reached, not exceeded (#120). A third one exceeds it.
const crowded: PlanDocument = {
  ...before,
  objects: [...before.objects, { ...before.objects.find((object) => object.id === 'eq_7')!, id: 'eq_extra_display', label: 'Лишнее табло' }],
};

describe('инструменты агента', () => {
  test('сводка плана — числа расчёта, округлённые до сантиметров', () => {
    const state = createAgentToolState(before, null);
    const { output, step } = runAgentTool(state, 'plan_overview', {});
    const view = output as { room: { total_m2: number; free_m2: number }; zones: unknown[]; objectsTotal: number };
    expect(step.ok).toBe(true);
    expect(view.zones).toHaveLength(before.zones.length);
    expect(view.objectsTotal).toBe(before.objects.length);
    expect(Number.isInteger(view.room.free_m2 * 100)).toBe(true);
  });

  test('поиск места запоминает рекомендацию, и её вариант можно предложить', () => {
    const state = createAgentToolState(before, null);
    const found = runAgentTool(state, 'find_place', { typeId: 'ot_workplace', zoneId: null });
    expect(found.step.ok).toBe(true);
    const [recommendation] = [...state.recommendations.values()];
    const candidate = recommendation!.candidates[0]!;
    const offered = runAgentTool(state, 'suggest_candidate', { recommendationId: recommendation!.id, candidateId: candidate.id });
    expect(offered.step.ok).toBe(true);
    expect(state.actions).toEqual([
      { kind: 'preview-candidate', recommendationId: recommendation!.id, candidateId: candidate.id },
      { kind: 'apply-candidate', recommendationId: recommendation!.id, candidateId: candidate.id },
    ]);
  });

  test('предложенный вариант, поставленный в план, не ломает проверку', () => {
    const state = createAgentToolState(before, null);
    runAgentTool(state, 'find_place', { typeId: 'ot_cashier_window', zoneId: null });
    const candidate = [...state.recommendations.values()][0]!.candidates[0]!;
    const errorsBefore = validatePlan(before).filter((issue) => issue.severity === 'error').length;
    const applied = { ...before, objects: [...before.objects, candidate.object] };
    expect(validatePlan(applied).filter((issue) => issue.severity === 'error')).toHaveLength(errorsBefore);
  });

  test('модель не может предложить вариант, которого расчёт не выдавал', () => {
    const state = createAgentToolState(before, null);
    const outcome = runAgentTool(state, 'suggest_candidate', { recommendationId: 'adv_x', candidateId: 'adv_y' });
    expect(outcome.step.ok).toBe(false);
    expect(outcome.output).toHaveProperty('error');
    expect(state.actions).toEqual([]);
  });

  test('подсветка только существующих зон и объектов; неизвестный id — ошибка для модели', () => {
    const state = createAgentToolState(before, null);
    expect(runAgentTool(state, 'show_on_plan', { ids: ['z_client', 'nope_1'] }).step.ok).toBe(false);
    expect(state.actions).toEqual([]);
    expect(runAgentTool(state, 'show_on_plan', { ids: ['z_client', 'eq_1'] }).step.ok).toBe(true);
    expect(state.actions.map((action) => action.kind)).toEqual(['focus', 'focus']);
  });

  test('неизвестный инструмент и неверные параметры не бросают исключение', () => {
    const state = createAgentToolState(before, null);
    expect(runAgentTool(state, 'object_put', {}).step.ok).toBe(false);
    expect(runAgentTool(state, 'find_place', { typeId: 42 }).step.ok).toBe(false);
    expect(runAgentTool(state, 'find_place', { typeId: 'ot_missing' }).step.ok).toBe(false);
    expect(runAgentTool(state, 'zone_details', { zoneId: 'z_missing' }).step.ok).toBe(false);
  });

  test('сравнение без исходного варианта — честная ошибка, с ним — рекомендация', () => {
    expect(runAgentTool(createAgentToolState(after, null), 'compare_with_original', {}).step.ok).toBe(false);
    const state = createAgentToolState(after, before);
    expect(runAgentTool(state, 'compare_with_original', {}).step.ok).toBe(true);
    expect([...state.recommendations.values()].map((entry) => entry.scenario)).toEqual(['compare']);
  });

  test('ни один инструмент не меняет документ', () => {
    const snapshot = JSON.stringify(before);
    const state = createAgentToolState(before, before);
    for (const [name, args] of [
      ['plan_overview', {}], ['zone_details', { zoneId: 'z_client' }], ['list_objects', {}],
      ['find_place', { typeId: 'ot_workplace' }], ['check_equipment', {}], ['validate_plan', {}],
      ['compare_with_original', {}], ['suggest_layer', { layerId: 'l_lt_heat' }], ['open_panel', { panel: 'inventory' }],
    ] as const) runAgentTool(state, name, args);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('агент без модели', () => {
  test('маршрутизатор понимает обычные фразы', () => {
    expect(routeAgentQuery(before, 'Где поставить ещё одно кассовое окно?', false)[0]).toEqual({
      name: 'find_place',
      args: { typeId: 'ot_cashier_window', zoneId: null },
    });
    expect(routeAgentQuery(before, 'Чего не хватает в зоне ожидания?', false)[0]).toEqual({
      name: 'check_equipment',
      args: { zoneId: 'z_waiting' },
    });
    expect(routeAgentQuery(before, 'Какие ошибки в плане?', false)[0]?.name).toBe('validate_plan');
    expect(routeAgentQuery(after, 'Что изменилось?', true)[0]?.name).toBe('compare_with_original');
    expect(routeAgentQuery(before, 'Расскажи про клиентский зал', false)[0]).toEqual({
      name: 'zone_details',
      args: { zoneId: 'z_client' },
    });
    expect(routeAgentQuery(before, 'Привет', false)[0]?.name).toBe('plan_overview');
  });

  test('ответ без модели: шаги, текст расчёта, вариант с кнопкой «Применить»', () => {
    const steps: string[] = [];
    const answer = answerWithoutModel(before, null, 'Куда добавить рабочее место оператора?', 4, 'без LLM', (step) => steps.push(step.label));
    expect(answer.mode).toBe('fallback');
    expect(answer.revision).toBe(4);
    expect(answer.fallbackReason).toBe('без LLM');
    expect(steps).toHaveLength(2);
    expect(answer.text).not.toBe('');
    expect(answer.actions.some((action) => action.kind === 'apply-candidate')).toBe(true);
    expect(answer.recommendations[0]?.scenario).toBe('place');
  });
});

describe('ответ без модели называет зоны, типы и правило (критерий «ИИ-ассистент»)', () => {
  function answer(plan: PlanDocument, query: string): { text: string } {
    const result = answerWithoutModel(plan, null, query, 1, 'без LLM');
    return { text: result.text };
  }

  test('комплектование: тип, зона с id, учтённые объекты и правило команды', () => {
    // «name» (id): the chat UI turns this shape into a single button labelled
    // with the name (D-320) — this test still checks the calculation's raw
    // text, which keeps both, in AgentChat.test.tsx's format.
    const { text } = answer(crowded, 'Чего не хватает или что лишнее по оборудованию?');
    expect(text).toContain('«Центральное информационное табло»');
    expect(text).toContain('«Клиентский зал» (z_client)');
    expect(text).toContain('eq_7');
    expect(text).toContain('eq_8');
    expect(text).toContain('rule_info_display_max');
    expect(text).toContain('«Скамья для ожидания»');
    expect(text).toContain('«Зона ожидания» (z_waiting)');
    expect(text).toContain('Учтены: «Табло над зоной ожидания» (eq_7), «Табло над зоной очереди» (eq_8), «Лишнее табло» (eq_extra_display).');
    expect(text).toContain('eq_6');
    expect(text).toContain('rule_bench_min');
    // The rationale already says «Правило команды» — the mark is not repeated.
    expect(text).toContain('(rule_bench_min, справочник проекта)');
    // One paragraph per recommendation: the chat splits on blank lines.
    expect(text.split('\n\n')).toHaveLength(2);
  });

  test('правило команды без слов «Правило команды» в обосновании получает полную пометку', () => {
    const plan: PlanDocument = {
      ...before,
      catalog: {
        ...before.catalog,
        rules: before.catalog.rules.map((rule) => (rule.id === 'rule_bench_min' ? { ...rule, rationale: 'В зоне ожидания не меньше двух мест.' } : rule)),
      },
    };
    expect(answer(plan, 'Чего не хватает в зоне ожидания?').text).toContain('(rule_bench_min; справочник проекта)');
  });

  test('длинный список учтённых объектов сокращается, общее число — из расчёта', () => {
    const source = before.objects.find((object) => object.id === 'eq_7')!;
    const extra = Array.from({ length: 6 }, (_, index) => ({ ...source, id: `eq_extra_${index + 1}` }));
    const plan: PlanDocument = { ...before, objects: [...before.objects, ...extra] };
    const { text } = answer(plan, 'Что лишнее по оборудованию в клиентском зале?');
    expect(text).toContain('eq_extra_3');
    expect(text).not.toContain('eq_extra_4');
    expect(text).toContain('и другие, всего 8');
  });

  test('правило из материалов организаторов не выдаётся за правило команды', () => {
    const plan: PlanDocument = {
      ...before,
      catalog: {
        ...before.catalog,
        rules: before.catalog.rules.map((rule) => (rule.id === 'rule_bench_min' ? { ...rule, source: 'organizer-material' as const } : rule)),
      },
    };
    const { text } = answer(plan, 'Чего не хватает в зоне ожидания?');
    expect(text).toContain('rule_bench_min');
    expect(text).toContain('материалы организаторов');
    expect(text).not.toContain('правило команды, не норматив');
  });

  test('зона не названа: тип без правила ищется там, где такие объекты уже стоят, и зона названа', () => {
    const calls = routeAgentQuery(before, 'куда поставить стеллаж для посылок?', false);
    expect(calls[0]).toMatchObject({ name: 'find_place', args: { typeId: 'ot_parcel_rack', zoneId: 'z_storage' } });
    const result = answerWithoutModel(before, null, 'куда поставить стеллаж для посылок?', 1, 'без LLM');
    expect(result.recommendations[0]?.candidates[0]?.object.zoneId).toBe('z_storage');
    const { text } = answer(before, 'куда поставить стеллаж для посылок?');
    expect(text).toContain('«Хранение и посылки» (z_storage)');
    expect(text).toContain('правил для этого типа в справочнике нет');
    // The note named the zone; «Место в зоне …» does not repeat it.
    expect(text.split('(z_storage)')).toHaveLength(2);
    expect(text).toContain('не названа');
  });

  test('максимум уже превышен (третье табло): вариант не предлагается, ответ начинается с отказа', () => {
    const query = 'Куда поставить информационное табло?';
    expect(routeAgentQuery(crowded, query, false).map((call) => [call.name, call.args.zoneId])).toEqual([['check_equipment', 'z_client']]);
    const result = answerWithoutModel(crowded, null, query, 1, 'без LLM');
    expect(result.text.startsWith('Ставить ещё одно «Центральное информационное табло» в зону «Клиентский зал» (z_client)')).toBe(true);
    expect(result.text.split('\n\n')[0]).toContain('не рекомендуется');
    expect(result.text).toContain('rule_info_display_max');
    expect(result.text).toContain('Сначала уберите лишнее');
    expect(result.text).toContain('Учтены: «Табло над зоной ожидания» (eq_7), «Табло над зоной очереди» (eq_8), «Лишнее табло» (eq_extra_display).');
    expect(result.text).not.toContain('Место найдено');
    expect(result.actions.some((action) => action.kind === 'apply-candidate')).toBe(false);
    expect(result.recommendations.every((entry) => entry.scenario === 'equipment')).toBe(true);
  });

  test('зона названа, превышение в родительской зоне: тоже отказ; в зоне без правила — вариант', () => {
    expect(routeAgentQuery(crowded, 'Куда поставить информационное табло в зоне очереди?', false)[0]).toMatchObject({ name: 'check_equipment', args: { zoneId: 'z_client' } });
    expect(routeAgentQuery(crowded, 'Куда поставить информационное табло в служебной зоне?', false)).toEqual([
      { name: 'find_place', args: { typeId: 'ot_info_display', zoneId: 'z_back' } },
    ]);
  });

  test('максимум достигнут, но не превышен: вариант с утвердительным предупреждением', () => {
    const result = answerWithoutModel(before, null, 'Куда поставить информационное табло?', 1, 'без LLM');
    expect(result.recommendations[0]?.candidates[0]?.object.zoneId).toBe('z_waiting');
    expect(result.text).toContain('Этот вариант нарушит максимум (rule_info_display_max, справочник проекта)');
    expect(result.text).not.toContain('не рекомендуется');
  });

  test('зону выбрал поиск и попал туда, где максимум превышен — вариант снят, отказ первым', () => {
    // A minimum on the same rule: the router guesses no zone, the search keeps to the rule's zones.
    const plan: PlanDocument = {
      ...crowded,
      catalog: {
        ...crowded.catalog,
        rules: [
          ...crowded.catalog.rules.map((rule) => (rule.id === 'rule_info_display_max' ? { ...rule, min: 1 } : rule)),
          // A zoneless rule gives the search call a note of its own: the refusal must still come first.
          { id: 'rule_display_entrance', kind: 'distance-to-entrance' as const, source: 'team-assumption' as const, rationale: 'Табло видно от входа.', objectTypeId: 'ot_info_display', maxDistance_m: 3, entranceId: null },
        ],
      },
    };
    const query = 'Куда поставить информационное табло?';
    expect(routeAgentQuery(plan, query, false)[0]).toMatchObject({ name: 'find_place', args: { typeId: 'ot_info_display', zoneId: null } });
    const result = answerWithoutModel(plan, null, query, 1, 'без LLM');
    expect(result.text.split('\n\n')[0]).toContain('не рекомендуется');
    expect(result.text).not.toContain('Место найдено');
    expect(result.actions.some((action) => action.kind === 'apply-candidate')).toBe(false);
  });

  test('правило без зоны (терминал очереди у входа) названо, а не «правил нет»', () => {
    const { text } = answer(before, 'Куда поставить терминал очереди?');
    expect(text).not.toContain('правил для этого типа в справочнике нет');
    expect(text).toContain('правил комплектования по зонам для этого типа в справочнике нет');
    expect(text).toContain('Правило rule_queue_terminal_entrance (материалы организаторов) — не дальше 3 м от ближайшего входа — зону не задаёт; поиск места его соблюдает.');
    const named = answerWithoutModel(before, null, 'Куда поставить терминал очереди во входной группе?', 1, 'без LLM');
    expect(named.text).toContain('rule_queue_terminal_entrance');
  });

  test('в угаданной зоне места нет — поиск по всему плану, а не «место не найдено»', () => {
    const plan: PlanDocument = {
      ...before,
      zones: before.zones.map((zone) => (zone.id === 'z_storage' ? { ...zone, polygon: [[9.6, 6.2], [10.2, 6.2], [10.2, 6.8], [9.6, 6.8]] } : zone)),
    };
    const result = answerWithoutModel(plan, null, 'куда поставить стеллаж для посылок?', 1, 'без LLM');
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.candidates.length).toBeGreaterThan(0);
    expect(result.text).toContain('В зоне «Хранение и посылки» (z_storage) места нет — вариант по всему плану.');
    expect(result.text).not.toContain('Подходящее место не найдено');
    expect(result.actions.some((action) => action.kind === 'apply-candidate')).toBe(true);
  });

  test('поровну объектов в двух зонах — первая по порядку плана', () => {
    const storageRacks = before.objects.filter((object) => object.typeId === 'ot_parcel_rack' && object.zoneId === 'z_storage');
    const plan: PlanDocument = { ...before, objects: before.objects.filter((object) => !storageRacks.slice(1).includes(object)) };
    expect(routeAgentQuery(plan, 'куда поставить стеллаж для посылок?', false)[0]?.args.zoneId).toBe('z_back');
  });

  test('зона названа в вопросе — она и используется, без пояснения о выборе', () => {
    const calls = routeAgentQuery(before, 'куда поставить стеллаж для посылок в служебной зоне?', false);
    expect(calls[0]).toEqual({ name: 'find_place', args: { typeId: 'ot_parcel_rack', zoneId: 'z_back' } });
    const { text } = answer(before, 'куда поставить стеллаж для посылок в служебной зоне?');
    expect(text).toContain('«Служебная зона» (z_back)');
    expect(text).not.toContain('не названа');
  });

  test('тип с правилом: поиск по зонам правила, найденная зона названа', () => {
    const { text } = answer(before, 'Где поставить ещё одно кассовое окно?');
    expect(text).toContain('(z_client)');
    expect(text).not.toContain('не названа');
  });

  test('тип без правила и без объектов в плане: зона варианта названа по геометрии', () => {
    expect(routeAgentQuery(before, 'Куда поставить пандус?', false)[0]).toEqual({ name: 'find_place', args: { typeId: 'ot_ramp', zoneId: null } });
    const result = answerWithoutModel(before, null, 'Куда поставить пандус?', 1, 'без LLM');
    const zoneId = result.recommendations[0]!.candidates[0]!.object.zoneId;
    const { text } = answer(before, 'Куда поставить пандус?');
    expect(text).toContain(zoneId === null ? 'вне зон' : `(${zoneId})`);
  });
});

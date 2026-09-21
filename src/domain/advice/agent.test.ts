/**
 * D-255: the plan agent's tools, the check of the model's text and the
 * model-free path, on the demo plan the jury opens first.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { validatePlan } from '../validation';
import {
  agentEvidence,
  answerWithoutModel,
  checkAgentText,
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

describe('проверка текста модели', () => {
  function evidenceFor(): ReturnType<typeof agentEvidence> {
    const state = createAgentToolState(before, null);
    const overview = runAgentTool(state, 'plan_overview', {}).output;
    return agentEvidence(state, [overview], 'Сколько свободно?');
  }
  const overview = runAgentTool(createAgentToolState(before, null), 'plan_overview', {}).output as {
    room: { free_m2: number; total_m2: number };
  };

  test('числа и id из результатов проходят, включая округление и запятую', () => {
    const free = overview.room.free_m2;
    const text = `В помещении свободно ${String(free).replace('.', ',')} м² (около ${Math.round(free)} м²), зона z_client.`;
    expect(checkAgentText(text, evidenceFor())).toEqual([]);
  });

  test('выдуманное число и несуществующий id отвергаются', () => {
    const problems = checkAgentText('Свободно 999,7 м², объект eq_9999 лишний.', evidenceFor());
    expect(problems).toEqual([
      { kind: 'unknown-id', token: 'eq_9999' },
      { kind: 'unknown-number', token: '999,7' },
    ]);
  });

  test('цифры внутри id не считаются числами', () => {
    expect(checkAgentText('Посмотрите eq_12 и eq_13.', evidenceFor())).toEqual([]);
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

test('служебный id варианта в тексте отвергается — человеку он ничего не говорит', () => {
  const state = createAgentToolState(before, null);
  const output = runAgentTool(state, 'find_place', { typeId: 'ot_cashier_window', zoneId: null }).output;
  const candidate = [...state.recommendations.values()][0]!.candidates[0]!;
  expect(checkAgentText(`Вариант ${candidate.id} подходит.`, agentEvidence(state, [output], ''))).toEqual([{ kind: 'unknown-id', token: candidate.id }]);
});

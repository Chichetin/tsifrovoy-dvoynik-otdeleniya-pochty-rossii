/**
 * A08: свободный ответ модели проходит ту же проверку, что и остальной ответ.
 *
 * Здесь проверяется не «красиво ли написано», а единственное, ради чего текст
 * вообще разрешён: он не может назвать `id`, которого рекомендация не называет,
 * и число, которого расчёт не выдавал. Множества допустимого проверяются
 * отдельными тестами — именно они ловят враньё модели, когда промпт перепишут.
 */

import { describe, expect, test } from 'vitest';
import type { Candidate, Explanation, Fact, Recommendation } from '../../contracts/advice';
import { ADVICE_LIMITS } from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import type { Equipment } from '../../contracts/model';
import {
  EXPLANATION_ISSUE_CODES,
  allowedIds,
  allowedNumbers,
  reviewExplanations,
  verifyExplanation,
} from './explanation';
import { renderExplanation } from './templates';

const DESK: Equipment = {
  id: 'eq_new_desk',
  typeId: 'ot_desk',
  label: 'Рабочее место',
  position: [3.005, 4.5],
  size_m: [1.2, 0.8],
  rotation_deg: 90,
  base_m: 0,
  height_m: 0.75,
  zoneId: 'z_service',
  layerId: 'lay_equipment',
  attributes: {},
};

/** Площадь с «хвостом»: на экране 12,35, в расчёте — 12,3456789. */
const FREE_CURRENT: Fact = {
  id: 'adv_place.area.free.current',
  metric: 'area.free',
  phase: 'current',
  value: 12.3456789,
  unit: 'm2',
  refs: [{ kind: 'room', id: 'op_main' }],
};

const COUNT_CURRENT: Fact = {
  id: 'adv_place.equipment.count.current',
  metric: 'equipment.count',
  phase: 'current',
  value: 2,
  unit: 'count',
  refs: [{ kind: 'room', id: 'op_main' }],
};

const CANDIDATE: Candidate = {
  id: 'cand_1',
  object: DESK,
  facts: [
    {
      id: 'cand_1.area.free.after',
      metric: 'area.free',
      phase: 'after',
      value: 11.3856789,
      unit: 'm2',
      refs: [{ kind: 'room', id: 'op_main' }],
    },
    {
      id: 'cand_1.equipment.count.after',
      metric: 'equipment.count',
      phase: 'after',
      value: 3,
      unit: 'count',
      refs: [{ kind: 'room', id: 'op_main' }],
    },
  ],
};

const RECOMMENDATION: Recommendation = {
  id: 'adv_place_ot_desk_z_service',
  scenario: 'place',
  refs: [
    { kind: 'zone', id: 'z_service' },
    { kind: 'room', id: 'op_main' },
  ],
  candidates: [CANDIDATE],
  facts: [FREE_CURRENT, COUNT_CURRENT, ...CANDIDATE.facts],
  ruleIds: ['rule_desk_zone'],
  assumptions: [],
  reasonCodes: ['placement.available'],
  limitations: [REASON_CODE_SPECS['placement.available'].requiredLimitation],
  changes: [],
};

const GOOD_EXPLANATION: Explanation = {
  recommendationId: RECOMMENDATION.id,
  candidateId: CANDIDATE.id,
  reasonCode: 'placement.available',
  factIds: [
    FREE_CURRENT.id,
    COUNT_CURRENT.id,
    'cand_1.area.free.after',
    'cand_1.equipment.count.after',
  ],
};

function answer(text?: string): string {
  const explanation = text === undefined ? GOOD_EXPLANATION : { ...GOOD_EXPLANATION, text };
  return JSON.stringify({ explanations: [explanation] });
}

function review(text?: string): ReturnType<typeof reviewExplanations> {
  return reviewExplanations(answer(text), [RECOMMENDATION]);
}

function textOf(text?: string): string | undefined {
  const reviewed = review(text);
  if (!reviewed.ok) throw new Error('структурная часть ответа неожиданно отклонена');
  return reviewed.value.explanations[0]?.text;
}

function codesOf(text: string): string[] {
  const reviewed = review(text);
  if (!reviewed.ok) throw new Error('структурная часть ответа неожиданно отклонена');
  return reviewed.value.textIssues.map((issue) => issue.code);
}

describe('множества допустимого', () => {
  test('допустимые id — только те, что называет сама рекомендация', () => {
    const ids = allowedIds(RECOMMENDATION);

    expect(ids.has('z_service')).toBe(true);
    expect(ids.has('op_main')).toBe(true);
    expect(ids.has('rule_desk_zone')).toBe(true);
    expect(ids.has('cand_1')).toBe(true);
    expect(ids.has('eq_new_desk')).toBe(true);
    expect(ids.has(FREE_CURRENT.id)).toBe(true);
    expect(ids.has(RECOMMENDATION.id)).toBe(true);
    // Соседняя зона существует в плане, но эта рекомендация её не называет.
    expect(ids.has('z_waiting')).toBe(false);
  });

  test('допустимые числа берутся в том же округлении, в каком показаны', () => {
    const numbers = allowedNumbers(RECOMMENDATION, CANDIDATE.id);

    expect(numbers).toContain(12.35); // area.free.current, 12,3456789 на экране 12,35
    expect(numbers).toContain(11.39); // прогноз варианта
    expect(numbers).toContain(2);
    expect(numbers).toContain(3);
    expect(numbers).toContain(1.2); // габарит варианта
    expect(numbers).toContain(0.8);
    expect(numbers).toContain(3.01); // центр по X, 3,005 на экране 3,01
    expect(numbers).toContain(4.5);
    expect(numbers).toContain(90); // поворот
    expect(numbers).toContain(1); // «Вариант 1» и число вариантов
    // Сырое значение до округления числом с экрана не является.
    expect(numbers).not.toContain(12.3456789);
    expect(numbers).not.toContain(999);
  });

  test('счётчики изменений входят в допустимые числа сценария сравнения', () => {
    const compare: Recommendation = {
      ...RECOMMENDATION,
      scenario: 'compare',
      candidates: [],
      changes: [
        { ref: { kind: 'object', id: 'eq_1' }, kind: 'added' },
        { ref: { kind: 'object', id: 'eq_2' }, kind: 'added' },
        { ref: { kind: 'object', id: 'eq_3' }, kind: 'removed' },
      ],
    };

    const numbers = allowedNumbers(compare, null);
    expect(numbers).toContain(3); // всего изменений
    expect(numbers).toContain(2); // добавлено
    expect(numbers).toContain(1); // удалено
    expect(allowedIds(compare).has('eq_3')).toBe(true);
  });

  test('прогноз чужого варианта не становится допустимым числом', () => {
    const other: Candidate = {
      id: 'cand_2',
      object: { ...DESK, id: 'eq_new_desk_2', position: [7.25, 8.75] },
      facts: [
        {
          id: 'cand_2.area.free.after',
          metric: 'area.free',
          phase: 'after',
          value: 9.87,
          unit: 'm2',
          refs: [{ kind: 'room', id: 'op_main' }],
        },
      ],
    };
    const two: Recommendation = {
      ...RECOMMENDATION,
      candidates: [CANDIDATE, other],
      facts: [FREE_CURRENT, COUNT_CURRENT, ...CANDIDATE.facts, ...other.facts],
    };

    const numbers = allowedNumbers(two, CANDIDATE.id);

    // Прогноз и геометрия — только у названного варианта.
    expect(numbers).toContain(11.39);
    expect(numbers).toContain(4.5);
    expect(numbers).not.toContain(9.87);
    expect(numbers).not.toContain(7.25);
    expect(numbers).not.toContain(8.75);
    // Порядковые номера видны у обоих: «Вариант 2» — законная ссылка на список.
    expect(numbers).toContain(1);
    expect(numbers).toContain(2);
  });
});

describe('свободный ответ модели', () => {
  test('без текста ответ выглядит ровно как раньше', () => {
    const verified = verifyExplanation(answer(), [RECOMMENDATION]);

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value[0]).toEqual(GOOD_EXPLANATION);
    expect(verified.value[0]).not.toHaveProperty('text');
  });

  test('проверенный текст доходит до пользователя', () => {
    const text =
      'Поставьте рабочее место в зоне z_service: свободной площади останется 11,39 м², объектов станет 3.';

    expect(textOf(text)).toBe(text);
    expect(codesOf(text)).toEqual([]);
  });

  test('число из расчёта принимается и с точкой, и с запятой', () => {
    expect(codesOf('Свободно 12,35 м², станет 11,39 м².')).toEqual([]);
    expect(codesOf('Свободно 12.35 м², станет 11.39 м².')).toEqual([]);
  });

  test('выдуманный id выбрасывает текст, но не ответ', () => {
    const text = 'Лучше поставить в зоне z_waiting — там свободнее.';

    expect(codesOf(text)).toEqual([EXPLANATION_ISSUE_CODES.TEXT_UNKNOWN_ID]);
    expect(textOf(text)).toBeUndefined();

    const reviewed = review(text);
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    const explanation = reviewed.value.explanations[0];
    if (explanation === undefined) throw new Error('объяснение пропало вместе с текстом');
    expect(explanation).toEqual(GOOD_EXPLANATION);
    // Структурное объяснение и его числа остались целыми.
    expect(renderExplanation(RECOMMENDATION, explanation)).toContain('12,35');
  });

  test('число, которого расчёт не выдавал, выбрасывает текст', () => {
    expect(codesOf('Свободной площади станет 15,00 м².')).toEqual([
      EXPLANATION_ISSUE_CODES.TEXT_UNKNOWN_NUMBER,
    ]);
    // Правдоподобное, но не посчитанное округление тоже не проходит.
    expect(codesOf('Свободно 12,3 м².')).toEqual([
      EXPLANATION_ISSUE_CODES.TEXT_UNKNOWN_NUMBER,
    ]);
  });

  test('число, приклеенное к слову через точку, проверяется как число', () => {
    // `area.15` похоже на id, но без подчёркивания проверку id не проходит:
    // если вырезать его из текста вместе с настоящими id, 15 не проверит никто.
    expect(codesOf('Свободной площади станет area.15 м².')).toEqual([
      EXPLANATION_ISSUE_CODES.TEXT_UNKNOWN_NUMBER,
    ]);
    // Название метрики без цифр остаётся свободным словарём и текст не рушит.
    expect(textOf('Свободная площадь (area.free) взята из расчёта.')).toBe(
      'Свободная площадь (area.free) взята из расчёта.',
    );
  });

  test('текст длиннее предела не показывается', () => {
    const long = `Место найдено. ${'о'.repeat(ADVICE_LIMITS.maxAnswerChars)}`;

    expect(codesOf(long)).toEqual([EXPLANATION_ISSUE_CODES.TEXT_TOO_LONG]);
    expect(textOf(long)).toBeUndefined();
  });

  test('пустой текст считается отсутствующим и попадает в журнал', () => {
    expect(codesOf('   ')).toEqual([EXPLANATION_ISSUE_CODES.TEXT_EMPTY]);
    expect(textOf('   ')).toBeUndefined();
  });

  test('нарушение структуры по-прежнему отклоняет весь ответ целиком', () => {
    const broken = JSON.stringify({
      explanations: [{ ...GOOD_EXPLANATION, text: 'Всё хорошо.', factIds: ['ничего'] }],
    });

    const verified = verifyExplanation(broken, [RECOMMENDATION]);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.issues.map((issue) => issue.code)).toContain(
      EXPLANATION_ISSUE_CODES.UNKNOWN_FACT,
    );
  });

  test('текст не строкой — это нарушение структуры, а не мягкий отказ', () => {
    const broken = JSON.stringify({
      explanations: [{ ...GOOD_EXPLANATION, text: 42 }],
    });

    const verified = verifyExplanation(broken, [RECOMMENDATION]);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.issues.map((issue) => issue.code)).toEqual([
      EXPLANATION_ISSUE_CODES.SHAPE_INVALID,
    ]);
  });
});

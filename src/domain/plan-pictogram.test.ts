import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isPlanPictogramVisible, planPictogram, PLAN_PICTOGRAM_PATHS } from './plan-pictogram';

describe('пиктограммы готового 2D-плана', () => {
  test('важные для посетителя и сотрудника объекты получают узнаваемый знак', () => {
    expect(planPictogram('ot_cashier_window')).toBe('cashier');
    expect(planPictogram('ot_queue_terminal')).toBe('terminal');
    expect(planPictogram('ot_parcel_rack')).toBe('rack');
    expect(planPictogram('ot_camera')).toBe('camera');
    expect(planPictogram('ot_bench')).toBe('seat');
  });

  test('новый тип без заранее придуманного символа не получает ложную иконку', () => {
    expect(planPictogram('ot_team_custom')).toBeNull();
  });

  test('значок уходит на слишком мелком масштабе', () => {
    expect(isPlanPictogramVisible(42, 24)).toBe(true);
    expect(isPlanPictogramVisible(17, 24)).toBe(true);
    expect(isPlanPictogramVisible(15, 24)).toBe(false);
    expect(isPlanPictogramVisible(16, 9)).toBe(false);
    expect(isPlanPictogramVisible(9, 40)).toBe(false);
  });

  test('каждый тип значка имеет собственный векторный силуэт', () => {
    const paths = Object.values(PLAN_PICTOGRAM_PATHS);
    // Числа силуэтов здесь нет намеренно: набор растёт вместе со справочником,
    // а полноту проверяет «у каждого типа поставки есть свой знак» ниже.
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^M\d/);
  });
});

describe('покрытие справочника значками', () => {
  const types = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'catalog', 'object-types.json'), 'utf8'),
  ) as Array<{ id: string; label: string }>;

  // Значок в библиотеке стоит рядом с названием, поэтому пустой значок — это
  // пустая строка в списке. До 22.09 своего знака не было у восьми типов:
  // компьютер, кассовый терминал, панель ОТС, розетка, пандус, электрощит,
  // вентиляция, водонагреватель.
  test('у каждого типа поставки есть свой знак', () => {
    const without = types.filter((type) => planPictogram(type.id) === null).map((type) => type.label);
    expect(without).toEqual([]);
  });

  test('каждый знак набора нарисован', () => {
    for (const type of types) {
      const kind = planPictogram(type.id);
      if (kind === null) continue;
      expect(PLAN_PICTOGRAM_PATHS[kind], type.label).toMatch(/^M/);
    }
  });

  // Табло, медиапанель и стенд навигации раньше делили один знак «экран».
  test('стенд навигации отличается от табло', () => {
    expect(planPictogram('ot_info_stand')).not.toBe(planPictogram('ot_info_display'));
  });
});

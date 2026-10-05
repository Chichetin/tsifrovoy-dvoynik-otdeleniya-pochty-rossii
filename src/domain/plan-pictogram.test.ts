import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ObjectType } from '../contracts/model';
import {
  isPlanPictogramVisible,
  planPictogram,
  planPictogramNeedsBackdrop,
  planPictogramSize,
  PLAN_PICTOGRAM_MIN_PX,
  PLAN_PICTOGRAM_PATHS,
} from './plan-pictogram';

describe('пиктограммы готового 2D-плана', () => {
  test('знак берётся из поля pictogram типа справочника (D-376)', () => {
    expect(planPictogram({ pictogram: 'cashier' })).toBe('cashier');
    expect(planPictogram({ pictogram: 'stand' })).toBe('stand');
  });

  test('тип без поля pictogram и неизвестный тип не получают ложную иконку', () => {
    expect(planPictogram({})).toBeNull();
    expect(planPictogram(null)).toBeNull();
    expect(planPictogram(undefined)).toBeNull();
  });

  test('значок уходит на слишком мелком масштабе', () => {
    expect(isPlanPictogramVisible(42, 24)).toBe(true);
    expect(isPlanPictogramVisible(17, 24)).toBe(true);
    // Сам объект ещё различим на экране — знак нужен тем более: без него
    // камера, датчик и пинпад остаются безымянными точками.
    expect(isPlanPictogramVisible(15, 24)).toBe(true);
    expect(isPlanPictogramVisible(16, 9)).toBe(true);
    expect(isPlanPictogramVisible(9, 40)).toBe(true);
    // Ниже этого объект и сам не читается, а полсотни знаков превращают
    // уменьшенный план в шум.
    // Датчик дыма 0,12 м — 4,8 px во «Вписать»: знак нужен ему больше всех.
    expect(isPlanPictogramVisible(4.8, 4.8)).toBe(true);
    expect(isPlanPictogramVisible(3.5, 3.5)).toBe(false);
    // Розетка 0,08 × 0,02 м — 3,2 px: ждёт приближения.
    expect(isPlanPictogramVisible(3.2, 0.8)).toBe(false);
  });

  test('мелкий объект получает знак постоянного размера, как в экспорте', () => {
    // Камера 0,15 × 0,15 м в масштабе «Вписать» — это 8,5 px: знак по размеру
    // объекта был бы нечитаем, поэтому он не мельче PLAN_PICTOGRAM_MIN_PX.
    expect(planPictogramSize(8.5, 8.5)).toBe(PLAN_PICTOGRAM_MIN_PX);
    // Крупный объект по-прежнему несёт знак по своему размеру, с потолком 20.
    expect(planPictogramSize(40, 30)).toBe(20);
    expect(planPictogramSize(20, 18)).toBeCloseTo(14.04, 2);
  });

  test('знак крупнее объекта получает подложку, иначе белые линии теряются на полу', () => {
    expect(planPictogramNeedsBackdrop(8.5, 8.5)).toBe(true);
    expect(planPictogramNeedsBackdrop(40, 30)).toBe(false);
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
  ) as ObjectType[];

  // Значок в библиотеке стоит рядом с названием, поэтому пустой значок — это
  // пустая строка в списке. До 22.09 своего знака не было у восьми типов:
  // компьютер, кассовый терминал, панель ОТС, розетка, пандус, электрощит,
  // вентиляция, водонагреватель.
  test('у каждого типа поставки есть свой знак', () => {
    const without = types.filter((type) => planPictogram(type) === null).map((type) => type.label);
    expect(without).toEqual([]);
  });

  // Знаки до #208 задавал switch по id типа; справочник даёт ровно те же.
  test('справочник даёт типам поставки те же знаки, что раньше давал код', () => {
    const before: Record<string, string> = {
    ot_workplace: 'workplace',
    ot_chair: 'seat',
    ot_bench: 'seat',
    ot_cashier_window: 'cashier',
    ot_payment_terminal: 'terminal',
    ot_queue_terminal: 'terminal',
    ot_mailbox: 'mailbox',
    ot_info_display: 'display',
    ot_media_panel: 'display',
    ot_info_stand: 'stand',
    ot_printer: 'printer',
    ot_label_printer: 'printer',
    ot_camera: 'camera',
    ot_fire_sensor: 'sensor',
    ot_parcel_rack: 'rack',
    ot_goods_rack: 'rack',
    ot_scales: 'scales',
    ot_computer: 'computer',
    ot_pos_terminal: 'pinpad',
    ot_alarm_panel: 'alarm',
    ot_socket: 'socket',
    ot_ramp: 'ramp',
    ot_switchboard: 'switchboard',
    ot_hvac: 'hvac',
    ot_water_heater: 'heater',
    };
    expect(Object.fromEntries(types.map((type) => [type.id, planPictogram(type)]))).toEqual(before);
  });

  test('каждый знак набора нарисован', () => {
    for (const type of types) {
      const kind = planPictogram(type);
      if (kind === null) continue;
      expect(PLAN_PICTOGRAM_PATHS[kind], type.label).toMatch(/^M/);
    }
  });

  // Табло, медиапанель и стенд навигации раньше делили один знак «экран».
  test('стенд навигации отличается от табло', () => {
    const byId = new Map(types.map((type) => [type.id, type]));
    expect(planPictogram(byId.get('ot_info_stand'))).not.toBe(planPictogram(byId.get('ot_info_display')));
  });
});

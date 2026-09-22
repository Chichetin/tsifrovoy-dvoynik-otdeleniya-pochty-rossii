import { describe, expect, test } from 'vitest';
import { isPlanPictogramVisible, planPictogram } from './plan-pictogram';

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
    expect(isPlanPictogramVisible(16, 9)).toBe(false);
    expect(isPlanPictogramVisible(9, 40)).toBe(false);
  });
});

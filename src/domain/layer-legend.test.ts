/**
 * U05-ux: легенда информационного слоя строится из справочника, а не из кода.
 * Проверяется на настоящем `data/catalog/layer-types.json`: поменяли шкалу в
 * JSON — поменялась легенда.
 */

import { describe, expect, test } from 'vitest';
import layerTypes from '../../data/catalog/layer-types.json';
import type { LayerType } from '../contracts/model';
import { legendOf } from './layer-legend';

const types = layerTypes as LayerType[];
const byId = (id: string): LayerType => {
  const type = types.find((entry) => entry.id === id);
  if (type === undefined) throw new Error(id);
  return type;
};

describe('legendOf', () => {
  test('тепловой слой: шкала от первого цвета ко второму, 0 … max в единицах справочника', () => {
    const legend = legendOf(byId('lt_heat'));
    expect(legend).toEqual({
      kind: 'scale',
      from: '#D3F9D8',
      to: '#FA5252',
      low: '0\u00a0%',
      high: '100\u00a0%',
      threshold: 'от 100\u00a0% и выше — самый насыщенный цвет',
    });
  });

  test('очередь — та же шкала со своим порогом и единицей', () => {
    const legend = legendOf(byId('lt_queue'));
    expect(legend.kind).toBe('scale');
    if (legend.kind !== 'scale') return;
    expect(legend.high).toBe('12\u00a0чел.');
    expect(legend.threshold).toContain('12\u00a0чел.');
  });

  test('сотрудники: метка своего цвета и единица', () => {
    expect(legendOf(byId('lt_staff'))).toEqual({
      kind: 'swatch',
      color: '#1971C2',
      text: 'метка в зоне — чел.',
    });
  });

  test('камеры: цвет сектора и значения по умолчанию', () => {
    expect(legendOf(byId('lt_cameras'))).toEqual({
      kind: 'swatch',
      color: '#7048E8',
      text: 'сектор обзора; без атрибутов камеры — 90°, 6\u00a0м',
    });
  });

  test('обычный слой легенды не имеет', () => {
    expect(
      legendOf({ id: 'lt_x', label: 'x', note: '', representation: { kind: 'objects' } }),
    ).toEqual({ kind: 'none' });
  });

  test('слой состояния показывает значения и цвета из справочника', () => {
    expect(legendOf(byId('lt_equipment_status'))).toEqual({
      kind: 'palette',
      values: [
        { value: 'unknown', label: 'Не указано', color: '#868E96' },
        { value: 'working', label: 'Работает', color: '#087F5B' },
        { value: 'repair', label: 'В ремонте', color: '#A15C00' },
        { value: 'retired', label: 'Списано', color: '#C92A2A' },
      ],
    });
  });

  test('дробный порог пишется с запятой, единица не отрывается от числа', () => {
    const legend = legendOf({
      id: 'lt_x',
      label: 'x',
      note: '',
      representation: {
        kind: 'zone-heat',
        attribute: 'a',
        unit: 'м²',
        max: 2.5,
        colors: ['#000000', '#FFFFFF'],
      },
    });
    expect(legend.kind === 'scale' ? legend.high : '').toBe('2,5\u00a0м²');
  });
});

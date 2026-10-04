import { describe, expect, test } from 'vitest';
import type { Layer } from '../contracts/model';
import { editableContentLayer } from './content-layer';

const layers: Layer[] = [
  { id: 'l_info', name: 'Нагрузка', visible: true, locked: false, order: 0, typeId: 'lt_heat' },
  { id: 'l_locked', name: 'Заперт', visible: true, locked: true, order: 1, typeId: null },
  { id: 'l_main', name: 'Основной', visible: true, locked: false, order: 2, typeId: null },
  { id: 'l_second', name: 'Второй', visible: true, locked: false, order: 3, typeId: null },
];

describe('слой для содержимого плана', () => {
  test('пропускает информационный и запертый слои', () => {
    expect(editableContentLayer(layers)?.id).toBe('l_main');
  });

  test('при удалении слоя выбирает следующий допустимый', () => {
    expect(editableContentLayer(layers, 'l_main')?.id).toBe('l_second');
  });

  test('не подменяет отсутствие обычного слоя информационным', () => {
    expect(editableContentLayer(layers.slice(0, 2))).toBeUndefined();
  });
});

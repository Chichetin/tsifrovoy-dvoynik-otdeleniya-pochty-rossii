import { describe, expect, test } from 'vitest';
import layerTypes from '../../data/catalog/layer-types.json';
import nested from '../contracts/fixtures/nested.json';
import type { LayerType, PlanDocument } from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';
import { activeObjectColor, objectColorValue } from './object-color';

function statusPlan(): PlanDocument {
  const parsed = parsePlanDocument(nested);
  if (!parsed.ok) throw new Error('nested fixture invalid');
  const status = (layerTypes as LayerType[]).find((type) => type.id === 'lt_equipment_status');
  if (status === undefined) throw new Error('status layer missing');
  return {
    ...parsed.value,
    catalog: { ...parsed.value.catalog, layerTypes: [...parsed.value.catalog.layerTypes, status] },
    layers: [...parsed.value.layers, {
      id: 'l_status', name: status.label, visible: true, locked: false, order: 99, typeId: status.id,
    }],
  };
}

describe('object-colour information layer', () => {
  test('visible layer chooses the status colour; hidden layer changes neither data nor base view', () => {
    const plan = statusPlan();
    const status = activeObjectColor(plan);
    expect(status?.kind).toBe('object-color');
    if (status === null) return;
    expect(objectColorValue(status, {})).toEqual({ value: 'unknown', label: 'Не указано', color: '#868E96' });
    expect(objectColorValue(status, { equipmentStatus: 'repair' }).color).toBe('#A15C00');
    expect(objectColorValue(status, { equipmentStatus: 'bad-value' }).value).toBe('unknown');
    expect(activeObjectColor({ ...plan, layers: plan.layers.map((layer) => ({ ...layer, visible: false })) })).toBeNull();
  });

  test('second status-like layer comes from catalog data without new rendering code', () => {
    const plan = statusPlan();
    const second: LayerType = {
      id: 'lt_priority', label: 'Приоритет обслуживания',
      representation: {
        kind: 'object-color', attribute: 'servicePriority', defaultValue: 'ordinary',
        values: [
          { value: 'ordinary', label: 'Обычный', color: '#1971C2' },
          { value: 'urgent', label: 'Срочно', color: '#C92A2A' },
        ],
      },
      note: 'Приоритет назначается сотрудником вручную.',
    };
    const withSecond = {
      ...plan,
      catalog: { ...plan.catalog, layerTypes: [...plan.catalog.layerTypes, second] },
      layers: [...plan.layers, { id: 'l_priority', name: second.label, visible: true, locked: false, order: 100, typeId: second.id }],
    };
    expect(activeObjectColor(withSecond)?.attribute).toBe('servicePriority');
    expect(objectColorValue(activeObjectColor(withSecond)!, { servicePriority: 'urgent' }).color).toBe('#C92A2A');
  });
});

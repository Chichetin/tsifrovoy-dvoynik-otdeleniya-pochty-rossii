/**
 * U03: что удаляют Delete и Backspace и когда они отказываются.
 *
 * Правило одно на клавишу и кнопку панели, поэтому проверяется здесь, а не в
 * двух местах: зона на скрытом слое не удаляется (D-078 — удалять то, чего не
 * видишь, нельзя), а исчезнувшая из плана выбранная сущность не даёт команды.
 */

import { describe, expect, it } from 'vitest';
import type { Catalog, Layer, PlanDocument, Zone } from '../../contracts/model';
import { HIDDEN_ZONE_NOTICE } from './notice';
import { deleteIntent, isDeleteKey } from './delete-key';

const catalog: Catalog = {
  version: '1.0.0',
  objectTypes: [],
  zoneTypes: [{ id: 'zt_client', label: 'Клиентская зона', color: '#D0EBFF', attributes: [] }],
  layerTypes: [],
  rules: [],
};

function layer(overrides: Partial<Layer> = {}): Layer {
  return { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null, ...overrides };
}

function zone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: 'z_hall',
    typeId: 'zt_client',
    name: 'Клиентский зал',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    parentId: null,
    layerId: 'l_base',
    attributes: {},
    ...overrides,
  };
}

function plan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return {
    schemaVersion: 1,
    id: 'plan_test',
    name: 'Тестовый план',
    room: {
      id: 'room_main',
      boundary: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      ceilingHeight_m: 3,
    },
    walls: [{ id: 'w_north', from: [0, 4], to: [6, 4], thickness_m: 0.2, height_m: 3 }],
    openings: [
      {
        id: 'op_entrance',
        wallId: 'w_north',
        offset_m: 2,
        width_m: 1.2,
        kind: 'entrance',
        sill_m: 0,
        height_m: 2.1,
      },
    ],
    layers: [layer()],
    zones: [zone()],
    objects: [],
    catalog,
    extensions: {},
    ...overrides,
  };
}

describe('клавиша удаления', () => {
  it('Delete и Backspace равноправны, остальные клавиши не удаляют', () => {
    expect(isDeleteKey('Delete')).toBe(true);
    expect(isDeleteKey('Backspace')).toBe(true);
    expect(isDeleteKey('Escape')).toBe(false);
    expect(isDeleteKey('d')).toBe(false);
    expect(isDeleteKey('Enter')).toBe(false);
  });
});

describe('что удаляет выбор', () => {
  it('зона, перегородка и проём удаляются своими командами', () => {
    expect(deleteIntent({ kind: 'zone', id: 'z_hall' }, plan())).toEqual({
      kind: 'delete',
      command: { type: 'zone.delete', id: 'z_hall' },
      label: 'зону',
    });
    expect(deleteIntent({ kind: 'wall', id: 'w_north' }, plan())).toEqual({
      kind: 'delete',
      command: { type: 'wall.delete', id: 'w_north' },
      label: 'перегородку',
    });
    expect(deleteIntent({ kind: 'opening', id: 'op_entrance' }, plan())).toEqual({
      kind: 'delete',
      command: { type: 'opening.delete', id: 'op_entrance' },
      label: 'проём',
    });
  });

  it('помещение, объект и пустой выбор этому модулю не принадлежат', () => {
    expect(deleteIntent(null, plan())).toBeNull();
    expect(deleteIntent({ kind: 'room', id: 'room_main' }, plan())).toBeNull();
    // Объект удаляет свой слой (U04) — здесь команды быть не должно.
    expect(deleteIntent({ kind: 'object', id: 'eq_1' }, plan())).toBeNull();
    expect(deleteIntent({ kind: 'layer', id: 'l_base' }, plan())).toBeNull();
  });

  it('зона на скрытом слое не удаляется и объясняет отказ — D-078', () => {
    const hidden = plan({ layers: [layer({ visible: false })] });
    expect(deleteIntent({ kind: 'zone', id: 'z_hall' }, hidden)).toEqual({
      kind: 'refused',
      notice: HIDDEN_ZONE_NOTICE,
    });
  });

  it('зона на показанном слое удаляется, даже если скрыт соседний слой', () => {
    const mixed = plan({
      layers: [layer(), layer({ id: 'l_other', name: 'Второй', visible: false, order: 1 })],
    });
    expect(deleteIntent({ kind: 'zone', id: 'z_hall' }, mixed)?.kind).toBe('delete');
  });

  it('исчезнувшая сущность не даёт команды: удалять нечего', () => {
    expect(deleteIntent({ kind: 'zone', id: 'z_gone' }, plan())).toBeNull();
    expect(deleteIntent({ kind: 'wall', id: 'w_gone' }, plan())).toBeNull();
    expect(deleteIntent({ kind: 'opening', id: 'op_gone' }, plan())).toBeNull();
  });
});

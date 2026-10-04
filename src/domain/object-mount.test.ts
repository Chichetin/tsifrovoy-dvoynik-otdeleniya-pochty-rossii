import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Layer, PlanDocument } from '../contracts/model';
import {
  CEILING_BASE_M,
  HIDDEN_MOUNT_LAYER_ID,
  countByMount,
  mountScopeLayer,
  objectMount,
  revealMountOf,
  withHiddenMounts,
} from './object-mount';

function demo(name: string): PlanDocument {
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'demo', name), 'utf8')) as PlanDocument;
}

describe('напольные и потолочные объекты', () => {
  test('граница — 2,0 м по низу самого объекта, включительно', () => {
    expect(CEILING_BASE_M).toBe(2);
    expect(objectMount({ base_m: 0 })).toBe('floor');
    expect(objectMount({ base_m: 1.99 })).toBe('floor');
    expect(objectMount({ base_m: 2 })).toBe('ceiling');
    expect(objectMount({ base_m: 2.9 })).toBe('ceiling');
  });

  test('демо-план до: 11 потолочных — камеры, датчики, табло, вентиляция', () => {
    const plan = demo('before.json');
    const ceiling = plan.objects.filter((object) => objectMount(object) === 'ceiling');
    expect(new Set(ceiling.map((object) => object.typeId))).toEqual(
      new Set(['ot_camera', 'ot_fire_sensor', 'ot_info_display', 'ot_hvac']),
    );
    expect(countByMount(plan.objects, 'l_base')).toEqual({ floor: 42, ceiling: 11 });
  });

  test('демо-план после: одно табло убрано, скамья добавлена — 10 потолочных', () => {
    expect(countByMount(demo('after.json').objects, 'l_base')).toEqual({ floor: 43, ceiling: 10 });
  });

  test('делится первый обычный слой, информационные не в счёт', () => {
    const layers: Layer[] = [
      { id: 'l_info', name: 'Камеры', visible: true, locked: false, order: 0, typeId: 'lt_cameras' },
      { id: 'l_second', name: 'Второй', visible: true, locked: false, order: 2, typeId: null },
      { id: 'l_main', name: 'Основной', visible: true, locked: true, order: 1, typeId: null },
    ];
    expect(mountScopeLayer(layers)?.id).toBe('l_main');
    expect(mountScopeLayer(layers.slice(0, 1))).toBeUndefined();
  });

  test('скрытая группа уезжает на скрытый запертый слой вида, остальное не тронуто', () => {
    const plan = demo('before.json');
    const view = withHiddenMounts(plan, 'l_base', new Set(['ceiling']));
    const viewLayer = view.layers.find((layer) => layer.id === HIDDEN_MOUNT_LAYER_ID);
    expect(viewLayer).toMatchObject({ visible: false, locked: true });
    expect(view.objects).toHaveLength(plan.objects.length);
    const camera = view.objects.find((object) => object.id === 'eq_25');
    const bench = view.objects.find((object) => object.id === 'eq_6');
    expect(camera?.layerId).toBe(HIDDEN_MOUNT_LAYER_ID);
    expect(bench?.layerId).toBe('l_base');
    expect(view.zones).toBe(plan.zones);
    // The source document is left as it was.
    expect(plan.objects.find((object) => object.id === 'eq_25')?.layerId).toBe('l_base');
    expect(plan.layers.some((layer) => layer.id === HIDDEN_MOUNT_LAYER_ID)).toBe(false);
  });

  test('скрыть напольные — прячет только напольные', () => {
    const view = withHiddenMounts(demo('before.json'), 'l_base', new Set(['floor']));
    const hidden = view.objects.filter((object) => object.layerId === HIDDEN_MOUNT_LAYER_ID);
    expect(hidden).toHaveLength(42);
    expect(hidden.every((object) => object.base_m < CEILING_BASE_M)).toBe(true);
  });

  test('ничего не скрыто или группа в другом слое — тот же документ', () => {
    const plan = demo('before.json');
    expect(withHiddenMounts(plan, 'l_base', new Set())).toBe(plan);
    expect(withHiddenMounts(plan, 'l_other', new Set(['ceiling', 'floor']))).toBe(plan);
  });

  test('поставленный объект скрытой группы открывает свою группу, чужую не трогает', () => {
    const hidden = new Set(['ceiling', 'floor'] as const);
    const camera = { base_m: 2.6, layerId: 'l_base' };
    expect([...revealMountOf(hidden, 'l_base', camera)]).toEqual(['floor']);
    expect([...revealMountOf(hidden, 'l_base', { base_m: 0, layerId: 'l_base' })]).toEqual(['ceiling']);
    // Nothing to reveal — the very same set, so React skips the update.
    const onlyFloor = new Set(['floor'] as const);
    expect(revealMountOf(onlyFloor, 'l_base', camera)).toBe(onlyFloor);
    expect(revealMountOf(hidden, 'l_base', { base_m: 2.6, layerId: 'l_other' })).toBe(hidden);
  });
});

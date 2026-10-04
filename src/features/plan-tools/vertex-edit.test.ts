import { expect, it } from 'vitest';
import type { Zone } from '../../contracts/model';
import { newZoneBase } from './vertex-edit';

const zone = (id: string, typeId: string, side: number): Zone => ({
  id,
  typeId,
  name: id,
  polygon: [[0, 0], [side, 0], [side, side], [0, side]],
  parentId: null,
  layerId: 'l_base',
  attributes: {},
});

it('зона внутри другой берёт её тип и родителя, зона вне — тип по умолчанию без родителя', () => {
  const zones = [zone('z_hall', 'zt_service', 10)];
  const inside = [[1, 1], [3, 1], [3, 3], [1, 3]] as [number, number][];
  const outside = [[11, 1], [13, 1], [13, 3], [11, 3]] as [number, number][];
  expect(newZoneBase(inside, zones, 'zt_default')).toEqual({ parentId: 'z_hall', typeId: 'zt_service' });
  expect(newZoneBase(outside, zones, 'zt_default')).toEqual({ parentId: null, typeId: 'zt_default' });
});

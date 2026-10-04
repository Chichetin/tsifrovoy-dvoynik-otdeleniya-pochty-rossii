import { expect, it } from 'vitest';
import type { Polygon, Wall } from '../../contracts/model';
import { wallMountPlacement } from './wall-mount';

const walls: Wall[] = [
  { id: 'w_mid', from: [9.3, 0], to: [9.3, 7], thickness_m: 0.25, height_m: 3 },
  { id: 'w_east', from: [15, 0], to: [15, 7], thickness_m: 0.25, height_m: 3 },
];
const room: Polygon = [
  [0, 0],
  [15, 0],
  [15, 7],
  [0, 7],
];

it('прижатый прибор не заходит в стену при округлении до сантиметра (#119)', () => {
  // Точный центр 9,125: округление к ближнему дало бы 9,13 и 5 мм в стене.
  expect(wallMountPlacement(walls, room, [1.1, 0.1], [9, 3.6])?.position).toEqual([9.12, 3.6]);
  // Точный центр на сетке остаётся вплотную, без лишнего сантиметра.
  expect(wallMountPlacement(walls, room, [0.6, 0.25], [14.5, 5])?.position).toEqual([14.75, 5]);
});

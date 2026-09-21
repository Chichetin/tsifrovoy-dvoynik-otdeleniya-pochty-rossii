import { describe, expect, it } from 'vitest';
import { zoneDepth } from '../../domain/relations';
import { ZONE_NAME_FILLS, zoneNameFill } from './zone-name-color';

describe('zoneNameFill (D-250)', () => {
  it('gives the root, a nested and a twice nested zone three different colours', () => {
    const fills = [zoneNameFill(0), zoneNameFill(1), zoneNameFill(2)];
    expect(fills).toEqual([...ZONE_NAME_FILLS]);
    expect(new Set(fills).size).toBe(3);
  });

  it('keeps the last colour for anything deeper than two levels', () => {
    expect(zoneNameFill(3)).toBe(ZONE_NAME_FILLS[2]);
    expect(zoneNameFill(7)).toBe(ZONE_NAME_FILLS[2]);
  });

  it('treats a cycle in parentId (null) and a negative depth as a root', () => {
    expect(zoneNameFill(null)).toBe(ZONE_NAME_FILLS[0]);
    expect(zoneNameFill(-1)).toBe(ZONE_NAME_FILLS[0]);
  });

  it('paints a zone whose parent is missing from the plan as nested, not as a root', () => {
    const square: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const zones = [{ id: 'z_orphan', polygon: square, parentId: 'z_gone' }];
    expect(zoneDepth('z_orphan', zones)).toBe(1);
    expect(zoneNameFill(zoneDepth('z_orphan', zones))).toBe(ZONE_NAME_FILLS[1]);
  });
});

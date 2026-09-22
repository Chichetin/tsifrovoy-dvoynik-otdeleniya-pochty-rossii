import { describe, expect, it } from 'vitest';
import { sameRef, showsPropsCard } from './props-column';

describe('showsPropsCard', () => {
  const zone = { kind: 'zone', id: 'z_1' } as const;
  const object = { kind: 'object', id: 'z_1' } as const;

  it('shows nothing without a selection', () => {
    expect(showsPropsCard(null, null)).toBe(false);
    expect(showsPropsCard(null, zone)).toBe(false);
  });

  it('shows the card for any selection the person has not sent back to a tab', () => {
    expect(showsPropsCard(zone, null)).toBe(true);
    for (const kind of ['room', 'zone', 'object', 'wall', 'opening'] as const) {
      expect(showsPropsCard({ kind, id: 'x' }, null)).toBe(true);
    }
  });

  it('hides the card for the very selection it was sent away for, and only for it', () => {
    expect(showsPropsCard(zone, { kind: 'zone', id: 'z_1' })).toBe(false);
    // Same id, another kind — a different pick.
    expect(showsPropsCard(object, zone)).toBe(true);
    expect(showsPropsCard(zone, { kind: 'zone', id: 'z_2' })).toBe(true);
  });

  it('never covers the layers panel with a layer selection', () => {
    expect(showsPropsCard({ kind: 'layer', id: 'l_1' }, null)).toBe(false);
  });
});

describe('sameRef', () => {
  it('compares kind and id, null only with null', () => {
    expect(sameRef(null, null)).toBe(true);
    expect(sameRef({ kind: 'zone', id: 'a' }, null)).toBe(false);
    expect(sameRef(null, { kind: 'zone', id: 'a' })).toBe(false);
    expect(sameRef({ kind: 'zone', id: 'a' }, { kind: 'zone', id: 'a' })).toBe(true);
    expect(sameRef({ kind: 'zone', id: 'a' }, { kind: 'object', id: 'a' })).toBe(false);
  });
});

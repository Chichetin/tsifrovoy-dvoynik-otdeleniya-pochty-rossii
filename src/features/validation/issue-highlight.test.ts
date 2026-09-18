/**
 * V02 (подсветка): что попадает на холст по клику в списке находок.
 */

import { describe, expect, test } from 'vitest';
import type { Issue, Polygon } from '../../contracts/model';
import { HIGHLIGHT_COLORS, highlightsFor } from './issue-highlight';

const square: Polygon = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

function issue(code: string, refs: Issue['refs'], polygon?: Polygon, severity: Issue['severity'] = 'error'): Issue {
  return polygon === undefined
    ? { code, severity, message: code, refs }
    : { code, severity, message: code, refs, polygon };
}

const rack = { kind: 'object', id: 'eq_rack_1' } as const;
const cashier = { kind: 'object', id: 'eq_cashier_1' } as const;
const zone = { kind: 'zone', id: 'z_back' } as const;

const issues: Issue[] = [
  issue('OBJECT_COLLISION', [cashier, rack], square),
  issue('OBJECT_HITS_WALL', [rack, { kind: 'wall', id: 'w_inner_1' }], square),
  issue('OBJECT_OUTSIDE_ZONE', [rack, zone], square),
  issue('RULE_COUNT_BELOW_MIN', [zone], square, 'warning'),
  issue('RULE_ENTRANCE_MISSING', [zone]),
];

describe('подсветка находок', () => {
  test('без фокуса на холсте ничего не подсвечивается', () => {
    expect(highlightsFor(issues, null)).toEqual([]);
  });

  test('фокус на объекте собирает все находки о нём', () => {
    const codes = highlightsFor(issues, rack).map((entry) => entry.code);
    expect(codes).toEqual(['OBJECT_COLLISION', 'OBJECT_HITS_WALL', 'OBJECT_OUTSIDE_ZONE']);
  });

  test('находка без полигона не подсвечивается, даже если ссылается на фокус', () => {
    const codes = highlightsFor(issues, zone).map((entry) => entry.code);
    expect(codes).toEqual(['OBJECT_OUTSIDE_ZONE', 'RULE_COUNT_BELOW_MIN']);
  });

  test('совпадать должны и вид, и идентификатор ссылки', () => {
    expect(highlightsFor(issues, { kind: 'zone', id: 'eq_rack_1' })).toEqual([]);
  });

  test('серьёзность и полигон приходят вместе с кодом', () => {
    const [first] = highlightsFor(issues, cashier);
    expect(first?.severity).toBe('error');
    expect(first?.polygon).toBe(square);
    expect(HIGHLIGHT_COLORS[first?.severity ?? 'error']).toMatch(/^#[0-9A-F]{6}$/);
  });

  test('вырожденный полигон не подсвечивается', () => {
    const broken = [issue('X', [rack], [[0, 0], [1, 1]] as Polygon)];
    expect(highlightsFor(broken, rack)).toEqual([]);
  });
});

/**
 * V02 (подсветка): что попадает на холст по клику в списке находок.
 */

import { describe, expect, test } from 'vitest';
import type { Issue, Polygon, Viewport } from '../../contracts/model';
import { HIGHLIGHT_COLORS, issueMarkers } from '../../domain/issue-markers';
import { highlightsFor, markerAnchor } from './issue-highlight';

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

describe('маркеры находок видны без клика (operator №10, D-157)', () => {
  test('без фокуса у каждой затронутой сущности свой маркер с числом находок', () => {
    const markers = issueMarkers(issues, null);
    expect(markers.map((marker) => [marker.ref.id, marker.count])).toEqual([
      ['eq_cashier_1', 1],
      ['eq_rack_1', 2],
      ['z_back', 1],
    ]);
    expect(markers.every((marker) => !marker.focused)).toBe(true);
  });

  test('находка без полигона маркера не даёт и в число не входит', () => {
    const zoneMarker = issueMarkers(issues, null).find((marker) => marker.ref.id === 'z_back');
    expect(zoneMarker?.count).toBe(1);
    expect(issueMarkers([issue('RULE_ENTRANCE_MISSING', [zone])], null)).toEqual([]);
    expect(issueMarkers([issue('X', [rack], [[0, 0], [1, 1]] as Polygon)], null)).toEqual([]);
    expect(issueMarkers([issue('X', [], square)], null)).toEqual([]);
  });

  test('цвет маркера — по самой серьёзной находке сущности', () => {
    const mixed = [
      issue('RULE_COUNT_BELOW_MIN', [zone], square, 'warning'),
      issue('ZONE_OUTSIDE_ROOM', [zone], square, 'error'),
    ];
    expect(issueMarkers(mixed, null)[0]?.severity).toBe('error');
    expect(issueMarkers([mixed[0]!], null)[0]?.severity).toBe('warning');
    expect(issueMarkers([...mixed].reverse(), null)[0]?.severity).toBe('error');
  });

  test('выделенная сущность помечена, соседи — нет; совпадают вид и id', () => {
    const markers = issueMarkers(issues, rack);
    expect(markers.filter((marker) => marker.focused).map((marker) => marker.ref.id)).toEqual([
      'eq_rack_1',
    ]);
    expect(issueMarkers(issues, { kind: 'zone', id: 'eq_rack_1' }).some((m) => m.focused)).toBe(
      false,
    );
  });

  test('маркер стоит в правом верхнем углу фигуры на экране', () => {
    // Ось Y модели вверх, экрана — вниз: верх фигуры на экране — это max Y модели.
    const viewport: Viewport = { origin: [100, 500], scale: 10 };
    const shape: Polygon = [
      [1, 2],
      [4, 2],
      [4, 6],
      [1, 6],
    ];
    expect(markerAnchor(shape, viewport)).toEqual([140, 440]);
  });
});

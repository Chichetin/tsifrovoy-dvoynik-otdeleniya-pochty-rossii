/**
 * D-277: the outline as a contract. What the file may carry, what loading
 * fills in, and in which order the shape resolves — object, type, symbol,
 * rectangle.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Equipment, PlanDocument, Point } from './model';
import { CIRCLE_OUTLINE_VERTICES, UNIT_SQUARE, normalizeOutline, outlineFits, symbolOutline, typeOutline } from './outline';
import { parsePlanDocument } from './schema';

function raw(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8'),
  ) as Record<string, unknown>;
}

function parsed(input: unknown): PlanDocument {
  const result = parsePlanDocument(input);
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path}: ${entry.message}`).join('; '));
  return result.value;
}

function object(plan: PlanDocument, id: string): Equipment {
  const found = plan.objects.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

const L_SHAPE: Point[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0], [0, 0], [0, 0.5], [-0.5, 0.5]];

describe('контур объекта в контракте (D-277)', () => {
  test('файл без поля открывается: круг и треугольник типа становятся контуром объекта, прямоугольник — нет', () => {
    const plan = parsed(raw('outline.json'));
    const round = object(plan, 'eq_round_table').outline;
    expect(round).toHaveLength(CIRCLE_OUTLINE_VERTICES);
    expect(round).toBe(symbolOutline('circle'));
    expect(object(plan, 'eq_camera').outline).toEqual([[0, 0.5], [-0.5, -0.5], [0.5, -0.5]]);

    const minimal = parsed(raw('minimal.json'));
    expect(minimal.objects[0]).not.toHaveProperty('outline');
  });

  test('порядок формы: свой контур объекта → контур типа → символ типа', () => {
    const plan = parsed(raw('outline.json'));
    // Type outline wins over symbol and fills an object without its own.
    expect(object(plan, 'eq_corner_desk').outline).toEqual(L_SHAPE);
    // The object's own outline wins over its (rectangle) type.
    expect(object(plan, 'eq_trapezoid').outline).toEqual([[-0.5, -0.5], [0.5, -0.5], [0.25, 0.5], [-0.25, 0.5]]);

    const input = raw('outline.json') as { objects: Record<string, unknown>[] };
    const own: Point[] = [[0, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    input.objects = input.objects.map((entry) => (entry.id === 'eq_corner_desk' ? { ...entry, outline: own } : entry));
    expect(object(parsed(input), 'eq_corner_desk').outline).toEqual(own);
  });

  test('контур типа важнее символа; прямоугольнику контур не нужен', () => {
    const plan = parsed(raw('outline.json'));
    const types = new Map(plan.catalog.objectTypes.map((type) => [type.id, type]));
    expect(typeOutline({ ...types.get('ot_round_table')!, outline: L_SHAPE })).toEqual(L_SHAPE);
    expect(typeOutline(types.get('ot_workplace')!)).toBeUndefined();
    expect(symbolOutline('rect')).toBeUndefined();
  });

  test('рамка контура с погрешностью округления растягивается ровно до ±0,5', () => {
    const input = raw('outline.json') as { objects: Record<string, unknown>[] };
    input.objects = input.objects.map((entry) =>
      entry.id === 'eq_trapezoid'
        ? { ...entry, outline: [[-0.4995, -0.5], [0.5004, -0.5], [0.25, 0.5003], [-0.25, 0.5]] }
        : entry,
    );
    const ring = object(parsed(input), 'eq_trapezoid').outline!;
    const xs = ring.map((point) => point[0]);
    const ys = ring.map((point) => point[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([-0.5, 0.5, -0.5, 0.5]);
  });

  test.each([
    ['рамка меньше габарита', [[-0.3, -0.5], [0.5, -0.5], [0.5, 0.5]]],
    ['рамка больше габарита', [[-0.5, -0.5], [0.7, -0.5], [0.5, 0.5]]],
    ['контур в метрах, а не в долях', [[-0.8, -0.4], [0.8, -0.4], [0.8, 0.4], [-0.8, 0.4]]],
    ['меньше трёх вершин', [[-0.5, -0.5], [0.5, 0.5]]],
  ])('отказ: %s', (_name, outline) => {
    const input = raw('outline.json') as { objects: Record<string, unknown>[] };
    input.objects = input.objects.map((entry) => (entry.id === 'eq_trapezoid' ? { ...entry, outline } : entry));
    const result = parsePlanDocument(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('objects.3.outline');
  });

  test('контур типа в справочнике проверяется так же', () => {
    const input = raw('outline.json') as { catalog: { objectTypes: Record<string, unknown>[] } };
    input.catalog.objectTypes = input.catalog.objectTypes.map((type) =>
      type.id === 'ot_corner_desk' ? { ...type, outline: [[0, 0], [1.6, 0], [0, 1.6]] } : type,
    );
    expect(parsePlanDocument(input).ok).toBe(false);
  });

  test('самопересекающийся контур открывается: это геометрия, её сообщает проверка плана', () => {
    const bowtie: Point[] = [[-0.5, -0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5]];
    expect(outlineFits(bowtie)).toBe(true);
    const input = raw('outline.json') as { objects: Record<string, unknown>[] };
    input.objects = input.objects.map((entry) => (entry.id === 'eq_trapezoid' ? { ...entry, outline: bowtie } : entry));
    expect(object(parsed(input), 'eq_trapezoid').outline).toEqual(bowtie);
  });

  test('точный контур не пересчитывается: файл не набирает шум округления', () => {
    expect(normalizeOutline(UNIT_SQUARE)).toBe(UNIT_SQUARE);
    const circle = symbolOutline('circle')!;
    expect(normalizeOutline(circle)).toBe(circle);
  });
});

/**
 * D-277: how an object gets and keeps its shape through commands. A new
 * object takes its type's outline; changing the type carries an inherited
 * outline along and leaves an object's own; a catalog whose type changed
 * shape reshapes the objects that inherited it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Equipment, PlanDocument, Point, Result } from '../../contracts/model';
import { CONTRACT_ISSUE_CODES } from '../../contracts/model';
import { symbolOutline } from '../../contracts/outline';
import { parsePlanDocument } from '../../contracts/schema';
import { applyCommand } from './index';

function outlinePlan(): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', 'outline.json');
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error('fixture outline.json не проходит схему');
  return parsed.value;
}

function expectOk(result: Result<PlanDocument>): PlanDocument {
  if (!result.ok) throw new Error(`команда отклонена: ${result.issues.map((issue) => issue.code).join(', ')}`);
  return result.value;
}

function find(plan: PlanDocument, id: string): Equipment {
  const found = plan.objects.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

const L_SHAPE: Point[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0], [0, 0], [0, 0.5], [-0.5, 0.5]];

function fresh(typeId: string): Equipment {
  return {
    id: 'eq_new',
    typeId,
    label: 'Новый',
    position: [7, 3],
    size_m: [1, 1],
    rotation_deg: 0,
    base_m: 0,
    height_m: 0.75,
    zoneId: null,
    layerId: 'l_base',
    attributes: {},
  };
}

describe('форма объекта в командах (D-277)', () => {
  test('новый объект из библиотеки получает форму типа: круг, Г-образный контур, прямоугольник без поля', () => {
    const plan = outlinePlan();
    const round = expectOk(applyCommand(plan, { type: 'object.put', object: fresh('ot_round_table') }));
    expect(find(round, 'eq_new').outline).toBe(symbolOutline('circle'));
    const corner = expectOk(applyCommand(plan, { type: 'object.put', object: fresh('ot_corner_desk') }));
    expect(find(corner, 'eq_new').outline).toEqual(L_SHAPE);
    const plain = expectOk(applyCommand(plan, { type: 'object.put', object: fresh('ot_workplace') }));
    expect(find(plain, 'eq_new')).not.toHaveProperty('outline');
  });

  test('смена типа: унаследованная форма меняется на форму нового типа', () => {
    const plan = outlinePlan();
    const table = find(plan, 'eq_round_table');
    const asDesk = expectOk(applyCommand(plan, { type: 'object.put', object: { ...table, typeId: 'ot_corner_desk' } }));
    expect(find(asDesk, 'eq_round_table').outline).toEqual(L_SHAPE);
    const asPlain = expectOk(applyCommand(plan, { type: 'object.put', object: { ...table, typeId: 'ot_workplace' } }));
    expect(find(asPlain, 'eq_round_table')).not.toHaveProperty('outline');
  });

  test('смена типа не стирает собственный контур объекта', () => {
    const plan = outlinePlan();
    const trapezoid = find(plan, 'eq_trapezoid');
    const next = expectOk(applyCommand(plan, { type: 'object.put', object: { ...trapezoid, typeId: 'ot_round_table' } }));
    expect(find(next, 'eq_trapezoid').outline).toEqual(trapezoid.outline);
  });

  test('перенос и растяжение сохраняют контур', () => {
    const plan = outlinePlan();
    const desk = find(plan, 'eq_corner_desk');
    const next = expectOk(
      applyCommand(plan, { type: 'object.put', object: { ...desk, position: [3, 3], size_m: [2, 1.2] } }),
    );
    expect(find(next, 'eq_corner_desk').outline).toEqual(L_SHAPE);
  });

  test('контур, который файл не примет, редактор тоже не принимает', () => {
    const plan = outlinePlan();
    const desk = find(plan, 'eq_corner_desk');
    const result = applyCommand(plan, {
      type: 'object.put',
      object: { ...desk, outline: [[0, 0], [1.6, 0], [0, 1.6]] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
      expect(result.issues[0]?.path).toBe('/outline');
    }
  });

  test('справочник: тип сменил форму — объекты с унаследованной формой следуют, со своей — нет', () => {
    const plan = outlinePlan();
    const catalog = {
      ...plan.catalog,
      objectTypes: plan.catalog.objectTypes.map((type) =>
        type.id === 'ot_round_table'
          ? { ...type, symbol: 'triangle' as const }
          : type.id === 'ot_workplace'
            ? { ...type, outline: L_SHAPE }
            : type,
      ),
    };
    const next = expectOk(applyCommand(plan, { type: 'catalog.replace', catalog }));
    expect(find(next, 'eq_round_table').outline).toBe(symbolOutline('triangle'));
    // eq_trapezoid is a workplace with an outline of its own: it keeps it.
    expect(find(next, 'eq_trapezoid').outline).toEqual(find(plan, 'eq_trapezoid').outline);
    expect(find(next, 'eq_corner_desk').outline).toEqual(L_SHAPE);
  });
});

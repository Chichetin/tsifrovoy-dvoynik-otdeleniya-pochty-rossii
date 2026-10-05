/**
 * #176, mode A «Подсказки»: one settled edit — one hint about what this edit
 * did. Old findings are not repeated, numbers are the calculation's.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { measurePlan } from '../metrics';
import { formatMeasure } from '../number-format';
import { editHint, editHintSnapshot, editHintText } from './edit-hints';

const TODAY = '2026-10-05';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(path);
  return parsed.value;
}

const before = load('demo/before.json');
const snap = (plan: PlanDocument) => editHintSnapshot(plan, TODAY);

function without(plan: PlanDocument, id: string): PlanDocument {
  return { ...plan, objects: plan.objects.filter((object) => object.id !== id) };
}

describe('подсказка после правки', () => {
  test('нет правки — нет подсказки', () => {
    const base = snap(before);
    expect(editHint(base, base)).toBeNull();
    expect(editHint(base, snap({ ...before }))).toBeNull();
  });

  test('другой план — не правка', () => {
    expect(editHint(snap(before), snap({ ...before, id: 'other-plan' }))).toBeNull();
  });

  test('удалили камеру, которой требует правило: одна причина, правило команды, объект не в фокусе', () => {
    const hint = editHint(snap(before), snap(without(before, 'eq_39')));
    expect(hint).not.toBeNull();
    expect(hint!.subject).toBe('Удалён объект «Камера служебной зоны».');
    expect(hint!.target).toBeNull();
    const rule = hint!.items.filter((item) => item.key.includes('rule_camera_min'));
    expect(rule).toHaveLength(1);
    expect(rule[0]).toMatchObject({ tone: 'problem', refs: [{ kind: 'zone', id: 'z_back' }] });
    expect(rule[0]!.text).toContain('0 шт. при минимуме 1');
    expect(rule[0]!.text).toContain('Правило команды');
    // validatePlan's RULE_COUNT_BELOW_MIN is the same reason: not said twice.
    expect(hint!.items.filter((item) => item.text.includes('Камера видеонаблюдения'))).toHaveLength(1);
  });

  test('старые находки не повторяются', () => {
    const base = snap(before);
    const hint = editHint(base, snap(without(before, 'eq_39')));
    const oldKeys = new Set([...base.issues.keys()].map((key) => `issue|${key}`));
    expect(hint!.items.some((item) => item.tone === 'problem' && oldKeys.has(item.key))).toBe(false);
  });

  test('перенос в другую зону называет обе зоны по имени, id — только в refs', () => {
    const after: PlanDocument = {
      ...before,
      objects: before.objects.map((object) =>
        object.id === 'eq_11' ? { ...object, position: [12, 4.4], zoneId: 'z_back' } : object,
      ),
    };
    const hint = editHint(snap(before), snap(after));
    expect(hint!.subject).toBe('Перенесён объект «Окно 2 — платежи».');
    expect(hint!.target).toEqual({ kind: 'object', id: 'eq_11' });
    const move = hint!.items.find((item) => item.key.startsWith('zone|eq_11|'));
    expect(move?.text).toBe('Объект «Окно 2 — платежи» вышел из зоны «Клиентский зал» в зону «Служебная зона».');
    expect(editHintText(hint!)).not.toMatch(/\beq_11\b|\bz_back\b|\bz_client\b/);
  });

  test('свободная площадь — числа measurePlan, в тексте округлены', () => {
    const after = without(before, 'eq_36');
    const hint = editHint(snap(before), snap(after));
    const was = measurePlan(before);
    const now = measurePlan(after);
    if (!was.ok || !now.ok) throw new Error('measurePlan');
    expect(hint!.free_m2).toEqual({ before: was.value.room.free_m2, after: now.value.room.free_m2 });
    expect(editHintText(hint!)).toContain(
      `Свободно ${formatMeasure(was.value.room.free_m2, '', 1)} → ${formatMeasure(now.value.room.free_m2, 'м²', 1)}.`,
    );
  });

  test('отмена правки снимает причину: обратное сравнение говорит «выполнено», а не «не хватает»', () => {
    const removed = snap(without(before, 'eq_39'));
    const hint = editHint(removed, snap(before));
    const rule = hint!.items.find((item) => item.key.includes('rule_camera_min'));
    expect(rule?.tone).toBe('fixed');
  });
});

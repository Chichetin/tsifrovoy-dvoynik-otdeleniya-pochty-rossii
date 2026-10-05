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

  test('старая находка не повторяется, даже когда её текст изменился', () => {
    // The queue kiosk is 6,62 m from the entrance (norm 3 m); moved closer it
    // is still too far: the finding keeps its key, its number changes.
    const moved: PlanDocument = {
      ...before,
      objects: before.objects.map((object) => (object.id === 'eq_1' ? { ...object, position: [3, 2] } : object)),
    };
    const far = (plan: PlanDocument) =>
      [...snap(plan).issues.values()].filter((issue) => issue.code === 'RULE_TOO_FAR_FROM_ENTRANCE' && issue.refs.some((ref) => ref.id === 'eq_1'));
    const [was] = far(before);
    const [now] = far(moved);
    expect(was?.message).toBeDefined();
    expect(now?.message).toBeDefined();
    expect(now!.message).not.toBe(was!.message);
    const hint = editHint(snap(before), snap(moved));
    expect((hint?.items ?? []).filter((item) => item.key.includes('RULE_TOO_FAR_FROM_ENTRANCE'))).toEqual([]);
  });

  test('окно перенесено вне зон — о нём ровно один пункт, а не «вышел из зоны» и ZONE_UNASSIGNED', () => {
    // The demo floor is all zones; without the staff room its corner is free floor of no zone.
    const base: PlanDocument = {
      ...before,
      zones: before.zones.filter((zone) => zone.id !== 'z_staff'),
      objects: before.objects.map((object) => (object.zoneId === 'z_staff' ? { ...object, zoneId: null } : object)),
    };
    const moved: PlanDocument = {
      ...base,
      objects: base.objects.map((object) => (object.id === 'eq_11' ? { ...object, position: [7, 8.6], zoneId: null } : object)),
    };
    const hint = editHint(snap(base), snap(moved));
    const aboutWindow = hint!.items.filter((item) => item.refs.some((ref) => ref.kind === 'object' && ref.id === 'eq_11'));
    expect(aboutWindow).toHaveLength(1);
    expect(aboutWindow[0]!.text).toBe('Объект «Окно 2 — платежи» вышел из зоны «Клиентский зал» и теперь вне зон.');
    // Back into a zone: «теперь в зоне», no separate «Исправлено: … ни в одной зоне».
    const back = editHint(snap(moved), snap({ ...moved, objects: moved.objects.map((object) => (object.id === 'eq_11' ? { ...object, position: [3.5, 5.2], zoneId: 'z_client' } : object)) }));
    expect(back!.items.filter((item) => item.refs.some((ref) => ref.kind === 'object' && ref.id === 'eq_11'))).toHaveLength(1);
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

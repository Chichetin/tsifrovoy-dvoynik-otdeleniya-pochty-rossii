/**
 * #176, mode A «Подсказки»: what the last edit of the plan changed, counted by
 * code, never by a model.
 *
 * A snapshot holds what the checks say about one document: findings of
 * `validatePlan`, stocking violations of `checkEquipment`, free floor of
 * `measurePlan` and camera coverage. Two snapshots — before and after one
 * settled edit — give one hint: only what this edit caused or fixed. A finding
 * that was there before the edit is not repeated.
 *
 * Text names zones and objects by their names (D-320); ids travel in `refs`,
 * so the panel puts them into `title` and the focus button.
 */

import type { Change, Recommendation } from '../../contracts/advice';
import type { Id, PlanDocument, Ref } from '../../contracts/model';
import { findObjectType } from '../catalog';
import { measurePlan } from '../metrics';
import { formatMeasure } from '../number-format';
import { RELATION_ISSUE_CODES } from '../relations';
import { VALIDATION_ISSUE_CODES, localToday, validatePlan, type ValidationIssue } from '../validation';
import { cameraCoverage } from './camera-coverage';
import { diffPlans } from './compare';
import { checkEquipment } from './equipment';

/** `problem` — the edit caused it, `fixed` — the edit removed it, `info` — a fact of the edit. */
export type EditHintTone = 'problem' | 'fixed' | 'info';

export type EditHintItem = {
  /** One reason, one key: the same reason is never said twice in a hint. */
  key: string;
  tone: EditHintTone;
  /** A sentence with names, no bare ids. */
  text: string;
  refs: Ref[];
};

export type EditHintNumber = { before: number; after: number };

export type EditHint = {
  /** What the edit was: «Перенесён объект «Окно 2 — платежи».» */
  subject: string;
  /** The entity the edit touched, still in the plan; a click on the hint focuses it. */
  target: Ref | null;
  items: EditHintItem[];
  /** Reasons beyond `EDIT_HINT_LIMIT.items`, counted, not listed. */
  more: number;
  /** Free floor of the room, m², from `measurePlan`. Null — unchanged or not computable. */
  free_m2: EditHintNumber | null;
  /** Share of client zones seen by cameras, %, from `cameraCoverage`. Null — unchanged or no client zones. */
  coverage_percent: EditHintNumber | null;
};

export type EditHintSnapshot = {
  plan: PlanDocument;
  issues: Map<string, ValidationIssue>;
  equipment: Map<string, Recommendation>;
  free_m2: number | null;
  coverage_percent: number | null;
};

export const EDIT_HINT_LIMIT = {
  /** Reasons listed in one hint; the rest go to `more`. */
  items: 4,
  /** Smaller changes are rounding, not an effect of the edit. */
  area_m2: 0.005,
  percent: 0.05,
} as const;

/**
 * Stocking counts are said by `checkEquipment`, with the rule and its source.
 * The same shortage from `validatePlan` would be one reason said twice.
 */
const SKIPPED_ISSUE_CODES: ReadonlySet<string> = new Set([
  VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN,
  VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX,
]);

function refKey(ref: Ref): string {
  return `${ref.kind}:${ref.id}`;
}

/** A finding is the same finding while its rule and its subjects are the same; the numbers in its text may move. */
function issueKey(issue: ValidationIssue): string {
  return `${issue.code}|${issue.refs.map(refKey).sort().join(',')}`;
}

function coverageOf(plan: PlanDocument): number | null {
  for (const type of plan.catalog.layerTypes) {
    if (type.representation.kind !== 'object-field') continue;
    return cameraCoverage(plan, type.representation).total.percent;
  }
  return null;
}

/** Everything the checks say about one document. `today` fixes the maintenance dates for tests. */
export function editHintSnapshot(plan: PlanDocument, today: string = localToday()): EditHintSnapshot {
  const issues = new Map<string, ValidationIssue>();
  for (const issue of validatePlan(plan, today)) {
    if (!SKIPPED_ISSUE_CODES.has(issue.code)) issues.set(issueKey(issue), issue);
  }
  const equipment = new Map(checkEquipment(plan, { scenario: 'equipment', zoneId: null }).map((entry) => [entry.id, entry]));
  const metrics = measurePlan(plan);
  return {
    plan,
    issues,
    equipment,
    free_m2: metrics.ok ? metrics.value.room.free_m2 : null,
    coverage_percent: coverageOf(plan),
  };
}

function objectName(plan: PlanDocument, id: Id): string {
  return plan.objects.find((object) => object.id === id)?.label ?? 'без названия';
}

function zoneName(plan: PlanDocument, id: Id): string {
  return plan.zones.find((zone) => zone.id === id)?.name ?? 'без названия';
}

const OBJECT_VERBS: Record<Change['kind'], string> = {
  added: 'Добавлен',
  removed: 'Удалён',
  moved: 'Перенесён',
  updated: 'Изменён',
};

const ZONE_VERBS: Record<Change['kind'], string> = {
  added: 'Добавлена',
  removed: 'Удалена',
  moved: 'Изменена',
  updated: 'Изменена',
};

const COUNT_VERBS: Record<Change['kind'], string> = {
  added: 'Добавлено',
  removed: 'Удалено',
  moved: 'Перенесено',
  updated: 'Изменено',
};

function subjectOf(before: PlanDocument, after: PlanDocument, changes: Change[]): { subject: string; target: Ref | null } {
  const objects = changes.filter((change) => change.ref.kind === 'object');
  const zones = changes.filter((change) => change.ref.kind === 'zone');
  const alive = (change: Change): boolean => change.kind !== 'removed';
  const target = [...objects, ...zones].find(alive)?.ref ?? null;
  const [first] = objects;
  if (objects.length === 1 && first !== undefined) {
    const plan = first.kind === 'removed' ? before : after;
    return { subject: `${OBJECT_VERBS[first.kind]} объект «${objectName(plan, first.ref.id)}».`, target };
  }
  if (objects.length > 1) {
    const kinds = new Set(objects.map((change) => change.kind));
    const [kind] = kinds;
    const verb = kinds.size === 1 && kind !== undefined ? COUNT_VERBS[kind] : 'Изменено';
    return { subject: `${verb} объектов: ${objects.length}.`, target };
  }
  const [zone] = zones;
  if (zones.length === 1 && zone !== undefined) {
    const plan = zone.kind === 'removed' ? before : after;
    return { subject: `${ZONE_VERBS[zone.kind]} зона «${zoneName(plan, zone.ref.id)}».`, target };
  }
  if (zones.length > 1) return { subject: `Изменено зон: ${zones.length}.`, target };
  return { subject: 'План изменён.', target };
}

/** An object that went to another zone: the explicit link the editor recalculated. */
function zoneMoves(before: PlanDocument, after: PlanDocument, changes: Change[]): EditHintItem[] {
  const items: EditHintItem[] = [];
  const old = new Map(before.objects.map((object) => [object.id, object]));
  for (const change of changes) {
    if (change.ref.kind !== 'object' || change.kind === 'added' || change.kind === 'removed') continue;
    const was = old.get(change.ref.id);
    const now = after.objects.find((object) => object.id === change.ref.id);
    if (was === undefined || now === undefined || was.zoneId === now.zoneId) continue;
    const name = `«${now.label}»`;
    const objectRef: Ref = { kind: 'object', id: now.id };
    const key = `zone|${now.id}|${was.zoneId ?? ''}>${now.zoneId ?? ''}`;
    if (now.zoneId === null) {
      const from = was.zoneId === null ? '' : ` «${zoneName(before, was.zoneId)}»`;
      items.push({ key, tone: 'problem', text: `Объект ${name} вышел из зоны${from} и теперь вне зон.`, refs: [objectRef] });
    } else if (was.zoneId === null) {
      items.push({ key, tone: 'info', text: `Объект ${name} теперь в зоне «${zoneName(after, now.zoneId)}».`, refs: [objectRef, { kind: 'zone', id: now.zoneId }] });
    } else {
      items.push({
        key,
        tone: 'info',
        text: `Объект ${name} вышел из зоны «${zoneName(before, was.zoneId)}» в зону «${zoneName(after, now.zoneId)}».`,
        refs: [objectRef, { kind: 'zone', id: now.zoneId }],
      });
    }
  }
  return items;
}

function factValue(recommendation: Recommendation, suffix: string): number | null {
  return recommendation.facts.find((fact) => fact.id.endsWith(suffix))?.value ?? null;
}

/** «Не хватает» / «лишнее» with the numbers of `checkEquipment` and whose rule it is. */
function equipmentText(plan: PlanDocument, recommendation: Recommendation): string {
  const rule = plan.catalog.rules.find((entry) => recommendation.ruleIds.includes(entry.id));
  const zoneId = recommendation.refs.find((ref) => ref.kind === 'zone')?.id;
  const zone = zoneId === undefined ? 'зоне' : `зоне «${zoneName(plan, zoneId)}»`;
  const type = rule?.kind === 'count' ? (findObjectType(plan.catalog, rule.objectTypeId)?.label ?? 'объект') : 'объект';
  const count = factValue(recommendation, '.count');
  const bound = factValue(recommendation, '.bound');
  const source = rule?.source === 'organizer-material' ? 'Правило из материалов организаторов.' : 'Правило команды, не норматив Почты.';
  const missing = recommendation.reasonCodes.includes('equipment.missing');
  const head = missing ? `В ${zone} не хватает «${type}»` : `В ${zone} лишнее «${type}»`;
  const numbers = count === null || bound === null ? '' : `: ${count} шт. при ${missing ? 'минимуме' : 'максимуме'} ${bound}`;
  return `${head}${numbers}. ${source}`;
}

function equipmentFixedText(plan: PlanDocument, recommendation: Recommendation): string {
  const rule = plan.catalog.rules.find((entry) => recommendation.ruleIds.includes(entry.id));
  const zoneId = recommendation.refs.find((ref) => ref.kind === 'zone')?.id;
  const zone = zoneId === undefined ? 'зоне' : `зоне «${zoneName(plan, zoneId)}»`;
  const type = rule?.kind === 'count' ? (findObjectType(plan.catalog, rule.objectTypeId)?.label ?? 'объект') : 'объект';
  return `Правило комплектования снова выполнено: «${type}» в ${zone}.`;
}

function changed(before: number | null, after: number | null, epsilon: number): EditHintNumber | null {
  if (before === null || after === null || Math.abs(after - before) < epsilon) return null;
  return { before, after };
}

const TONE_ORDER: Record<EditHintTone, number> = { problem: 0, fixed: 1, info: 2 };

/**
 * What one settled edit did, from the snapshots on its two sides. Null when the
 * edit touched no object or zone and changed no check (a layer shown, a name of
 * the plan): such an edit is not worth a word.
 */
export function editHint(before: EditHintSnapshot, after: EditHintSnapshot): EditHint | null {
  if (before.plan.id !== after.plan.id || before.plan === after.plan) return null;
  const changes = diffPlans(before.plan, after.plan).filter((change) => change.ref.kind === 'object' || change.ref.kind === 'zone');

  const moves = zoneMoves(before.plan, after.plan, changes);
  // «Вышел из зоны … и теперь вне зон» already says what ZONE_UNASSIGNED says
  // about the same object: one reason, one line — in both directions.
  const moved = new Set(moves.map((item) => item.refs[0]?.id));
  const saidByMove = (issue: ValidationIssue): boolean =>
    issue.code === RELATION_ISSUE_CODES.ZONE_UNASSIGNED && issue.refs.some((ref) => ref.kind === 'object' && moved.has(ref.id));

  const items: EditHintItem[] = [...moves];
  for (const [key, issue] of after.issues) {
    if (!before.issues.has(key) && !saidByMove(issue)) items.push({ key: `issue|${key}`, tone: 'problem', text: issue.message, refs: issue.refs });
  }
  for (const [key, recommendation] of after.equipment) {
    if (!before.equipment.has(key)) {
      items.push({ key: `rule|${key}`, tone: 'problem', text: equipmentText(after.plan, recommendation), refs: recommendation.refs.slice(0, 1) });
    }
  }
  for (const [key, issue] of before.issues) {
    if (!after.issues.has(key) && !saidByMove(issue)) items.push({ key: `issue|${key}`, tone: 'fixed', text: `Исправлено: ${issue.message}`, refs: issue.refs });
  }
  for (const [key, recommendation] of before.equipment) {
    if (!after.equipment.has(key)) {
      items.push({ key: `rule|${key}`, tone: 'fixed', text: equipmentFixedText(after.plan, recommendation), refs: recommendation.refs.slice(0, 1) });
    }
  }

  const unique = new Map<string, EditHintItem>();
  for (const item of items) if (!unique.has(item.key)) unique.set(item.key, item);
  const sorted = [...unique.values()].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);

  const free_m2 = changed(before.free_m2, after.free_m2, EDIT_HINT_LIMIT.area_m2);
  const coverage_percent = changed(before.coverage_percent, after.coverage_percent, EDIT_HINT_LIMIT.percent);
  if (sorted.length === 0 && free_m2 === null && coverage_percent === null) return null;

  const { subject, target } = subjectOf(before.plan, after.plan, changes);
  return {
    subject,
    target,
    items: sorted.slice(0, EDIT_HINT_LIMIT.items),
    more: Math.max(0, sorted.length - EDIT_HINT_LIMIT.items),
    free_m2,
    coverage_percent,
  };
}

/** One decimal, as people read areas; two when one decimal would show «114,7 → 114,7». */
function pair(value: EditHintNumber, unit: string): string {
  const digits = formatMeasure(value.before, unit, 1) === formatMeasure(value.after, unit, 1) ? 2 : 1;
  return `${formatMeasure(value.before, '', digits)} → ${formatMeasure(value.after, unit, digits)}`;
}

/** «Свободно 114,7 → 113,9 м².» — the numbers are the calculation's, only rounded for reading. */
export function editHintNumbers(hint: EditHint): string[] {
  const lines: string[] = [];
  if (hint.free_m2 !== null) lines.push(`Свободно ${pair(hint.free_m2, 'м²')}.`);
  if (hint.coverage_percent !== null) lines.push(`Камеры видят ${pair(hint.coverage_percent, '%')} клиентских зон.`);
  return lines;
}

/** The whole hint as one text: for «same hint» checks and for the question to the agent. */
export function editHintText(hint: EditHint): string {
  const more = hint.more === 0 ? [] : [`Ещё причин: ${hint.more}.`];
  return [hint.subject, ...hint.items.map((item) => item.text), ...more, ...editHintNumbers(hint)].join(' ');
}

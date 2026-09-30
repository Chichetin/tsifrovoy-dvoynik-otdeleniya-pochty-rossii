/** A read-only comparison, independent of the editor's save baseline and history. */
import type { Change } from '../contracts/advice';
import type { CountRule, DistanceToEntranceRule, Id, PlanDocument, Ref, Result, Rule } from '../contracts/model';
import { diffPlans } from './advice';
import { findObjectType } from './catalog';
import { openingCentre, segmentLength } from './geometry';
import { countInZoneScope } from './inventory';
import { measurePlan } from './metrics';
import { planIndex } from './plan-index';
import { validatePlan, type ValidationIssue } from './validation';

export type ComparisonMetric =
  | 'area.total' | 'area.occupied' | 'area.free' | 'equipment.count'
  | 'issues.error' | 'issues.warning';

export type ComparisonRow = {
  metric: ComparisonMetric;
  unit: 'm2' | 'count';
  before: number;
  after: number;
  delta: number;
};

export type NamedPlanChange = Change & {
  /** Removed entities must be named from the source, not the current document. */
  beforeName: string | null;
  afterName: string | null;
};

/** A finding of `validatePlan` that disappeared («resolved») or showed up («new»). */
export type IssueDelta = {
  status: 'resolved' | 'new';
  /** The issue as it stood on its own side: «до» for resolved, «после» for new. */
  issue: ValidationIssue;
};

/** The number a stocking/distance rule is about, measured on both sides — not only when it is violated. */
export type RuleEffectRow = {
  ruleId: Id;
  label: string;
  unit: 'count' | 'm';
  /** `null` — the value has no meaning on this side (the object or zone is not there). */
  before: number | null;
  after: number | null;
  source: Rule['source'];
  /** Same wording as `ruleNote` in `src/domain/validation`: this rule's own source. */
  sourceNote: string;
};

export type PlanComparison = {
  related: boolean;
  warning: string | null;
  rows: ComparisonRow[];
  /** null means IDs cannot be matched; [] means a related plan is unchanged. */
  changes: NamedPlanChange[] | null;
  /** [] for unrelated plans, same as `changes: null` — nothing is matched between them. */
  issueDeltas: IssueDelta[];
  ruleEffects: RuleEffectRow[];
};

const UNRELATED_WARNING = 'Файлы имеют разные ID планов. Показатели рассчитаны отдельно; соответствие предметов и их перемещения не установлены.';

/** Same wording as `ruleNote` in `src/domain/validation/index.ts` — one source of truth to the eye. */
function ruleSourceNote(rule: Rule): string {
  return rule.source === 'organizer-material'
    ? 'Источник правила: материалы организаторов.'
    : 'Источник правила: допущение команды, не норматив Почты России.';
}

function refKey(ref: Ref): string {
  return `${ref.kind}:${ref.id}`;
}

function issueKey(issue: ValidationIssue): string {
  return `${issue.code}::${issue.refs.map(refKey).sort().join(',')}`;
}

/**
 * Findings that disappeared and findings that showed up — matched by
 * `code`+`refs`, not by message text, which can change while the finding does not.
 */
function issueDeltas(issuesBefore: ValidationIssue[], issuesAfter: ValidationIssue[]): IssueDelta[] {
  const beforeKeys = new Set(issuesBefore.map(issueKey));
  const afterKeys = new Set(issuesAfter.map(issueKey));
  const resolved: IssueDelta[] = issuesBefore
    .filter((issue) => !afterKeys.has(issueKey(issue)))
    .map((issue) => ({ status: 'resolved' as const, issue }));
  const appeared: IssueDelta[] = issuesAfter
    .filter((issue) => !beforeKeys.has(issueKey(issue)))
    .map((issue) => ({ status: 'new' as const, issue }));
  return [...resolved, ...appeared];
}

/** Which rule ids findings mention, and which refs they carry — from both sides at once. */
function touchedRules(issuesBefore: ValidationIssue[], issuesAfter: ValidationIssue[]): Map<Id, Ref[]> {
  const map = new Map<Id, Ref[]>();
  for (const issue of [...issuesBefore, ...issuesAfter]) {
    for (const ruleId of issue.ruleIds ?? []) {
      map.set(ruleId, [...(map.get(ruleId) ?? []), ...issue.refs]);
    }
  }
  return map;
}

function uniqueIds(refs: Ref[], kind: Ref['kind']): Id[] {
  return [...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id))];
}

/**
 * The same nearest-entrance distance `distanceRuleIssues` in `src/domain/validation`
 * computes (`openingCentre` + `segmentLength`), but without the threshold: the
 * value is wanted even once the object already meets the rule and no finding
 * is left to read it from.
 */
function nearestEntranceDistance(plan: PlanDocument, rule: DistanceToEntranceRule, objectId: Id): number | null {
  const object = plan.objects.find((entry) => entry.id === objectId);
  if (object === undefined) return null;
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const entrances = plan.openings
    .filter((opening) => (rule.entranceId === null ? opening.kind === 'entrance' : opening.id === rule.entranceId))
    .flatMap((opening) => {
      const wall = walls.get(opening.wallId);
      return wall === undefined ? [] : [openingCentre(opening, wall)];
    });
  if (entrances.length === 0) return null;
  return Math.min(...entrances.map((point) => segmentLength(object.position, point)));
}

function countRuleRows(before: PlanDocument, after: PlanDocument, rule: CountRule, refs: Ref[]): RuleEffectRow[] {
  const typeLabel = findObjectType(after.catalog, rule.objectTypeId)?.label
    ?? findObjectType(before.catalog, rule.objectTypeId)?.label
    ?? rule.objectTypeId;
  const sourceNote = ruleSourceNote(rule);
  return uniqueIds(refs, 'zone').map((zoneId): RuleEffectRow => {
    const zoneAfter = after.zones.find((zone) => zone.id === zoneId);
    const zoneBefore = before.zones.find((zone) => zone.id === zoneId);
    const zoneName = zoneAfter?.name ?? zoneBefore?.name ?? zoneId;
    return {
      ruleId: rule.id,
      label: `«${typeLabel}» в зоне «${zoneName}»`,
      unit: 'count',
      before: zoneBefore === undefined ? null : countInZoneScope(before, rule.objectTypeId, zoneId, rule.scope),
      after: zoneAfter === undefined ? null : countInZoneScope(after, rule.objectTypeId, zoneId, rule.scope),
      source: rule.source,
      sourceNote,
    };
  });
}

function distanceRuleRows(before: PlanDocument, after: PlanDocument, rule: DistanceToEntranceRule, refs: Ref[]): RuleEffectRow[] {
  const sourceNote = ruleSourceNote(rule);
  return uniqueIds(refs, 'object').map((objectId): RuleEffectRow => {
    const objectAfter = after.objects.find((entry) => entry.id === objectId);
    const objectBefore = before.objects.find((entry) => entry.id === objectId);
    const label = objectAfter?.label ?? objectBefore?.label ?? objectId;
    return {
      ruleId: rule.id,
      label: `Расстояние «${label}» до входа`,
      unit: 'm',
      before: nearestEntranceDistance(before, rule, objectId),
      after: nearestEntranceDistance(after, rule, objectId),
      source: rule.source,
      sourceNote,
    };
  });
}

/** «Было → стало» only for rules at least one finding, on either side, mentions. */
function ruleEffects(before: PlanDocument, after: PlanDocument, issuesBefore: ValidationIssue[], issuesAfter: ValidationIssue[]): RuleEffectRow[] {
  const touched = touchedRules(issuesBefore, issuesAfter);
  if (touched.size === 0) return [];
  const rules = new Map((after.catalog.rules.length > 0 ? after.catalog.rules : before.catalog.rules).map((rule) => [rule.id, rule]));
  const rows: RuleEffectRow[] = [];
  for (const [ruleId, refs] of touched) {
    const rule = rules.get(ruleId);
    if (rule === undefined) continue;
    rows.push(...(rule.kind === 'count' ? countRuleRows(before, after, rule, refs) : distanceRuleRows(before, after, rule, refs)));
  }
  return rows;
}

export function buildPlanComparison(before: PlanDocument, after: PlanDocument): Result<PlanComparison> {
  const measuredBefore = measurePlan(before);
  if (!measuredBefore.ok) return measuredBefore;
  const measuredAfter = measurePlan(after);
  if (!measuredAfter.ok) return measuredAfter;
  const issuesBefore = validatePlan(before);
  const issuesAfter = validatePlan(after);
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  const row = (metric: ComparisonMetric, unit: ComparisonRow['unit'], previous: number, current: number): ComparisonRow => ({
    metric, unit, before: round(previous), after: round(current), delta: round(current - previous),
  });
  const related = before.id === after.id;
  const previousNames = planIndex(before);
  const currentNames = planIndex(after);
  return {
    ok: true,
    value: {
      related,
      warning: related ? null : UNRELATED_WARNING,
      rows: [
        row('area.total', 'm2', measuredBefore.value.room.total_m2, measuredAfter.value.room.total_m2),
        row('area.occupied', 'm2', measuredBefore.value.room.occupied_m2, measuredAfter.value.room.occupied_m2),
        row('area.free', 'm2', measuredBefore.value.room.free_m2, measuredAfter.value.room.free_m2),
        row('equipment.count', 'count', before.objects.length, after.objects.length),
        row('issues.error', 'count', issuesBefore.filter((issue) => issue.severity === 'error').length, issuesAfter.filter((issue) => issue.severity === 'error').length),
        row('issues.warning', 'count', issuesBefore.filter((issue) => issue.severity === 'warning').length, issuesAfter.filter((issue) => issue.severity === 'warning').length),
      ],
      changes: related ? diffPlans(before, after).map((change) => ({
        ...change,
        beforeName: previousNames.nameOf(change.ref),
        afterName: currentNames.nameOf(change.ref),
      })) : null,
      issueDeltas: related ? issueDeltas(issuesBefore, issuesAfter) : [],
      ruleEffects: related ? ruleEffects(before, after, issuesBefore, issuesAfter) : [],
    },
  };
}

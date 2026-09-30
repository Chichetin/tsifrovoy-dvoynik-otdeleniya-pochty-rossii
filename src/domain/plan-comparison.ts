/** A read-only comparison, independent of the editor's save baseline and history. */
import type { Change } from '../contracts/advice';
import type { PlanDocument, Result } from '../contracts/model';
import { diffPlans } from './advice';
import { measurePlan } from './metrics';
import { planIndex } from './plan-index';
import { validatePlan } from './validation';

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

export type PlanComparison = {
  related: boolean;
  warning: string | null;
  rows: ComparisonRow[];
  /** null means IDs cannot be matched; [] means a related plan is unchanged. */
  changes: NamedPlanChange[] | null;
};

const UNRELATED_WARNING = 'Файлы имеют разные ID планов. Показатели рассчитаны отдельно; соответствие предметов и их перемещения не установлены.';

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
    },
  };
}

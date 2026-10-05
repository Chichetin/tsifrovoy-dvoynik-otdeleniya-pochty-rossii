/**
 * #125: one number for "how good is this plan" — 100 minus a penalty per
 * finding of `validatePlan`, never below 0.
 *
 * The penalty follows the severity of the finding. The catalog rule schema has
 * no weight field, so the weights live here, not in `data/catalog/rules.json`.
 * This is a team rule, not a standard of the Post.
 */

import type { Id, PlanDocument, Ref, Severity } from '../../contracts/model';
import type { ValidationIssue } from './index';

export const HEALTH_MAX = 100;

/** Points one finding takes off the score. */
export const SEVERITY_PENALTY: Readonly<Record<Severity, number>> = {
  error: 10,
  warning: 3,
};

/** Findings of one code and one rule, with what they take off together. */
export type HealthLine = {
  code: string;
  ruleIds: Id[];
  severity: Severity;
  /** Points per finding. */
  weight: number;
  issues: ValidationIssue[];
  /** `weight × issues.length`. */
  penalty: number;
};

export type PlanHealth = {
  /** 0…100. */
  score: number;
  /** Sum of all penalties; can be more than 100. */
  penalty: number;
  /** The penalty is more than 100, so the score stopped at 0. */
  clamped: boolean;
  /** Largest penalty first. */
  lines: HealthLine[];
};

/** A plan with no zones and no equipment has nothing to check: 100 means «no data», not «ideal». */
export function isEmptyPlan(plan: Pick<PlanDocument, 'zones' | 'objects'>): boolean {
  return plan.zones.length === 0 && plan.objects.length === 0;
}

export function issuePenalty(issue: ValidationIssue): number {
  return SEVERITY_PENALTY[issue.severity];
}

/**
 * Takes the findings, not the plan: the header and «Проверка» read the same
 * `validatePlan` result, so a fixed finding changes both at once.
 */
export function planHealth(issues: readonly ValidationIssue[]): PlanHealth {
  const lines = new Map<string, HealthLine>();
  let penalty = 0;
  for (const issue of issues) {
    const weight = issuePenalty(issue);
    penalty += weight;
    const ruleIds = issue.ruleIds ?? [];
    const key = `${issue.code}|${issue.severity}|${ruleIds.join(',')}`;
    const line = lines.get(key);
    if (line === undefined) {
      lines.set(key, { code: issue.code, ruleIds, severity: issue.severity, weight, issues: [issue], penalty: weight });
    } else {
      line.issues.push(issue);
      line.penalty += weight;
    }
  }
  return {
    score: Math.max(0, HEALTH_MAX - penalty),
    penalty,
    clamped: penalty > HEALTH_MAX,
    lines: [...lines.values()].sort((a, b) => b.penalty - a.penalty),
  };
}

/** Every entity the findings of one line are about, each once. */
export function healthLineRefs(line: HealthLine): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  for (const issue of line.issues) {
    for (const ref of issue.refs) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

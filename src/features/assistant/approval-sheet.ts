/**
 * S2-39 (#35): data for the approval sheet — the one page that leaves the
 * screen for a manager's signature. Every number on it is `buildPlanComparison`,
 * the same calculation «Эффект изменений» already shows; the assumptions are
 * `comparePlans`'s own, the deterministic compare scenario, not a model call.
 * Nothing here reads an LLM response.
 */

import type { PlanDocument, Result } from '../../contracts/model';
import { comparePlans } from '../../domain/advice';
import { buildPlanComparison, type PlanComparison } from '../../domain/plan-comparison';
import { renderPlanSvg } from '../../persistence/plan-svg';

export type ApprovalSheetData = {
  comparison: PlanComparison;
  /** Inline-ready markup: no XML prolog, which only the standalone `.svg` file needs. */
  beforeSvg: string;
  afterSvg: string;
  /** Team assumptions the comparison rests on — never a Почта норматив. */
  assumptions: string[];
  limitations: string[];
};

/** The XML prolog is only meaningful for a file saved on its own (D-061). */
function inlineSvg(svg: string): string {
  return svg.replace(/^<\?xml[^>]*\?>\n?/, '');
}

export function buildApprovalSheet(before: PlanDocument, after: PlanDocument): Result<ApprovalSheetData> {
  const comparison = buildPlanComparison(before, after);
  if (!comparison.ok) return comparison;
  // Same calculation as the «Эффект изменений» scenario, called directly: no
  // network, no model, so a failed measurement here would already have failed
  // above. A miss still degrades to an empty list rather than losing the sheet.
  const recommendation = comparePlans(before, after);
  const facts = recommendation.ok ? recommendation.value[0] : undefined;
  return {
    ok: true,
    value: {
      comparison: comparison.value,
      beforeSvg: inlineSvg(renderPlanSvg(before)),
      afterSvg: inlineSvg(renderPlanSvg(after)),
      assumptions: facts?.assumptions ?? [],
      limitations: facts?.limitations ?? [],
    },
  };
}

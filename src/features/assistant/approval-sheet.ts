/**
 * S2-39 (#35): data for the approval sheet — the one page that leaves the
 * screen for a manager's signature. Every number on it is `buildPlanComparison`,
 * the same calculation «Эффект изменений» already shows, extended with the
 * checks block and the rule numbers it now also carries (`issueDeltas`,
 * `ruleEffects` — `validatePlan`, `countInZoneScope` and the entrance-distance
 * primitives the check itself uses, no new formula). The assumptions are
 * `comparePlans`'s own, the deterministic compare scenario. Nothing here reads
 * an LLM response.
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
  /** Team assumptions the comparison itself rests on — never a Почта норматив. */
  assumptions: string[];
  limitations: string[];
};

/** The XML prolog is only meaningful for a file saved on its own (D-061). */
function inlineSvg(svg: string): string {
  return svg.replace(/^<\?xml[^>]*\?>\n?/, '');
}

/**
 * Экспорт «Экспорт → SVG» рисует только видимые слои — верно для картинки
 * рабочего стола. Лист согласования — другой документ: руководитель должен
 * видеть план целиком, а не то, что случайно скрыто у автора листа сейчас.
 */
function withAllLayersVisible(plan: PlanDocument): PlanDocument {
  return { ...plan, layers: plan.layers.map((layer) => ({ ...layer, visible: true })) };
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
      beforeSvg: inlineSvg(renderPlanSvg(withAllLayersVisible(before))),
      afterSvg: inlineSvg(renderPlanSvg(withAllLayersVisible(after))),
      assumptions: facts?.assumptions ?? [],
      limitations: facts?.limitations ?? [],
    },
  };
}

/**
 * #31: the stocking rules of the catalog as a checklist — «Кассовое окно 3/≥1 ✓».
 *
 * Nothing is counted here. `ruleCounts` and `ruleMet` are the very functions the
 * findings of the check use, so a red line in the list and a finding in
 * «Проверка» cannot disagree.
 */

import type { PlanDocument } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';
import { ruleCounts, ruleMet } from '../../domain/validation';

export type ChecklistItem = {
  key: string;
  zoneId: string;
  zoneName: string;
  typeLabel: string;
  count: number;
  /** «≥2», «≤1» or «≥1, ≤3». */
  limit: string;
  met: boolean;
  organizerRule: boolean;
  /**
   * A ready question for the assistant about an unmet line, in the words its
   * router sends to the equipment check («не хватает», «лишнее»). «Изменить»
   * would send it to the comparison of the plan with its original.
   */
  question: string;
};

export function checklistItems(plan: PlanDocument): ChecklistItem[] {
  return ruleCounts(plan).map((entry) => {
    const { rule, zone, count } = entry;
    const typeLabel = findObjectType(plan.catalog, rule.objectTypeId)?.label ?? rule.objectTypeId;
    const limit = [
      rule.min === null ? null : `≥${rule.min}`,
      rule.max === null ? null : `≤${rule.max}`,
    ]
      .filter((part) => part !== null)
      .join(', ');
    return {
      key: `${rule.id}:${zone.id}`,
      zoneId: zone.id,
      zoneName: zone.name,
      typeLabel,
      count,
      limit,
      met: ruleMet(entry),
      organizerRule: rule.source === 'organizer-material',
      question:
        rule.max !== null && count > rule.max
          ? `Что лишнее по оборудованию в зоне «${zone.name}» (${zone.id})?`
          : `Чего не хватает по оборудованию в зоне «${zone.name}» (${zone.id})?`,
    };
  });
}

/**
 * A04 (тексты): the Russian sentence the user reads.
 *
 * The sentence is assembled from the template of the chosen reason code and
 * from facts that already passed verification — never from model output. A
 * model cannot write "стало просторнее" over a shrinking number here, because
 * it does not write the sentence at all: it only picks which of the calculated
 * facts the sentence quotes.
 *
 * Nothing in this file knows about the plan document: it formats numbers and
 * fills slots, so a template change cannot silently change a measurement.
 */

import type {
  Candidate,
  Explanation,
  Fact,
  Recommendation,
} from '../../contracts/advice';
import { REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import { defaultExplanation } from './explanation';

/** Русская запись числа: разделитель дробной части — запятая. */
function formatNumber(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace('.', ',');
}

function formatFact(fact: Fact): string {
  if (fact.unit === 'count') return String(fact.value);
  const text = formatNumber(Math.abs(fact.value), 2);
  if (fact.phase !== 'delta') return formatNumber(fact.value, 2);
  if (fact.value === 0) return `0,00`;
  return fact.value > 0 ? `+${text}` : `−${text}`;
}

function candidateSlots(candidate: Candidate): Record<string, string> {
  const object = candidate.object;
  return {
    candidateLabel: object.label,
    candidateSize: `${formatNumber(object.size_m[0], 2)} × ${formatNumber(object.size_m[1], 2)}`,
    candidatePosition: `${formatNumber(object.position[0], 2)}; ${formatNumber(object.position[1], 2)}`,
    candidateRotation: String(object.rotation_deg),
  };
}

/** «добавлено 2, перемещено 1» — только то, что действительно произошло. */
function changeSummary(recommendation: Recommendation): string {
  const titles: Record<string, string> = {
    added: 'добавлено',
    removed: 'удалено',
    moved: 'перемещено',
    updated: 'изменено',
  };
  const parts = Object.entries(titles)
    .map(([kind, title]) => {
      const count = recommendation.changes.filter(
        (change) => change.kind === kind,
      ).length;
      return count === 0 ? null : `${title} ${count}`;
    })
    .filter((part): part is string => part !== null);
  return parts.length === 0 ? 'состав не менялся' : parts.join(', ');
}

function difference(cited: Fact[], left: Fact['metric'], right: Fact['metric']): string {
  const a = cited.find((fact) => fact.metric === left);
  const b = cited.find((fact) => fact.metric === right);
  if (a === undefined || b === undefined) return '—';
  return String(Math.abs(a.value - b.value));
}

/**
 * Renders the sentence of a *verified* explanation. Returns null when a slot
 * cannot be filled from the cited facts: an unfinished sentence with a dangling
 * `{area.free.after}` must never reach the screen.
 */
export function renderExplanation(
  recommendation: Recommendation,
  explanation: Explanation,
): string | null {
  const spec = REASON_CODE_SPECS[explanation.reasonCode];
  const cited = recommendation.facts.filter((fact) =>
    explanation.factIds.includes(fact.id),
  );

  const slots: Record<string, string> = {};
  for (const fact of cited) slots[`${fact.metric}.${fact.phase}`] = formatFact(fact);

  const candidate = recommendation.candidates.find(
    (entry) => entry.id === explanation.candidateId,
  );
  if (candidate !== undefined) Object.assign(slots, candidateSlots(candidate));

  slots.shortfall = difference(cited, 'equipment.min', 'equipment.count');
  slots.excess = difference(cited, 'equipment.count', 'equipment.max');
  slots.changeSummary = changeSummary(recommendation);

  if (spec.slots.some((slot) => slots[slot] === undefined)) return null;
  return spec.template.replace(
    /\{([^}]+)\}/g,
    (whole, slot: string) => slots[slot] ?? whole,
  );
}

/**
 * The sentence for the same recommendation without a model: the calculation
 * explains itself. The UI shows it with an explicit «без LLM» mark, so a reader
 * always knows which of the two paths produced the text.
 */
export function fallbackExplanation(recommendation: Recommendation): string | null {
  const explanation = defaultExplanation(recommendation);
  if (explanation === null) return null;
  return renderExplanation(recommendation, explanation);
}

/**
 * The check between the model's prose and the screen (D-236).
 *
 * The model may phrase the answer freely, but every identifier it writes must
 * exist in the plan or in this exchange's calculation, and every number must be
 * one the tools returned (or its rounding). Anything else is a number the model
 * made up, and the answer falls back to text the code writes itself.
 */

import type { Id, PlanDocument } from '../../contracts/model';
import type { AgentToolState } from './agent-tools';

export type AgentEvidence = { ids: Set<Id>; numbers: number[] };

export type AgentTextProblem =
  | { kind: 'unknown-id'; token: string }
  | { kind: 'unknown-number'; token: string };

/** snake_case with at least one underscore: z_client, eq_12, ot_workplace. */
const ID_PATTERN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi;
const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

/** Small counts and ordinals («вариант 2», «три окна») carry no measurement. */
const ALWAYS_ALLOWED = [0, 1, 2, 3];

function collectNumbers(value: unknown, into: number[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    into.push(Math.abs(value));
    return;
  }
  if (typeof value === 'string') {
    for (const match of value.matchAll(NUMBER_PATTERN)) into.push(Number(match[0].replace(',', '.')));
    return;
  }
  if (Array.isArray(value)) {
    into.push(value.length);
    for (const entry of value) collectNumbers(entry, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) collectNumbers(entry, into);
  }
}

function planIds(plan: PlanDocument): Id[] {
  return [
    plan.id,
    plan.room.id,
    ...plan.zones.map((zone) => zone.id),
    ...plan.objects.map((object) => object.id),
    ...plan.layers.map((layer) => layer.id),
    ...plan.walls.map((wall) => wall.id),
    ...plan.openings.map((opening) => opening.id),
    ...plan.catalog.objectTypes.map((type) => type.id),
    ...plan.catalog.zoneTypes.map((type) => type.id),
    ...plan.catalog.layerTypes.map((type) => type.id),
    ...plan.catalog.rules.map((rule) => rule.id),
  ];
}

/** Everything the answer may cite: the plan's ids, the tool outputs, the question. */
export function agentEvidence(state: AgentToolState, outputs: readonly unknown[], query: string): AgentEvidence {
  const ids = new Set(planIds(state.plan));
  for (const recommendation of state.recommendations.values()) {
    ids.add(recommendation.id);
    for (const candidate of recommendation.candidates) {
      ids.add(candidate.id);
      ids.add(candidate.object.id);
    }
  }
  const numbers = [...ALWAYS_ALLOWED];
  for (const output of outputs) collectNumbers(output, numbers);
  collectNumbers(query, numbers);
  return { ids, numbers };
}

function matches(value: number, evidence: number): boolean {
  const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  return (
    close(value, evidence) ||
    close(value, Math.round(evidence)) ||
    close(value, Math.round(evidence * 10) / 10) ||
    close(value, Math.round(evidence * 100) / 100)
  );
}

/** Problems in the text; an empty list means it may be shown as the model's answer. */
export function checkAgentText(text: string, evidence: AgentEvidence): AgentTextProblem[] {
  const problems: AgentTextProblem[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ID_PATTERN)) {
    const token = match[0];
    if (!evidence.ids.has(token) && !seen.has(token)) {
      seen.add(token);
      problems.push({ kind: 'unknown-id', token });
    }
  }
  // Digits inside an id («eq_12») are part of the name, not a measurement.
  const prose = text.replace(ID_PATTERN, ' ');
  for (const match of prose.matchAll(NUMBER_PATTERN)) {
    const token = match[0];
    const value = Number(token.replace(',', '.'));
    if (!evidence.numbers.some((entry) => matches(value, entry)) && !seen.has(token)) {
      seen.add(token);
      problems.push({ kind: 'unknown-number', token });
    }
  }
  return problems;
}

/** The note that goes back to the model for its one attempt to correct itself. */
export function describeProblems(problems: readonly AgentTextProblem[]): string {
  const ids = problems.filter((problem) => problem.kind === 'unknown-id').map((problem) => problem.token);
  const numbers = problems.filter((problem) => problem.kind === 'unknown-number').map((problem) => problem.token);
  const parts = [
    ids.length === 0 ? null : `идентификаторы ${ids.join(', ')} не существуют в плане`,
    numbers.length === 0 ? null : `числа ${numbers.join(', ')} не встречаются в результатах инструментов`,
  ].filter(Boolean);
  return `Проверка ответа: ${parts.join('; ')}. Перепиши ответ, используя только id и числа из результатов инструментов.`;
}

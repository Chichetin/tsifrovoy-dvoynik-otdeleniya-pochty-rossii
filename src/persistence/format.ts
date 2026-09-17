/**
 * IO03: which of the two plan formats is in this file.
 *
 * The jury opens a plan we wrote and the organizers' `example_plan.json` with
 * the same button, so the choice is made by the file, not by the user: our
 * document announces itself with `schemaVersion`, the example with its `ops`
 * block. A file that is neither is refused with both formats named, and the
 * document already open stays where it is.
 *
 * Detection only routes; every verdict about the content still belongs to
 * `decodePlan` and `importOrganizerExample`. That is why a plan of a future
 * version is still "ours": the codec has to be the one to say no.
 */

import {
  CONTRACT_ISSUE_CODES,
  type Issue,
  type PlanDocument,
  type Result,
} from '../contracts/model';
import { decodePlan } from './codec';
import { importOrganizerExample } from './organizer-import';

/** Our versioned document, the organizers' example, or neither. */
export type PlanFormat = 'ours' | 'organizer' | 'unknown';

/** A plan that opened, with the format it came from. */
export type OpenedPlan = {
  plan: PlanDocument;
  format: Exclude<PlanFormat, 'unknown'>;
  /**
   * Values the source did not state and the importer had to assume (D-027).
   * Empty for our own format: there is nothing to invent there.
   */
  assumptions: string[];
};

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classify(payload: unknown): PlanFormat {
  if (!isObject(payload)) return 'unknown';
  // Our own file. `schemaVersion` alone is enough: whether the number is one we
  // understand is the codec's call, not ours.
  if ('schemaVersion' in payload) return 'ours';
  if (isObject(payload.room) && Array.isArray(payload.objects)) return 'ours';
  // The organizers' example: a branch block plus their two flat lists.
  if (isObject(payload.ops) && Array.isArray(payload.zones) && Array.isArray(payload.equipment)) {
    return 'organizer';
  }
  return 'unknown';
}

/** Names the format of a file without opening it. */
export function detectPlanFormat(text: string): PlanFormat {
  return classify(parse(text));
}

function unreadable(): Issue {
  return {
    code: CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE,
    severity: 'error',
    message:
      'Файл не похож ни на план редактора (поле «schemaVersion»), ни на пример организаторов ' +
      '(поля «ops», «zones», «equipment», как в example_plan.json).',
    refs: [],
  };
}

/** Assumptions the importer parked in `extensions`; never invented here. */
function assumptionsOf(plan: PlanDocument): string[] {
  const block = plan.extensions['organizer-import'];
  if (!isObject(block)) return [];
  const list = block.assumptions;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Opens a file in either format. Nothing partial comes back: on failure the
 * caller keeps the document it had.
 */
export function readPlanFile(text: string): Result<OpenedPlan> {
  const payload = parse(text);
  if (payload === undefined) {
    // Broken JSON: the codec reports the exact syntax error and where it is.
    const refused = decodePlan(text);
    if (!refused.ok) return refused;
    return { ok: false, issues: [unreadable()] };
  }

  const format = classify(payload);
  if (format === 'unknown') return { ok: false, issues: [unreadable()] };

  const opened = format === 'ours' ? decodePlan(text) : importOrganizerExample(payload);
  if (!opened.ok) return opened;
  return {
    ok: true,
    value: {
      plan: opened.value,
      format,
      assumptions: format === 'organizer' ? assumptionsOf(opened.value) : [],
    },
  };
}

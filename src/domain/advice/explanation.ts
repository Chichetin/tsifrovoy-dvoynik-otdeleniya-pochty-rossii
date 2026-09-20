/**
 * A04: the gate between the model and the user.
 *
 * The model never gets to state a number. It gets a calculated recommendation
 * and may only answer with a choice: which recommendation, which reason code,
 * which candidate and which already-existing facts it cites. Everything else —
 * an id that does not exist, a code the calculation did not offer, a candidate
 * belonging to another variant, an extra field with an invented number, or text
 * that is not JSON at all — is refused here, and the assistant falls back to
 * showing the calculation.
 *
 * That is the whole point of the package: a model will confidently state that
 * 12 m² became 15 m². This module makes such an answer unshowable.
 *
 * A08 adds one thing the model may write itself: `text`, a short Russian answer
 * to the user's free question. It is held to the same standard — every id-shaped
 * token must be one the recommendation names, every number must be one the
 * calculation produced, in the rounding the user is shown — but its refusal is
 * *soft*, and that asymmetry is deliberate. The structural part is what the
 * sentence and the figures are built from: one bad field there and nothing on
 * screen can be trusted, so the whole answer goes. The free text is an addition
 * on top of a complete answer, so dropping it alone returns the user exactly to
 * the screen they had before the field existed. A hard refusal there would
 * punish the reader for the model's chatter: they would lose the verified
 * explanation too. Every drop is reported in `textIssues` so the server logs it
 * — a model that never gets a word through is a fact we need to know, not a
 * silence.
 *
 * What the number check does not do: it compares magnitudes, not meaning. It
 * accepts «1,50 м²» for a delta of −1,50 and cannot tell «освободилось» from
 * «занято». The signed number stays visible in the template sentence next to
 * the text, which is where the reader sees the direction of the change.
 */

import { z } from 'zod';
import type {
  Candidate,
  Change,
  Explanation,
  Fact,
  Recommendation,
  VerifyExplanation,
} from '../../contracts/advice';
import { ADVICE_LIMITS } from '../../contracts/advice';
import { REASON_CODES, REASON_CODE_SPECS } from '../../contracts/advice-semantics';
import type { Id, Issue, Ref, Result } from '../../contracts/model';

/** Codes owned by this module. */
export const EXPLANATION_ISSUE_CODES = {
  /** The payload is not JSON at all. */
  NOT_JSON: 'NOT_JSON',
  /** The payload is JSON, but not the agreed shape — including extra fields. */
  SHAPE_INVALID: 'SHAPE_INVALID',
  /** The explanation points at a recommendation that was not offered. */
  UNKNOWN_RECOMMENDATION: 'UNKNOWN_RECOMMENDATION',
  /** Two explanations for one recommendation. */
  DUPLICATE_RECOMMENDATION: 'DUPLICATE_RECOMMENDATION',
  /** The reason code is not among those the calculation allowed. */
  REASON_NOT_ALLOWED: 'REASON_NOT_ALLOWED',
  /** The code needs a candidate and none was named. */
  CANDIDATE_REQUIRED: 'CANDIDATE_REQUIRED',
  /** The code forbids a candidate and one was named. */
  CANDIDATE_FORBIDDEN: 'CANDIDATE_FORBIDDEN',
  /** A cited fact does not belong to the recommendation. */
  UNKNOWN_FACT: 'UNKNOWN_FACT',
  /** A fact the code requires was not cited. */
  MISSING_FACT: 'MISSING_FACT',
  /** A forecast of another candidate is cited for the named one. */
  CANDIDATE_FACT_MISMATCH: 'CANDIDATE_FACT_MISMATCH',
  /** "Изменилось" while every cited delta is zero. */
  DELTA_ZERO: 'DELTA_ZERO',
  /** "Не изменилось" while a cited delta is not. */
  DELTA_NONZERO: 'DELTA_NONZERO',
  /** The recommendation lost the limitation its code must carry. */
  LIMITATION_MISSING: 'LIMITATION_MISSING',
  /** The free answer names an id the recommendation does not. Text only. */
  TEXT_UNKNOWN_ID: 'TEXT_UNKNOWN_ID',
  /** The free answer states a number the calculation did not produce. */
  TEXT_UNKNOWN_NUMBER: 'TEXT_UNKNOWN_NUMBER',
  /** The free answer is longer than ADVICE_LIMITS.maxAnswerChars. */
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  /** The free answer is blank — the field was sent, the answer was not. */
  TEXT_EMPTY: 'TEXT_EMPTY',
} as const;

const explanationSchema = z
  .object({
    recommendationId: z.string().min(1),
    candidateId: z.string().min(1).nullable(),
    reasonCode: z.enum(REASON_CODES as [string, ...string[]]),
    factIds: z.array(z.string().min(1)).min(1),
    // Любая строка: длину и содержимое разбирает мягкая проверка ниже, иначе
    // болтливая модель уносила бы с собой и проверенное объяснение.
    text: z.string().optional(),
  })
  .strict();

const answerTextSchema = z.string().trim().min(1).max(ADVICE_LIMITS.maxAnswerChars);

const payloadSchema = z
  .object({ explanations: z.array(explanationSchema).min(1) })
  .strict();

function issue(code: string, message: string, refs: Ref[] = []): Issue {
  return { code, severity: 'error', message, refs };
}

/**
 * Models like to wrap JSON in a fenced block. Unwrapping it changes no number,
 * so it is allowed; anything beyond that is refused.
 */
function unwrap(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z]*\s*/, '');
  const close = withoutOpen.lastIndexOf('```');
  return (close === -1 ? withoutOpen : withoutOpen.slice(0, close)).trim();
}

function parse(input: unknown): Result<unknown> {
  if (typeof input !== 'string') return { ok: true, value: input };
  try {
    return { ok: true, value: JSON.parse(unwrap(input)) };
  } catch {
    return {
      ok: false,
      issues: [
        issue(
          EXPLANATION_ISSUE_CODES.NOT_JSON,
          'Ответ модели не разбирается как JSON: показываем расчёт без объяснения модели.',
        ),
      ],
    };
  }
}

function factById(recommendation: Recommendation): Map<Id, Fact> {
  return new Map(recommendation.facts.map((fact) => [fact.id, fact]));
}

/** Which candidate a fact belongs to, for the facts that belong to one. */
export function factOwner(recommendation: Recommendation): Map<Id, Id> {
  const owner = new Map<Id, Id>();
  for (const candidate of recommendation.candidates) {
    for (const fact of candidate.facts) owner.set(fact.id, candidate.id);
  }
  return owner;
}

/**
 * Every id the recommendation itself puts on the screen or rests on: its own
 * id, the entities it points at, the rules it applied, its facts and the refs
 * under them, its candidates with their reserved objects and target zones, and
 * the entities its diff touches. The free answer may name these and nothing
 * else — a zone that exists in the plan but is not part of this recommendation
 * is already an invention as far as this answer is concerned.
 */
export function allowedIds(recommendation: Recommendation): Set<Id> {
  const ids = new Set<Id>([recommendation.id]);
  const addFact = (fact: Fact): void => {
    ids.add(fact.id);
    for (const ref of fact.refs) ids.add(ref.id);
  };

  for (const ref of recommendation.refs) ids.add(ref.id);
  for (const ruleId of recommendation.ruleIds) ids.add(ruleId);
  for (const fact of recommendation.facts) addFact(fact);
  for (const candidate of recommendation.candidates) {
    ids.add(candidate.id);
    ids.add(candidate.object.id);
    if (candidate.object.zoneId !== null) ids.add(candidate.object.zoneId);
    for (const fact of candidate.facts) addFact(fact);
  }
  for (const change of recommendation.changes) ids.add(change.ref.id);
  return ids;
}

/** How many decimals the interface shows for a value in these units. */
function displayDigits(unit: Fact['unit']): number {
  return unit === 'count' ? 0 : 2;
}

/**
 * Rounds the way the interface rounds — half away from zero, like
 * `Intl.NumberFormat` in src/domain/number-format.ts. Comparing against the raw
 * value would reject «12,35» for a free area of 12,3456789: the honest quote of
 * a number the user is actually shown.
 */
function roundToDisplay(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(Math.abs(value) * factor) / factor;
}

const CHANGE_KINDS: readonly Change['kind'][] = ['added', 'removed', 'moved', 'updated'];

/** |min − count| and |count − max|: the difference the template prints. */
function ruleGaps(facts: Fact[]): number[] {
  const value = (metric: Fact['metric']): number | undefined =>
    facts.find((fact) => fact.metric === metric && fact.phase === 'current')?.value;
  const count = value('equipment.count');
  if (count === undefined) return [];
  return [value('equipment.min'), value('equipment.max')]
    .filter((limit): limit is number => limit !== undefined)
    .map((limit) => Math.abs(limit - count));
}

/**
 * Every number the recommendation lets the user read, at the rounding they read
 * it in: the values of its facts and of its candidates' forecasts, the geometry
 * of each candidate, the ordinal of each variant («Вариант 2»), how many
 * variants and changes there are, and the shortfall the equipment template
 * prints. Magnitudes only — the sign is not part of the comparison, see the
 * module header.
 */
export function allowedNumbers(recommendation: Recommendation): number[] {
  const values: number[] = [];
  const add = (value: number, digits: number): void => {
    values.push(roundToDisplay(value, digits));
  };
  const addFact = (fact: Fact): void => add(fact.value, displayDigits(fact.unit));
  const addCandidate = (candidate: Candidate, index: number): void => {
    for (const fact of candidate.facts) addFact(fact);
    for (const coordinate of candidate.object.position) add(coordinate, 2);
    for (const side of candidate.object.size_m) add(side, 2);
    add(candidate.object.rotation_deg, 0);
    add(index + 1, 0);
  };

  for (const fact of recommendation.facts) addFact(fact);
  recommendation.candidates.forEach(addCandidate);
  add(recommendation.candidates.length, 0);
  add(recommendation.changes.length, 0);
  for (const kind of CHANGE_KINDS) {
    add(recommendation.changes.filter((change) => change.kind === kind).length, 0);
  }
  for (const gap of ruleGaps(recommendation.facts)) add(gap, 0);
  return values;
}

/**
 * A token shaped like an id of this project: latin, and carrying at least one
 * underscore — `z_waiting`, `eq_6`, `rule_desk_zone`, `adv_place_x.area.free`.
 * The underscore is what separates an id from the vocabulary the answer may use
 * freely: `area.free` is a metric name, not an entity.
 */
const ID_TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[_.][A-Za-z0-9]+)+/g;

/** Field names of the prompt payload — the model sees them, they are not ids. */
const PAYLOAD_FIELDS: ReadonlySet<string> = new Set(['size_m', 'rotation_deg']);

/** Unsigned: «−1,50» is read as 1,50, and «2-3» does not become −3. */
const NUMBER_TOKEN = /\d+(?:[.,]\d+)?/g;

/** Id-shaped tokens of the text that the recommendation does not name. */
export function unknownIds(text: string, allowed: ReadonlySet<Id>): string[] {
  const found: string[] = [];
  for (const [token] of text.matchAll(ID_TOKEN)) {
    if (!token.includes('_')) continue;
    if (PAYLOAD_FIELDS.has(token)) continue;
    if (allowed.has(token)) continue;
    found.push(token);
  }
  return found;
}

/** Numbers of the text that the calculation did not produce. */
export function unknownNumbers(text: string, allowed: readonly number[]): string[] {
  // Ids are removed first: `eq_6` carries a 6 that is part of a name, not a
  // measurement, and it has already been checked as an id.
  const prose = text.replace(ID_TOKEN, ' ');
  const found: string[] = [];
  for (const [token] of prose.matchAll(NUMBER_TOKEN)) {
    const value = Number.parseFloat(token.replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    if (allowed.some((entry) => Math.abs(entry - value) < 1e-9)) continue;
    found.push(token);
  }
  return found;
}

/** The free answer after the check: kept as written, or dropped with a reason. */
type TextReview = { text?: string; issues: Issue[] };

function reviewText(text: string | undefined, recommendation: Recommendation): TextReview {
  if (text === undefined) return { issues: [] };
  const where: Ref[] = recommendation.refs;

  const parsed = answerTextSchema.safeParse(text);
  if (!parsed.success) {
    const tooLong = text.trim().length > ADVICE_LIMITS.maxAnswerChars;
    return {
      issues: [
        tooLong
          ? issue(
              EXPLANATION_ISSUE_CODES.TEXT_TOO_LONG,
              `Свободный ответ модели длиннее ${ADVICE_LIMITS.maxAnswerChars} символов: показан только расчёт.`,
              where,
            )
          : issue(
              EXPLANATION_ISSUE_CODES.TEXT_EMPTY,
              'Модель прислала пустой свободный ответ: показан только расчёт.',
              where,
            ),
      ],
    };
  }

  const issues: Issue[] = [];
  const ids = unknownIds(parsed.data, allowedIds(recommendation));
  if (ids.length > 0) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.TEXT_UNKNOWN_ID,
        `Свободный ответ называет идентификаторы, которых в рекомендации нет: ${ids.join(', ')}.`,
        where,
      ),
    );
  }
  const numbers = unknownNumbers(parsed.data, allowedNumbers(recommendation));
  if (numbers.length > 0) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.TEXT_UNKNOWN_NUMBER,
        `Свободный ответ называет числа, которых расчёт не выдавал: ${numbers.join(', ')}.`,
        where,
      ),
    );
  }

  return issues.length > 0 ? { issues } : { text: parsed.data, issues };
}

/**
 * The explanation the calculation gives itself: its own reason code, its first
 * candidate and the facts that code requires. This is what the assistant shows
 * when there is no model or the model's answer was refused — and it passes the
 * check above by construction, so the fallback path is not a second, laxer one.
 *
 * `null` means even the calculation cannot back this recommendation up; the UI
 * then shows the numbers without a sentence rather than a sentence without
 * numbers.
 */
export function defaultExplanation(recommendation: Recommendation): Explanation | null {
  const reasonCode = recommendation.reasonCodes[0];
  if (reasonCode === undefined) return null;
  const spec = REASON_CODE_SPECS[reasonCode];

  const candidate =
    spec.candidate === 'required' ? recommendation.candidates[0] : undefined;
  if (spec.candidate === 'required' && candidate === undefined) return null;

  const owner = factOwner(recommendation);
  const usable = recommendation.facts.filter((fact) => {
    const belongsTo = owner.get(fact.id);
    return belongsTo === undefined || belongsTo === candidate?.id;
  });

  const factIds: Id[] = [];
  for (const required of spec.requiredFacts) {
    const fact = usable.find(
      (entry) => entry.metric === required.metric && entry.phase === required.phase,
    );
    if (fact === undefined) return null;
    if (!factIds.includes(fact.id)) factIds.push(fact.id);
  }
  if (spec.requiresNonZeroDelta) {
    const moved = usable.find((fact) => fact.phase === 'delta' && fact.value !== 0);
    if (moved === undefined) return null;
    if (!factIds.includes(moved.id)) factIds.push(moved.id);
  }
  if (factIds.length === 0) return null;

  return {
    recommendationId: recommendation.id,
    candidateId: candidate?.id ?? null,
    reasonCode,
    factIds,
  };
}

function checkOne(explanation: Explanation, recommendation: Recommendation): Issue[] {
  const spec = REASON_CODE_SPECS[explanation.reasonCode];
  const where: Ref[] = recommendation.refs;
  const issues: Issue[] = [];

  // Проверки ниже не прекращаются на первой: отказ уходит в журнал сервера, и
  // по нему должно быть видно всё, что не так с ответом, а не первый признак.
  const allowed = recommendation.reasonCodes.includes(explanation.reasonCode);
  if (!allowed) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.REASON_NOT_ALLOWED,
        `Модель выбрала код «${explanation.reasonCode}», которого расчёт не предлагал.`,
        where,
      ),
    );
  }

  if (allowed && !recommendation.limitations.includes(spec.requiredLimitation)) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.LIMITATION_MISSING,
        `Рекомендация «${recommendation.id}» не несёт обязательного ограничения кода «${explanation.reasonCode}».`,
        where,
      ),
    );
  }

  const candidateIds = new Set(
    recommendation.candidates.map((candidate) => candidate.id),
  );
  if (spec.candidate === 'required' && !candidateIds.has(explanation.candidateId ?? '')) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.CANDIDATE_REQUIRED,
        `Код «${explanation.reasonCode}» обязан называть вариант размещения из этой рекомендации.`,
        where,
      ),
    );
  }
  if (spec.candidate === 'forbidden' && explanation.candidateId !== null) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.CANDIDATE_FORBIDDEN,
        `Код «${explanation.reasonCode}» не имеет вариантов размещения, а модель назвала «${explanation.candidateId}».`,
        where,
      ),
    );
  }

  const facts = factById(recommendation);
  const owner = factOwner(recommendation);
  const cited: Fact[] = [];
  for (const factId of explanation.factIds) {
    const fact = facts.get(factId);
    if (fact === undefined) {
      issues.push(
        issue(
          EXPLANATION_ISSUE_CODES.UNKNOWN_FACT,
          `Модель сослалась на факт «${factId}», которого в рекомендации нет.`,
          where,
        ),
      );
      continue;
    }
    const belongsTo = owner.get(factId);
    if (belongsTo !== undefined && belongsTo !== explanation.candidateId) {
      issues.push(
        issue(
          EXPLANATION_ISSUE_CODES.CANDIDATE_FACT_MISMATCH,
          `Факт «${factId}» относится к варианту «${belongsTo}», а объяснение о варианте «${explanation.candidateId ?? 'без варианта'}».`,
          where,
        ),
      );
      continue;
    }
    cited.push(fact);
  }

  for (const required of spec.requiredFacts) {
    if (
      cited.some(
        (fact) => fact.metric === required.metric && fact.phase === required.phase,
      )
    ) {
      continue;
    }
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.MISSING_FACT,
        `Объяснение не ссылается на обязательный факт ${required.metric} (${required.phase}).`,
        where,
      ),
    );
  }

  const deltas = cited.filter((fact) => fact.phase === 'delta');
  if (spec.requiresNonZeroDelta && !deltas.some((fact) => fact.value !== 0)) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.DELTA_ZERO,
        'Код говорит об изменении, но все названные разницы нулевые.',
        where,
      ),
    );
  }
  if (spec.requiresAllDeltaZero && deltas.some((fact) => fact.value !== 0)) {
    issues.push(
      issue(
        EXPLANATION_ISSUE_CODES.DELTA_NONZERO,
        'Код говорит об отсутствии изменений, но названа ненулевая разница.',
        where,
      ),
    );
  }

  return issues;
}

export type ExplanationReview = {
  explanations: Explanation[];
  /**
   * Why a free answer was dropped. The explanations came through regardless —
   * these go to the server log, so a model that never gets a word past the
   * check is visible to us instead of looking like a model that stays silent.
   */
  textIssues: Issue[];
};

/**
 * Checks the model's choice against the calculation. Either every explanation
 * holds up — and comes back typed — or the whole answer is refused: showing one
 * verified sentence next to one unverified one would leave the user guessing
 * which is which. The free answer is the one part that can fail alone, and then
 * only it is dropped.
 */
export function reviewExplanations(
  input: unknown,
  recommendations: Recommendation[],
): Result<ExplanationReview> {
  const parsed = parse(input);
  if (!parsed.ok) return parsed;

  const payload = payloadSchema.safeParse(parsed.value);
  if (!payload.success) {
    return {
      ok: false,
      issues: [
        issue(
          EXPLANATION_ISSUE_CODES.SHAPE_INVALID,
          `Ответ модели не соответствует согласованной структуре: ${payload.error.issues
            .map((entry) => `${entry.path.join('.') || '<корень>'} — ${entry.message}`)
            .join('; ')}.`,
        ),
      ],
    };
  }

  const byId = new Map(recommendations.map((entry) => [entry.id, entry]));
  const seen = new Set<Id>();
  const issues: Issue[] = [];
  const textIssues: Issue[] = [];
  const verified: Explanation[] = [];

  for (const entry of payload.data.explanations) {
    const explanation = entry as Explanation;
    const recommendation = byId.get(explanation.recommendationId);
    if (recommendation === undefined) {
      issues.push(
        issue(
          EXPLANATION_ISSUE_CODES.UNKNOWN_RECOMMENDATION,
          `Объяснение о рекомендации «${explanation.recommendationId}», которой расчёт не выдавал.`,
        ),
      );
      continue;
    }
    if (seen.has(explanation.recommendationId)) {
      issues.push(
        issue(
          EXPLANATION_ISSUE_CODES.DUPLICATE_RECOMMENDATION,
          `Для рекомендации «${explanation.recommendationId}» дано больше одного объяснения.`,
          recommendation.refs,
        ),
      );
      continue;
    }
    seen.add(explanation.recommendationId);

    const problems = checkOne(explanation, recommendation);
    if (problems.length > 0) {
      issues.push(...problems);
      continue;
    }

    // Текст собирается заново, а не переносится из ответа: в `verified` попадает
    // только то, что проверено, поэтому отклонённый текст физически не доедет.
    const review = reviewText(explanation.text, recommendation);
    textIssues.push(...review.issues);
    const checked: Explanation = {
      recommendationId: explanation.recommendationId,
      candidateId: explanation.candidateId,
      reasonCode: explanation.reasonCode,
      factIds: explanation.factIds,
    };
    if (review.text !== undefined) checked.text = review.text;
    verified.push(checked);
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { explanations: verified, textIssues } };
}

/** Contract-shaped view of the review: the explanations only. */
export const verifyExplanation: VerifyExplanation = (input, recommendations) => {
  const reviewed = reviewExplanations(input, recommendations);
  if (!reviewed.ok) return reviewed;
  return { ok: true, value: reviewed.value.explanations };
};

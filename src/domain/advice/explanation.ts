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
 */

import { z } from 'zod';
import type {
  Explanation,
  Fact,
  Recommendation,
  VerifyExplanation,
} from '../../contracts/advice';
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
} as const;

const explanationSchema = z
  .object({
    recommendationId: z.string().min(1),
    candidateId: z.string().min(1).nullable(),
    reasonCode: z.enum(REASON_CODES as [string, ...string[]]),
    factIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

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

/**
 * Checks the model's choice against the calculation. Either every explanation
 * holds up — and comes back typed — or the whole answer is refused: showing one
 * verified sentence next to one unverified one would leave the user guessing
 * which is which.
 */
export const verifyExplanation: VerifyExplanation = (input, recommendations) => {
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
    if (problems.length > 0) issues.push(...problems);
    else verified.push(explanation);
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: verified };
};

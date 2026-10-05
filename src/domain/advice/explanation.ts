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
  AdviceResponse,
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

/** #178: codes of the free-text «почему сюда» check. */
export const WHY_ISSUE_CODES = {
  /** The text compares variants, but the calculation offered none. */
  NO_VARIANTS: 'WHY_NO_VARIANTS',
  /** An id-shaped token that is not a zone, object, type, rule or layer of the plan. */
  UNKNOWN_ID: 'WHY_UNKNOWN_ID',
  /** A number that no calculated value rounds to. */
  UNKNOWN_NUMBER: 'WHY_UNKNOWN_NUMBER',
  /** «Вариант N» outside the variants the calculation offered. */
  UNKNOWN_VARIANT: 'WHY_UNKNOWN_VARIANT',
  /** «в 2 раза», «вдвое», «три»: a ratio or a number in words, which no check can match. */
  WORD_NUMBER: 'WHY_WORD_NUMBER',
  /** A catalog rule called a norm. */
  RULE_AS_NORM: 'WHY_RULE_AS_NORM',
  /** A rule mentioned without whose rule it is. */
  RULE_SOURCE_MISSING: 'WHY_RULE_SOURCE_MISSING',
} as const;

export type WhyUnit = 'm' | 'm2' | 'percent' | 'count';
/** A value the calculation gave the model, with the unit it is in. */
export type WhyNumber = { value: number; unit: WhyUnit };

/** What a «почему сюда» text may name: everything here was produced by code or is in the plan. */
export type WhyScope = {
  /** Zone, object, type, rule and layer ids of the plan. */
  ids: ReadonlySet<Id>;
  /** Rule ids among `ids`: naming one is naming a rule. */
  rules: ReadonlySet<Id>;
  /** Zones and objects: in «name» (id) the chat shows the plan's name instead (D-320). */
  shown: ReadonlySet<Id>;
  /** Plan names by id: digits inside «Окно 2» are a name, not a number. */
  names: ReadonlyMap<Id, string>;
  /** Every value the calculation gave the model. */
  numbers: readonly WhyNumber[];
  /** «Вариант N» is valid for 1 ≤ N ≤ variants. */
  variants: number;
};

const ID_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi;
const QUOTED = /«([^«»]{1,120})»/g;
const ID_AFTER = new RegExp(`^\\s*\\((${ID_TOKEN.source})\\)`, 'i');
/** A variant number is whole; lists only with «и», «или», a range only as «1–3» without spaces. */
const VARIANT_NUMBER = String.raw`\d+(?!\d|[.,]\d)`;
const VARIANT_NUMBERS = new RegExp(String.raw`вариант[а-яё]*\s+(?:№\s*)?(${VARIANT_NUMBER}(?:(?:\s+(?:и|или)\s+|[–-])${VARIANT_NUMBER})*)`, 'gi');
/** «в 2 раза», «вдвое», «треть», «три»: a ratio or a number in words is the model's own sum. */
const WORD_NUMBER = new RegExp(String.raw`(?<![а-я])(?:раза?|в(?:дво|тро|четвер|пятер)[еоа]|\S*кратн\S*|\S*половин\S*|трет(?:ь|и|ью|ей)|` +
  String.raw`нол(?:ь|я|ем)|нул(?:ь|я|ем)|од(?:ин|на|но|ного|ной|ному|ним|ну|ном)|дв(?:а|е|ух|ум|умя)|тр(?:и|ех|ем|емя)|четыр(?:е|ех|ем|ьмя)|` +
  String.raw`(?:пят|шест|сем|восем|девят|десят)(?:ь|и|ью)|восьм(?:и|ью)|\S+надцат(?:ь|и|ью)|(?:двадцат|тридцат)(?:ь|и|ью)|сорок|` +
  String.raw`\S+десят|девяност[оа]|сто|двест[иа]|трист[аео]|тысяч\S*|полтор(?:а|ы|ум))(?![а-я])`, 'i');
const VARIANT_ORDINALS = /(перв|втор|трет|четв[её]рт|пят)[а-яё]*\s+вариант/gi;
const ORDINALS: Record<string, number> = { перв: 1, втор: 2, трет: 3, четвёрт: 4, четверт: 4, пят: 5 };
/** A decimal comma or point; thousands only by the non-breaking spaces `formatNumber` writes. */
const NUMBER = /\d+(?:[\u00A0\u202F]\d{3})*(?:[.,]\d+)?/g;
const NORM_CLAIM = /(?<!не\s)норматив/i;
const RULE_WORD = /(?<![а-яё])правил(?:о|а|у|ом|е|ам|ами|ах)?(?![а-яё])/i;
const RULE_SOURCE = /правил[а-яё]*\s+команды|организатор/i;
/** The unit written right after a number; m² before m. No unit — any value may match. */
const UNITS: [RegExp, WhyUnit][] = [
  [/^\s*(?:м²|м2|кв\.\s*м)/i, 'm2'],
  [/^\s*м(?:етр[а-яё]*)?(?![а-яё])/i, 'm'],
  [/^\s*(?:%|п\.\s*п\.|процент)/i, 'percent'],
  [/^\s*шт/i, 'count'],
];

/**
 * A number in the text matches a value if the value rounds to it at the
 * text's own precision: «12,3» stands for 12,34. A whole number stands only
 * for a whole value — «5» for 4,57 is a guess, not a rounding. A unit after
 * the number narrows the values to that unit: «5 м» is not five objects. The
 * sign is the sentence's business («выросла на», «−0,5»), the size is the code's.
 */
function matchesValue(token: string, unit: WhyUnit | null, values: readonly WhyNumber[]): boolean {
  const normal = token.replace(/[\u00A0\u202F]/g, '').replace(',', '.');
  const number = Number(normal);
  const decimals = normal.includes('.') ? normal.length - normal.indexOf('.') - 1 : 0;
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  return values.some((entry) =>
    (unit === null || entry.unit === unit) &&
    (decimals > 0 || Math.abs(entry.value - Math.round(entry.value)) < 0.005) &&
    Math.abs(Math.abs(entry.value) - number) <= tolerance);
}

/**
 * #178: the model's own words about why one variant beats another. The model
 * may write the sentence, but not a fact: every id must exist in the plan,
 * every number must be a value the calculation produced (at the precision
 * written), every «вариант N» must have been offered, and a catalog rule is
 * the team's rule or the organizers', never a norm of the Post. Any miss
 * refuses the whole text — the person then reads the calculation «без LLM».
 */
export function verifyWhyText(text: string, scope: WhyScope): Result<string> {
  // One paragraph: the chat splits answers on blank lines.
  const clean = text.replace(/\s*\n\s*/g, ' ').trim();
  const issues: Issue[] = [];
  if (scope.variants === 0) {
    issues.push(issue(WHY_ISSUE_CODES.NO_VARIANTS, 'Обоснование сравнивает варианты, а расчёт вариантов места не давал.'));
  }

  const ids = [...clean.matchAll(ID_TOKEN)].map((match) => match[0]);
  for (const id of new Set(ids)) {
    if (!scope.ids.has(id)) issues.push(issue(WHY_ISSUE_CODES.UNKNOWN_ID, `Обоснование называет «${id}», а в плане такого id нет.`));
  }

  // Digits of an id or of a plan name are not numbers. Before a zone or object
  // id the chat shows the plan's name instead of the quoted text (D-320); before
  // a rule, type or layer id the quoted text stays on screen, so it is checked.
  const names = new Set(scope.names.values());
  let rest = clean
    .replace(QUOTED, (whole, name: string, offset: number, all: string) => {
      const id = ID_AFTER.exec(all.slice(offset + whole.length))?.[1];
      const known = id === undefined ? names.has(name.trim()) : scope.shown.has(id) || scope.names.get(id) === name.trim();
      return known ? ' ' : whole;
    })
    .replace(ID_TOKEN, ' ');

  const variants: number[] = [];
  rest = rest.replace(VARIANT_NUMBERS, (_whole, list: string) => {
    variants.push(...(list.match(/\d+/g) ?? []).map(Number));
    return ' ';
  });
  for (const match of rest.matchAll(VARIANT_ORDINALS)) {
    variants.push(ORDINALS[match[1]!.toLowerCase()] ?? 0);
  }
  for (const variant of new Set(variants)) {
    if (variant < 1 || variant > scope.variants) {
      issues.push(issue(WHY_ISSUE_CODES.UNKNOWN_VARIANT, `Обоснование называет вариант ${variant}, а расчёт дал вариантов: ${scope.variants}.`));
    }
  }

  const unknown = new Set<string>();
  for (const match of rest.matchAll(NUMBER)) {
    const after = rest.slice(match.index + match[0].length);
    const unit = UNITS.find(([pattern]) => pattern.test(after));
    if (!matchesValue(match[0], unit?.[1] ?? null, scope.numbers)) unknown.add(`${match[0]}${unit === undefined ? '' : ` ${unit[0].exec(after)![0].trim()}`}`);
  }
  for (const token of unknown) issues.push(issue(WHY_ISSUE_CODES.UNKNOWN_NUMBER, `Числа ${token} нет в расчёте.`));
  const word = WORD_NUMBER.exec(rest.toLowerCase().replaceAll('ё', 'е'))?.[0];
  if (word !== undefined) {
    issues.push(issue(WHY_ISSUE_CODES.WORD_NUMBER, `Обоснование пишет число или отношение словами («${word}»): числа — только цифрами из расчёта, отношения код не считал.`));
  }

  if (NORM_CLAIM.test(clean)) {
    issues.push(issue(WHY_ISSUE_CODES.RULE_AS_NORM, 'Обоснование называет правило нормативом: правила справочника — правила команды, не норматив Почты.'));
  }
  const rule = ids.some((id) => scope.rules.has(id)) || RULE_WORD.test(clean);
  if (rule && !RULE_SOURCE.test(clean)) {
    issues.push(issue(WHY_ISSUE_CODES.RULE_SOURCE_MISSING, 'Обоснование упоминает правило, но не говорит, что это правило команды, не норматив Почты.'));
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: clean };
}

/**
 * #69: the advice answer without a model — the calculation explains itself
 * with the same codes, facts and check. One function for the server (provider
 * down or rejected text) and the client (server unreachable).
 */
export function fallbackAdviceResponse(revision: number, recommendations: Recommendation[], reason: string): AdviceResponse {
  const explanations = recommendations
    .map((recommendation) => defaultExplanation(recommendation))
    .filter((explanation) => explanation !== null);
  return { revision, recommendations, explanations, mode: 'fallback', fallbackReason: reason };
}

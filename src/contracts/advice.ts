/**
 * Contracts v1: assistant request, calculated recommendation and HTTP surface.
 * Frozen by F02, see docs/contracts-v1.md.
 *
 * Numbers are produced by the calculation, never taken from the model: the model
 * only picks an already-permitted reason code and the fact ids behind it.
 */

import type { Equipment, Id, PlanDocument, Point, Ref, Result } from './model';

export type AdviceScenario = 'place' | 'equipment' | 'compare';

export type AdviceRequest =
  | { scenario: 'place'; typeId: Id; zoneId: Id | null; anchor?: Point }
  | { scenario: 'equipment'; zoneId: Id | null }
  | { scenario: 'compare'; before: PlanDocument };

export type MetricCode =
  | 'area.total'
  | 'area.occupied'
  | 'area.free'
  | 'equipment.count'
  | 'equipment.min'
  | 'equipment.max'
  | 'objects.added'
  | 'objects.removed'
  | 'placement.distance';

export type ReasonCode =
  | 'placement.available'
  | 'placement.none'
  | 'equipment.missing'
  | 'equipment.excess'
  | 'comparison.changed'
  | 'comparison.unchanged';

export type FactPhase = 'current' | 'before' | 'after' | 'delta';

export type FactUnit = 'm' | 'm2' | 'count';

export type Fact = {
  id: Id;
  metric: MetricCode;
  phase: FactPhase;
  value: number;
  unit: FactUnit;
  refs: Ref[];
};

/** A placement candidate. Its object id is reserved but not yet in the plan. */
export type Candidate = { id: Id; object: Equipment; facts: Fact[] };

export type ChangeKind = 'added' | 'removed' | 'moved' | 'updated';

export type Change = { ref: Ref; kind: ChangeKind };

export type Recommendation = {
  id: Id;
  scenario: AdviceScenario;
  /** Existing entities only; new ids live in `candidates`. */
  refs: Ref[];
  candidates: Candidate[];
  facts: Fact[];
  ruleIds: Id[];
  /** Team assumptions the recommendation rests on, in Russian, for the UI. */
  assumptions: string[];
  reasonCodes: ReasonCode[];
  limitations: string[];
  /** Full diff for the compare scenario; [] for the others. */
  changes: Change[];
};

export type Explanation = {
  recommendationId: Id;
  candidateId: Id | null;
  reasonCode: ReasonCode;
  factIds: Id[];
};

export type AdviceMode = 'llm' | 'fallback';

export type AdviceResponse = {
  revision: number;
  recommendations: Recommendation[];
  explanations: Explanation[];
  mode: AdviceMode;
  /** Why the calculation is shown without the model. */
  fallbackReason?: string;
};

/** POST /api/advice */
export type AdviceHttpRequest = {
  plan: PlanDocument;
  revision: number;
  request: AdviceRequest;
  /** Free text, at most LIMITS.maxQueryChars characters. */
  query?: string;
};

/**
 * GET /api/health. `llm` says which mode the assistant will answer in on this
 * address: `configured: true` with the provider's name from LLM_PROVIDER — never
 * a key, an endpoint or a model URI (D-200).
 */
export type HealthResponse = {
  status: 'ok';
  llm: { configured: false } | { configured: true; provider: string };
};

/**
 * 400 malformed structure, 413 body over LIMITS.maxRequestBytes, 422 geometry
 * cannot be computed, 429 server rate limit. An external LLM failure is not an
 * error response: it returns 200 with mode 'fallback'.
 */
export type AdviceErrorStatus = 400 | 413 | 422 | 429;

/** src/domain/advice */
export type FindPlacements = (
  plan: PlanDocument,
  request: Extract<AdviceRequest, { scenario: 'place' }>,
) => Result<Candidate[]>;
export type CheckEquipment = (
  plan: PlanDocument,
  request: Extract<AdviceRequest, { scenario: 'equipment' }>,
) => Recommendation[];
export type ComparePlans = (
  before: PlanDocument,
  after: PlanDocument,
) => Result<Recommendation[]>;
export type CalculateAdvice = (
  plan: PlanDocument,
  request: AdviceRequest,
) => Result<Recommendation[]>;
export type VerifyExplanation = (
  input: unknown,
  recommendations: Recommendation[],
) => Result<Explanation[]>;

/** Validators for the two schema-bound conversational model calls. */
export type VerifyChatIntent = (
  input: unknown,
  plan: PlanDocument,
) => Result<import('./advice-chat').ChatIntent>;
export type VerifyChatSelection = (
  input: unknown,
  recommendations: Recommendation[],
  plan: PlanDocument,
) => Result<import('./advice-chat').ChatSelection>;

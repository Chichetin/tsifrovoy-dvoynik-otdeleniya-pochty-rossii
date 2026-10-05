/**
 * Contract of the conversational plan agent (D-258).
 *
 * The model talks to the plan only through the tools named here. Read tools
 * return what the deterministic calculation produced; interface tools attach
 * actions to the answer. No tool changes the document: a candidate or an edit
 * proposal reaches the plan only when a person presses «Применить», through
 * ordinary editor commands with one undo step.
 */

import { z } from 'zod';
import type { Fact, Recommendation } from './advice';
import type { Command } from './commands';
import { LIMITS, type Id, type Issue, type PlanDocument, type Point, type Ref } from './model';

export const AGENT_LIMITS = {
  /** Model calls in one exchange, tool rounds and the final text together. */
  maxSteps: 6,
  /** Prior messages sent as context: user questions and verified answers. */
  maxTurns: 8,
  maxHistoryChars: 4_000,
  maxTextChars: 2_000,
  /** Edits in one propose_edits call. */
  maxEdits: 12,
  /** #122: variants one layout_zone call returns. */
  layoutVariants: 3,
} as const;

export const AGENT_READ_TOOLS = [
  'plan_overview',
  'zone_details',
  'list_objects',
  'find_place',
  'check_equipment',
  'validate_plan',
  'compare_with_original',
] as const;

export const AGENT_UI_TOOLS = ['show_on_plan', 'suggest_candidate', 'suggest_layer', 'open_panel', 'propose_edits', 'layout_zone'] as const;

export type AgentToolName = (typeof AGENT_READ_TOOLS)[number] | (typeof AGENT_UI_TOOLS)[number];

/** Right-column tabs the agent may open next to its answer. */
export type AgentPanel = 'metrics' | 'validation' | 'inventory';

const finiteNumber = z.number().finite();
const optionalId = z.string().min(1).nullish().transform((value) => value ?? null);

/**
 * #126: one edit the model asks for in `propose_edits`. Metres and degrees in
 * plan axes. The model names existing ids; code computes every coordinate the
 * model does not give and checks the rest.
 */
export const agentEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('move'), id: z.string().min(1), dx_m: finiteNumber, dy_m: finiteNumber }),
  /** Turn by this angle, not to it. */
  z.object({ op: z.literal('rotate'), id: z.string().min(1), by_deg: finiteNumber }),
  /**
   * The point is a hint: code puts the object at the nearest place that passes
   * the check, as `find_place` does. Without a point code finds the place in
   * the zone; with both null, code also picks a fitting zone.
   */
  z.object({
    op: z.literal('add'),
    typeId: z.string().min(1),
    zoneId: optionalId,
    position_m: z.tuple([finiteNumber, finiteNumber]).nullish().transform((value) => value ?? null),
  }),
  z.object({ op: z.literal('delete'), id: z.string().min(1) }),
]);

export type AgentEdit = z.infer<typeof agentEditSchema>;

/** Arguments of `propose_edits`. */
export const proposeEditsArgsSchema = z.object({ edits: z.array(agentEditSchema).min(1).max(AGENT_LIMITS.maxEdits) });

/**
 * #122: arguments of `layout_zone`. Code rearranges the objects of the zone
 * (or only the listed types) by search and returns up to
 * `AGENT_LIMITS.layoutVariants` proposals of move and rotate edits. The model
 * only names the zone and explains the difference between the variants.
 */
export const layoutZoneArgsSchema = z.object({
  zoneId: z.string().min(1),
  typeIds: z.array(z.string().min(1)).min(1).nullish().transform((value) => value ?? null),
});

/** Where an object stands on one side of an edit. */
export type AgentEditPose = { position: Point; rotation_deg: number; zoneId: Id | null };

/** One accepted edit as the person reads it: «было → стало», written by code. */
export type AgentEditChange = {
  op: AgentEdit['op'];
  /** The object's id; for `add` — the id the new object gets. */
  id: Id;
  typeId: Id;
  label: string;
  /** null for `add`. */
  before: AgentEditPose | null;
  /** null for `delete`. */
  after: AgentEditPose | null;
};

/** Validation findings of one severity on the plan before and after the edits. */
export type AgentEditFindings = { before: number; after: number };

/**
 * Edits from one `propose_edits` call after the code check. Code checks the
 * edits one by one, in order, each on top of the edits accepted before it:
 * the ids exist, the command applies to the plan of the answer's revision and
 * passes physics and validation. A refused edit stays out of `commands`,
 * keeps its reason, and the next edit is checked without it.
 */
export type AgentEditProposal = {
  id: Id;
  /** #122: a layout variant's name, written by code («Вариант 1: вдоль стен»). */
  title?: string;
  /**
   * Accepted edits as editor commands, in order. Applied as one `batch` — one
   * undo step. A new object's id is minted against the plan; the UI re-mints
   * an id the store has retired (D-019) and names the id the object got.
   */
  commands: Command[];
  /** One entry per accepted edit, in the order of `commands`. */
  changes: AgentEditChange[];
  rejected: { edit: AgentEdit; reason: string }[];
  /**
   * Effect of all accepted edits, calculated by code on a copy of the plan:
   * `area.free`, `area.occupied`, `objects.added`, `objects.removed` with
   * phases before, after and delta. A layout variant (#122) adds
   * `layout.passage` and `layout.entrance`.
   */
  facts: Fact[];
  /** Validation errors and warnings before → after all accepted edits. */
  findings: { errors: AgentEditFindings; warnings: AgentEditFindings };
};

export type AssistantAction =
  | { kind: 'focus'; ref: Ref }
  | { kind: 'preview-candidate'; recommendationId: Id; candidateId: Id }
  /** Edits the plan — only on a person's click. */
  | { kind: 'apply-candidate'; recommendationId: Id; candidateId: Id }
  /** Ghosts of every accepted edit on the plan; no command. */
  | { kind: 'preview-edits'; proposalId: Id }
  /** Edits the plan — only on a person's click: the proposal's commands as one batch. */
  | { kind: 'apply-edits'; proposalId: Id }
  | { kind: 'show-layer'; layerId: Id }
  | { kind: 'open-panel'; panel: AgentPanel };

/** One tool call as the person sees it. The label is written by code. */
export type AgentStep = { tool: AgentToolName; label: string; ok: boolean };

export type AgentAnswer = {
  revision: number;
  /** 'llm' — the text is the model's and passed the check; otherwise code wrote it. */
  mode: 'llm' | 'fallback';
  text: string;
  steps: AgentStep[];
  recommendations: Recommendation[];
  /** Checked edit proposals that `preview-edits` / `apply-edits` refer to. */
  proposals: AgentEditProposal[];
  actions: AssistantAction[];
  /** Existing entities the answer rests on: highlighted and clickable. */
  refs: Ref[];
  fallbackReason?: string;
};

/** Browser-only conversation memory; never part of the plan file. */
export type AgentTurn = { role: 'user' | 'assistant'; text: string; revision: number };

/** POST /api/assistant/agent */
export type AgentHttpRequest = {
  plan: PlanDocument;
  revision: number;
  query: string;
  history: AgentTurn[];
  /** The plan as it was opened: the only source for the comparison tool. */
  before?: PlanDocument;
};

/** The response is NDJSON: steps as they happen, then exactly one answer or error. */
export type AgentStreamEvent =
  | { type: 'step'; step: AgentStep }
  | { type: 'answer'; answer: AgentAnswer }
  | { type: 'error'; issues: Issue[] };

export const agentTurnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(AGENT_LIMITS.maxTextChars),
    revision: z.number().int().min(0),
  })
  .strict();

export const agentBodySchema = z.object({
  plan: z.unknown(),
  revision: z.number().int().min(0),
  query: z.string().trim().min(1).max(LIMITS.maxQueryChars),
  history: z.array(agentTurnSchema).max(AGENT_LIMITS.maxTurns).default([]),
  before: z.unknown().optional(),
});

/** One question and what came of it, as the chat shows it. */
export type AgentExchange = {
  id: string;
  question: string;
  /** Plan revision the question was asked about. */
  revision: number;
  /** Tool calls seen so far; the answer carries the final list. */
  steps: AgentStep[];
  answer: AgentAnswer | null;
  error: string | null;
};

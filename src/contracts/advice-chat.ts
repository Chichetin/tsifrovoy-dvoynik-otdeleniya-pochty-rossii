/**
 * Contract of the conversational plan agent (D-255).
 *
 * The model talks to the plan only through the tools named here. Read tools
 * return what the deterministic calculation produced; interface tools attach
 * actions to the answer. No tool changes the document: a candidate reaches the
 * plan only when a person presses «Применить», through the ordinary
 * `object.put` command with its undo step.
 */

import { z } from 'zod';
import type { Recommendation } from './advice';
import { LIMITS, type Id, type Issue, type PlanDocument, type Ref } from './model';

export const AGENT_LIMITS = {
  /** Model calls in one exchange, tool rounds and the final text together. */
  maxSteps: 6,
  /** Prior messages sent as context: user questions and verified answers. */
  maxTurns: 8,
  maxHistoryChars: 4_000,
  maxTextChars: 2_000,
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

export const AGENT_UI_TOOLS = ['show_on_plan', 'suggest_candidate', 'suggest_layer', 'open_panel'] as const;

export type AgentToolName = (typeof AGENT_READ_TOOLS)[number] | (typeof AGENT_UI_TOOLS)[number];

/** Right-column tabs the agent may open next to its answer. */
export type AgentPanel = 'metrics' | 'validation' | 'inventory';

export type AssistantAction =
  | { kind: 'focus'; ref: Ref }
  | { kind: 'preview-candidate'; recommendationId: Id; candidateId: Id }
  /** The only action that edits the plan — and only on a person's click. */
  | { kind: 'apply-candidate'; recommendationId: Id; candidateId: Id }
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

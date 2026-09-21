/**
 * D-258: the browser side of the plan agent.
 *
 * Reads the NDJSON stream of `/api/assistant/agent`: each tool call is passed
 * on as it arrives, then the answer. When the server is not there — `npm run
 * dev` without a backend, a dropped network — the same model-free agent runs
 * in the page, so the chat still answers from the calculation, «без LLM».
 */

import { AGENT_LIMITS, type AgentAnswer, type AgentHttpRequest, type AgentStep, type AgentStreamEvent, type AgentTurn } from '../../contracts/advice-chat';
import type { Issue, Result } from '../../contracts/model';
import { answerWithoutModel } from '../../domain/advice';

export const AGENT_CLIENT_ISSUE_CODES = {
  AGENT_RESPONSE_UNEXPECTED: 'AGENT_RESPONSE_UNEXPECTED',
} as const;

const LOCAL_REASON = 'Сервер ассистента недоступен — ответ собран расчётом в браузере, без LLM.';

function unexpected(message: string): Result<AgentAnswer> {
  return { ok: false, issues: [{ code: AGENT_CLIENT_ISSUE_CODES.AGENT_RESPONSE_UNEXPECTED, severity: 'error', message, refs: [] }] };
}

function looksLikeAnswer(value: unknown): value is AgentAnswer {
  const answer = value as Partial<AgentAnswer> | null;
  return (
    answer !== null &&
    typeof answer === 'object' &&
    typeof answer.text === 'string' &&
    typeof answer.revision === 'number' &&
    (answer.mode === 'llm' || answer.mode === 'fallback') &&
    Array.isArray(answer.steps) &&
    Array.isArray(answer.actions) &&
    Array.isArray(answer.recommendations) &&
    Array.isArray(answer.refs)
  );
}

function local(input: AgentHttpRequest, onStep: (step: AgentStep) => void): Result<AgentAnswer> {
  return { ok: true, value: answerWithoutModel(input.plan, input.before ?? null, input.query, input.revision, LOCAL_REASON, onStep) };
}

/** Parses one NDJSON line; a broken line is skipped, not fatal. */
function parseEvent(line: string): AgentStreamEvent | null {
  try {
    return JSON.parse(line) as AgentStreamEvent;
  } catch {
    return null;
  }
}

export async function requestAgent(
  input: AgentHttpRequest,
  onStep: (step: AgentStep) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<AgentAnswer>> {
  let response: Response;
  try {
    response = await fetchImpl('/api/assistant/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return local(input, onStep);
  }

  // No backend behind the dev proxy, or a static host: answer from the page.
  if (response.status === 404 || response.status >= 500 || response.body === null) return local(input, onStep);
  if (!response.ok) {
    let issues: Issue[];
    try {
      const body = (await response.json()) as { issues?: Issue[] };
      issues = Array.isArray(body.issues) ? body.issues : [];
    } catch {
      issues = [];
    }
    return issues.length > 0 ? { ok: false, issues } : unexpected(`Сервер ассистента ответил кодом ${response.status}.`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let stepsSeen = 0;
  const handle = (line: string): Result<AgentAnswer> | null => {
    if (line.trim() === '') return null;
    const event = parseEvent(line);
    if (event === null) return null;
    if (event.type === 'step') {
      stepsSeen += 1;
      onStep(event.step);
      return null;
    }
    if (event.type === 'error') return { ok: false, issues: event.issues };
    return looksLikeAnswer(event.answer) ? { ok: true, value: event.answer } : unexpected('Сервер ассистента прислал ответ в непонятном формате.');
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value !== undefined) buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const result = handle(line);
        if (result !== null) return result;
      }
      if (done) break;
    }
  } catch {
    // The connection dropped mid-answer: the answer comes from the page and
    // carries its own steps, which replace the ones shown so far.
    return local(input, stepsSeen === 0 ? onStep : () => undefined);
  }
  const last = handle(buffer);
  return last ?? unexpected('Поток ассистента оборвался без ответа.');
}

/**
 * What goes back to the server as context: the newest questions and the
 * answers shown for them, within the contract's count and size limits.
 */
export function turnsOf(exchanges: readonly { question: string; revision: number; answer: AgentAnswer | null }[]): AgentTurn[] {
  const turns: AgentTurn[] = [];
  for (const exchange of exchanges) {
    if (exchange.answer === null) continue;
    turns.push({ role: 'user', text: exchange.question, revision: exchange.revision });
    turns.push({ role: 'assistant', text: exchange.answer.text.slice(0, AGENT_LIMITS.maxTextChars), revision: exchange.answer.revision });
  }
  const kept = turns.slice(-AGENT_LIMITS.maxTurns);
  while (kept.length > 0 && kept.reduce((sum, turn) => sum + turn.text.length, 0) > AGENT_LIMITS.maxHistoryChars) kept.splice(0, 2);
  // A context never starts with an answer to a question it no longer holds.
  if (kept[0]?.role === 'assistant') kept.shift();
  return kept;
}

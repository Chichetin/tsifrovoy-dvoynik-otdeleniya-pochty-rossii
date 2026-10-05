import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';
import { ASSISTANT_CORPUS, type CorpusCase } from './assistant-corpus/cases';
import { collectAgentFacts, createAgentToolState, defaultExplanation, renderAgentFact, runAgentTool, verifyExplanation } from '../src/domain/advice';
import { measurePlan } from '../src/domain/metrics';
import { validatePlan } from '../src/domain/validation';
import { runAgent } from '../server/agent';
import type { LlmChat, LlmMessage, LlmTurn } from '../server/llm-client';

type Offered = { id: string; text: string; candidateId?: string; recommendationId?: string };
function scriptedScenario(item: CorpusCase): { chat: LlmChat; selected: string[] } {
  let turn = 0;
  const selected: string[] = [];
  const chat: LlmChat = async ({ messages }) => {
    const call = (name: string, args: unknown): LlmTurn => ({ content: '', toolCalls: [{ id: `call-${turn}`, name, arguments: JSON.stringify(args) }] });
    if (turn++ === 0) return { ok: true, value: call(item.tool.name, item.tool.args) };
    if (item.unsafeText !== undefined) return { ok: true, value: { content: item.unsafeText, toolCalls: [] } };
    const tools = messages.filter((m): m is Extract<LlmMessage, { role: 'tool' }> => m.role === 'tool').map((m) => JSON.parse(m.content));
    const offered: Offered[] = tools.flatMap((t) => t.answerFacts);
    const candidateFact = offered.find((f) => f.candidateId !== undefined);
    if (turn === 2 && item.category === 'place' && candidateFact !== undefined) {
      return { ok: true, value: call('suggest_candidate', { recommendationId: candidateFact.recommendationId, candidateId: candidateFact.candidateId }) };
    }
    const chosen = offered.filter((f) => f.candidateId === undefined || f.candidateId === candidateFact?.candidateId).slice(0, 12);
    selected.push(...chosen.map((f) => f.id));
    return { ok: true, value: { content: JSON.stringify({ factIds: selected }), toolCalls: [] } };
  };
  return { chat, selected };
}

test('корпус содержит ровно 24 сценария и требуемую разбивку', () => {
  expect(ASSISTANT_CORPUS).toHaveLength(24);
  expect(new Set(ASSISTANT_CORPUS.map((c) => c.id)).size).toBe(24);
  expect(['place', 'equipment', 'compare', 'refusal'].map((category) => ASSISTANT_CORPUS.filter((c) => c.category === category).length)).toEqual([9, 6, 3, 6]);
});

describe('приёмочный корпус ассистента без внешнего API', () => {
  test.each(ASSISTANT_CORPUS)('$id', async (item) => {
    const snapshots = [JSON.stringify(item.plan), JSON.stringify(item.before)];
    const { chat, selected } = scriptedScenario(item);
    const started = performance.now();
    const answer = await runAgent({ chat, plan: item.plan, before: item.before ?? null, query: item.query, history: [], revision: 7, deadlineMs: 60000, onStep: () => undefined });
    const elapsedMs = performance.now() - started;
    expect([JSON.stringify(item.plan), JSON.stringify(item.before)]).toEqual(snapshots);
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.steps[0]).toMatchObject({ tool: item.tool.name, ok: true });
    expect(answer.mode).toBe(item.category === 'refusal' ? 'fallback' : 'llm');
    const state = createAgentToolState(item.plan, item.before ?? null);
    const output = runAgentTool(state, item.tool.name, item.tool.args).output;
    const facts = collectAgentFacts(state, [{ name: item.tool.name, output }]);
    for (const id of selected) {
      const fact = facts.find((f) => f.id === id);
      expect(fact, id).toBeDefined();
      expect(answer.text).toContain(renderAgentFact(fact!));
      for (const ref of fact!.refs) expect(answer.refs).toContainEqual(ref);
    }
    for (const recommendation of answer.recommendations) {
      const explanation = defaultExplanation(recommendation);
      expect(explanation).not.toBeNull();
      expect(verifyExplanation({ explanations: [explanation] }, [recommendation]).ok).toBe(true);
      if (selected.some((id) => facts.find((f) => f.id === id)?.recommendationId === recommendation.id)) {
        for (const note of [...recommendation.assumptions, ...recommendation.limitations]) expect(answer.text).toContain(note);
      }
    }
    if (item.category === 'place') {
      const candidate = answer.recommendations[0]?.candidates[0];
      expect(candidate).toBeDefined();
      expect(answer.actions).toContainEqual({ kind: 'apply-candidate', recommendationId: answer.recommendations[0]!.id, candidateId: candidate!.id });
      const withCandidate = { ...item.plan, objects: [...item.plan.objects, candidate!.object] };
      expect(validatePlan(withCandidate).filter((i) => i.severity === 'error').length).toBe(validatePlan(item.plan).filter((i) => i.severity === 'error').length);
    }
    if (item.category === 'compare') {
      const current = measurePlan(item.plan);
      const previous = measurePlan(item.before!);
      expect(current.ok && previous.ok).toBe(true);
      if (current.ok && previous.ok) {
        const delta = answer.recommendations[0]!.facts.find((f) => f.metric === 'area.free' && f.phase === 'delta')!;
        expect(delta.value).toBeCloseTo(current.value.room.free_m2 - previous.value.room.free_m2, 5);
      }
    }
    if (item.category === 'refusal') {
      expect(answer.fallbackReason).toContain('проверку связанных фактов');
      expect(answer.text).not.toContain(item.unsafeText!);
      expect(answer.text).not.toContain('99999');
      expect(answer.text).toMatch(/площад|свобод|Помещение/i);
    }
    console.log(JSON.stringify({ id: item.id, mode: answer.mode, elapsedMs: Math.round(elapsedMs), facts: selected.length, refs: answer.refs.length, recommendations: answer.recommendations.length }));
  });
});

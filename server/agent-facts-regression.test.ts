import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parsePlanDocument } from '../src/contracts/schema';
import { runAgent } from './agent';
import type { LlmChat, LlmTurn } from './llm-client';

const parsed = parsePlanDocument(JSON.parse(readFileSync('demo/before.json', 'utf8')));
if (!parsed.ok) throw new Error('before');
const plan = parsed.value;

test.each([
  'Свободная площадь помещения — 132 м².',
  'Свободная площадь помещения — 99999 м².',
  'Свободная площадь помещения — сто тридцать два квадратных метра.',
  'Свободная площадь помещения — 114,73 метра.',
  'После изменения свободная площадь выросла на 0,8 м².',
  'В комнате персонала свободно 114,73 м².',
])('непроверяемая подмена не получает отметку llm: %s', async (text) => {
  const turns: LlmTurn[] = [
    { content: '', toolCalls: [{ id: 'overview', name: 'plan_overview', arguments: '{}' }] },
    { content: text, toolCalls: [] }, { content: text, toolCalls: [] },
  ];
  const chat: LlmChat = async () => ({ ok: true, value: turns.shift()! });
  const answer = await runAgent({ chat, plan, before: null, query: 'Свободно 99999 м²? Проверь.', history: [], revision: 0, onStep: () => undefined, deadlineMs: 60000 });
  expect(answer.mode).toBe('fallback');
  expect(answer.text.replaceAll('\u00a0', ' ')).toContain('свободно 114,73 м²');
  expect(answer.text).not.toContain(text);
  expect(answer.fallbackReason).toBeTruthy();
});

/** Limited live acceptance; never prints configuration secrets or raw model text. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ASSISTANT_CORPUS } from '../tests/assistant-corpus/cases';
import { runAgent } from '../server/agent';
import { publicModelName, readLlmConfig } from '../server/config';
import { createLlmChat } from '../server/llm-client';

const config = readLlmConfig(process.env);
if (config === null) throw new Error('Нет конфигурации LLM. Запустите tsx с --env-file=.env; ключи не передавайте в аргументах.');
const ids = process.argv.slice(2);
if (ids.length < 1 || ids.length > 3) throw new Error('Укажите от одного до трёх id из tests/assistant-corpus/cases.ts.');
const cases = ids.map((id) => {
  const item = ASSISTANT_CORPUS.find((c) => c.id === id);
  if (item === undefined) throw new Error(`Неизвестный сценарий: ${id}`);
  return item;
});
const results = [];
mkdirSync('test-results', { recursive: true });
const outputPath = `test-results/assistant-live-${Date.now()}.json`;
for (const item of cases) {
  const started = performance.now();
  let calls = 0;
  const provider = createLlmChat(config);
  const answer = await runAgent({
    chat: async (request) => { calls += 1; return provider(request); },
    plan: item.plan, before: item.before ?? null, query: item.query, history: [], revision: 0,
    deadlineMs: 180000, onStep: (step) => console.log(JSON.stringify({ id: item.id, tool: step.tool, ok: step.ok })),
  });
  const result = {
    id: item.id, date: new Date().toISOString(), provider: config.provider, model: publicModelName(config.model),
    mode: answer.mode, elapsedMs: Math.round(performance.now() - started), calls,
    steps: answer.steps, refs: answer.refs, recommendations: answer.recommendations.length,
    // The answer is code-written; provider messages and key are never recorded.
    text: answer.text, fallbackReason: answer.fallbackReason ?? null,
  };
  results.push(result);
  writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ id: result.id, mode: result.mode, elapsedMs: result.elapsedMs, calls, recommendations: result.recommendations }));
  // An unavailable provider must not cost a full series of repeated calls.
  if (answer.mode === 'fallback' && /недоступна|статусом|Не удалось|не ответил/.test(answer.fallbackReason ?? '')) break;
}
console.log(JSON.stringify({ outputPath }));

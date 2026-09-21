# Conversational Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a concise Russian chat assistant that understands planning requests, keeps short browser-only context, and directs the editor without mutating a plan.

**Architecture:** The server makes two constrained LLM calls: intent parsing over a catalog vocabulary, then action/response selection over deterministic advice. Contracts validate every returned id, fact, recommendation, candidate and action. The browser retains six normalized turns in session storage and executes an explicit action union only when the document revision remains current.

**Tech Stack:** TypeScript 6, React 19, Zustand 5, Fastify 5, Zod 4, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-21-conversational-assistant-design.md`

## Global Constraints

- Only Qwen, DeepSeek, GigaChat or YandexGPT via server-side API; no provider key enters `src/` or git.
- Code calculates geometry, numbers, candidates and validation; LLM returns only schema-bound selections.
- Context contains at most six confirmed turns and 2,000 serialized characters in `sessionStorage`, never in a plan file or server store.
- Actions are exactly `focus`, `open-properties`, `filter-inventory`, `show-layer`, and `preview-candidate`; no action dispatches a plan command.
- Every UI change receives the full UI/UX gate and the round-trip browser scenario.

## File Structure

| File | Responsibility |
|---|---|
| `src/contracts/advice-chat.ts` | Strict chat, turn and action types plus validation. |
| `server/advice-route.ts` | Two LLM calls, deterministic calculation, fallback. |
| `src/features/assistant/chat-session.ts` | Bounded session storage and stale helpers. |
| `src/features/assistant/AssistantPanel.tsx` | Accessible operational chat and actions. |
| `src/app/App.tsx` | Validated action execution against current revision. |
| `tests/e2e/assistant.spec.ts` | Browser proof of dialogue, action and round trip. |

### Task 1: Strict chat contracts

**Files:**

- Create: `src/contracts/advice-chat.ts`
- Create: `src/contracts/advice-chat.test.ts`
- Modify: `src/contracts/advice.ts`
- Modify: `src/contracts/README.md`

**Interfaces:**

- Consumes: `AdviceRequest`, `Recommendation`, `Fact`, `PlanDocument`, `Id` and `Ref`.
- Produces: `ChatIntent`, `ChatTurn`, `AssistantAction`, `ChatSelection`, `verifyChatIntent`, `verifyChatSelection`.

- [ ] **Step 1: Write failing tests for legal and illegal model output**

```ts
expect(verifyChatIntent({ kind: 'request', request: { scenario: 'place', typeId: 'ot_workplace', zoneId: null }, preference: 'ближе к входу' }, plan)).toMatchObject({ ok: true });
expect(verifyChatIntent({ kind: 'request', request: { scenario: 'place', typeId: 'invented', zoneId: null }, preference: '' }, plan)).toMatchObject({ ok: false });
expect(verifyChatSelection({ selections: [{ recommendationId: 'r1', factIds: ['f1'], actions: [{ kind: 'focus', ref: { kind: 'object', id: 'invented' } }] }] }, recommendations, plan)).toMatchObject({ ok: false });
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run src/contracts/advice-chat.test.ts`

Expected: FAIL because the chat contract does not exist.

- [ ] **Step 3: Implement minimal strict validators**

```ts
export type AssistantAction =
  | { kind: 'focus'; ref: Ref }
  | { kind: 'open-properties'; objectId: Id }
  | { kind: 'filter-inventory'; typeId?: Id; zoneId?: Id }
  | { kind: 'show-layer'; layerId: Id }
  | { kind: 'preview-candidate'; recommendationId: Id; candidateId: Id };

export type ChatIntent =
  | { kind: 'clarify'; question: string }
  | { kind: 'request'; request: AdviceRequest; preference: string | null };
```

Use strict Zod objects. Validate intent ids against the plan; validate fact/candidate ownership and permitted action targets against calculated advice and the plan. Reject LLM-provided numeric facts and extra fields.

- [ ] **Step 4: Verify green and commit**

Run: `npx vitest run src/contracts/advice-chat.test.ts src/domain/advice/explanation.test.ts`

Commit: `git add src/contracts/advice-chat.ts src/contracts/advice-chat.test.ts src/contracts/advice.ts src/contracts/README.md && git commit -m "ai: контракт разговорного ассистента"`

### Task 2: Server conversation orchestration

**Files:**

- Modify: `server/advice-route.ts`
- Modify: `server/advice-route.test.ts`
- Modify: `server/llm-client.ts`
- Modify: `server/README.md`
- Modify: `.env.example`

**Interfaces:**

- Consumes: Task 1 validators, `calculateAdvice`, existing limiter and `LlmClient`.
- Produces: `POST /api/advice/chat`, a clarification or verified result/fallback.

- [ ] **Step 1: Write failing sequenced-provider tests**

```ts
const calls: LlmRequest[] = [];
const llm: LlmClient = async (request) => {
  calls.push(request);
  return calls.length === 1
    ? { ok: true, value: '{"kind":"request","request":{"scenario":"equipment","zoneId":null},"preference":null}' }
    : { ok: true, value: '{"selections":[{"recommendationId":"r1","factIds":["f1"],"actions":[]}]}' };
};
expect((await app.inject({ method: 'POST', url: '/api/advice/chat', payload: body })).statusCode).toBe(200);
expect(calls).toHaveLength(2);
```

Also prove clarification uses one call; unknown ids/actions, excess fields, unavailable model and rate limit produce deterministic fallback rather than an empty response.

- [ ] **Step 2: Verify red**

Run: `npx vitest run server/advice-route.test.ts`

Expected: FAIL because the chat endpoint is absent.

- [ ] **Step 3: Implement two bounded prompts and route**

```ts
const intent = await options.llm({ system: INTENT_SYSTEM_PROMPT, user: intentPrompt(query, vocabulary(plan)) });
const parsedIntent = verifyChatIntent(parseJson(intent), plan);
if (parsedIntent.value.kind === 'clarify') return { revision, kind: 'clarify', question: parsedIntent.value.question };
const calculated = calculateAdvice(plan, parsedIntent.value.request);
const selected = await options.llm({ system: SELECTION_SYSTEM_PROMPT, user: selectionPrompt(calculated.value, history) });
```

The parser receives only scenario names plus current labels/ids. The selector receives only calculated recommendations, fact ids and precomputed action allow-list. Reserve two rate-limit slots before an exchange; if either call fails, return calculation with a truthful fallback reason and no second call after a failed first call.

- [ ] **Step 4: Verify green and commit**

Run: `npx vitest run server/advice-route.test.ts server/llm-client.test.ts`

Commit: `git add server/advice-route.ts server/advice-route.test.ts server/llm-client.ts server/README.md .env.example && git commit -m "ai: сервер разговорного ассистента"`

### Task 3: Bounded browser context and safe app actions

**Files:**

- Create: `src/features/assistant/chat-session.ts`
- Create: `src/features/assistant/chat-session.test.ts`
- Modify: `src/features/assistant/advice-client.ts`
- Modify: `src/features/assistant/advice-client.test.ts`
- Modify: `src/contracts/ui.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**

- Consumes: Tasks 1–2 and existing `focusOn`, preview, layers and inventory view state.
- Produces: `requestChatAdvice`, `appendTurn`, `readChatSession`, `clearChatSession` and `executeAssistantAction`.

- [ ] **Step 1: Write failing retention and non-mutation tests**

```ts
const seven = Array.from({ length: 7 }, (_, index) => turn(`q${index}`));
expect(appendTurn([], seven).length).toBe(6);
expect(JSON.stringify(appendTurn([], seven)).length).toBeLessThanOrEqual(2000);
executeAssistantAction({ kind: 'preview-candidate', recommendationId: 'r1', candidateId: 'c1' });
expect(store.getState().document).toBe(before);
expect(store.getState().revision).toBe(0);
```

Cover denied/corrupt session storage, document replacement, stale action disabling and removed targets.

- [ ] **Step 2: Verify red**

Run: `npx vitest run src/features/assistant/chat-session.test.ts src/features/assistant/advice-client.test.ts src/app/App.test.tsx`

Expected: FAIL because no chat session/action seams exist.

- [ ] **Step 3: Implement only display-state actions**

```ts
export const MAX_CHAT_TURNS = 6;
export const MAX_CHAT_CONTEXT_CHARS = 2000;

function executeAssistantAction(action: AssistantAction): void {
  if (action.kind === 'focus') focusOn(action.ref);
  if (action.kind === 'open-properties') focusOn({ kind: 'object', id: action.objectId });
  if (action.kind === 'preview-candidate') setPreview(candidateFor(action));
}
```

Resolve all targets from the current document and response immediately before execution. Invalid/stale actions emit status text. `filter-inventory` and `show-layer` change only app-local presentation state; none of the five actions calls `store.dispatch`.

- [ ] **Step 4: Verify green and commit**

Run: `npx vitest run src/features/assistant/chat-session.test.ts src/features/assistant/advice-client.test.ts src/app/App.test.tsx`

Commit: `git add src/features/assistant/chat-session.ts src/features/assistant/chat-session.test.ts src/features/assistant/advice-client.ts src/features/assistant/advice-client.test.ts src/contracts/ui.ts src/app/App.tsx src/app/App.test.tsx && git commit -m "ai: контекст и действия ассистента"`

### Task 4: Accessible concise chat UI and evidence

**Files:**

- Modify: `src/features/assistant/AssistantPanel.tsx`
- Modify: `src/features/assistant/AssistantPanel.test.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/features/assistant/README.md`
- Modify: `tests/e2e/assistant.spec.ts`
- Modify: `HANDOFF.md`

**Interfaces:**

- Consumes: Task 3 session/action callback and fallback recommendation cards.
- Produces: accessible history, `aria-live` response and action controls that never dispatch commands.

- [ ] **Step 1: Write failing component/e2e tests**

```ts
fireEvent.change(screen.getByLabelText('Вопрос ассистенту'), { target: { value: 'Где добавить окно?' } });
fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
expect(onAskChat).toHaveBeenCalledWith('Где добавить окно?');
expect(screen.getByRole('button', { name: 'Показать на плане' })).toBeEnabled();
```

After rerender with a new revision, assert the action is disabled. In Playwright submit through a stub, execute focus/preview, modify the plan, assert staleness, then save/reopen the demo.

- [ ] **Step 2: Verify red**

Run: `npx vitest run src/features/assistant/AssistantPanel.test.tsx && DEV_PORT=5224 npx playwright test tests/e2e/assistant.spec.ts --grep "разговорный"`

Expected: FAIL because the legacy form has no chat input/history.

- [ ] **Step 3: Implement compact operational cards**

```tsx
<ol className="assistant__history" aria-label="История диалога">
  {turns.map((turn) => <ChatTurnCard key={turn.id} turn={turn} stale={turn.revision !== revision} onAction={onAction} />)}
</ol>
<label className="assistant__field">Вопрос ассистенту<textarea value={query} onChange={(event) => setQuery(event.target.value)} maxLength={LIMITS.maxQueryChars} /></label>
```

Render «Вывод / Предложения / Основание / Действие». Preserve three legacy controls as quick scenario examples and deterministic fallback. Expose loading via `role=status`, errors via `role=alert`, disabled stale action explanation, and fit 1280×800/1440×900 with core text at least 12 px.

- [ ] **Step 4: Verify UI, browser and accessibility gates**

Before code run `ui-ux-pro-max` and `frontend-design`. Then run `playwright-interactive`, `webapp-testing` and `playwright` at 1440×900/1280×800; capture at most four clipped after screenshots in `docs/verification/conversational-assistant/`; run `accessibility-scan`, `accessibility-inspect`, `accessibility-diff` and `web-design-guidelines`. If scan finds an actionable violation, use `accessibility-fix` then repeat scan/inspect. Record commands, artifacts and limits in `HANDOFF.md`.

- [ ] **Step 5: Verify green, full path and commit**

Run: `npm test && DEV_PORT=5224 npm run test:e2e && npm run typecheck && npm run lint && npm run build`

Commit: `git add src/features/assistant/AssistantPanel.tsx src/features/assistant/AssistantPanel.test.tsx src/app/styles.css src/features/assistant/README.md tests/e2e/assistant.spec.ts HANDOFF.md docs/verification/conversational-assistant && git commit -m "ai: разговорный интерфейс ассистента"`

### Task 5: Document and release verified capability

**Files:**

- Modify: `README.md`
- Modify: `docs/tz-compliance.md`
- Modify: `docs/decisions.md`
- Modify: `HANDOFF.md`
- Modify: `demo/effect.md`
- Test: `tests/demo.test.ts`

**Interfaces:**

- Consumes: verified Tasks 1–4.
- Produces: documented method, limitations and repeatable demo evidence.

- [ ] **Step 1: Add executable wording checks**

```ts
expect(readme).toContain('короткий контекст');
expect(readme).toContain('не изменяет план автоматически');
expect(demoEffects).toContain('ручной шаг в редакторе');
```

Run: `npx vitest run tests/demo.test.ts`

- [ ] **Step 2: Document exact boundaries**

Describe two-call flow, allowed providers, browser-only context, no full plan for parser, action allow-list, fallback and manual application. Do not alter `demo/recommendation.json` merely to claim chat behaviour.

- [ ] **Step 3: Full verification, commit and MR update**

Run: `npm test && DEV_PORT=5224 npm run test:e2e && npm run typecheck && npm run lint && npm run build && bash .claude/hooks/check-upstream.sh && bash .claude/hooks/check-secrets.sh`

Commit: `git add README.md docs/tz-compliance.md docs/decisions.md HANDOFF.md demo/effect.md tests/demo.test.ts && git commit -m "docs: описать разговорный ассистент"`

Push: `git push -u origin HEAD -o merge_request.create -o merge_request.target=main -o merge_request.title "ai: разговорный ассистент"`

## Plan Self-Review

| Specification requirement | Tasks |
|---|---|
| Natural language and one clarification | 1, 2, 4 |
| Two bounded model calls | 2 |
| Deterministic facts and checked ids | 1, 2 |
| Six-turn browser-only context | 3 |
| Revision/document invalidation | 3, 4 |
| Five actions with no plan mutation | 1, 3, 4 |
| Concise Russian accessible UI and fallback | 2, 4 |
| Contract/unit/e2e/a11y/round-trip evidence | 1–5 |
| Documentation and TZ proof | 5 |

No introduced type is used before its definition in Task 1; each task has a red-green test cycle and its own commit.

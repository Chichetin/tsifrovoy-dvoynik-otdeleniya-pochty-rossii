/**
 * A06: talking to the assistant's API — and doing without it.
 *
 * The browser never sees a provider key: it asks our own `/api/advice`, and the
 * server decides whether a model is involved. If the server itself is not
 * reachable — no backend in `npm run dev`, a dropped network during the demo —
 * the same calculation runs here, in the page, and the answer comes back marked
 * `fallback` with the reason said out loud. A blank panel is a defect.
 */

import type {
  AdviceHttpRequest,
  AdviceRequest,
  AdviceResponse,
  Recommendation,
} from '../../contracts/advice';
import { verifyChatIntent, verifyChatSelection, type ChatIntent, type ChatSelection, type ChatTurn } from '../../contracts/advice-chat';
import type { Issue, PlanDocument, Result } from '../../contracts/model';
import { calculateAdvice, defaultExplanation } from '../../domain/advice';

export const ADVICE_CLIENT_ISSUE_CODES = {
  /** The server answered, but not with an advice response. */
  ADVICE_RESPONSE_UNEXPECTED: 'ADVICE_RESPONSE_UNEXPECTED',
} as const;

export type ChatAdviceResponse =
  | { revision: number; kind: 'clarify'; question: string }
  | {
      revision: number;
      kind: 'fallback';
      mode: 'fallback';
      recommendations: Recommendation[];
      selection: null;
      fallbackReason: string;
    }
  | {
      revision: number;
      kind: 'result';
      mode: 'llm' | 'fallback';
      intent: ChatIntent;
      recommendations: Recommendation[];
      selection: ChatSelection | null;
      fallbackReason?: string;
    };

export type ChatAdviceInput = {
  plan: PlanDocument;
  revision: number;
  query: string;
  history: readonly ChatTurn[];
  before?: PlanDocument;
};

/** Локальный расчёт: те же функции, что и на сервере, тот же режим ответа. */
function localAdvice(
  plan: PlanDocument,
  revision: number,
  request: AdviceRequest,
  reason: string,
): Result<AdviceResponse> {
  const calculated = calculateAdvice(plan, request);
  if (!calculated.ok) return calculated;

  const recommendations: Recommendation[] = calculated.value;
  return {
    ok: true,
    value: {
      revision,
      recommendations,
      explanations: recommendations
        .map((recommendation) => defaultExplanation(recommendation))
        .filter((explanation) => explanation !== null),
      mode: 'fallback',
      fallbackReason: reason,
    },
  };
}

function issuesOf(body: unknown): Issue[] {
  const issues = (body as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as Issue[]) : [];
}

function looksLikeResponse(body: unknown): body is AdviceResponse {
  const candidate = body as Partial<AdviceResponse> | null;
  return (
    candidate !== null &&
    Array.isArray(candidate.recommendations) &&
    Array.isArray(candidate.explanations) &&
    (candidate.mode === 'llm' || candidate.mode === 'fallback')
  );
}

function isChatIntent(value: unknown): value is ChatIntent {
  if (typeof value !== 'object' || value === null) return false;
  const intent = value as { kind?: unknown; question?: unknown; request?: unknown; preference?: unknown };
  if (intent.kind === 'clarify') return typeof intent.question === 'string' && intent.question.length > 0;
  return intent.kind === 'request' && typeof intent.request === 'object' && intent.request !== null && (typeof intent.preference === 'string' || intent.preference === null);
}

function isSelection(value: unknown): value is ChatSelection | null {
  if (value === null) return true;
  return typeof value === 'object' && value !== null && Array.isArray((value as { selections?: unknown }).selections);
}

function looksLikeChatResponse(body: unknown): body is ChatAdviceResponse {
  if (typeof body !== 'object' || body === null) return false;
  const response = body as Partial<ChatAdviceResponse>;
  if (typeof response.revision !== 'number' || !Number.isInteger(response.revision) || response.revision < 0) return false;
  if (response.kind === 'clarify') return typeof response.question === 'string' && response.question.length > 0;
  if (
    (response.kind !== 'fallback' && response.kind !== 'result') ||
    !Array.isArray(response.recommendations) ||
    !isSelection(response.selection)
  ) {
    return false;
  }
  if (response.kind === 'fallback') return response.mode === 'fallback' && typeof response.fallbackReason === 'string';
  return (response.mode === 'llm' || response.mode === 'fallback') && isChatIntent((response as { intent?: unknown }).intent);
}

/** The server validates too; checking again keeps a malformed proxy response out of action callbacks. */
function verifiedChatResponse(input: ChatAdviceInput, response: ChatAdviceResponse): Result<ChatAdviceResponse> {
  if (response.kind === 'fallback') return { ok: true, value: response };
  const intent = verifyChatIntent(
    response.kind === 'clarify'
      ? { kind: 'clarify', question: response.question }
      : response.intent,
    input.plan,
  );
  if (!intent.ok) return intent;
  if (response.kind === 'clarify' || response.selection === null) return { ok: true, value: response };
  const selection = verifyChatSelection(response.selection, response.recommendations, input.plan);
  return selection.ok ? { ok: true, value: response } : selection;
}

/**
 * One request of the assistant. Never throws and never returns nothing: either
 * the server's answer, or the same calculation done locally, or the issues that
 * say why this plan cannot be advised on at all.
 */
export async function requestAdvice(
  input: AdviceHttpRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<AdviceResponse>> {
  let response: Response;
  try {
    response = await fetchImpl('/api/advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return localAdvice(
      input.plan,
      input.revision,
      input.request,
      'Сервер ассистента не отвечает — показан расчёт в браузере. Проверьте сеть и спросите ещё раз.',
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok && looksLikeResponse(body)) return { ok: true, value: body };

  // Причины пишутся для сотрудника (находка operator №20): что случилось и что
  // делать; код статуса остаётся в скобках в конце — для разработчика.
  // Лимит защищает платный вызов модели, но расчёт пользователю доступен.
  // Сервер возвращает 429 с issues; обработать его нужно до общей ветки ошибок.
  if (response.status === 429) {
    return localAdvice(
      input.plan,
      input.revision,
      input.request,
      'Модель сейчас недоступна: исчерпан лимит обращений, показан расчёт. Спросите ещё раз через минуту (код 429).',
    );
  }

  // 400/422 — это про запрос и про план, и их надо показать, а не заменять
  // локальным расчётом, который упрётся в то же самое.
  const issues = issuesOf(body);
  if (issues.length > 0) return { ok: false, issues };

  if (response.status === 404 || response.status >= 500) {
    return localAdvice(
      input.plan,
      input.revision,
      input.request,
      `Модель сейчас недоступна: сервер ассистента не ответил, показан расчёт в браузере (код ${response.status}).`,
    );
  }

  return {
    ok: false,
    issues: [
      {
        code: ADVICE_CLIENT_ISSUE_CODES.ADVICE_RESPONSE_UNEXPECTED,
        severity: 'error',
        message: `Сервер ассистента прислал непонятный ответ. Повторите запрос; если не поможет — сообщите разработчикам (код ${response.status}).`,
        refs: [],
      },
    ],
  };
}

/**
 * Browser transport for the constrained conversational endpoint. The server
 * receives a compact normalized history and remains responsible for provider
 * fallback; malformed answers are never promoted into a UI action.
 */
export async function requestChatAdvice(
  input: ChatAdviceInput,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<ChatAdviceResponse>> {
  let response: Response;
  try {
    response = await fetchImpl('/api/advice/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: ADVICE_CLIENT_ISSUE_CODES.ADVICE_RESPONSE_UNEXPECTED,
          severity: 'error',
          message: 'Сервер разговорного ассистента не отвечает. Используйте быстрый сценарий расчёта.',
          refs: [],
        },
      ],
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && looksLikeChatResponse(body)) return verifiedChatResponse(input, body);

  const issues = issuesOf(body);
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: false,
    issues: [
      {
        code: ADVICE_CLIENT_ISSUE_CODES.ADVICE_RESPONSE_UNEXPECTED,
        severity: 'error',
        message: `Сервер разговорного ассистента прислал непонятный ответ (код ${response.status}). Используйте быстрый сценарий расчёта.`,
        refs: [],
      },
    ],
  };
}

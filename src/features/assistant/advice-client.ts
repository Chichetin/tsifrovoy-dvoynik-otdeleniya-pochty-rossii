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
} from '../../contracts/advice';
import type { Issue, PlanDocument, Result } from '../../contracts/model';
import { calculateAdvice, fallbackAdviceResponse } from '../../domain/advice';

export const ADVICE_CLIENT_ISSUE_CODES = {
  /** The server answered, but not with an advice response. */
  ADVICE_RESPONSE_UNEXPECTED: 'ADVICE_RESPONSE_UNEXPECTED',
} as const;

/** Локальный расчёт: те же функции, что и на сервере, тот же режим ответа. */
function localAdvice(
  plan: PlanDocument,
  revision: number,
  request: AdviceRequest,
  reason: string,
): Result<AdviceResponse> {
  const calculated = calculateAdvice(plan, request);
  if (!calculated.ok) return calculated;

  return { ok: true, value: fallbackAdviceResponse(revision, calculated.value, reason) };
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

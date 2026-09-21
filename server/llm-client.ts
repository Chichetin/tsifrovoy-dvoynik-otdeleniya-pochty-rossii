/**
 * A05: the transport to the model. It does one thing — send two messages and
 * bring back the text — and it never throws.
 *
 * Every failure (network, timeout, 429, a body that is not the expected shape)
 * comes back as an `Issue`, because none of them is a reason to hide the
 * calculation the user already paid for with their click. The answer's content
 * is not judged here: that is A04's job, and mixing the two would put trust in
 * the transport layer.
 *
 * The protocol is OpenAI-compatible chat completions, which DeepSeek and Qwen
 * (Alibaba Model Studio compatible mode) both speak. GigaChat and YandexGPT use
 * their own request shapes and would need another client — that limitation is
 * written down rather than papered over.
 */

import { z } from 'zod';
import type { Issue, Result } from '../src/contracts/model';
import type { LlmConfig } from './config';

/** Codes owned by this module. */
export const LLM_ISSUE_CODES = {
  /** No provider is configured: the assistant runs on the calculation alone. */
  LLM_NOT_CONFIGURED: 'LLM_NOT_CONFIGURED',
  /** The request did not finish within the configured timeout. */
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  /** The network call failed before any HTTP status. */
  LLM_UNREACHABLE: 'LLM_UNREACHABLE',
  /** The provider answered with a non-2xx status. */
  LLM_HTTP_ERROR: 'LLM_HTTP_ERROR',
  /** The provider's body is not the OpenAI-compatible shape. */
  LLM_BODY_UNEXPECTED: 'LLM_BODY_UNEXPECTED',
  /** A bounded assistant response was not valid JSON. */
  LLM_JSON_INVALID: 'LLM_JSON_INVALID',
  /**
   * The answer has no text: a reasoning model spent `max_tokens` on
   * `reasoning_content` (finish_reason `length`), or the provider returned an
   * empty message. Raise LLM_MAX_OUTPUT_TOKENS rather than blame the JSON.
   */
  LLM_EMPTY_CONTENT: 'LLM_EMPTY_CONTENT',
} as const;

export type LlmRequest = { system: string; user: string };

export type LlmClient = (request: LlmRequest) => Promise<Result<string>>;

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

function issue(code: string, message: string): Issue {
  return { code, severity: 'error', message, refs: [] };
}

/** Text of a failure, safe to log: no key, no prompt, no plan. */
function failure(code: string, message: string): Result<string> {
  return { ok: false, issues: [issue(code, message)] };
}

/** JSON is a transport boundary: callers still validate its exact schema. */
export function parseLlmJson(value: string): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return {
      ok: false,
      issues: [issue(LLM_ISSUE_CODES.LLM_JSON_INVALID, 'Модель вернула ответ не в формате JSON.')],
    };
  }
}

export function createLlmClient(config: LlmConfig): LlmClient {
  return async ({ system, user }) => {
    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          // Объяснение — выбор из уже посчитанного, творчество здесь вредно.
          temperature: 0,
          max_tokens: config.maxOutputTokens,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return timedOut
        ? failure(
            LLM_ISSUE_CODES.LLM_TIMEOUT,
            `Провайдер ${config.provider} не ответил за ${config.timeoutMs} мс.`,
          )
        : failure(
            LLM_ISSUE_CODES.LLM_UNREACHABLE,
            `Не удалось обратиться к провайдеру ${config.provider}.`,
          );
    }

    if (!response.ok) {
      return failure(
        LLM_ISSUE_CODES.LLM_HTTP_ERROR,
        `Провайдер ${config.provider} ответил статусом ${response.status}.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failure(
        LLM_ISSUE_CODES.LLM_BODY_UNEXPECTED,
        `Ответ провайдера ${config.provider} не является JSON.`,
      );
    }

    const parsed = completionSchema.safeParse(body);
    if (!parsed.success) {
      return failure(
        LLM_ISSUE_CODES.LLM_BODY_UNEXPECTED,
        `Ответ провайдера ${config.provider} не содержит choices[0].message.content.`,
      );
    }

    const choice = parsed.data.choices[0];
    const content = choice?.message.content ?? '';
    if (content.trim() === '') {
      const outOfTokens = choice?.finish_reason === 'length';
      return failure(
        LLM_ISSUE_CODES.LLM_EMPTY_CONTENT,
        outOfTokens
          ? `лимит ${config.maxOutputTokens} токенов ушёл на рассуждение, текста не осталось — поднимите LLM_MAX_OUTPUT_TOKENS.`
          : 'пустой ответ.',
      );
    }
    return { ok: true, value: content };
  };
}

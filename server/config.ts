/**
 * A05: server configuration, read from the environment and nowhere else.
 *
 * No provider, endpoint, model or key is written into the code: the organizers
 * allow Qwen, DeepSeek, GigaChat and YandexGPT, we pay for the account
 * ourselves, and the choice may change on the day of the demo. A build without
 * `LLM_ENDPOINT` and `LLM_API_KEY` is a valid build — the assistant then works
 * from the calculation only and says so.
 */

export type LlmConfig = {
  /** Free-form label for logs and the UI: «deepseek», «qwen», … */
  provider: string;
  /**
   * Full URL of the chat completions endpoint, OpenAI-compatible protocol.
   * A full URL rather than a base: providers differ in whether `/v1` belongs to
   * the base or the path, and guessing that is how a deploy dies at 3 a.m.
   */
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

export type ServerConfig = {
  host: string;
  port: number;
  /** Built SPA to serve, or null to run the API alone. */
  staticDir: string | null;
  llm: LlmConfig | null;
  rateLimit: { max: number; windowMs: number };
};

export type Env = Record<string, string | undefined>;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The LLM half is all-or-nothing: an endpoint without a key, or a key without a
 * model, would fail on the first request of the demo. Missing pieces mean «no
 * provider», which is a supported mode, not an error.
 */
export function readLlmConfig(env: Env): LlmConfig | null {
  const endpoint = text(env.LLM_ENDPOINT);
  const model = text(env.LLM_MODEL);
  const apiKey = text(env.LLM_API_KEY);
  if (endpoint === null || model === null || apiKey === null) return null;

  return {
    provider: text(env.LLM_PROVIDER) ?? 'unknown',
    endpoint,
    model,
    apiKey,
    timeoutMs: positiveInt(env.LLM_TIMEOUT_MS, 20_000),
    maxOutputTokens: positiveInt(env.LLM_MAX_OUTPUT_TOKENS, 800),
  };
}

export function readConfig(env: Env): ServerConfig {
  return {
    host: text(env.HOST) ?? '127.0.0.1',
    port: positiveInt(env.PORT, 8080),
    staticDir: text(env.STATIC_DIR),
    llm: readLlmConfig(env),
    rateLimit: {
      max: positiveInt(env.ADVICE_RATE_LIMIT, 30),
      windowMs: positiveInt(env.ADVICE_RATE_WINDOW_MS, 60_000),
    },
  };
}

/** What may be printed to a log. The key is not part of it, ever. */
export function describeConfig(config: ServerConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    staticDir: config.staticDir,
    llm:
      config.llm === null
        ? 'не настроен: ассистент работает без модели'
        : {
            provider: config.llm.provider,
            endpoint: config.llm.endpoint,
            model: config.llm.model,
            timeoutMs: config.llm.timeoutMs,
          },
    rateLimit: config.rateLimit,
  };
}

/**
 * The model name as it may leave the server: Yandex AI Studio URIs carry the
 * cloud folder id (`gpt://<folder>/<model>`), which stays with the key. Used
 * for the fallback-reason label; health names the provider only (D-200).
 */
export function publicModelName(model: string): string {
  return model.replace(/^([a-z]+):\/\/[^/]+\//, '$1://<folder_ID>/');
}

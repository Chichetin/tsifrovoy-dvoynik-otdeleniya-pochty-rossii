/**
 * A05: the process. Serves the built SPA and the assistant API from one port,
 * so the deployed service is one container with one address.
 *
 * The key never reaches this file's logs: `describeConfig` decides what may be
 * printed, and the SPA bundle is built without any of it — the browser talks to
 * `/api/advice`, not to the provider.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { LIMITS } from '../src/contracts/model';
import { registerAdviceRoutes } from './advice-route';
import { registerAgentRoute } from './agent-route';
import { describeConfig, readConfig, publicModelName } from './config';
import { createLlmChat, createLlmClient } from './llm-client';

export async function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = readConfig(env);
  const app = Fastify({
    logger: true,
    // 413 приходит отсюда: план крупнее предела не должен занимать память.
    bodyLimit: LIMITS.maxRequestBytes,
  });

  registerAdviceRoutes(app, {
    llm: config.llm === null ? null : createLlmClient(config.llm),
    // Label for the fallback reason: the folder id of a cloud model URI is
    // not for the browser (D-200).
    llmLabel: config.llm === null ? null : `${config.llm.provider}/${publicModelName(config.llm.model)}`,
    llmProvider: config.llm === null ? null : config.llm.provider,
    rateLimit: config.rateLimit,
    build: config.build,
  });
  registerAgentRoute(app, {
    chat: config.llm === null ? null : createLlmChat(config.llm),
    rateLimit: config.rateLimit,
    // One exchange is a few model calls; three provider timeouts bound it.
    deadlineMs: (config.llm?.timeoutMs ?? 0) * 3,
    llmTimeoutMs: config.llm?.timeoutMs ?? null,
  });

  const staticDir = config.staticDir ?? resolve(process.cwd(), 'dist');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir });
    // SPA: любой не-API путь отдаёт index.html, маршрутизация — в браузере.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ issues: [] });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(
      { staticDir },
      'сборки SPA нет: сервер отдаёт только API, соберите её командой npm run build',
    );
  }

  app.log.info(describeConfig(config), 'конфигурация сервера');
  return { app, config };
}

/**
 * Stop on the signals a container receives. `docker stop` sends SIGTERM, and a
 * process running as PID 1 gets no default action from the kernel: without a
 * handler it keeps running until the grace period ends and SIGKILL cuts it off
 * mid-request. `app.close()` stops accepting connections and lets the requests
 * in flight finish — an assistant call may still be waiting on the provider,
 * bounded by LLM_TIMEOUT_MS. A second signal while closing is ignored: the
 * process is already on its way out.
 *
 * `close()` drops idle keep-alive sockets once, at the start; a socket busy at
 * that moment goes idle only after its response and would hold the process
 * until keepAliveTimeout (72 s by default). The sweep below closes such
 * sockets as they free up, so the exit follows the last response by at most
 * one sweep — active requests are never touched.
 *
 * Returns the handler so the shutdown can be exercised without a real signal.
 */
const IDLE_SWEEP_MS = 100;

export function stopOnSignals(
  app: FastifyInstance,
  signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
  exit: (code: number) => void = (code) => process.exit(code),
): (signal: NodeJS.Signals) => void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'остановка: новые соединения не принимаются, текущие запросы завершаются');
    const sweep = setInterval(() => app.server.closeIdleConnections(), IDLE_SWEEP_MS);
    app.close().then(
      () => {
        clearInterval(sweep);
        exit(0);
      },
      (error: unknown) => {
        clearInterval(sweep);
        app.log.error(error, 'сервер не закрылся штатно');
        exit(1);
      },
    );
  };
  for (const signal of signals) process.on(signal, stop);
  return stop;
}

const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  const { app, config } = await buildServer();
  stopOnSignals(app);
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error, 'сервер не запустился');
    process.exit(1);
  }
}

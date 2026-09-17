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
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { LIMITS } from '../src/contracts/model';
import { registerAdviceRoutes } from './advice-route';
import { describeConfig, readConfig } from './config';
import { createLlmClient } from './llm-client';

export async function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const config = readConfig(env);
  const app = Fastify({
    logger: true,
    // 413 приходит отсюда: план крупнее предела не должен занимать память.
    bodyLimit: LIMITS.maxRequestBytes,
  });

  registerAdviceRoutes(app, {
    llm: config.llm === null ? null : createLlmClient(config.llm),
    llmLabel: config.llm === null ? null : `${config.llm.provider}/${config.llm.model}`,
    rateLimit: config.rateLimit,
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

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;

if (isEntryPoint) {
  const { app, config } = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error, 'сервер не запустился');
    process.exit(1);
  }
}

/**
 * A05: остановка процесса. В контейнере сервер — PID 1, и сигнал без
 * обработчика ничего не делает: `docker stop` ждёт срок и убивает процесс
 * посреди запроса. Проверяется ровно поведение обработчика: слушатель
 * стоит, сервер перестаёт слушать, ответ в полёте доходит, процесс выходит
 * один раз, а отказ закрыться — код 1, а не молчание.
 */

import Fastify from 'fastify';
import { afterEach, describe, expect, test } from 'vitest';
import { stopOnSignals } from './main';

// Сигнал, которого в тесте никто не пошлёт: слушатели снимаются после каждого.
const SIGNAL: NodeJS.Signals = 'SIGUSR2';

afterEach(() => {
  process.removeAllListeners(SIGNAL);
});

describe('остановка по сигналу', () => {
  test('вешает слушатель, закрывает сервер после ответов в полёте и выходит один раз', async () => {
    const app = Fastify({ logger: false });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.get('/slow', async () => {
      await held;
      return { done: true };
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.addresses()[0]!;
    const base = `http://127.0.0.1:${address.port}`;

    const exits: number[] = [];
    const before = process.listenerCount(SIGNAL);
    const stop = stopOnSignals(app, [SIGNAL], (code) => exits.push(code));
    expect(process.listenerCount(SIGNAL)).toBe(before + 1);

    const inFlight = fetch(`${base}/slow`);
    // Дать запросу дойти до обработчика до сигнала.
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop(SIGNAL);
    stop(SIGNAL);
    expect(exits).toEqual([]);

    release();
    const response = await inFlight;
    expect(await response.json()).toEqual({ done: true });

    await expect.poll(() => exits).toEqual([0]);
    expect(app.server.listening).toBe(false);
    await expect(fetch(`${base}/slow`)).rejects.toThrow();
  });

  test('сервер не закрылся штатно — выход с кодом 1, не тишина', async () => {
    const app = Fastify({ logger: false });
    app.addHook('onClose', async () => {
      throw new Error('ресурс не отпустил');
    });
    await app.ready();
    const exits: number[] = [];
    const stop = stopOnSignals(app, [SIGNAL], (code) => exits.push(code));
    stop(SIGNAL);
    await expect.poll(() => exits).toEqual([1]);
  });
});

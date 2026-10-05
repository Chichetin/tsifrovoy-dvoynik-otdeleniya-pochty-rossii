/**
 * #169, #170: drag timing on the synthetic 1000-object plan — 30 mouse steps
 * of one object in headless Chromium, median of the runs. The clock runs from
 * the first counted step to the second frame after the last one; the worst
 * frame is the longest gap between animation frames during the steps.
 *
 * Run: npx tsx scripts/measure-drag.ts [runs]   (default 5)
 * Without APP_URL the script builds the app and serves it with `vite preview`
 * on PREVIEW_PORT (default 5189) — what the deployed service ships. APP_URL
 * measures an app that is already running. PW_CHANNEL=msedge or chrome picks
 * an installed browser, as in e2e.
 */

import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { resolveChannel } from '../playwright.config';
import { generateBenchmark } from './generate-benchmark';

const runs = Number(process.argv[2] ?? '5');
const STEPS = 30;
const STEP_PX = 4;
// The middle of the 40×25 grid of the benchmark plan.
const OBJECT_ID = 'eq_519';
const plan = Buffer.from(JSON.stringify(generateBenchmark(1000)));

const vite = 'node_modules/vite/bin/vite.js';
let url = process.env['APP_URL'];
let preview: ReturnType<typeof spawn> | undefined;
if (url === undefined) {
  const port = process.env['PREVIEW_PORT'] ?? '5189';
  const build = spawnSync('node', [vite, 'build'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (build.status !== 0) throw new Error('vite build не прошёл');
  preview = spawn('node', [vite, 'preview', '--port', port, '--strictPort'], { stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30_000;
  while (!(await fetch(url).then((r) => r.ok, () => false))) {
    if (Date.now() > deadline) throw new Error(`vite preview не ответил на ${url}`);
    await new Promise((done) => setTimeout(done, 300));
  }
}

type Run = { stepsMs: number; worstFrameMs: number };
const results: Run[] = [];

try {
  for (let run = 0; run < runs; run += 1) {
    const browser = await chromium.launch({ channel: resolveChannel(process.env.PW_CHANNEL) });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => window.localStorage.setItem('ops-twin.onboarding.v1', 'done'));
    const page = await context.newPage();
    await page.goto(url);
    await page.getByTestId('plan-file-input').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: plan });
    // Page code goes in as text: tsx would wrap a named function in a helper the page lacks.
    const calm = `new Promise((done) => {
      let last = performance.now();
      let calm = 0;
      const tick = (now) => { calm = now - last < 50 ? calm + 1 : 0; last = now; calm >= 2 ? done(true) : requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    })`;
    const objectCenter = `(() => {
      const node = window.Konva?.stages[0]?.findOne('.object-hit-${OBJECT_ID}');
      if (!node) return null;
      const rect = node.getClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`;
    // Opening 1000 objects keeps the page busy for a while: wait until the
    // object is on the canvas and two frames in a row come within 50 ms.
    await page.waitForFunction(objectCenter, undefined, { timeout: 180_000 });
    await page.evaluate(calm);

    const box = await page.getByTestId('editor-canvas').boundingBox();
    const center = (await page.evaluate(objectCenter)) as { x: number; y: number } | null;
    if (box === null || center === null) throw new Error(`объект ${OBJECT_ID} не найден на холсте`);
    const x = box.x + center.x;
    const y = box.y + center.y;

    await page.mouse.move(x, y);
    await page.mouse.down();
    // The first small step starts the gesture; it is not counted.
    await page.mouse.move(x + 3, y + 3);
    await page.evaluate(calm);
    await page.evaluate(`(() => {
      window.dragGaps = [];
      let last = performance.now();
      const tick = (now) => { window.dragGaps.push(now - last); last = now; window.dragRaf = requestAnimationFrame(tick); };
      window.dragRaf = requestAnimationFrame(tick);
    })()`);
    const started = Date.now();
    for (let step = 1; step <= STEPS; step += 1) {
      await page.mouse.move(x + 3 + step * STEP_PX, y + 3);
    }
    await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))');
    const stepsMs = Date.now() - started;
    const gaps = (await page.evaluate('(cancelAnimationFrame(window.dragRaf), window.dragGaps)')) as number[];
    await page.mouse.up();

    // The drop must move the object, or the steps timed an idle canvas.
    await page.evaluate(calm);
    const after = (await page.evaluate(objectCenter)) as { x: number; y: number } | null;
    if (after === null || after.x - center.x < STEPS * STEP_PX / 2) {
      throw new Error(`объект ${OBJECT_ID} не перенёсся: перенос не случился`);
    }
    results.push({ stepsMs, worstFrameMs: Math.max(...gaps) });
    await browser.close();
  }
} finally {
  preview?.kill();
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
console.log(JSON.stringify({
  plan: 1000,
  object: OBJECT_ID,
  steps: STEPS,
  runs: results.length,
  stepsMs: Math.round(median(results.map((r) => r.stepsMs))),
  worstFrameMs: Math.round(median(results.map((r) => r.worstFrameMs))),
  samples: results.map((r) => [r.stepsMs, Math.round(r.worstFrameMs)]),
}));

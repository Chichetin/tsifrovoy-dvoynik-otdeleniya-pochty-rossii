/**
 * #59: 3D timing on a running app — from the "3D" click to the frame where
 * every object stands as its model, then the frame rate while the camera
 * orbits (animation callbacks, not GPU draw calls). Median of the runs. Only plans whose types all have models finish
 * by the count; the demo plans and the benchmark plans do.
 *
 * Run: DEV_PORT=5174 npm run dev, then
 *      npx tsx scripts/measure-3d.ts <plan.json | 100 | 500 | 1000> [runs]
 * APP_URL picks another address (default http://127.0.0.1:5174/). The browser
 * uses the browser's normal graphics backend; the frame rate is
 * limited by the browser and display refresh rate.
 */

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { resolveChannel } from '../playwright.config';
import { generateBenchmark } from './generate-benchmark';

const [target = '1000', runs = '3'] = process.argv.slice(2);
const size = Number(target);
const plan = size === 100 || size === 500 || size === 1000
  ? Buffer.from(JSON.stringify(generateBenchmark(size)))
  : readFileSync(target);

type Run = { sceneMs: number; fps: number; models: number };
const results: Run[] = [];

for (let run = 0; run < Number(runs); run += 1) {
  const browser = await chromium.launch({ channel: resolveChannel(process.env.PW_CHANNEL) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => window.localStorage.setItem('ops-twin.onboarding.v1', 'done'));
  const page = await context.newPage();
  await page.goto(process.env['APP_URL'] ?? 'http://127.0.0.1:5174/');
  await page.getByTestId('plan-file-input').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: plan });
  // Opening 1000 objects keeps the page busy for seconds: the clock starts when
  // two frames in a row come within 50 ms, not while the plan still loads.
  await page.waitForFunction(`new Promise((done) => {
    let last = performance.now();
    let calm = 0;
    const tick = (now) => { calm = now - last < 50 ? calm + 1 : 0; last = now; calm >= 2 ? done(true) : requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })`, undefined, { timeout: 180_000 });

  const models = new Set<string>();
  page.on('requestfinished', (request) => {
    if (request.url().endsWith('.glb')) models.add(request.url());
  });
  const started = Date.now();
  await page.getByRole('group', { name: 'Вид плана' }).getByRole('button', { name: '3D' }).click();
  // Done when every shown object stands as a model (a build without models has
  // no such count: its first frame is the end), then two frames are drawn.
  await page.waitForFunction(`(() => {
    const canvas = document.querySelector('[data-testid="view3d-canvas"]');
    const section = document.querySelector('[data-testid="view3d"]');
    if (!canvas || !section) return false;
    const drawn = canvas.dataset.modelsCount;
    return drawn === undefined || drawn === section.dataset.objectsCount;
  })()`, undefined, { polling: 'raf', timeout: 60_000 });
  await page.evaluate('new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))');
  const sceneMs = Date.now() - started;

  const box = await page.getByTestId('view3d-canvas').boundingBox();
  if (box === null) throw new Error('холст 3D не найден');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Page code goes in as text: tsx would wrap a named function in a helper the page lacks.
  await page.evaluate(`(() => {
    window.frames3d = 0;
    const tick = () => { window.frames3d += 1; window.raf3d = requestAnimationFrame(tick); };
    tick();
  })()`);
  const orbit = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Measure actual frames over a fixed interval. A fixed number of input
  // events made slow renderers spend minutes on this step alone.
  let moves = 0;
  while (Date.now() - orbit < 4000) {
    await page.mouse.move(cx + 300 * Math.sin(moves / 20), cy + 40 * Math.sin(moves / 13));
    moves += 1;
  }
  await page.mouse.up();
  const seconds = (Date.now() - orbit) / 1000;
  const frames = Number(await page.evaluate('(cancelAnimationFrame(window.raf3d), window.frames3d)'));
  results.push({ sceneMs, fps: frames / seconds, models: models.size });
  await browser.close();
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
console.log(JSON.stringify({
  plan: target,
  runs: results.length,
  modelFiles: results[0]?.models,
  sceneMs: median(results.map((r) => r.sceneMs)),
  fps: Number(median(results.map((r) => r.fps)).toFixed(1)),
}));

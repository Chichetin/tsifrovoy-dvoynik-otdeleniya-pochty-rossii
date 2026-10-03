/**
 * #59: 3D timing on a running app — from the "3D" click to the scene with its
 * models, then the frame rate while the camera orbits. Median of the runs.
 *
 * Run: DEV_PORT=5174 npm run dev, then
 *      npx tsx scripts/measure-3d.ts <plan.json | 100 | 500 | 1000> [runs]
 * APP_URL picks another address (default http://127.0.0.1:5174/). The browser
 * gets the machine's GPU (`--enable-gpu --use-angle=gl`); the frame rate is
 * capped by the display at about 60.
 */

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { generateBenchmark } from './generate-benchmark';

const [target = '1000', runs = '3'] = process.argv.slice(2);
const size = Number(target);
const plan = size === 100 || size === 500 || size === 1000
  ? Buffer.from(JSON.stringify(generateBenchmark(size)))
  : readFileSync(target);

type Run = { sceneMs: number; fps: number; models: number };
const results: Run[] = [];

for (let run = 0; run < Number(runs); run += 1) {
  const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=gl'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => window.localStorage.setItem('ops-twin.onboarding.v1', 'done'));
  const page = await context.newPage();
  await page.goto(process.env['APP_URL'] ?? 'http://127.0.0.1:5174/');
  await page.getByTestId('plan-file-input').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: plan });
  await page.waitForTimeout(1500);

  const models = new Set<string>();
  page.on('requestfinished', (request) => {
    if (request.url().endsWith('.glb')) models.add(request.url());
  });
  const started = Date.now();
  await page.getByRole('group', { name: 'Вид плана' }).getByRole('button', { name: '3D' }).click();
  await page.getByTestId('view3d-canvas').waitFor();
  // The scene is complete when no model file arrived for 500 ms.
  let seen = -1;
  while (seen !== models.size) {
    seen = models.size;
    await page.waitForTimeout(500);
  }
  const sceneMs = Date.now() - started - 500;

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
  for (let i = 0; i < 180; i += 1) await page.mouse.move(cx + 300 * Math.sin(i / 20), cy + 40 * Math.sin(i / 13));
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

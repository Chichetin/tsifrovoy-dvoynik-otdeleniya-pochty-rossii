/**
 * #223: wheel timing on the 2D canvas — the demo plan and the synthetic
 * 1000-object plan, three gestures each, in headless Chromium:
 *
 * - mouse: 10 notches of `deltaY` 100 (pixel mode), one every 50 ms, zoom in;
 * - trackpad: a swipe of 60 events of `deltaY` 6, one every 16 ms, pan;
 * - pinch: 60 events of `deltaY` −3 with `ctrlKey`, one every 16 ms, zoom.
 *
 * The events are dispatched in the page on a fixed timer, so a busy main
 * thread shows up as late frames, not as a slower test. The clock runs from
 * the first event to the last change of the visible world box (the
 * `data-visible` attribute of the canvas). Per gesture the
 * script prints the median of the runs: total time, frames drawn, worst frame,
 * and the step — screen pixels per event for a pan, scale factor per event for
 * a zoom.
 *
 * Run: npx tsx scripts/measure-wheel.ts [runs]   (default 3)
 * Without APP_URL the script builds the app and serves it with `vite preview`
 * on PREVIEW_PORT (default 5189). PW_CHANNEL picks an installed browser.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { resolveChannel } from '../playwright.config';
import { generateBenchmark } from './generate-benchmark';

const runs = Number(process.argv[2] ?? '3');
if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error('Число прогонов должно быть целым положительным числом.');
}

const plans = [
  { name: 'demo', buffer: readFileSync('demo/before.json') },
  { name: '1000', buffer: Buffer.from(JSON.stringify(generateBenchmark(1000))) },
];
type Gesture = { name: string; kind: 'pan' | 'zoom'; count: number; everyMs: number; deltaY: number; ctrlKey: boolean };
const gestures: Gesture[] = [
  { name: 'mouse', kind: 'zoom', count: 10, everyMs: 50, deltaY: -100, ctrlKey: false },
  { name: 'trackpad', kind: 'pan', count: 60, everyMs: 16, deltaY: 6, ctrlKey: false },
  { name: 'pinch', kind: 'zoom', count: 60, everyMs: 16, deltaY: -3, ctrlKey: true },
];
type Sample = { totalMs: number; frames: number; worstFrameMs: number; step: number };

const vite = 'node_modules/vite/bin/vite.js';
let url = process.env['APP_URL'];
let preview: ReturnType<typeof spawn> | undefined;
const results = new Map<string, Sample[]>();

// Page code goes in as text: tsx would wrap a named function in a helper the page lacks.
const calm = `new Promise((done) => {
  let last = performance.now();
  let calm = 0;
  const tick = (now) => { calm = now - last < 50 ? calm + 1 : 0; last = now; calm >= 2 ? done(true) : requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})`;
// The visible world box is on the canvas element; with its pixel width it
// gives the scale and the screen position of the plan.
const view = `(() => {
  const element = document.querySelector('[data-testid="editor-canvas"]');
  const [minX, minY, maxX, maxY] = element.dataset.visible.split(',').map(Number);
  const scale = element.clientWidth / (maxX - minX);
  return { scale, x: -minX * scale, y: maxY * scale };
})()`;

function gestureScript(gesture: Gesture): string {
  return `new Promise((done) => {
    const stage = window.Konva.stages[0];
    const target = stage.content;
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const gaps = [];
    let last = performance.now();
    let raf = 0;
    const tick = (now) => { gaps.push(now - last); last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const started = performance.now();
    // The gesture ends when the visible world box changes for the last time.
    let changed = started;
    const observer = new MutationObserver(() => { changed = performance.now(); });
    observer.observe(document.querySelector('[data-testid="editor-canvas"]'), { attributes: true, attributeFilter: ['data-visible'] });
    let sent = 0;
    const send = () => {
      target.dispatchEvent(new WheelEvent('wheel', {
        deltaX: 0, deltaY: ${gesture.deltaY}, deltaMode: 0, ctrlKey: ${gesture.ctrlKey},
        clientX, clientY, bubbles: true, cancelable: true,
      }));
      sent += 1;
      if (sent < ${gesture.count}) setTimeout(send, ${gesture.everyMs});
      else setTimeout(() => ${calm}.then(() => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        done({ totalMs: changed - started, gaps });
      }), 300);
    };
    send();
  })`;
}

try {
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

  for (const plan of plans) {
    for (let run = 0; run < runs; run += 1) {
      const browser = await chromium.launch({ channel: resolveChannel(process.env.PW_CHANNEL) });
      try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
        await context.addInitScript(() => window.localStorage.setItem('ops-twin.onboarding.v1', 'done'));
        const page = await context.newPage();
        await page.goto(url);
        await page.getByTestId('plan-file-input').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: plan.buffer });
        // Opening a plan keeps the page busy for a while: wait until its
        // objects are on the canvas and two frames in a row come within 50 ms.
        await page.waitForFunction(`(window.Konva?.stages[0]?.find((node) => node.name().startsWith('object-hit-')).length ?? 0) > 0`, undefined, { timeout: 180_000 });
        await page.evaluate(calm);

        for (const gesture of gestures) {
          // Every gesture starts from the fitted plan.
          await page.getByTestId('editor-canvas').focus();
          await page.keyboard.press('KeyF');
          await page.evaluate(calm);
          const before = (await page.evaluate(view)) as { scale: number; x: number; y: number };
          const timing = (await page.evaluate(gestureScript(gesture))) as { totalMs: number; gaps: number[] };
          const after = (await page.evaluate(view)) as { scale: number; x: number; y: number };
          const step =
            gesture.kind === 'pan'
              ? Math.hypot(after.x - before.x, after.y - before.y) / gesture.count
              : (after.scale / before.scale) ** (1 / gesture.count);
          const key = `${plan.name}/${gesture.name}`;
          results.set(key, [
            ...(results.get(key) ?? []),
            { totalMs: timing.totalMs, frames: timing.gaps.length, worstFrameMs: Math.max(...timing.gaps), step },
          ]);
        }
      } finally {
        await browser.close();
      }
    }
  }
} finally {
  preview?.kill();
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
for (const [key, samples] of results) {
  const gesture = gestures.find((item) => key.endsWith(`/${item.name}`))!;
  console.log(JSON.stringify({
    gesture: key,
    events: gesture.count,
    runs: samples.length,
    totalMs: Math.round(median(samples.map((s) => s.totalMs))),
    frames: median(samples.map((s) => s.frames)),
    worstFrameMs: Math.round(median(samples.map((s) => s.worstFrameMs))),
    [gesture.kind === 'pan' ? 'pxPerEvent' : 'zoomPerEvent']: Number(median(samples.map((s) => s.step)).toFixed(3)),
  }));
}

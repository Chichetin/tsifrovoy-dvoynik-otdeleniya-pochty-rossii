/**
 * #169, #170, #190: canvas gestures in headless Chromium, median of the runs.
 * Plans: `demo` (the start plan), `example` (example_plan.json), `1000` (the
 * synthetic plan). Gestures: `one` — 30 drag steps of one object, `group` —
 * of one member of a group of ten, `captions` — of one object with captions
 * on, `pan` — 30 steps of a right-button pan, `zoom` — 10 wheel notches,
 * `select` — 10 clicks that change the selection.
 *
 * `stepsMs` runs from the first counted step to the second frame after the
 * last one; `worstFrameMs` and `medianFrameMs` are gaps between animation
 * frames during the steps; `busyMs` — main-thread work per step; `releaseMs` —
 * the longest frame within 0.4 s after the button is released or after the
 * last wheel notch; `dropped` — whether the drop moved the object;
 * `draws` counts Konva layer repaints per layer during the steps.
 *
 * Run: npx tsx scripts/measure-drag.ts [runs] [plans] [gestures]
 *   e.g. npx tsx scripts/measure-drag.ts 5 demo,1000 one,pan   (default: 5, all, all)
 * Without APP_URL the script builds the app and serves it with `vite preview`
 * on PREVIEW_PORT (default 5189) — what the deployed service ships. APP_URL
 * measures an app that is already running (`npm run dev`). PW_CHANNEL=msedge
 * or chrome picks an installed browser, as in e2e; HEADED=1 shows the window.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, type CDPSession, type Page } from '@playwright/test';
import { resolveChannel } from '../playwright.config';
import { generateBenchmark } from './generate-benchmark';

const runs = Number(process.argv[2] ?? '5');
if (!Number.isSafeInteger(runs) || runs < 1) {
  throw new Error('Число прогонов должно быть целым положительным числом.');
}
const STEPS = 30;
const PAN_PX = 8;
const NOTCHES = 10;
const CLICKS = 10;
/**
 * Below 14 px/m the plan shows zone cards instead of the objects in them
 * (#123). The 1000-object plan opens fitted below that, so the script zooms
 * in on the dragged object first: the gestures are timed on drawn objects.
 */
const DETAIL_SCALE = 18;

type PlanCase = {
  file: Buffer | null;
  /** The dragged object; it heads the group. */
  object: string;
  /** One drag step in screen pixels: the drop lands on free floor and is accepted. */
  step: [number, number];
  /** Nine more members of the group, picked by Shift+click. */
  group: string[];
  /** Two objects the selection clicks go between. */
  pick: [string, string];
};
const PLANS: Record<string, PlanCase> = {
  demo: {
    file: null,
    object: 'eq_10',
    step: [1, 2],
    group: ['eq_11', 'eq_12', 'eq_9', 'eq_6', 'eq_1', 'eq_4', 'eq_36', 'eq_35', 'eq_41'],
    pick: ['eq_10', 'eq_35'],
  },
  example: {
    file: readFileSync(new URL('../example_plan.json', import.meta.url)),
    object: 'eq_cashier_1',
    step: [4, 0],
    group: ['eq_cashier_2', 'eq_pvz', 'eq_kiosk', 'eq_atm', 'eq_info', 'eq_bench_1', 'eq_bench_2', 'eq_rack_1', 'eq_rack_2'],
    pick: ['eq_cashier_1', 'eq_rack_1'],
  },
  // eq_519 is on row 12 of the 40×25 grid; the group is the same row.
  1000: {
    file: Buffer.from(JSON.stringify(generateBenchmark(1000))),
    object: 'eq_519',
    // To the left: eq_519 is near the right edge of the canvas, and a release
    // outside it may not end the drag.
    step: [-4, 0],
    group: ['eq_510', 'eq_511', 'eq_512', 'eq_513', 'eq_514', 'eq_515', 'eq_516', 'eq_517', 'eq_518'],
    pick: ['eq_519', 'eq_480'],
  },
};
const GESTURES = ['one', 'group', 'captions', 'pan', 'zoom', 'select'] as const;
type Gesture = (typeof GESTURES)[number];

const plans = (process.argv[3] ?? Object.keys(PLANS).join(',')).split(',');
const gestures = (process.argv[4] ?? GESTURES.join(',')).split(',') as Gesture[];
for (const name of plans) if (!(name in PLANS)) throw new Error(`Нет плана «${name}»: ${Object.keys(PLANS).join(', ')}`);
for (const name of gestures) if (!GESTURES.includes(name)) throw new Error(`Нет жеста «${name}»: ${GESTURES.join(', ')}`);

const vite = 'node_modules/vite/bin/vite.js';
let url = process.env['APP_URL'];
let preview: ReturnType<typeof spawn> | undefined;

// Page code goes in as text: tsx would wrap a named function in a helper the page lacks.
/** Resolves once two frames in a row come within 50 ms: the page has settled. */
const CALM = `new Promise((done) => {
  let last = performance.now();
  let calm = 0;
  const tick = (now) => { calm = now - last < 50 ? calm + 1 : 0; last = now; calm >= 2 ? done(true) : requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})`;
const TWO_FRAMES = 'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))';
/** Frame gaps and Konva layer repaints from now on. */
const START_CLOCK = `(() => {
  window.gaps = [];
  window.draws = {};
  if (!window.drawsPatched) {
    window.drawsPatched = true;
    const draw = window.Konva.Layer.prototype.drawScene;
    window.Konva.Layer.prototype.drawScene = function (...args) {
      const name = this.name() || '?';
      window.draws[name] = (window.draws[name] ?? 0) + 1;
      return draw.apply(this, args);
    };
  }
  let last = performance.now();
  window.started = last;
  const tick = (now) => { window.gaps.push(now - last); last = now; window.raf = requestAnimationFrame(tick); };
  window.raf = requestAnimationFrame(tick);
})()`;
const STOP_CLOCK = `(cancelAnimationFrame(window.raf),
  { stepsMs: performance.now() - window.started, gaps: window.gaps, draws: window.draws })`;

/** Centre of an object on the page, in page pixels. */
async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('editor-canvas').boundingBox();
  const centre = (await page.evaluate(`(() => {
    const node = window.Konva?.stages[0]?.findOne('.equipment-${id}');
    if (!node) return null;
    const rect = node.getClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)) as { x: number; y: number } | null;
  if (box === null || centre === null) throw new Error(`объект ${id} не найден на холсте`);
  return { x: box.x + centre.x, y: box.y + centre.y };
}

/** The dragged object as the plan file has it; null for the start plan. */
function fileObject(plan: PlanCase): { position: [number, number]; zoneId?: string | null } | null {
  if (plan.file === null) return null;
  // The project format has `objects`; example_plan.json has `equipment`.
  const json = JSON.parse(plan.file.toString()) as Record<string, { id: string; position: [number, number]; zoneId?: string | null }[] | undefined>;
  return (json['objects'] ?? json['equipment'] ?? []).find((object) => object.id === plan.object) ?? null;
}

/** Wheel notches over the dragged object until the plan shows objects, not zone cards. */
async function zoomToDetail(page: Page, plan: PlanCase): Promise<void> {
  const canvas = page.getByTestId('editor-canvas');
  const scale = async (): Promise<number> =>
    Number.parseFloat((await page.getByTestId('canvas-scale').getAttribute('title')) ?? '0');
  const target = fileObject(plan)?.position;
  for (let notch = 0; notch < 20 && (await scale()) < DETAIL_SCALE; notch += 1) {
    if (target === undefined) throw new Error(`объект ${plan.object} не виден и его нет в файле плана`);
    const box = (await canvas.boundingBox())!;
    const [minX, minY, maxX, maxY] = ((await canvas.getAttribute('data-visible')) ?? '').split(',').map(Number) as [number, number, number, number];
    await page.mouse.move(
      box.x + ((target[0] - minX) / (maxX - minX)) * box.width,
      box.y + ((maxY - target[1]) / (maxY - minY)) * box.height,
    );
    await page.mouse.wheel(0, -100);
    // The wheel hands the view to the app after a pause (#223).
    await page.waitForTimeout(300);
    await page.evaluate(CALM);
  }
}

type Clock = { stepsMs: number; gaps: number[]; draws: Record<string, number>; busyMs: number };

/**
 * Runs `steps` between the clock's start and stop. `busyMs` is the main
 * thread's task time per step (Chromium's `TaskDuration`): unlike frame gaps,
 * which only show work longer than a frame, it shows what a slower machine
 * will feel first.
 */
async function timed(page: Page, cdp: CDPSession, count: number, steps: () => Promise<void>): Promise<Clock> {
  const taskMs = async (): Promise<number> =>
    ((await cdp.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0) * 1000;
  await page.evaluate(START_CLOCK);
  const before = await taskMs();
  await steps();
  await page.evaluate(TWO_FRAMES);
  const busy = (await taskMs()) - before;
  const clock = (await page.evaluate(STOP_CLOCK)) as Omit<Clock, 'busyMs'>;
  return { ...clock, busyMs: busy / count };
}

type Run = {
  stepsMs: number;
  worstFrameMs: number;
  medianFrameMs: number;
  busyMs: number;
  /** The longest frame within 0.4 s after the release; null without a release. */
  releaseMs: number | null;
  /** Whether the drop moved the object; null for a gesture without one. */
  dropped: boolean | null;
  draws: Record<string, number>;
};

async function measure(planName: string, gesture: Gesture): Promise<Run> {
  const plan = PLANS[planName]!;
  const browser = await chromium.launch({ channel: resolveChannel(process.env.PW_CHANNEL), headless: process.env['HEADED'] !== '1' });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(() => window.localStorage.setItem('ops-twin.onboarding.v1', 'done'));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(url!);
    if (plan.file !== null) {
      await page.getByTestId('plan-file-input').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: plan.file });
    }
    // Opening 1000 objects keeps the page busy for a while.
    // The plan is open when its object or the card of the object's zone is drawn.
    const zone = fileObject(plan)?.zoneId;
    await page.waitForFunction(
      `!!window.Konva?.stages[0]?.findOne('.equipment-${plan.object}') || !!window.Konva?.stages[0]?.findOne('.zone-overview-${zone ?? '-'}')`,
      undefined,
      { timeout: 180_000 },
    );
    await page.evaluate(CALM);
    await zoomToDetail(page, plan);
    await page.waitForFunction(`!!window.Konva?.stages[0]?.findOne('.equipment-${plan.object}')`, undefined, { timeout: 60_000 });
    await page.evaluate(CALM);

    if (gesture === 'captions') await page.getByRole('button', { name: 'Подписи объектов' }).click();
    if (gesture === 'group') {
      for (const id of [...plan.group, plan.object]) {
        const { x, y } = await centreOf(page, id);
        await page.mouse.click(x, y, { modifiers: ['Shift'] });
      }
    }
    await page.evaluate(CALM);

    const canvas = page.getByTestId('editor-canvas');
    const before = await canvas.getAttribute('data-visible');
    let clock: Clock;
    let button: 'left' | 'right' | null = null;
    const start = await centreOf(page, plan.object);
    if (gesture === 'one' || gesture === 'group' || gesture === 'captions') {
      const { x, y } = start;
      await page.mouse.move(x, y);
      await page.mouse.down();
      button = 'left';
      // The first small step starts the gesture; it is not counted.
      await page.mouse.move(x + 3, y + 3);
      await page.evaluate(CALM);
      clock = await timed(page, cdp, STEPS, async () => {
        for (let step = 1; step <= STEPS; step += 1) {
          await page.mouse.move(x + 3 + step * plan.step[0], y + 3 + step * plan.step[1]);
        }
      });
      // The steps must have timed a drag, not an idle canvas.
      if (!(await page.evaluate('window.Konva.isDragging()'))) throw new Error(`объект ${plan.object} не тянется`);
    } else if (gesture === 'pan') {
      // From the empty margin above the plan: a press on an issue marker selects it instead.
      const box = (await canvas.boundingBox())!;
      const x = box.x + box.width / 3;
      const y = box.y + 30;
      await page.mouse.move(x, y);
      await page.mouse.down({ button: 'right' });
      button = 'right';
      clock = await timed(page, cdp, STEPS, async () => {
        for (let step = 1; step <= STEPS; step += 1) await page.mouse.move(x + step * PAN_PX, y + step * PAN_PX / 2);
      });
    } else if (gesture === 'zoom') {
      const { x, y } = await centreOf(page, plan.object);
      await page.mouse.move(x, y);
      // In and back out: every notch is drawn before the next one comes.
      clock = await timed(page, cdp, NOTCHES, async () => {
        for (let notch = 0; notch < NOTCHES; notch += 1) {
          await page.mouse.wheel(0, notch < NOTCHES / 2 ? -100 : 100);
          await page.evaluate(TWO_FRAMES);
        }
      });
    } else {
      const points = [await centreOf(page, plan.pick[0]), await centreOf(page, plan.pick[1])];
      clock = await timed(page, cdp, CLICKS, async () => {
        for (let click = 0; click < CLICKS; click += 1) {
          const { x, y } = points[click % 2]!;
          await page.mouse.click(x, y);
          await page.evaluate(TWO_FRAMES);
        }
      });
    }
    // The release ends the gesture: a drop commits the command, a pan the
    // viewport. The wheel has no release: the view settles once it stops.
    let releaseMs: number | null = null;
    if (button !== null) {
      // 0.4 s: the check and the areas follow the drop in a later render (#190).
      const release = await timed(page, cdp, 1, async () => {
        await page.mouse.up({ button: button! });
        await page.waitForTimeout(400);
      });
      releaseMs = Math.max(...release.gaps);
    } else if (gesture === 'zoom') {
      const settle = await timed(page, cdp, 1, () => page.waitForTimeout(400));
      releaseMs = Math.max(...settle.gaps);
    }
    if (gesture === 'pan' && (await canvas.getAttribute('data-visible')) === before) {
      throw new Error('план не сдвинулся: панорама не случилась');
    }
    // A refused drop puts the object back and costs less: the output says which one it was.
    const end = await centreOf(page, plan.object);
    const dropped = button === 'left' ? Math.hypot(end.x - start.x, end.y - start.y) > 10 : null;
    return {
      dropped,
      stepsMs: clock.stepsMs,
      worstFrameMs: Math.max(...clock.gaps),
      medianFrameMs: median(clock.gaps),
      busyMs: clock.busyMs,
      releaseMs,
      draws: clock.draws,
    };
  } finally {
    await browser.close();
  }
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
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

  for (const planName of plans) {
    for (const gesture of gestures) {
      const results: Run[] = [];
      for (let run = 0; run < runs; run += 1) results.push(await measure(planName, gesture));
      console.log(JSON.stringify({
        plan: planName,
        gesture,
        runs: results.length,
        stepsMs: Math.round(median(results.map((r) => r.stepsMs))),
        worstFrameMs: Math.round(median(results.map((r) => r.worstFrameMs))),
        medianFrameMs: Math.round(median(results.map((r) => r.medianFrameMs))),
        busyMs: Math.round(median(results.map((r) => r.busyMs)) * 10) / 10,
        releaseMs: results[0]?.releaseMs === null ? null : Math.round(median(results.map((r) => r.releaseMs ?? 0))),
        dropped: results[0]?.dropped,
        draws: results[0]?.draws,
      }));
    }
  }
} finally {
  preview?.kill();
}

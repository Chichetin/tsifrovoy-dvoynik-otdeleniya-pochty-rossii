/** Q02: real Chromium, isolated dev port, fixed synthetic plans and five samples. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, loadavg, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { expect, test } from '@playwright/test';
import { BENCHMARK_SEED, CASES, generateBenchmark } from '../../scripts/generate-benchmark';
import { skipOnboarding, exportPlan } from '../e2e/fixtures';

const REPEATS = 5;
const SERVER = process.env.PERF_SERVER === 'preview' ? 'preview' : 'dev';

/**
 * Budgets hold on the production build only (`PERF_SERVER=preview`); the dev
 * build carries React's development overhead, its numbers are published, not
 * asserted. Both are medians in the page on 1000 objects. Before/after D-187:
 * docs/verification/performance-2026-09-19-d187.md — the budgets leave room
 * for a loaded machine and catch the buffer-canvas path coming back.
 */
const SELECT_BUDGET_MS = 400;
const ZOOM_BUDGET_MS = 300;

/**
 * `selectMs` — from the pointer press to the first frame after the card shows
 * the object, measured inside the page; `selectWallMs` — the same click as
 * Playwright sees it, with its own waiting. Locating a row among 1000 walks
 * every label of the page and is the test's cost, not the user's, so it is
 * done before the clock starts. `zoomMs` — one wheel step over the canvas to
 * the second frame after it, median of five steps. `validateMs` is null on
 * the production build: the module is not importable there.
 */
type Sample = {
  coldOpenMs: number;
  warmOpenMs: number;
  selectMs: number;
  selectWallMs: number;
  zoomMs: number;
  filterMs: number;
  clearFilterMs: number;
  validateMs: number | null;
  saveReopenMs: number;
  heapBytes: number | null;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

type Probe = { q02: Promise<number> };

/** A broken interaction probe must fail quickly, not consume the 10-minute test timeout. */
const INTERACTION_PROBE_TIMEOUT_MS = 10_000;

for (const config of CASES) {
  test(`${config.objects} объектов / ${config.zones} зон`, async ({ browser, baseURL }, testInfo) => {
    const plan = generateBenchmark(config.objects);
    const buffer = Buffer.from(JSON.stringify(plan));
    const samples: Sample[] = [];
    let userAgent = '';
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      // Fresh context includes an empty browser draft and a new React tree.
      const context = await browser.newContext();
      await skipOnboarding(context);
      const page = await context.newPage();
      const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
      try {
        await page.goto(baseURL ?? '/');
        if (!userAgent) userAgent = await page.evaluate(() => navigator.userAgent);
        const file = { name: `benchmark-${config.objects}.json`, mimeType: 'application/json', buffer };
        const started = performance.now();
        await page.getByTestId('plan-file-input').setInputFiles(file);
        await expect(rows).toHaveCount(config.objects, { timeout: 180_000 });
        const coldOpenMs = performance.now() - started;

        // Clear the document first: the row assertion must observe a new load,
        // not the old table that already has the expected number of rows.
        page.once('dialog', (dialog) => void dialog.accept());
        await page.getByRole('button', { name: 'Создать новый' }).click();
        await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
        const warmStarted = performance.now();
        await page.getByTestId('plan-file-input').setInputFiles(file);
        await expect(rows).toHaveCount(config.objects);
        await expect(page.getByTestId('room-free')).toContainText('м²');
        const warmOpenMs = performance.now() - warmStarted;

        const rowButton = await rows.first().locator('button').first().elementHandle();
        if (!rowButton) throw new Error('Строка перечня не найдена');
        await page.evaluate((timeoutMs) => {
          (window as unknown as Probe).q02 = new Promise<number>((resolve, reject) => {
            let pressed: number | null = null;
            const onPointerDown = (): void => { pressed = performance.now(); };
            const observer = new MutationObserver(() => {
              if (window.document.querySelector('[data-testid="props-id"]')?.textContent !== 'eq_0') return;
              cleanup();
              if (pressed === null) {
                reject(new Error('Q02: карточка объекта открылась без pointerdown'));
                return;
              }
              const started = pressed;
              requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - started), 0));
            });
            const timer = window.setTimeout(() => {
              cleanup();
              reject(new Error(`Q02: выбор объекта не завершился за ${timeoutMs} мс`));
            }, timeoutMs);
            function cleanup(): void {
              window.clearTimeout(timer);
              window.document.removeEventListener('pointerdown', onPointerDown, { capture: true });
              observer.disconnect();
            }
            window.document.addEventListener('pointerdown', onPointerDown, { capture: true, once: true });
            observer.observe(window.document.body, { subtree: true, childList: true, characterData: true });
          });
        }, INTERACTION_PROBE_TIMEOUT_MS);
        const selectStarted = performance.now();
        await rowButton.click();
        const selectMs = await page.evaluate(() => (window as unknown as Probe).q02);
        await expect(page.getByTestId('props-id')).toHaveText('eq_0');
        const selectWallMs = performance.now() - selectStarted;

        // Zoom redraws every shape of every layer: the cost a thousand objects
        // put on pan, zoom and drag. In and out alternate, so the view ends
        // where it started.
        const canvas = await page.locator('.konvajs-content').first().boundingBox();
        if (!canvas) throw new Error('Холст не найден');
        await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
        const zoomSteps: number[] = [];
        for (let step = 0; step < 5; step += 1) {
          await page.evaluate(() => {
            (window as unknown as Probe).q02 = new Promise<number>((resolve) => {
              window.addEventListener('wheel', () => {
                const started = performance.now();
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
              }, { capture: true, once: true });
            });
          });
          await page.mouse.wheel(0, step % 2 === 0 ? -120 : 120);
          zoomSteps.push(await page.evaluate(() => (window as unknown as Probe).q02));
        }
        const zoomMs = median(zoomSteps);

        const search = page.getByLabel('Поиск по перечню');
        const filterStarted = performance.now();
        await search.fill('ot_window');
        await expect(rows).toHaveCount(plan.objects.filter((object) => object.typeId === 'ot_window').length);
        const filterMs = performance.now() - filterStarted;
        const clearFilterStarted = performance.now();
        await search.fill('');
        await expect(rows).toHaveCount(config.objects);
        const clearFilterMs = performance.now() - clearFilterStarted;

        const validateMs = SERVER === 'preview' ? null : await page.evaluate(async (document) => {
          const path = '/src/domain/validation/index.ts';
          const { validatePlan } = await import(/* @vite-ignore */ path);
          const start = performance.now();
          const issues = validatePlan(document);
          const elapsed = performance.now() - start;
          if (!Array.isArray(issues)) throw new Error('Валидация не вернула список');
          return elapsed;
        }, plan);

        const saveStarted = performance.now();
        const download = await Promise.all([
          page.waitForEvent('download'),
          exportPlan(page, 'JSON'),
        ]).then(([item]) => item);
        const saved = await download.path();
        if (!saved) throw new Error('Браузер не сохранил файл');
        // "Новый" confirms whenever the plan has content, not only when it is
        // dirty (275d061): without a handler Playwright dismisses the dialog and
        // the plan is never cleared, so the reopen below measures nothing.
        page.once('dialog', (dialog) => void dialog.accept());
        await page.getByRole('button', { name: 'Создать новый' }).click();
        await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
        await page.getByTestId('plan-file-input').setInputFiles(saved);
        await expect(rows).toHaveCount(config.objects);
        const saveReopenMs = performance.now() - saveStarted;
        const heapBytes = await page.evaluate(() => {
          const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          return memory?.usedJSHeapSize ?? null;
        });
        samples.push({ coldOpenMs, warmOpenMs, selectMs, selectWallMs, zoomMs, filterMs, clearFilterMs, validateMs, saveReopenMs, heapBytes });
      } finally {
        await context.close();
      }
    }
    const raw = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      server: SERVER, seed: BENCHMARK_SEED, objects: config.objects, zones: config.zones, repeats: REPEATS,
      browser: userAgent, machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length, ramBytes: totalmem(), loadavgAtEnd: loadavg() },
      samples,
    };
    const output = testInfo.outputPath('samples.json');
    writeFileSync(output, JSON.stringify(raw, null, 2));
    await testInfo.attach('raw-samples', { path: output, contentType: 'application/json' });
    console.log(`Q02 ${config.objects}/${config.zones}: ${output}`);
    if (SERVER === 'preview') {
      expect(median(samples.map((sample) => sample.selectMs)), 'выбор объекта, медиана, мс').toBeLessThan(SELECT_BUDGET_MS);
      expect(median(samples.map((sample) => sample.zoomMs)), 'шаг zoom, медиана, мс').toBeLessThan(ZOOM_BUDGET_MS);
    }
  });
}

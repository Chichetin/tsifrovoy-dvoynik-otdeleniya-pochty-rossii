/** Q02: real Chromium, isolated dev port, fixed synthetic plans and five samples. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { expect, test } from '@playwright/test';
import { BENCHMARK_SEED, CASES, generateBenchmark } from '../../scripts/generate-benchmark';

const REPEATS = 5;

type Sample = { coldOpenMs: number; warmOpenMs: number; selectMs: number; validateMs: number; saveReopenMs: number; heapBytes: number | null };

for (const config of CASES) {
  test(`${config.objects} объектов / ${config.zones} зон`, async ({ browser, baseURL }, testInfo) => {
    const plan = generateBenchmark(config.objects);
    const buffer = Buffer.from(JSON.stringify(plan));
    const samples: Sample[] = [];
    let userAgent = '';
    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      // Fresh context includes an empty browser draft and a new React tree.
      const context = await browser.newContext();
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
        await page.getByRole('button', { name: 'Новый' }).click();
        await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
        const warmStarted = performance.now();
        await page.getByTestId('plan-file-input').setInputFiles(file);
        await expect(rows).toHaveCount(config.objects);
        await expect(page.getByTestId('room-free')).toContainText('м²');
        const warmOpenMs = performance.now() - warmStarted;

        const selectStarted = performance.now();
        await rows.first().locator('button').first().click();
        await expect(page.getByTestId('props-id')).toHaveText('eq_0');
        const selectMs = performance.now() - selectStarted;

        const validateMs = await page.evaluate(async (document) => {
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
          page.getByRole('button', { name: 'Сохранить' }).click(),
        ]).then(([item]) => item);
        const saved = await download.path();
        if (!saved) throw new Error('Браузер не сохранил файл');
        await page.getByRole('button', { name: 'Новый' }).click();
        await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
        await page.getByTestId('plan-file-input').setInputFiles(saved);
        await expect(rows).toHaveCount(config.objects);
        const saveReopenMs = performance.now() - saveStarted;
        const heapBytes = await page.evaluate(() => {
          const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          return memory?.usedJSHeapSize ?? null;
        });
        samples.push({ coldOpenMs, warmOpenMs, selectMs, validateMs, saveReopenMs, heapBytes });
      } finally {
        await context.close();
      }
    }
    const raw = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      seed: BENCHMARK_SEED, objects: config.objects, zones: config.zones, repeats: REPEATS,
      browser: userAgent, machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length, ramBytes: totalmem() },
      samples,
    };
    const output = testInfo.outputPath('samples.json');
    writeFileSync(output, JSON.stringify(raw, null, 2));
    await testInfo.attach('raw-samples', { path: output, contentType: 'application/json' });
    console.log(`Q02 ${config.objects}/${config.zones}: ${output}`);
  });
}

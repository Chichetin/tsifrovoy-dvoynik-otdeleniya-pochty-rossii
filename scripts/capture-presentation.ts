/** Reproducible screenshots of the synthetic E01 demo for the presentation. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { resolveChannel } from '../playwright.config';
import { skipOnboarding } from '../tests/e2e/fixtures';

const baseURL = process.env.PRESENTATION_BASE_URL ?? 'http://127.0.0.1:5196';
const dir = join(process.cwd(), 'build', 'presentation');
mkdirSync(dir, { recursive: true });

// Same browser as the test suites (D-125): the bundled Chromium from the README
// command by default, a system browser only with an explicit PW_CHANNEL=chrome.
const browser = await chromium.launch({
  channel: resolveChannel(process.env.PW_CHANNEL),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await skipOnboarding(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();

  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);
  await page.screenshot({ path: join(dir, 'before.png'), animations: 'disabled' });

  const assistant = page.getByLabel('Ассистент');
  await assistant.getByLabel('Сценарий').selectOption('equipment');
  await assistant.getByRole('button', { name: 'Спросить' }).click();
  await expect(assistant.locator('.assistant__mode')).toContainText('Без LLM');
  await expect(assistant.locator('.advice__sentence').first()).toBeVisible();
  await page.screenshot({ path: join(dir, 'advice.png'), animations: 'disabled' });

  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'after.json'));
  await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);
  await page.screenshot({ path: join(dir, 'after.png'), animations: 'disabled' });

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('3D-вид')).toBeVisible();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-objects-count', '53');
  await expect(page.getByTestId('view3d-canvas')).toBeVisible();
  await page.screenshot({ path: join(dir, 'view3d.png'), animations: 'disabled' });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  process.stdout.write(`Screenshots saved to ${dir}\n`);
} finally {
  await browser.close();
}

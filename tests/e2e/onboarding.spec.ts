/**
 * UX №2: мини-обучение при первом входе (D-195).
 *
 * Эта спека — единственная, что открывает приложение «впервые»: она берёт голый
 * `@playwright/test`, а не общую фикстуру `./fixtures`, которая отметку ставит
 * заранее. Проверяется то, что видит человек: четыре шага по сценарию
 * проверяющего, кольцо вокруг настоящей панели, «Пропустить» на каждом шаге,
 * отметка только в localStorage и ни байта обучения в файле плана.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ONBOARDING_KEY } from '../../src/features/onboarding/tour';
import { skipOnboarding, exportPlan } from './fixtures';

const DEMO = join(process.cwd(), 'demo', 'before.json');

function tour(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Обучение' });
}

/** Кольцо обводит панель: её рамка целиком внутри кольца, с зазором не больше 8 px. */
async function expectRingAround(page: Page, target: string, panel: Locator): Promise<void> {
  const ring = await page.locator(`[data-testid="onboarding-ring"][data-target="${target}"]`).boundingBox();
  const box = await panel.boundingBox();
  expect(ring, `кольцо ${target}`).not.toBeNull();
  expect(box, `панель ${target}`).not.toBeNull();
  const r = ring!;
  const b = box!;
  expect(r.x).toBeLessThanOrEqual(b.x);
  expect(r.y).toBeLessThanOrEqual(b.y);
  expect(r.x + r.width).toBeGreaterThanOrEqual(b.x + b.width);
  expect(r.y + r.height).toBeGreaterThanOrEqual(b.y + b.height);
  expect(b.x - r.x).toBeLessThanOrEqual(8);
  expect(r.width - b.width).toBeLessThanOrEqual(16);
}

async function savedText(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportPlan(page, 'JSON'),
  ]);
  return readFileSync((await download.path())!, 'utf8');
}

test('первый вход: четыре шага по настоящим панелям, «Готово» запоминается в localStorage', async ({ page }) => {
  await page.goto('/');
  const dialog = tour(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog).toContainText('Шаг 1 из 4');
  await expect(dialog).toContainText('Откройте план отделения');
  await expectRingAround(page, 'files', page.getByRole('group', { name: 'Файл плана' }));
  await expect(dialog.getByRole('button', { name: 'Пропустить' })).toBeVisible();

  // Клавиатура: Tab до «Далее», Enter нажимает её.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Далее' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toContainText('Шаг 2 из 4');
  await expectRingAround(page, 'tools', page.getByRole('toolbar', { name: 'Инструменты плана' }));
  await expectRingAround(page, 'side-left', page.locator('aside[data-tour="side-left"]'));
  await expect(dialog.getByRole('button', { name: 'Пропустить' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Далее' }).click();
  await expect(dialog).toContainText('Шаг 3 из 4');
  await expectRingAround(page, 'side-right', page.locator('aside[data-tour="side-right"]'));
  await expect(dialog.getByRole('button', { name: 'Пропустить' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Далее' }).click();
  await expect(dialog).toContainText('Шаг 4 из 4');
  await expectRingAround(page, 'files', page.getByRole('group', { name: 'Файл плана' }));
  await expect(dialog.getByRole('button', { name: 'Пропустить' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Далее' })).toHaveCount(0);

  // Карточка целиком на экране: кнопки не уезжают за край.
  const card = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
  expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);

  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_KEY)).toBe('done');

  await page.reload();
  await expect(page.getByRole('toolbar', { name: 'Инструменты плана' })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('Escape пропускает обучение; пока оно открыто, мышь до холста не доходит', async ({ page }) => {
  await page.goto('/');
  await expect(tour(page)).toBeVisible();
  const canvas = (await page.getByTestId('editor-canvas').boundingBox())!;
  const x = canvas.x + canvas.width / 2;
  const y = canvas.y + canvas.height / 2;
  const hit = (): Promise<boolean> =>
    page.evaluate(
      ([px, py]) => document.elementFromPoint(px!, py!)?.closest('[data-testid="onboarding"]') !== null,
      [x, y],
    );

  // Затенение лежит поверх холста и забирает клик; фокус остаётся в карточке.
  expect(await hit()).toBe(true);
  await page.mouse.click(x, y);
  await expect(tour(page)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  expect(await hit()).toBe(false);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_KEY)).toBe('skipped');
});

test('«Обучение» в левой панели запускает его снова с первого шага и возвращает фокус', async ({ page }) => {
  await page.goto('/');
  await tour(page).getByRole('button', { name: 'Далее' }).click();
  await tour(page).getByRole('button', { name: 'Пропустить' }).click();
  await expect(tour(page)).toHaveCount(0);

  const again = page.getByRole('button', { name: 'Обучение' });
  await again.click();
  await expect(tour(page)).toContainText('Шаг 1 из 4');
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  await expect(again).toBeFocused();
});

test('метки подсветки не меняют раскладку шапки: у обёрток нет своей рамки', async ({ page }) => {
  await skipOnboarding(page.context());
  await page.goto('/');
  for (const target of ['files', 'tools']) {
    const anchor = page.locator(`header [data-tour="${target}"]`);
    await expect(anchor).toHaveCSS('display', 'contents');
  }
});

test('в файл плана обучение не попадает: сохранение с обучением и без него побайтно одинаково', async ({ page, browser }) => {
  await page.goto('/');
  const dialog = tour(page);
  for (let step = 1; step < 4; step += 1) await dialog.getByRole('button', { name: 'Далее' }).click();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(page.locator('.files__status').first()).toHaveText('сохранено');
  const withTour = await savedText(page);

  const context = await browser.newContext();
  try {
    await skipOnboarding(context);
    const other = await context.newPage();
    await other.goto(page.url());
    await other.getByTestId('plan-file-input').setInputFiles(DEMO);
    await expect(other.locator('.files__status').first()).toHaveText('сохранено');
    const withoutTour = await savedText(other);
    expect(withTour).toBe(withoutTour);
  } finally {
    await context.close();
  }
  expect(withTour).not.toContain('onboarding');
  expect(withTour).not.toContain('Обучение');
});

test('localStorage недоступен: обучение показывается, «Пропустить» закрывает, приложение работает', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(tour(page)).toBeVisible();
  await tour(page).getByRole('button', { name: 'Пропустить' }).click();
  await expect(tour(page)).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Инструменты плана' })).toBeVisible();

  // Запомнить негде — при следующем входе обучение снова на месте.
  await page.reload();
  await expect(tour(page)).toBeVisible();
  expect(errors).toEqual([]);
});

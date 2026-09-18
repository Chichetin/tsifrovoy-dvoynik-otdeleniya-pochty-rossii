/**
 * A06 в браузере: ассистент отвечает, даже когда сервера нет.
 *
 * Эти тесты идут против `npm run dev`, где `/api` некуда проксировать: это и
 * есть случай «API недоступен» из карточки пакета. Пустой панели тут быть не
 * может — расчёт выполняется в странице и помечается «Без LLM».
 */

import { expect, test, type Page } from '@playwright/test';

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function drawZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Зона', exact: true }).click();
  await clickCanvas(page, 200, 180);
  await clickCanvas(page, 430, 180);
  await clickCanvas(page, 430, 360);
  await clickCanvas(page, 200, 360);
  await clickCanvas(page, 200, 180);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

const panel = (page: Page) => page.getByLabel('Ассистент');

test.describe('ассистент в браузере', () => {
  test('лимит 429 на сервере оставляет рекомендации в режиме без LLM', async ({ page }) => {
    await page.route('**/api/advice', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          issues: [{ code: 'LLM_HTTP_ERROR', severity: 'error', message: 'Лимит модели', refs: [] }],
        }),
      }),
    );
    await page.goto('/');
    await drawZone(page);

    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    await expect(panel(page).locator('.assistant__mode')).toContainText('Без LLM');
    await expect(panel(page).locator('.assistant__mode')).toContainText('429');
    await expect(panel(page).locator('.advice__sentence').first()).toContainText('Место найдено');
  });

  test('сценарий «найти место»: варианты, числа и пометка «без LLM»', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await drawZone(page);

    await expect(panel(page).getByText('Ответа пока нет')).toBeVisible();

    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    // Сервера в dev нет: ответ приходит из расчёта в браузере и говорит об этом.
    await expect(panel(page).locator('.assistant__mode')).toContainText('Без LLM');
    await expect(panel(page).locator('.advice__sentence')).toContainText('Место найдено');

    const candidates = panel(page).locator('.advice__candidates li');
    await expect(candidates.first()).toBeVisible();
    expect(await candidates.count()).toBeGreaterThan(0);
    await expect(candidates.first()).toContainText('поворот');
    await expect(candidates.first()).toContainText('Свободно:');

    // Допущения и ограничения видно рядом с рекомендацией, а не в коде.
    await expect(panel(page).locator('.advice__limitations li').first()).toContainText(
      'геометрия размещения',
    );
    await expect(panel(page).locator('.advice__more summary')).toContainText('Допущения и правила');

    // Наведение на вариант рисует полупрозрачный отпечаток и ничего не меняет:
    // правка плана подняла бы ревизию, и панель отметила бы ответ устаревшим.
    await candidates.first().hover();
    await expect(panel(page).getByText('числа устарели')).toHaveCount(0);
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('план изменили после ответа — панель говорит, что числа устарели', async ({ page }) => {
    await page.goto('/');
    await drawZone(page);
    await panel(page).getByRole('button', { name: 'Спросить' }).click();
    await expect(panel(page).locator('.advice__sentence')).toBeVisible();
    await expect(panel(page).getByText('числа устарели')).toHaveCount(0);

    // Любая правка плана делает ответ устаревшим.
    await page.locator('.library__item').first().click();
    await clickCanvas(page, 300, 260);

    await expect(panel(page).getByText('числа устарели')).toBeVisible();
  });

  test('сценарий комплектования называет правило и его источник', async ({ page }) => {
    await page.goto('/');
    await drawZone(page);

    await panel(page).getByLabel('Сценарий').selectOption('equipment');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    const sentence = panel(page).locator('.advice__sentence').first();
    const empty = panel(page).getByText('Расчёт не нашёл, что предложить по этому запросу');
    await expect(sentence.or(empty).first()).toBeVisible();

    if ((await sentence.count()) > 0) {
      await expect(sentence).toContainText('Не хватает оборудования');
      await expect(panel(page).locator('.advice__more summary').first()).toBeVisible();
      await panel(page).locator('.advice__more summary').first().click();
      await expect(panel(page).locator('.advice__more li').first()).toContainText('команды');
    }
  });

  test('сценарий сравнения на неизменном плане не выдумывает изменений', async ({ page }) => {
    await page.goto('/');
    await drawZone(page);

    await panel(page).getByLabel('Сценарий').selectOption('compare');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    await expect(panel(page).locator('.advice__sentence')).toContainText(
      'Показатели не изменились',
    );
  });
});

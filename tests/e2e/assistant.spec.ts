/**
 * A06 в браузере: ассистент отвечает, даже когда сервера нет.
 *
 * Эти тесты идут против `npm run dev`, где `/api` некуда проксировать: это и
 * есть случай «API недоступен» из карточки пакета. Пустой панели тут быть не
 * может — расчёт выполняется в странице и помечается «Без LLM».
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

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

    // Свободный вопрос без модели никуда не уходит — панель говорит об этом прямо.
    await panel(page).getByLabel('Вопрос (необязательно)').fill('Куда поставить второе окно?');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    // Сервера в dev нет: ответ приходит из расчёта в браузере и говорит об этом.
    await expect(panel(page).locator('.assistant__mode')).toContainText('Без LLM');
    await expect(panel(page).getByTestId('assistant-query-ignored')).toContainText('второе окно');
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

  test('демо: место для рабочего места не в зоне очереди, у варианта названа зона', async ({ page }) => {
    // Находка jury 19.09: по «Всё помещение» ассистент ставил рабочее место
    // оператора в зону очереди клиентов и не говорил, в какой зоне вариант.
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);

    await panel(page).getByLabel('Объект').selectOption('ot_workplace');
    await expect(panel(page).getByLabel('Зона')).toHaveValue('');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    await expect(panel(page).locator('.advice__sentence')).toContainText('Место найдено');
    const candidates = panel(page).locator('.advice__candidates li');
    await expect(candidates.first()).toBeVisible();
    const count = await candidates.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const zone = candidates.nth(index).getByTestId('candidate-zone');
      await expect(zone).toContainText(/зона «.+» \(z_\w+\)/);
      await expect(zone).not.toContainText('z_queue');
    }
    // Уместны зоны, где рабочие места уже стоят в демо: клиентский зал и служебная.
    await expect(candidates.first().getByTestId('candidate-zone')).toContainText(
      /«(Клиентский зал|Служебная зона)» \(z_(client|back)\)/,
    );

    // Зона варианта — среди ссылок рекомендации, правило уместности — в допущениях.
    await expect(panel(page).locator('.advice__refs')).toContainText(/z_(client|back)/);
    await expect(panel(page).locator('.advice__refs')).not.toContainText('z_queue');
    await panel(page).locator('.advice__more summary').click();
    await expect(panel(page).locator('.advice__more')).toContainText('rule_workplace_min');
    await expect(panel(page).locator('.advice__more')).toContainText('по текущей расстановке');
    await expect(panel(page).locator('.advice__more')).toContainText('не норматив Почты');

    // Скамья ожидания: по всему помещению — только там, где скамьи уже стоят
    // или требует правило (ожидание, очередь, комната персонала), не у окон.
    await panel(page).getByLabel('Объект').selectOption('ot_bench');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();
    await expect(panel(page).locator('.advice__sentence')).toContainText('Скамья');
    const benches = panel(page).locator('.advice__candidates li');
    await expect(benches.first()).toBeVisible();
    const benchCount = await benches.count();
    for (let index = 0; index < benchCount; index += 1) {
      await expect(benches.nth(index).getByTestId('candidate-zone')).toContainText(/\(z_(waiting|queue|staff)\)/);
    }
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

    // Другой документ — другой план: ответ про прежние id не показывается вовсе.
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);
    await expect(panel(page).locator('.advice__sentence')).toHaveCount(0);
    await expect(panel(page).getByText('Ответа пока нет')).toBeVisible();
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

  test('комплектование демо называет оборудование и зону рядом с числами', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await panel(page).getByLabel('Сценарий').selectOption('equipment');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    const bench = panel(page).locator('.advice').filter({ hasText: 'Скамья / кресла для ожидания' });
    await expect(bench).toHaveCount(1);
    await expect(bench.locator('.advice__sentence')).toContainText('Зона ожидания');
    await expect(bench.locator('.advice__sentence')).toContainText('Не хватает оборудования: 1 при минимуме 2');
  });

  test('сценарий сравнения после правки показывает «было → стало», а не нули', async ({ page }) => {
    // Находка operator'а 18.09: после удаления объекта «Эффект изменений» отвечал
    // «Объектов 52 → 52» — сравнивал текущий план с ним же. «Было» — это
    // открытый или последний сохранённый план, а не то, что на экране сейчас.
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    // Первая таблица панели — объекты; вторая — разрез по зонам.
    const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
    await expect(rows).toHaveCount(53);

    // Удалить один объект через строку перечня и Delete.
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(52);

    await panel(page).getByLabel('Сценарий').selectOption('compare');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    const sentence = panel(page).locator('.advice__sentence');
    await expect(sentence).toContainText('Планировка изменилась');
    await expect(sentence).toContainText('удалено 1');
    // Свободная площадь выросла: «было → стало» с разными числами.
    await expect(sentence).toContainText(/Свободная площадь: [\d,]+ → [\d,]+ м² \(\+/);

    // Сохранение переносит «было»: сравнивать нужно с сохранённым, а не с
    // открытым файлом. После сохранения и ещё одного удаления ответ — снова
    // «удалено 1», а не «удалено 2» от исходного файла.
    await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Сохранить' }).click(),
    ]);
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(51);

    await panel(page).getByRole('button', { name: 'Спросить' }).click();
    await expect(sentence).toContainText('удалено 1');
    await expect(sentence).not.toContainText('удалено 2');
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

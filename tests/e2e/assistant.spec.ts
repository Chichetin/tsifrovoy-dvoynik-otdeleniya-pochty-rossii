/**
 * A06 в браузере: ассистент отвечает, даже когда сервера нет.
 *
 * Эти тесты идут против `npm run dev`, где `/api` некуда проксировать: это и
 * есть случай «API недоступен» из карточки пакета. Пустой панели тут быть не
 * может — расчёт выполняется в странице и помечается «Без LLM».
 */

import { join } from 'node:path';
import { expect, exportPlan, test, type Page } from './fixtures';
import { calculateAdvice } from '../../src/domain/advice';
import { showTab } from './side-tabs';

/**
 * D-258: агент по плану. Без сервера отвечает расчёт в браузере — это сценарий
 * проверяющего без ключа; с «моделью» поток подменён, чтобы проверить шаги,
 * проверенный текст и действия детерминированно.
 */
test('агент без сервера: вопрос → шаги → «Применить» → сохранить → открыть заново', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
  await showTab(page, 'Инвентаризация');
  const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(53);

  await showTab(page, 'Ассистент');
  const assistant = panel(page);
  await assistant.getByLabel('Вопрос ассистенту').fill('Куда добавить рабочее место оператора?');
  await assistant.getByLabel('Вопрос ассистенту').press('Enter');
  const answer = assistant.locator('.agent__answer');
  await expect(answer).toContainText('Без LLM');
  await expect(assistant.getByText(/Ход проверки: 2 шага/)).toBeVisible();
  // Вопрос ассистенту сам по себе план не меняет.
  await showTab(page, 'Инвентаризация');
  await expect(rows).toHaveCount(53);

  await showTab(page, 'Ассистент');
  await assistant.getByRole('button', { name: /^Применить: Рабочее место оператора/ }).click();
  await expect(assistant.getByRole('status')).toContainText('Применено');
  await expect(assistant.getByRole('button', { name: /^Применить:/ })).toBeDisabled();
  await showTab(page, 'Инвентаризация');
  await expect(rows).toHaveCount(54);

  const [download] = await Promise.all([page.waitForEvent('download'), exportPlan(page, 'JSON')]);
  const saved = testInfo.outputPath('agent-roundtrip.json');
  await download.saveAs(saved);
  await page.getByTestId('plan-file-input').setInputFiles(saved);
  await expect(rows).toHaveCount(54);
  await showTab(page, 'Ассистент');
  await expect(assistant.locator('.agent__exchange')).toHaveCount(0);
});

test('#32 без сервера: «где слепые пятна» → посмотрел → применил → слой считает то же → сохранить → открыть', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
  await showTab(page, 'Ассистент');
  const assistant = panel(page);
  await assistant.getByLabel('Вопрос ассистенту').fill('Где слепые пятна камер в клиентском зале?');
  await assistant.getByLabel('Вопрос ассистенту').press('Enter');
  const answer = assistant.locator('.agent__answer');
  await expect(answer).toContainText('Без LLM');
  // Numbers are the calculation's: 300 of 1 008 squares now, 72,1 % with the first variant.
  await expect(answer).toContainText('Клиентские зоны видны камерами на 29,8 %, с этим вариантом — на 72,1 % (+42,3 п. п.).');
  // Existing cameras are named by their card label, not by id (#10); the id
  // still drives the click and is kept in the button's title/data-ref-id.
  const cameraButton = answer.getByRole('button', { name: 'Камера зала (вход)', exact: true });
  await expect(cameraButton).toHaveAttribute('data-ref-id', 'eq_25');
  await cameraButton.click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-focus', 'object:eq_25');

  // The layer is named in words, not offered as a button: showing it would
  // change the plan and make «Применить» of this answer stale.
  await expect(answer).toContainText('Секторы и слепые пятна покажет слой «Камеры и зоны обзора» в панели «Слои»');
  await expect(assistant.getByRole('button', { name: /^Включить слой/ })).toHaveCount(0);

  // Asked → looked → applied, in that order, with nothing else in between.
  await assistant.getByRole('button', { name: /^Применить: Камера видеонаблюдения/ }).click();
  await expect(assistant.getByRole('status')).toContainText('Применено');
  await showTab(page, 'Слои');
  const cameras = page.getByLabel('Слои').locator('.layers__item').filter({ has: page.getByLabel('Имя слоя Камеры и зоны обзора') });
  await cameras.getByRole('button', { name: 'Показывать слой Камеры и зоны обзора' }).click();
  const table = cameras.getByRole('table', { name: 'Покрытие клиентских зон камерами' });
  // The layer counts the applied camera exactly as the assistant promised.
  await expect(table.getByRole('row', { name: /Все клиентские зоны/ })).toContainText('72,1 %');

  const [download] = await Promise.all([page.waitForEvent('download'), exportPlan(page, 'JSON')]);
  const saved = testInfo.outputPath('camera-roundtrip.json');
  await download.saveAs(saved);
  await page.getByTestId('plan-file-input').setInputFiles(saved);
  await showTab(page, 'Слои');
  await expect(table.getByRole('row', { name: /Все клиентские зоны/ })).toContainText('72,1 %');
});

test('агент с моделью: шаги потоком, id в тексте ведут на план, действие показывает вариант', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/assistant/agent', async (route) => {
    const input = route.request().postDataJSON();
    const calculated = calculateAdvice(input.plan, { scenario: 'place', typeId: 'ot_cashier_window', zoneId: null });
    if (!calculated.ok) throw new Error('demo calculation failed');
    const recommendation = calculated.value[0]!;
    const candidate = recommendation.candidates[0]!;
    const events = [
      { type: 'step', step: { tool: 'find_place', label: 'Поиск места: «Кассовое окно / операционная касса»', ok: true } },
      {
        type: 'answer',
        answer: {
          revision: input.revision,
          mode: 'llm',
          text: 'Четвёртое окно лучше поставить в Клиентском зале (z_client).',
          steps: [{ tool: 'find_place', label: 'Поиск места: «Кассовое окно / операционная касса»', ok: true }],
          recommendations: calculated.value,
          actions: [
            { kind: 'preview-candidate', recommendationId: recommendation.id, candidateId: candidate.id },
            { kind: 'apply-candidate', recommendationId: recommendation.id, candidateId: candidate.id },
            { kind: 'open-panel', panel: 'metrics' },
          ],
          refs: [{ kind: 'zone', id: 'z_client' }],
        },
      },
    ];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map((event) => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
  await showTab(page, 'Ассистент');
  const assistant = panel(page);
  await assistant.getByRole('button', { name: /кассовое окно ближе к входу/ }).click();
  await expect(assistant.getByText(/LLM выбрала рассчитанные факты/)).toBeVisible();
  // The zone reads by its name, not by id (#10); the id still drives the click.
  const zoneButton = assistant.getByRole('button', { name: 'Клиентский зал', exact: true });
  await expect(zoneButton).toHaveAttribute('data-ref-id', 'z_client');
  await zoneButton.click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-focus', 'zone:z_client');
  await assistant.getByRole('button', { name: 'Открыть «Площади»' }).click();
  await expect(page.getByRole('tab', { name: /^Площади/ })).toHaveAttribute('aria-selected', 'true');
});

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

const panel = (page: Page) => page.getByLabel('Ассистент', { exact: true });

test.describe('ассистент в браузере', () => {
  // D-289: плавающей кнопки «Открыть ассистента» над холстом больше нет —
  // ассистент открывается своей вкладкой в правой колонке, как остальные панели.
  test('вкладка открывает ассистента в правой колонке (D-249)', async ({ page }) => {
    await page.goto('/');
    const assistant = panel(page);
    await showTab(page, 'Площади');
    await expect(assistant).toBeHidden();
    await expect(page.getByRole('button', { name: 'Открыть ассистента' })).toHaveCount(0);

    await showTab(page, 'Ассистент');

    await expect(page.getByRole('tab', { name: 'Ассистент' })).toHaveAttribute('aria-selected', 'true');
    await expect(assistant).toBeVisible();
    await expect(assistant.getByLabel('Сценарий')).toBeVisible();
    await expect(assistant.getByRole('button', { name: 'Спросить' })).toBeVisible();
  });

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
    await showTab(page, 'Ассистент');
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

    await showTab(page, 'Ассистент');
    await drawZone(page);

    await expect(panel(page).getByText('Ответа пока нет')).toBeVisible();

    // Пожелание без модели никуда не уходит — панель говорит об этом прямо.
    await panel(page).getByLabel('Пожелание к варианту (необязательно)').fill('ближе ко входу');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    // Сервера в dev нет: ответ приходит из расчёта в браузере и говорит об этом.
    await expect(panel(page).locator('.assistant__mode')).toContainText('Без LLM');
    await expect(panel(page).getByTestId('assistant-query-ignored')).toContainText('ближе ко входу');
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
    await showTab(page, 'Инвентаризация');
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('демо: место для рабочего места не в зоне очереди, у варианта названа зона', async ({ page }) => {
    // Находка jury 19.09: по «Всё помещение» ассистент ставил рабочее место
    // оператора в зону очереди клиентов и не говорил, в какой зоне вариант.
    await page.goto('/');
    await showTab(page, 'Ассистент');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await showTab(page, 'Инвентаризация');
    await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);

    // Перечень был нужен, чтобы дождаться открытого плана; спрашивают на вкладке ассистента (D-249).
    await showTab(page, 'Ассистент');
    await panel(page).getByLabel('Объект').selectOption('ot_workplace');
    await expect(panel(page).getByLabel('Зона')).toHaveValue('');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    await expect(panel(page).locator('.advice__sentence')).toContainText('Место найдено');
    const candidates = panel(page).locator('.advice__candidates li');
    await expect(candidates.first()).toBeVisible();
    const count = await candidates.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      // Названием, не голым id (#10); id остаётся в «Ссылки» ниже.
      const zone = candidates.nth(index).getByTestId('candidate-zone');
      await expect(zone).toContainText(/зона «.+»/);
      await expect(zone).not.toContainText('Зона очереди');
    }
    // Уместны зоны, где рабочие места уже стоят в демо: клиентский зал и служебная.
    await expect(candidates.first().getByTestId('candidate-zone')).toContainText(
      /«(Клиентский зал|Служебная зона)»/,
    );

    // Зона варианта — среди ссылок рекомендации (названием, id — в title/data-ref-id), правило уместности — в допущениях.
    await expect(panel(page).locator('.advice__refs')).toContainText(/Клиентский зал|Служебная зона/);
    await expect(panel(page).locator('.advice__refs')).not.toContainText('Зона очереди');
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
      await expect(benches.nth(index).getByTestId('candidate-zone')).toContainText(/Зона ожидания|Зона очереди|Комната персонала/);
    }
  });

  test('план изменили после ответа — панель говорит, что числа устарели', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Ассистент');
    await drawZone(page);
    await panel(page).getByRole('button', { name: 'Спросить' }).click();
    await expect(panel(page).locator('.advice__sentence')).toBeVisible();
    await expect(panel(page).getByText('числа устарели')).toHaveCount(0);

    // Любая правка плана делает ответ устаревшим.
    await showTab(page, 'Библиотека');
    await page.locator('.library__item').first().click();
    await clickCanvas(page, 300, 260);

    await expect(panel(page).getByText('числа устарели')).toBeVisible();

    // Другой документ — другой план: ответ про прежние id не показывается вовсе.
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await showTab(page, 'Инвентаризация');
    await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);
    await showTab(page, 'Ассистент');
    await expect(panel(page).locator('.advice__sentence')).toHaveCount(0);
    await expect(panel(page).getByText('Ответа пока нет')).toBeVisible();
  });

  test('сценарий комплектования называет правило и его источник', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Ассистент');
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
    await showTab(page, 'Ассистент');
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
    await showTab(page, 'Ассистент');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    // Первая таблица панели — объекты; вторая — разрез по зонам.
    await showTab(page, 'Инвентаризация');
    const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
    await expect(rows).toHaveCount(53);

    // Удалить один объект через строку перечня и Delete.
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(52);

    await showTab(page, 'Ассистент');
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
      exportPlan(page, 'JSON'),
    ]);
    await showTab(page, 'Инвентаризация');
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(51);

    await showTab(page, 'Ассистент');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();
    await expect(sentence).toContainText('удалено 1');
    await expect(sentence).not.toContainText('удалено 2');
  });

  test('сценарий сравнения на неизменном плане не выдумывает изменений', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Ассистент');
    await drawZone(page);

    await panel(page).getByLabel('Сценарий').selectOption('compare');
    await panel(page).getByRole('button', { name: 'Спросить' }).click();

    await expect(panel(page).locator('.advice__sentence')).toContainText(
      'Показатели не изменились',
    );
  });
});

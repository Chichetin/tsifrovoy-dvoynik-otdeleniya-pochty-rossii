/**
 * E01 в браузере: комплект сдачи проверяется так, как его откроет жюри.
 *
 * Архив здесь настоящий: он собирается `package-demo`, распаковывается во
 * временный каталог, и в кнопку «Открыть» подаются именно распакованные файлы.
 * Проверка «после распаковки оба плана открываются» иначе остаётся рассуждением.
 *
 * Второй сценарий — та же рекомендация, применённая руками в редакторе:
 * поставить скамью из библиотеки, удалить лишнее табло, перетащить терминал
 * очереди числами карточки. Скачанный файл сравнивается с `demo/after.json`
 * целиком, поэтому «изменённый план получен в редакторе» — факт, а не подпись.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { DEMO_FILES, packageDemo, readZip } from '../../scripts/package-demo';

/** Каталог с распакованным архивом; наполняется один раз на файл спеки. */
let unpacked = '';

test.beforeAll(() => {
  unpacked = mkdtempSync(join(tmpdir(), 'demo-e2e-'));
  const archive = join(unpacked, 'submission.zip');
  packageDemo(archive);
  const files = readZip(readFileSync(archive));
  expect([...files.keys()]).toEqual([...DEMO_FILES]);
  for (const [name, content] of files) writeFileSync(join(unpacked, name), content);
});

test.afterAll(() => {
  if (unpacked !== '') rmSync(unpacked, { recursive: true, force: true });
});

const card = (page: Page) => page.getByLabel('Свойства');

function inventoryRows(page: Page) {
  return page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
}

async function openFromArchive(page: Page, name: string): Promise<void> {
  await page.getByTestId('plan-file-input').setInputFiles(join(unpacked, name));
}

async function selectByLabel(page: Page, label: string): Promise<void> {
  await page
    .getByLabel('Инвентаризация')
    .locator('.table__link', { hasText: label })
    .first()
    .click();
}

async function savePlan(page: Page): Promise<Record<string, unknown>> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ]).then(([event]) => event);
  const file = await download.path();
  expect(file).not.toBeNull();
  return JSON.parse(readFileSync(file as string, 'utf8')) as Record<string, unknown>;
}

test.describe('демо-комплект из ZIP', () => {
  test('оба плана после распаковки открываются с зонами, объектами и атрибутами', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await openFromArchive(page, 'before.json');
    await expect(inventoryRows(page)).toHaveCount(53);

    // Зоны на месте, вместе с вложенными.
    for (const zone of ['z_client', 'z_waiting', 'z_queue', 'z_entrance', 'z_back']) {
      await expect(page.locator('.table__link', { hasText: zone }).first()).toBeVisible();
    }

    // Карточка объекта показывает его id, зону и атрибут из справочника.
    await selectByLabel(page, 'Окно 1 — приём и выдача');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_10');
    await expect(card(page).getByTestId('props-zone')).toContainText('z_client');
    await expect(card(page).getByLabel('Номер окна')).toHaveValue('1');
    await expect(card(page).getByLabel('Инвентарный номер')).toHaveValue('ИНВ-ДЕМО-010');

    // Площади посчитаны от плана, а не подписаны руками.
    await expect(page.getByTestId('room-free')).toContainText('м²');

    // Изменённый план — тем же путём, с применённой рекомендацией внутри.
    await openFromArchive(page, 'after.json');
    await expect(inventoryRows(page)).toHaveCount(53);
    await selectByLabel(page, 'Скамья ожидания 2');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_54');
    await expect(card(page).getByTestId('props-zone')).toContainText('z_waiting');
    await expect(card(page).getByLabel('Мест')).toHaveValue('3');
    await expect(
      page.getByLabel('Инвентаризация').locator('.table__link', {
        hasText: 'Табло над зоной очереди',
      }),
    ).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('рекомендация применяется руками в редакторе и даёт ровно after.json', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await openFromArchive(page, 'before.json');
    await expect(inventoryRows(page)).toHaveCount(53);

    // 1. Скамья из библиотеки. Куда попал клик — неважно: точные координаты
    // рекомендации ставятся в карточке, как это делает человек.
    await page.locator('.library__item', { hasText: 'Скамья / кресла для ожидания' }).first().click();
    await page.getByTestId('editor-canvas').click({ position: { x: 300, y: 300 } });
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await expect(inventoryRows(page)).toHaveCount(54);

    await selectByLabel(page, 'Скамья / кресла для ожидания');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_54');
    await card(page).getByLabel('X, м').fill('2.2');
    await card(page).getByLabel('Y, м').fill('2');
    await card(page).getByLabel('Поворот, °').fill('0');
    await card(page).getByLabel('Название').fill('Скамья ожидания 2');
    await card(page).getByLabel('Инвентарный номер').fill('ИНВ-ДЕМО-054');
    await card(page).getByLabel('Мест').fill('3');
    await expect(card(page).getByTestId('props-zone')).toContainText('z_waiting');

    // 2. Лишнее табло — удалить.
    await selectByLabel(page, 'Табло над зоной очереди');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_8');
    await page.keyboard.press('Delete');
    await expect(inventoryRows(page)).toHaveCount(53);

    // 3. Терминал очереди — на место из рекомендации, тот же объект.
    await selectByLabel(page, 'Терминал электронной очереди');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    await card(page).getByLabel('X, м').fill('7.9');
    await card(page).getByLabel('Y, м').fill('2.1');
    await expect(card(page).getByTestId('props-zone')).toContainText('z_entrance');

    const saved = await savePlan(page);
    const expected = JSON.parse(
      readFileSync(join(unpacked, 'after.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(saved).toEqual(expected);
    expect(errors).toEqual([]);
  });
});

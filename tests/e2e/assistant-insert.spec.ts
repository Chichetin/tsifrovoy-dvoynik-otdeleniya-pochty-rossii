import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanDocument } from '../../src/contracts/model';
import { calculateAdvice } from '../../src/domain/advice';
import { expect, exportPlan, test } from './fixtures';
import { showTab } from './side-tabs';

test('слой из ответа не мешает применить вариант; после удаления новый ID переживает undo и файл', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/assistant/agent', async (route) => {
    const input = route.request().postDataJSON();
    const calculated = calculateAdvice(input.plan, {
      scenario: 'place', typeId: 'ot_queue_terminal', zoneId: 'z_entrance',
    });
    if (!calculated.ok || calculated.value[0]?.candidates[0] === undefined) {
      throw new Error('No candidate in demo');
    }
    const recommendation = calculated.value[0];
    const candidate = recommendation.candidates[0]!;
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'answer', answer: {
        revision: input.revision, mode: 'fallback', text: 'Вариант рассчитан во входной группе.',
        steps: [], recommendations: calculated.value, proposals: [], refs: [],
        actions: [
          { kind: 'preview-candidate', recommendationId: recommendation.id, candidateId: candidate.id },
          { kind: 'show-layer', layerId: 'l_lt_cameras' },
          { kind: 'apply-candidate', recommendationId: recommendation.id, candidateId: candidate.id },
        ],
      } }) + '\n',
    });
  });
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
  await showTab(page, 'Ассистент');
  const assistant = page.getByLabel('Ассистент', { exact: true });
  const ask = async (): Promise<void> => {
    const input = assistant.getByLabel('Вопрос ассистенту');
    await input.fill('Куда поставить терминал управления очередью?');
    await input.press('Enter');
    await expect(assistant.locator('.agent__answer').last().getByRole('button', { name: /^Применить:/ })).toBeEnabled();
  };
  await ask();
  await assistant.getByRole('button', { name: 'Включить слой «Камеры и зоны обзора»' }).click();
  await expect(assistant.locator('.agent__answer').last().getByRole('button', { name: /^Применить:/ })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('assistant-layer-action.png') });
  await assistant.getByRole('button', { name: /^Применить:/ }).click();
  // The voice hint is a second, empty status region of the panel.
  await expect(assistant.getByRole('status').filter({ hasText: 'Применено' })).toBeVisible();
  const properties = page.getByLabel('Свойства', { exact: true });
  const firstId = await properties.getAttribute('data-entity-id');
  expect(firstId).toBeTruthy();
  const x = await properties.getByLabel('X, м', { exact: true }).inputValue();
  const y = await properties.getByLabel('Y, м', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Выбор', exact: true }).focus();
  await page.keyboard.press('Delete');
  await expect(properties).toHaveCount(0);
  await ask();
  await expect(assistant.locator('.agent__answer').first().getByRole('button', { name: /^Применить:/ })).toBeDisabled();
  const apply = assistant.locator('.agent__answer').last().getByRole('button', { name: /^Применить:/ });
  // Keyboard activation uses the same insertion as a pointer click.
  await apply.focus();
  await apply.press('Enter');
  // The voice hint is a second, empty status region of the panel.
  await expect(assistant.getByRole('status').filter({ hasText: 'Применено' })).toBeVisible();
  const secondId = await properties.getAttribute('data-entity-id');
  expect(secondId).toBeTruthy();
  expect(secondId).not.toBe(firstId);
  await expect(properties.getByLabel('X, м', { exact: true })).toHaveValue(x);
  await expect(properties.getByLabel('Y, м', { exact: true })).toHaveValue(y);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(properties).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await showTab(page, 'Инвентаризация');
  const rows = page.getByLabel('Инвентаризация', { exact: true }).locator('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(54);
  const [download] = await Promise.all([page.waitForEvent('download'), exportPlan(page, 'JSON')]);
  const saved = testInfo.outputPath('candidate-roundtrip.json');
  await download.saveAs(saved);
  const reopened = JSON.parse(readFileSync(saved, 'utf8')) as PlanDocument;
  const added = reopened.objects.find((object) => object.id === secondId);
  expect(added).toMatchObject({ typeId: 'ot_queue_terminal', zoneId: 'z_entrance', position: [Number(x), Number(y)] });
  expect(reopened.layers.find((layer) => layer.id === 'l_lt_cameras')?.visible).toBe(true);
  expect(reopened.objects.some((object) => object.id === firstId)).toBe(false);
  await page.getByTestId('plan-file-input').setInputFiles(saved);
  await expect(rows).toHaveCount(54);
  const canvas = page.getByTestId('editor-canvas');
  await canvas.screenshot({ path: testInfo.outputPath('candidate-after.png') });
});

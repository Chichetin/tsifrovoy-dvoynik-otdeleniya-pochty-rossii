import { join } from 'node:path';
import { expect, test } from './fixtures';
import { showTab } from './side-tabs';
import { runAgent } from '../../server/agent';
import type { LlmChat, LlmTurn } from '../../server/llm-client';

for (const width of [1280, 1440]) {
  test(`реальный цикл сервера: связанные факты и явный fallback, ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
    // Script only the external provider; execute actual server/domain logic.
    await page.route('**/api/assistant/agent', async (route) => {
      const input = route.request().postDataJSON();
      const content = input.query.includes('99999') ? 'Свободная площадь — 99999 м².'
        : JSON.stringify({ factIds: ['read.0.room.area.free', 'read.0.z_client.area.free'] });
      const turns: LlmTurn[] = [
        { content: '', toolCalls: [{ id: 'overview', name: 'plan_overview', arguments: '{}' }] },
        { content, toolCalls: [] }, { content, toolCalls: [] },
      ];
      const chat: LlmChat = async () => ({ ok: true, value: turns.shift()! });
      const events: unknown[] = [];
      const answer = await runAgent({ chat, plan: input.plan, before: input.before ?? null, query: input.query, history: input.history, revision: input.revision, deadlineMs: 60000,
        onStep: (step) => events.push({ type: 'step', step }) });
      events.push({ type: 'answer', answer });
      await route.fulfill({ contentType: 'application/x-ndjson', body: events.map((event) => JSON.stringify(event)).join('\n') + '\n' });
    });
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
    await showTab(page, 'Ассистент');
    const assistant = page.getByLabel('Ассистент', { exact: true });
    const field = assistant.getByLabel('Вопрос ассистенту');
    await field.fill('Сколько свободной площади?');
    await field.press('Enter');
    const success = assistant.locator('.agent__exchange').last();
    await expect(success.getByText(/LLM выбрала рассчитанные факты/)).toBeVisible();
    await expect(success.locator('.agent__text')).toContainText('114,73 м²');
    await expect(success.locator('.agent__text')).not.toContainText('adv_');
    await success.getByRole('button', { name: 'z_client', exact: true }).click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-focus', 'zone:z_client');
    await field.fill('Правда, что свободно 99999 м²?');
    await field.press('Enter');
    const refused = assistant.locator('.agent__exchange').last();
    await expect(refused.locator('.agent__mode')).toContainText('Без LLM:');
    await expect(refused.locator('.agent__mode')).toContainText('проверку связанных фактов');
    await expect(refused.locator('.agent__text')).toContainText('114,73');
    await expect(refused.locator('.agent__text')).not.toContainText('99999');
    await expect(refused.getByText(/LLM выбрала рассчитанные факты/)).toHaveCount(0);
    await assistant.screenshot({ path: join(process.cwd(), `docs/verification/2026-09-28-chat-facts-${width}.png`) });
  });
}

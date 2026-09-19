/**
 * Чистая загрузка страницы: проверяющий не должен видеть ошибок в консоли
 * браузера до того, как что-либо нажал.
 *
 * Запрос к `/api/advice` здесь не участвует: в dev его некому обслужить, и
 * ассистент по замыслу уходит в режим без LLM. Проверяется только то, что
 * страница просит и получает свои собственные ресурсы.
 */

import { expect, test } from './fixtures';

test('страница загружается без неудачных запросов и с иконкой', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/api/')) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (!request.url().includes('/api/')) {
      failed.push(`${request.failure()?.errorText ?? 'failed'} ${request.url()}`);
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('editor-canvas')).toBeVisible();

  // Иконка объявлена в разметке и отдаётся сервером: иначе браузер просит
  // /favicon.ico и получает 404.
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveCount(1);
  const href = await icon.getAttribute('href');
  expect(href).not.toBeNull();

  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);

  expect(failed, `неудачные запросы на чистой загрузке: ${failed.join(', ')}`).toEqual([]);
});

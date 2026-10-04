import { expect, test } from './fixtures';

test('main page opens', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();
});

test('harness loads a package stand with a Konva stage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/harness/?id=F01');
  await expect(page.getByTestId('harness-ready')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('harness reports an unknown stand', async ({ page }) => {
  await page.goto('/tests/harness/?id=NOPE');
  await expect(page.getByRole('alert')).toContainText('NOPE');
});

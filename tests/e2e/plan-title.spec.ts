import { readFileSync } from 'node:fs';
import { expect, test, exportPlan, passPhysicsBlock, type Page } from './fixtures';

/** D-350: the plan name lives in the header and renames in place; the mark beside it tells whether the edits are in a file. */

const before = JSON.parse(readFileSync('demo/before.json', 'utf8')) as { name: string };

async function save(page: Page): Promise<{ path: string; name: string }> {
  const downloading = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  await passPhysicsBlock(page);
  const path = (await (await downloading).path())!;
  return { path, name: (JSON.parse(readFileSync(path, 'utf8')) as { name: string }).name };
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`демо → переименовать в шапке → сохранить → открыть заново (${viewport.width})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Демо', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Исходный демо-план' }).click();

    const title = page.getByRole('button', { name: `Переименовать план «${before.name}»` });
    await expect(title).toBeVisible();
    await expect(page.locator('.shell__doc-state [role="status"]')).toHaveText('Сохранено в файл');

    await title.click();
    const input = page.getByLabel('Новое название плана');
    await expect(input).toBeFocused();
    await input.fill('ОПС 115534 — перепланировка');
    await input.press('Enter');

    const renamed = page.getByRole('button', { name: 'Переименовать план «ОПС 115534 — перепланировка»' });
    await expect(renamed).toBeFocused();
    await expect(page.locator('.shell__doc-state [role="status"]')).toHaveText('Есть несохранённые правки');

    // The header still fits one row: the file group ends inside the bar.
    const bar = (await page.locator('.shell__bar').boundingBox())!;
    const files = (await page.getByRole('group', { name: 'Файл плана' }).boundingBox())!;
    expect(files.x + files.width).toBeLessThanOrEqual(viewport.width);
    expect(files.y + files.height).toBeLessThanOrEqual(bar.y + bar.height);

    const saved = await save(page);
    expect(saved.name).toBe('ОПС 115534 — перепланировка');
    await expect(page.locator('.shell__doc-state [role="status"]')).toHaveText('Сохранено в файл');

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Демо', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Исходный демо-план' }).click();
    await expect(page.getByRole('button', { name: `Переименовать план «${before.name}»` })).toBeVisible();

    await page.getByTestId('plan-file-input').setInputFiles(saved.path);
    await expect(renamed).toBeVisible();
  });
}

test('Esc отменяет, пустое название не уходит в план', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Исходный демо-план' }).click();
  const title = page.getByRole('button', { name: `Переименовать план «${before.name}»` });

  await title.click();
  await page.getByLabel('Новое название плана').fill('Черновик');
  await page.getByLabel('Новое название плана').press('Escape');
  await expect(title).toBeFocused();

  await title.click();
  await page.getByLabel('Новое название плана').fill('   ');
  await page.getByLabel('Новое название плана').press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'У плана должно быть название.' })).toBeVisible();
  await page.getByLabel('Новое название плана').press('Escape');
  await expect(title).toBeVisible();
  await expect(page.locator('.shell__doc-state [role="status"]')).toHaveText('Сохранено в файл');
});

import { readFileSync } from 'node:fs';
import { test, expect, exportPlan, passPhysicsBlock, type Page } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';

async function caption(page: Page, id: string): Promise<string | null> {
  return page.evaluate((id) => {
    type Node = { findOne(selector: string): Node | undefined; textArr?: { text: string }[] };
    const stage = (window as unknown as { Konva: { stages: Node[] } }).Konva.stages[0]!;
    const text = stage.findOne(`.label-${id}`)?.findOne('Text');
    return text?.textArr?.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim() ?? null;
  }, id);
}

for (const width of [1280, 1440]) {
  test(`бирки демо сохраняют номера при вписывании и увеличении (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Демо', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Исходный демо-план' }).click();
    await expect(page.getByTestId('files-notice')).toContainText('учебное отделение');
    for (const [id, expected] of [['eq_13', 'Рабочее место 1'], ['eq_14', 'Рабочее место 2'],
      ['eq_15', 'Рабочее место 3'], ['eq_41', 'Стеллаж посылок 1'],
      ['eq_42', 'Стеллаж посылок 2'], ['eq_43', 'Стеллаж посылок 3'],
      ['eq_6', 'Скамья ожидания 1']]) {
      if (['eq_41', 'eq_42', 'eq_43'].includes(id!)) {
        await expect.poll(() => caption(page, id!)).toMatch(new RegExp(`^(Стеллаж посылок|Посылки) ${expected!.slice(-1)}$`));
      } else await expect.poll(() => caption(page, id!)).toBe(expected);
    }
    if (process.env.SAVE_LABEL_SNAPSHOTS === '1') {
      await page.screenshot({ path: `docs/verification/2026-10-02-plan-labels-${width}.png` });
    }
    const canvas = page.locator('.editor-canvas canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Нет холста');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => caption(page, 'eq_41')).toBe('Стеллаж посылок 1');
    // At a small scale captions yield to icons; they must return when refitted.
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => caption(page, 'eq_41')).toBeNull();
    await page.getByRole('button', { name: 'Вписать', exact: true }).click();
    await expect.poll(() => caption(page, 'eq_41')).toMatch(/^(Стеллаж посылок|Посылки) 1$/);
    const downloading = page.waitForEvent('download');
    await exportPlan(page, 'JSON'); await passPhysicsBlock(page);
    const path = await (await downloading).path();
    const original = JSON.parse(readFileSync('demo/before.json', 'utf8'));
    expect(JSON.parse(readFileSync(path!, 'utf8'))).toEqual(original);
    await page.getByTestId('plan-file-input').setInputFiles(path!);
    await expect.poll(() => caption(page, 'eq_41')).toMatch(/^(Стеллаж посылок|Посылки) 1$/);
    const svgDownloading = page.waitForEvent('download');
    await exportPlan(page, 'SVG'); await passPhysicsBlock(page);
    const svgPath = await (await svgDownloading).path();
    expect(readFileSync(svgPath!, 'utf8')).toContain('Стеллаж посылок 1');
    await expandInventoryRows(page);
    await page.getByLabel('Инвентаризация').locator('.table__link')
      .filter({ hasText: /^Рабочее место оператора 1$/ }).click();
    const name = page.getByLabel('Название', { exact: true });
    await name.fill('Рабочее место оператора 12');
    await name.press('Tab');
    await expect.poll(() => caption(page, 'eq_13')).toBe('Рабочее место 12');
    const editedDownloading = page.waitForEvent('download');
    await exportPlan(page, 'JSON'); await passPhysicsBlock(page);
    const editedPath = await (await editedDownloading).path();
    const edited = JSON.parse(readFileSync(editedPath!, 'utf8'));
    original.objects.find((item: { id: string }) => item.id === 'eq_13').label = 'Рабочее место оператора 12';
    expect(edited).toEqual(original);
    await page.getByTestId('plan-file-input').setInputFiles(editedPath!);
    await expect.poll(() => caption(page, 'eq_13')).toBe('Рабочее место 12');
  });
}

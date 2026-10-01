import { readFileSync } from 'node:fs';
import { test, expect, exportPlan, type Page } from './fixtures';
import type { PlanDocument } from '../../src/contracts/model';

async function saved(page: Page) {
  const pending = page.waitForEvent('download'); await exportPlan(page, 'JSON');
  const path = (await (await pending).path())!;
  return { path, plan: JSON.parse(readFileSync(path, 'utf8')) as PlanDocument };
}
async function point(page: Page, x: number, y: number) {
  const box = (await page.locator('.editor-canvas canvas').first().boundingBox())!;
  const v = (await page.getByTestId('editor-canvas').getAttribute('data-visible'))!.split(',').map(Number);
  return { x: box.x + (x-v[0]!)/(v[2]!-v[0]!)*box.width, y: box.y + (v[3]!-y)/(v[3]!-v[1]!)*box.height };
}
async function handle(page: Page, name: string) {
  return page.evaluate((name) => {
    type Node = { findOne(s: string): Node | undefined; getAbsolutePosition(): {x:number;y:number} };
    const stage = (window as unknown as {Konva: {stages: Node[]}}).Konva.stages[0]!;
    const node = stage.findOne('.'+name);
    return node?.getAbsolutePosition() ?? null;
  }, name);
}
async function drag(page: Page, name: string, to: {x:number;y:number}, escape = false) {
  const h = await handle(page, name); expect(h).not.toBeNull();
  const box = (await page.locator('.editor-canvas canvas').first().boundingBox())!;
  await page.mouse.move(box.x+h!.x, box.y+h!.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, {steps:8});
  if (escape) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('ширина проёма мышью: другая грань фиксирована, Escape, undo и JSON сохраняют геометрию', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await page.goto('/');
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const original = (await saved(page)).plan;
  const opening = original.openings[0]!; const wall = original.walls.find(w=>w.id===opening.wallId)!;
  const length = Math.hypot(wall.to[0]-wall.from[0],wall.to[1]-wall.from[1]);
  const at = async (along:number) => point(page,wall.from[0]+(wall.to[0]-wall.from[0])*along/length, wall.from[1]+(wall.to[1]-wall.from[1])*along/length);
  const centre = await at(opening.offset_m+opening.width_m/2); await page.mouse.click(centre.x,centre.y);
  await expect.poll(()=>handle(page,'opening-resize-end')).not.toBeNull();
  await drag(page,'opening-resize-end',await at(opening.offset_m+opening.width_m+0.5));
  const changed = await saved(page); const resized = changed.plan.openings[0]!;
  expect(resized.offset_m).toBeCloseTo(opening.offset_m,6); // Browser drag starts at integer pixels; allow one pixel at fitted scale.
  expect(Math.abs(resized.width_m-opening.width_m-0.5)).toBeLessThanOrEqual(0.02);
  await drag(page,'opening-resize-start',await at(opening.offset_m+0.3),true);
  expect((await saved(page)).plan.openings).toEqual(changed.plan.openings);
  await page.keyboard.press('Control+z'); expect((await saved(page)).plan.openings).toEqual(original.openings);
  await page.getByTestId('plan-file-input').setInputFiles(changed.path);
  expect((await saved(page)).plan.openings).toEqual(changed.plan.openings);
  if (process.env.UPDATE_SNAPSHOTS==='1') {
    await page.mouse.click(centre.x,centre.y);
    await page.screenshot({path:'docs/verification/2026-10-01-opening-handles.png'});
  }
});

test('расширение в соседнюю дверь отклоняется, перемещение центра и границы стены работают', async ({page}) => {
  await page.goto('/'); await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const fixture = (await saved(page)).plan; const opening = fixture.openings[0]!;
  const wall = fixture.walls.find(w=>w.id===opening.wallId)!;
  const length = Math.hypot(wall.to[0]-wall.from[0],wall.to[1]-wall.from[1]);
  opening.offset_m=1; opening.width_m=1;
  fixture.openings.push({...opening,id:'test-neighbour-door',offset_m:3});
  await page.getByTestId('plan-file-input').setInputFiles({name:'two-doors.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  const at = async (along:number) => point(page,wall.from[0]+(wall.to[0]-wall.from[0])*along/length,wall.from[1]+(wall.to[1]-wall.from[1])*along/length);
  const centre=await at(1.5); await page.mouse.click(centre.x,centre.y);
  await expect.poll(()=>handle(page,'opening-resize-end')).not.toBeNull();
  await drag(page,'opening-resize-end',await at(3.5));
  await expect(page.getByTestId('plan-tools-notice')).toContainText('наложился');
  expect((await saved(page)).plan.openings).toEqual(fixture.openings);
  // The centre grip moves both edges as one gesture.
  const c=await at(1.5); await page.mouse.move(c.x,c.y); await page.mouse.down();
  const target=await at(0.6); await page.mouse.move(target.x,target.y,{steps:8}); await page.mouse.up();
  expect((await saved(page)).plan.openings[0]!.offset_m).toBeCloseTo(0.1,2);
  await drag(page,'opening-resize-start',await at(-1));
  expect((await saved(page)).plan.openings[0]!.offset_m).toBe(0);
});

 test('ручки остаются различимыми при увеличении и уменьшении масштаба', async ({page}) => {
  await page.goto('/'); await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const document=(await saved(page)).plan; const opening=document.openings[0]!;
  const wall=document.walls.find(w=>w.id===opening.wallId)!;
  const length=Math.hypot(wall.to[0]-wall.from[0],wall.to[1]-wall.from[1]);
  const along=opening.offset_m+opening.width_m/2;
  const centre=await point(page,wall.from[0]+(wall.to[0]-wall.from[0])*along/length,wall.from[1]+(wall.to[1]-wall.from[1])*along/length);
  await page.mouse.click(centre.x,centre.y);
  for (const delta of [-250,500]) {
    await page.mouse.move(centre.x,centre.y); await page.mouse.wheel(0,delta);
    await expect.poll(async()=> {
      const a=await handle(page,'opening-resize-start'); const b=await handle(page,'opening-resize-end');
      return a&&b ? Math.hypot(a.x-b.x,a.y-b.y):0;
    }).toBeGreaterThan(24);
  }
  expect((await saved(page)).plan.openings).toEqual(document.openings);
});

test('предпросмотр и подтверждение: клик не режет стену, Escape и смена инструмента сохраняют план', async ({page})=>{
  await page.goto('/');await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const original=(await saved(page)).plan;
  await page.getByRole('button',{name:'Проём',exact:true}).click();
  const controls=page.getByRole('region',{name:'Создание проёма'});
  const target=await point(page,2,9);await page.mouse.move(target.x,target.y);
  await expect(controls.getByRole('button',{name:'Установить проём'})).toBeDisabled();
  await page.mouse.click(target.x,target.y);
  await expect(controls.getByRole('button',{name:'Установить проём'})).toBeEnabled();
  expect((await saved(page)).plan.openings).toEqual(original.openings);
  if(process.env.UPDATE_SNAPSHOTS==='1') await page.screenshot({path:'docs/verification/2026-10-01-opening-preview.png'});
  await page.keyboard.press('Escape');
  await expect(controls.getByRole('button',{name:'Установить проём'})).toBeDisabled();
  await page.mouse.click(target.x,target.y);
  await page.getByRole('button',{name:'Выбор',exact:true}).click();
  expect((await saved(page)).plan.openings).toEqual(original.openings);
  await page.getByRole('button',{name:'Проём',exact:true}).click();
  await page.mouse.click(target.x,target.y);
  await controls.getByLabel('Вид проёма').selectOption('window');
  await controls.getByLabel('Ширина проёма, м').fill('1.1');
  await controls.getByRole('button',{name:'Установить проём'}).click();
  const result=await saved(page);const added=result.plan.openings.find(o=>!original.openings.some(old=>old.id===o.id))!;
  expect(added.kind).toBe('window');expect(added.width_m).toBe(1.1);
  await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id',added.id);
  await expect.poll(()=>handle(page,'opening-resize-end')).not.toBeNull();
  expect(result.plan.walls).toEqual(original.walls);
  await page.keyboard.press('Control+z');expect((await saved(page)).plan.openings).toEqual(original.openings);
  await page.getByTestId('plan-file-input').setInputFiles(result.path);
  expect((await saved(page)).plan.openings).toEqual(result.plan.openings);
});

test('новый проём поверх входа отклоняется ещё до применения',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('editor-canvas')).toBeVisible();
 const original=(await saved(page)).plan;const o=original.openings[0]!;const w=original.walls.find(w=>w.id===o.wallId)!;
 const length=Math.hypot(w.to[0]-w.from[0],w.to[1]-w.from[1]);const along=o.offset_m+o.width_m/2;
 const target=await point(page,w.from[0]+(w.to[0]-w.from[0])*along/length,w.from[1]+(w.to[1]-w.from[1])*along/length);
 await page.getByRole('button',{name:'Проём',exact:true}).click();await page.mouse.click(target.x,target.y);
 const controls=page.getByRole('region',{name:'Создание проёма'});
 await expect(controls).toContainText('другой проём');await expect(controls.getByRole('button',{name:'Установить проём'})).toBeDisabled();
 expect((await saved(page)).plan.openings).toEqual(original.openings);
});

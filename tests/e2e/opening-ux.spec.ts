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
  const target=await at(1.1); await page.mouse.move(target.x,target.y,{steps:8}); await page.mouse.up();
  expect((await saved(page)).plan.openings[0]!.offset_m).toBeCloseTo(0.6,2);
  await drag(page,'opening-resize-start',await at(-1));
  await expect(page.locator('.shell__error')).toContainText('другая стена');
  expect((await saved(page)).plan.openings[0]!.offset_m).toBeCloseTo(0.6,2);
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
  await controls.getByLabel('Ширина проёма, м').focus();
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

test('отмена подготовленного проёма сохраняет ранее установленную дверь',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('editor-canvas')).toBeVisible();
 const original=(await saved(page)).plan;
 const controls=page.getByRole('region',{name:'Создание проёма'});
 await page.getByRole('button',{name:'Проём',exact:true}).click();
 const first=await point(page,2,9);await page.mouse.click(first.x,first.y);
 await controls.getByRole('button',{name:'Установить проём'}).click();
 const installed=(await saved(page)).plan;
 expect(installed.openings).toHaveLength(original.openings.length+1);
 for(const action of ['button','shortcut']) {
  await page.getByRole('button',{name:'Проём',exact:true}).click();
  const second=await point(page,8,9);await page.mouse.click(second.x,second.y);
  await expect(controls.getByRole('button',{name:'Установить проём'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Вернуть',exact:true})).toBeDisabled();
  await page.keyboard.press('Control+y');
  expect((await saved(page)).plan.openings).toEqual(installed.openings);
  if(action==='button')await page.getByRole('button',{name:'Отменить',exact:true}).click();
  else await page.keyboard.press('Control+z');
  await expect(controls.getByRole('button',{name:'Установить проём'})).toBeDisabled();
  expect((await saved(page)).plan.openings).toEqual(installed.openings);
  await page.getByRole('button',{name:'Выбор',exact:true}).click();
 }
 await page.keyboard.press('Control+z');expect((await saved(page)).plan.openings).toEqual(original.openings);
 await page.keyboard.press('Control+y');expect((await saved(page)).plan.openings).toEqual(installed.openings);
});

test('Escape в координатах предмета сбрасывает поле, сохраняя черновик проёма',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('editor-canvas')).toBeVisible();
 const fixture=(await saved(page)).plan;const type=fixture.catalog.objectTypes.find(type=>type.physical)!;
 fixture.objects=[{id:'escape-item',typeId:type.id,label:'Предмет для отмены координат',position:[4,4],size_m:[0.4,0.4],rotation_deg:0,base_m:0,height_m:1,zoneId:null,layerId:fixture.layers[0]!.id,attributes:{}}];
 await page.getByTestId('plan-file-input').setInputFiles({name:'escape-field.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 const item=await point(page,4,4);await page.mouse.click(item.x,item.y);
 await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id','escape-item');
 await page.getByRole('button',{name:'Проём',exact:true}).click();
 const wall=await point(page,2,9);await page.mouse.click(wall.x,wall.y);
 const apply=page.getByRole('region',{name:'Создание проёма'}).getByRole('button',{name:'Установить проём'});
 await expect(apply).toBeEnabled();
 const x=page.getByLabel('Свойства').getByLabel('X, м');await x.fill('5');await x.press('Escape');
 await expect(x).toHaveValue('4');await expect(apply).toBeEnabled();
 expect((await saved(page)).plan.objects).toEqual(fixture.objects);
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

test('сужение проёма ручкой и полем не замуровывает предмет в проходе',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('editor-canvas')).toBeVisible();
 const fixture=(await saved(page)).plan;const opening=fixture.openings[0]!;const wall={id:'interior-door-wall',from:[0,4] as [number,number],to:[12,4] as [number,number],height_m:3,thickness_m:0.2};fixture.walls.push(wall);opening.wallId=wall.id;
 opening.offset_m=2;opening.width_m=2;
 const type=fixture.catalog.objectTypes.find(type=>type.physical)!;
 const length=Math.hypot(wall.to[0]-wall.from[0],wall.to[1]-wall.from[1]);
 const at=(along:number):[number,number]=>[wall.from[0]+(wall.to[0]-wall.from[0])*along/length,wall.from[1]+(wall.to[1]-wall.from[1])*along/length];
 fixture.objects=[{id:'passage-object',typeId:type.id,label:'Предмет в проходе',position:at(3.5),size_m:[0.25,0.25],rotation_deg:0,base_m:0,height_m:1,zoneId:null,layerId:fixture.layers[0]!.id,attributes:{}}];
 await page.getByTestId('plan-file-input').setInputFiles({name:'occupied-door.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 const centre=await point(page,...at(3));await page.mouse.click(centre.x,centre.y);
 await expect.poll(()=>handle(page,'opening-resize-end')).not.toBeNull();
 await drag(page,'opening-resize-end',await point(page,...at(3.1)));
 await expect(page.locator('.shell__error')).toContainText('стена перекрывает оборудование');
 expect((await saved(page)).plan.openings).toEqual(fixture.openings);
 const card=page.getByLabel('Свойства');await card.getByLabel('Ширина, м').fill('1');
 await expect(card.locator('.props__error')).toContainText('стена перекрывает оборудование');
 if(process.env.UPDATE_SNAPSHOTS==='1') await page.screenshot({path:'docs/verification/2026-10-01-opening-blocked.png'});
 expect((await saved(page)).plan.openings).toEqual(fixture.openings);
 await card.getByLabel('Ширина, м').fill('2.5');
 const result=await saved(page);expect(result.plan.openings[0]!.width_m).toBe(2.5);
 await page.getByTestId('plan-file-input').setInputFiles(result.path);
 expect((await saved(page)).plan.openings).toEqual(result.plan.openings);
});

test('удаление занятого проёма отказано; после перемещения предмета можно удалить и отменить',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('editor-canvas')).toBeVisible();
 const fixture=(await saved(page)).plan;const wall={id:'interior-delete-wall',from:[0,4] as [number,number],to:[12,4] as [number,number],height_m:3,thickness_m:0.2};
 fixture.walls.push(wall);
 fixture.openings.push({id:'occupied-door',wallId:wall.id,kind:'door',offset_m:2,width_m:2,sill_m:0,height_m:2.1});
 const type=fixture.catalog.objectTypes.find(type=>type.physical)!;
 fixture.objects=[{id:'door-item',typeId:type.id,label:'Предмет в двери',position:[3.5,4],size_m:[0.25,0.25],rotation_deg:0,base_m:0,height_m:1,zoneId:null,layerId:fixture.layers[0]!.id,attributes:{}}];
 await page.getByTestId('plan-file-input').setInputFiles({name:'delete-door.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 const door=await point(page,3,4);await page.mouse.click(door.x,door.y);
 await page.getByRole('button',{name:'Удалить проём',exact:true}).click();
 await expect(page.locator('.shell__error')).toContainText('Нельзя удалить проём');
 expect((await saved(page)).plan.openings).toEqual(fixture.openings);
 await page.keyboard.press('Delete');expect((await saved(page)).plan.openings).toEqual(fixture.openings);
 // Move the item into the room, then deletion can legitimately restore the wall.
 const item=await point(page,3.5,4);await page.mouse.click(item.x,item.y);
 const card=page.getByLabel('Свойства');await card.getByLabel('Y, м', {exact:true}).fill('5');
 await card.getByRole('button',{name:'Применить координаты',exact:true}).click();
 const target=await point(page,3,4);await page.mouse.click(target.x,target.y);
 await page.getByRole('button',{name:'Удалить проём',exact:true}).click();
 expect((await saved(page)).plan.openings.some(o=>o.id==='occupied-door')).toBe(false);
 await page.keyboard.press('Control+z');const undone=await saved(page);
 expect(undone.plan.openings).toEqual(fixture.openings);
 await page.getByTestId('plan-file-input').setInputFiles(undone.path);
 expect((await saved(page)).plan.openings).toEqual(fixture.openings);
});

import {readFileSync} from 'node:fs';
import {test,expect,exportPlan} from './fixtures';
import type {PlanDocument} from '../../src/contracts/model';

test('комната получает выбранные имя и назначение до применения; undo и JSON сохраняют результат',async({page})=>{
  await page.setViewportSize({width:1280,height:720}); await page.goto('/');
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const save=async()=>{const pending=page.waitForEvent('download');await exportPlan(page,'JSON');const path=(await(await pending).path())!;return {path,plan:JSON.parse(readFileSync(path,'utf8')) as PlanDocument};};
  const click=async(x:number,y:number)=>{const box=(await page.locator('.editor-canvas canvas').first().boundingBox())!;const v=(await page.getByTestId('editor-canvas').getAttribute('data-visible'))!.split(',').map(Number);await page.mouse.click(box.x+(x-v[0]!)/(v[2]!-v[0]!)*box.width,box.y+(v[3]!-y)/(v[3]!-v[1]!)*box.height);};
  const original=(await save()).plan;
  const type=original.catalog.zoneTypes.find(entry=>/хранени|склад/i.test(entry.label))!;
  expect(type).toBeDefined();
  await page.getByRole('button',{name:'Помещение',exact:true}).click();
  const controls=page.getByRole('region',{name:'Создание комнаты'});
  await controls.getByLabel('Название комнаты').fill('  Склад посылок  ');
  await controls.getByLabel('Назначение комнаты').selectOption(type.id);
  await click(0.04,0.04);await click(4,4);
  for(const field of ['Название комнаты','Назначение комнаты']) {
    await controls.getByLabel(field).press('Escape');
    await expect(controls).toContainText('Нажмите первый угол комнаты');
    expect((await save()).plan.walls).toEqual(original.walls);
    await click(0.04,0.04);await click(4,4);
  }
  expect((await save()).plan.zones).toEqual(original.zones);
  await controls.getByLabel('Название комнаты').fill(' ');
  await expect(controls.getByRole('button',{name:'Создать комнату'})).toBeDisabled();
  await expect(controls).toContainText('Укажите название');
  await controls.getByLabel('Название комнаты').fill('  Склад посылок  ');
  await controls.getByLabel('Название комнаты').press('Enter');
  expect((await save()).plan.walls).toEqual(original.walls);
  if(process.env.UPDATE_SNAPSHOTS==='1')await page.screenshot({path:'docs/verification/2026-10-02-room-details.png'});
  await controls.getByRole('button',{name:'Создать комнату'}).click();
  const changed=await save();
  expect(changed.plan.zones.at(-1)).toMatchObject({name:'Склад посылок',typeId:type.id});
  expect(changed.plan.walls.slice(0,original.walls.length)).toEqual(original.walls);
  expect(changed.plan.openings).toEqual(original.openings);
  await page.keyboard.press('Control+z');expect((await save()).plan.walls).toEqual(original.walls);
  await page.keyboard.press('Control+y');expect((await save()).plan.zones).toEqual(changed.plan.zones);
  await page.getByTestId('plan-file-input').setInputFiles(changed.path);
  expect((await save()).plan.zones).toEqual(changed.plan.zones);
});

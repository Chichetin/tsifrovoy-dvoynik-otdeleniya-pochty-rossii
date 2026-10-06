import { readFileSync } from 'node:fs';
import { test, expect as baseExpect, exportPlan } from './fixtures';
import type { PlanDocument } from '../../src/contracts/model';

// Первый кадр без GPU (SwiftShader) собирает шейдеры 7-12 с: предел в 5 с ловит медленный старт, не поломку.
const expect = baseExpect.configure({ timeout: 60_000 });
test.describe.configure({ timeout: 180_000 });

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('ошибка загрузки 3D восстанавливается без потери правок и JSON', async ({page}) => {
 await page.goto('/'); await expect(page.getByTestId('editor-canvas')).toBeVisible();
 await page.locator('.library__item').first().click();
 await page.getByTestId('editor-canvas').click({position:{x:320,y:240}});
 await page.getByRole('button',{name:'Выбор',exact:true}).click();
 const save=async()=>{
  const pending=page.waitForEvent('download');await exportPlan(page,'JSON');
  const path=(await (await pending).path())!;
  return {path,plan:JSON.parse(readFileSync(path,'utf8')) as PlanDocument};
 };
 const changed=await save();expect(changed.plan.objects.length).toBeGreaterThan(0);
 const module=/(?:\/src\/features\/view3d\/View3DCanvas\.tsx|\/assets\/View3DCanvas-[\w-]+\.js)(?:\?|$)/;
 await page.route(module,route=>route.abort());
 await page.getByRole('button',{name:'3D',exact:true}).click();
 await expect(page.getByTestId('view3d-error')).toBeVisible();
 const retry=page.getByRole('button',{name:'Повторить загрузку 3D',exact:true});
 await expect(retry).toBeVisible();
 await retry.click(); // A second failure must remain an honest failure.
 await expect(page.getByTestId('view3d-error')).toBeVisible();
 expect((await save()).plan).toEqual(changed.plan);
 if(process.env.UPDATE_SNAPSHOTS==='1') await page.screenshot({path:'docs/verification/2026-10-02-3d-load-error.png'});
 await page.unroute(module);
 await retry.focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('view3d-canvas')).toBeVisible();
 await expect(page.getByTestId('view3d-error')).toHaveCount(0);
 expect(await page.getByTestId('view3d-canvas').evaluate(canvas=>{
  const gl=(canvas as HTMLCanvasElement).getContext('webgl2') ?? (canvas as HTMLCanvasElement).getContext('webgl');
  return gl!==null&&!gl.isContextLost();
 })).toBe(true);
 expect((await save()).plan).toEqual(changed.plan);
 await page.getByRole('button',{name:'2D',exact:true}).click();
 await page.getByTestId('plan-file-input').setInputFiles(changed.path);
 expect((await save()).plan).toEqual(changed.plan);
 await page.getByRole('button',{name:'3D',exact:true}).click();
 await expect(page.getByTestId('view3d-canvas')).toBeVisible();
 if(process.env.UPDATE_SNAPSHOTS==='1') {
  await page.screenshot({path:'docs/verification/2026-10-02-3d-recovered.png'});
 }
});

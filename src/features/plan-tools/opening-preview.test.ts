import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { openingPreview } from './opening-preview';
function plan():PlanDocument {
 const p=JSON.parse(readFileSync('demo/after.json','utf8')) as PlanDocument;
 return {...p,objects:[],openings:[],walls:[{id:'w',from:[0,0],to:[6,0],thickness_m:0.2,height_m:3}]};
}
it('строит только кандидат, с видом/шириной/retired id и ограничением стены',()=>{
 const p=plan();const before=JSON.stringify(p);
 const result=openingPreview(p,[5.9,0],'window',1.1,new Set(['op_1']));
 expect(result.message).toBeNull();expect(result.opening).toMatchObject({id:'op_2',kind:'window',width_m:1.1,sill_m:0.9});
 expect(result.opening!.offset_m+1.1).toBeLessThanOrEqual(6);expect(JSON.stringify(p)).toBe(before);
});
it('показывает отказ промаха, неверной ширины, слишком низкой стены и наложения',()=>{
 const p=plan();expect(openingPreview(p,[3,4],'door',0.9).opening).toBeNull();
 for(const width of [0,-1,NaN,7]) expect(openingPreview(p,[3,0],'door',width).message).not.toBeNull();
 p.walls[0]!.height_m=1;expect(openingPreview(p,[3,0],'door',0.9).message).toContain('Высота');p.walls[0]!.height_m=3;
 p.openings=[openingPreview(p,[3,0],'door',0.9).opening!];
 expect(openingPreview(p,[3,0],'door',0.9).message).toContain('другой проём');
 expect(openingPreview(p,[5,0],'door',0.9).message).toBeNull();
});
it('узкая дверь на короткой стене не зависит от ширины по умолчанию',()=>{
 const p=plan();p.walls[0]!.to=[0.5,0];
 expect(openingPreview(p,[0.25,0],'door',0.3).message).toBeNull();
});

it('не предлагает прорезать проём через физический предмет на его высоте',()=>{
 const p=plan();const demo=JSON.parse(readFileSync('demo/after.json','utf8')) as PlanDocument;
 const object={...demo.objects[0]!,position:[3,0] as [number,number],rotation_deg:0,base_m:0,height_m:1};
 p.objects=[object];expect(openingPreview(p,[3,0],'door',0.9).message).toContain('оборудование');
 object.base_m=2.5;object.height_m=0.2;expect(openingPreview(p,[3,0],'door',0.9).message).toBeNull();
});

it('отказывает на торце другой стены, учитывает её проёмы и высоту',()=>{
 const p=plan();p.walls.push({id:'cross',from:[3,0],to:[3,4],thickness_m:0.1,height_m:3});
 expect(openingPreview(p,[3,0],'door',0.9).message).toContain('другая стена');
 p.openings=[{id:'cross-door',wallId:'cross',kind:'door',offset_m:0,width_m:1,height_m:2.2,sill_m:0}];
 expect(openingPreview(p,[3,0],'door',0.9).message).toBeNull();
 p.openings=[];p.walls[1]!.height_m=0.5;
 expect(openingPreview(p,[3,0],'window',1.2).message).toBeNull();
});

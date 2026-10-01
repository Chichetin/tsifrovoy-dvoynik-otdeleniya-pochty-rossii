import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import type {PlanDocument} from '../../contracts/model';
import {openingEditRejection} from './opening-edit-rejection';
function fixture(){
 const plan=JSON.parse(readFileSync('demo/after.json','utf8')) as PlanDocument;
 plan.walls=[{id:'wall',from:[0,0],to:[6,0],height_m:3,thickness_m:0.2}];
 plan.openings=[{id:'door',wallId:'wall',kind:'door',offset_m:2,width_m:2,height_m:2.1,sill_m:0}];
 plan.objects=[{...plan.objects[0]!,position:[3.5,0],size_m:[0.3,0.3],rotation_deg:0,base_m:0,height_m:1}];
 return plan;
}
it('сужение и перенос не восстанавливают стену внутри предмета в проёме',()=>{
 const p=fixture();const o=p.openings[0]!;
 expect(openingEditRejection(p,{...o,width_m:1})?.message).toContain('оборудование');
 expect(openingEditRejection(p,{...o,offset_m:0})?.message).toContain('оборудование');
 expect(openingEditRejection(p,{...o,width_m:2.5})).toBeNull();
});
it('поднятое оборудование и прежняя ошибка стены не блокируют правку',()=>{
 const p=fixture();const o=p.openings[0]!;
 p.objects[0]!.base_m=2.5;p.objects[0]!.height_m=0.2;
 // It already overlaps the solid wall above the original door.
 expect(openingEditRejection(p,{...o,width_m:1})).toBeNull();
 p.objects[0]!.base_m=0;p.objects[0]!.position=[1,0];
 expect(openingEditRejection(p,{...o,width_m:1})).toBeNull();
});
it('новый выход за торец и наложение отклоняются, старый invalid план можно исправлять',()=>{
 const p=fixture();p.objects=[];const o=p.openings[0]!;
 expect(openingEditRejection(p,{...o,offset_m:5})?.message).toContain('конец стены');
 p.openings.push({...o,id:'next',offset_m:4.5,width_m:1});
 expect(openingEditRejection(p,{...o,width_m:3})?.message).toContain('наложился');
 o.offset_m=7;expect(openingEditRejection(p,{...o,offset_m:6.5})).toBeNull();
});

it('новый торец другой стены отклоняется, прежний blocked проём и gap в другой стене допускаются',()=>{
 const p=fixture();p.objects=[];const door=p.openings[0]!;door.offset_m=0.55;door.width_m=0.9;
 p.walls.push({id:'cross',from:[3,0],to:[3,4],thickness_m:0.1,height_m:3});
 expect(openingEditRejection(p,{...door,offset_m:2.55})?.message).toContain('другая стена');
 p.openings.push({...door,id:'cross-door',wallId:'cross',offset_m:0,width_m:1,height_m:2.2});
 expect(openingEditRejection(p,{...door,offset_m:2.55})).toBeNull();
 p.openings.pop();door.offset_m=2.55;expect(openingEditRejection(p,{...door,width_m:1})).toBeNull();
});

it('высота не выходит за стену при правке; прежний invalid верх можно снижать',()=>{
 const p=fixture();p.objects=[];const door=p.openings[0]!;
 expect(openingEditRejection(p,{...door,height_m:4})?.message).toContain('Высота');
 door.height_m=5;expect(openingEditRejection(p,{...door,height_m:4})).toBeNull();
});

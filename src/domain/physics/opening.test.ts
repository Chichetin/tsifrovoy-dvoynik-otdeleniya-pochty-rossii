import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import type {Command} from '../../contracts/commands';
import type {Opening,PlanDocument} from '../../contracts/model';
import {applyCommand} from '../commands';
import {editRejection,introducesOpeningOverlap,openingDeleteRejection,openingRejection} from '.';
function fixture(){
 const plan=JSON.parse(readFileSync('demo/after.json','utf8')) as PlanDocument;
 plan.walls=[{id:'wall',from:[0,0],to:[6,0],height_m:3,thickness_m:0.2}];
 plan.openings=[{id:'door',wallId:'wall',kind:'door',offset_m:2,width_m:2,height_m:2.1,sill_m:0}];
 plan.objects=[{...plan.objects[0]!,position:[3.5,0],size_m:[0.3,0.3],rotation_deg:0,base_m:0,height_m:1}];
 return plan;
}
it('сужение и перенос не восстанавливают стену внутри предмета в проёме',()=>{
 const p=fixture();const o=p.openings[0]!;
 expect(openingRejection(p,{...o,width_m:1})?.message).toContain('оборудование');
 expect(openingRejection(p,{...o,offset_m:0})?.message).toContain('оборудование');
 expect(openingRejection(p,{...o,width_m:2.5})).toBeNull();
});
it('поднятое оборудование и прежняя ошибка стены не блокируют правку',()=>{
 const p=fixture();const o=p.openings[0]!;
 p.objects[0]!.base_m=2.5;p.objects[0]!.height_m=0.2;
 // It already overlaps the solid wall above the original door.
 expect(openingRejection(p,{...o,width_m:1})).toBeNull();
 p.objects[0]!.base_m=0;p.objects[0]!.position=[1,0];
 expect(openingRejection(p,{...o,width_m:1})).toBeNull();
});
it('новый выход за торец и наложение отклоняются, старый invalid план можно исправлять',()=>{
 const p=fixture();p.objects=[];const o=p.openings[0]!;
 expect(openingRejection(p,{...o,offset_m:5})?.message).toContain('конец стены');
 p.openings.push({...o,id:'next',offset_m:4.5,width_m:1});
 expect(openingRejection(p,{...o,width_m:3})?.message).toContain('наложился');
 o.offset_m=7;expect(openingRejection(p,{...o,offset_m:6.5})).toBeNull();
});

it('новый торец другой стены отклоняется, прежний blocked проём и gap в другой стене допускаются',()=>{
 const p=fixture();p.objects=[];const door=p.openings[0]!;door.offset_m=0.55;door.width_m=0.9;
 p.walls.push({id:'cross',from:[3,0],to:[3,4],thickness_m:0.1,height_m:3});
 expect(openingRejection(p,{...door,offset_m:2.55})?.message).toContain('другая стена');
 p.openings.push({...door,id:'cross-door',wallId:'cross',offset_m:0,width_m:1,height_m:2.2});
 expect(openingRejection(p,{...door,offset_m:2.55})).toBeNull();
 p.openings.pop();door.offset_m=2.55;expect(openingRejection(p,{...door,width_m:1})).toBeNull();
});

it('высота не выходит за стену при правке; прежний invalid верх можно снижать',()=>{
 const p=fixture();p.objects=[];const door=p.openings[0]!;
 expect(openingRejection(p,{...door,height_m:4})?.message).toContain('Высота');
 door.height_m=5;expect(openingRejection(p,{...door,height_m:4})).toBeNull();
});

it('ошибочный импортированный проём можно исправлять, но нельзя выдвигать ещё дальше за стену',()=>{
 const p=fixture();p.objects=[];const door=p.openings[0]!;
 door.offset_m=5; // Existing end is 7 m on a 6 m wall.
 expect(openingRejection(p,{...door,offset_m:5.5})?.message).toContain('конец стены');
 expect(openingRejection(p,{...door,offset_m:4.5})).toBeNull();
 expect(openingRejection(p,{...door,kind:'window'})).toBeNull();
 door.offset_m=2;door.height_m=4;
 expect(openingRejection(p,{...door,height_m:4.5})?.message).toContain('Высота');
 expect(openingRejection(p,{...door,sill_m:0.5})?.message).toContain('Высота');
 expect(openingRejection(p,{...door,height_m:3.5})).toBeNull();
 expect(openingRejection(p,{...door,kind:'window'})).toBeNull();
});

it('удаление не замуровывает предмет, пустой или дублирующий проём удаляется',()=>{
 const p=fixture();expect(openingDeleteRejection(p,'door')?.message).toContain('переместите предмет');
 p.openings.push({...p.openings[0]!,id:'duplicate'});
 expect(openingDeleteRejection(p,'door')).toBeNull();
 p.openings.pop();p.objects=[];expect(openingDeleteRejection(p,'door')).toBeNull();
 expect(openingDeleteRejection(p,'absent')).toBeNull();
});
it('удаление не блокируется прежней ошибкой стен или нефизической отметкой',()=>{
 const p=fixture();p.objects[0]!.position=[1,0];expect(openingDeleteRejection(p,'door')).toBeNull();
 p.objects[0]!.position=[3.5,0];
 p.catalog.objectTypes.find(type=>type.id===p.objects[0]!.typeId)!.physical=false;
 expect(openingDeleteRejection(p,'door')).toBeNull();
});

it('прежнее частичное пересечение предмета нельзя увеличивать сужением или удалением двери',()=>{
 const p=fixture();const door=p.openings[0]!;
 p.objects[0]!.position=[4.1,0];p.objects[0]!.size_m=[0.6,0.3];
 expect(openingRejection(p,{...door,width_m:1.8})?.message).toContain('оборудование');
 expect(openingDeleteRejection(p,door.id)?.message).toContain('переместите предмет');
 expect(openingRejection(p,{...door,width_m:2.2})).toBeNull();
 expect(openingRejection(p,{...door,kind:'window'})).toBeNull();
});

it('частичное пересечение по высоте допускает ремонт, но не уменьшение свободного объёма',()=>{
 const p=fixture();const door=p.openings[0]!;
 p.objects[0]!.position=[3,0];p.objects[0]!.base_m=1;p.objects[0]!.height_m=1;
 door.height_m=1.5;
 expect(openingRejection(p,{...door,height_m:1.2})?.message).toContain('оборудование');
 expect(openingRejection(p,{...door,height_m:1.8})).toBeNull();
 expect(openingDeleteRejection(p,door.id)?.message).toContain('переместите предмет');
});
it('другой проём сохраняет прежний свободный объём при удалении, повёрнутый предмет учитывается',()=>{
 const p=fixture();const door=p.openings[0]!;
 p.objects[0]!.position=[4.1,0];p.objects[0]!.size_m=[0.6,0.3];p.objects[0]!.rotation_deg=35;
 expect(openingRejection(p,{...door,width_m:1.8})?.message).toContain('оборудование');
 p.openings.push({...door,id:'duplicate'});
 const snapshot=JSON.stringify(p);
 expect(openingDeleteRejection(p,door.id)).toBeNull();
 expect(openingRejection(p,{...door,width_m:1.8})).toBeNull();
 expect(JSON.stringify(p)).toBe(snapshot);
});

it('batch с проёмом проходит ту же проверку, что одиночный opening.put',()=>{
 const p=fixture();p.objects=[];const door=p.openings[0]!;
 p.openings.push({...door,id:'next',offset_m:4.5,width_m:1});
 const wide={...door,width_m:3};
 const single:Command={type:'opening.put',opening:wide};
 const batch:Command={type:'batch',commands:[single]};
 const after=applyCommand(p,batch);
 if(!after.ok)throw new Error('batch must apply before the gate');
 expect(editRejection(p,after.value,batch)?.message).toBe(editRejection(p,after.value,single)?.message);
 expect(editRejection(p,after.value,batch)?.message).toContain('наложился');
});

it('новый проём отклоняется на чужом проёме и на оборудовании',()=>{
 const p=fixture();const door=p.openings[0]!;
 expect(openingRejection(p,{...door,id:'new'})?.message).toContain('наложился');
 p.openings=[];
 expect(openingRejection(p,{...door,id:'new'})?.message).toContain('оборудование');
 p.objects=[];
 expect(openingRejection(p,{...door,id:'new'})).toBeNull();
});

const plain:Opening={id:'door',wallId:'wall',offset_m:2,width_m:1,sill_m:0,height_m:2.1,kind:'door'};
it('отказывает в новом наложении, но допускает касание и правку прежнего наложения',()=>{
 const other={...plain,id:'other',offset_m:4};
 expect(introducesOpeningOverlap({...plain,width_m:3},plain,[plain,other])).toBe(true);
 expect(introducesOpeningOverlap({...plain,width_m:2},plain,[plain,other])).toBe(false);
 expect(introducesOpeningOverlap({...plain,width_m:3},{...plain,width_m:3},[other])).toBe(false);
 expect(introducesOpeningOverlap({...plain,width_m:3},plain,[{...other,sill_m:2.5,height_m:0.3}])).toBe(false);
});

it('прежнее наложение можно уменьшать, но нельзя увеличивать по ширине или высоте',()=>{
 const before={...plain,width_m:2,height_m:1};
 const other={...plain,id:'other',offset_m:3,width_m:2,height_m:2};
 expect(introducesOpeningOverlap({...before,width_m:2.5},before,[before,other])).toBe(true);
 expect(introducesOpeningOverlap({...before,height_m:1.5},before,[other])).toBe(true);
 expect(introducesOpeningOverlap({...before,width_m:1.5},before,[other])).toBe(false);
 expect(introducesOpeningOverlap({...before,height_m:0.5},before,[other])).toBe(false);
 expect(introducesOpeningOverlap({...before,kind:'window'},before,[other])).toBe(false);
 expect(introducesOpeningOverlap({...before,width_m:2.5},before,[{...other,wallId:'another-wall'}])).toBe(false);
});

it('уменьшение общей суммы не разрешает усилить пересечение с отдельным соседом',()=>{
 const before={...plain,offset_m:1,width_m:3};
 const left={...plain,id:'left',offset_m:0,width_m:2};
 const right={...plain,id:'right',offset_m:3.5,width_m:2};
 expect(introducesOpeningOverlap({...before,offset_m:1.7,width_m:2.5},before,[left,right])).toBe(true);
});

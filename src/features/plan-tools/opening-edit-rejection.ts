import type { Issue, Opening, PlanDocument, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';
import { intersects, objectHitsWall, wallLength, wallObstacles, wallSpanPolygon } from '../../domain/geometry';
import { introducesOpeningOverlap } from './opening-edit';

/** Editing a hole can restore solid wall around an object that was inside it. */
export function openingEditRejection(plan: PlanDocument, candidate: Opening): Issue | null {
  const before=plan.openings.find(opening=>opening.id===candidate.id);
  if(before===undefined)return null; // New placement has its own preview preflight.
  const wall=plan.walls.find(wall=>wall.id===candidate.wallId);
  if(wall===undefined)return null; // Structural rejection belongs to the command.
  const values=[candidate.offset_m,candidate.width_m,candidate.height_m,candidate.sill_m];
  if(values.some(value=>!Number.isFinite(value))||candidate.offset_m<0||candidate.width_m<=0||candidate.height_m<=0||candidate.sill_m<0)return null;
  const ref={kind:'opening' as const,id:candidate.id};
  const fail=(message:string,refs:Issue['refs']=[ref]):Issue=>({code:'OPENING_EDIT_BLOCKED',severity:'error',message,refs});
  const length=wallLength(wall);
  if(candidate.width_m>length)return null; // Preserve the existing field-specific command error.
  const beforeWall=plan.walls.find(wall=>wall.id===before.wallId);
  const end=candidate.offset_m+candidate.width_m;
  const oldEndExcess=Math.max(0,before.offset_m+before.width_m-wallLength(beforeWall??wall));
  if(Math.max(0,end-length)>oldEndExcess+TOLERANCE.coordinate_m)
    return fail('Проём выходит за конец стены. Уменьшите отступ или ширину.');
  if(introducesOpeningOverlap(candidate,before,plan.openings))return fail('Проём наложился на другой проём. Выберите свободный участок стены.');
  const limit=Math.min(wall.height_m,plan.room.ceilingHeight_m);
  const oldLimit=Math.min(beforeWall?.height_m??wall.height_m,plan.room.ceilingHeight_m);
  const oldHeightExcess=Math.max(0,before.sill_m+before.height_m-oldLimit);
  if(Math.max(0,candidate.sill_m+candidate.height_m-limit)>oldHeightExcess+TOLERANCE.coordinate_m)
    return fail('Высота проёма выходит за стену или потолок. Уменьшите высоту или отступ от пола.');
  const blockedByWall=(opening:Opening,host:Wall|undefined,other:Wall):boolean=>{
    if(host===undefined||host.id===other.id)return false;
    const polygon=wallSpanPolygon(host,opening.offset_m,opening.offset_m+opening.width_m);
    return wallObstacles(other,plan.openings,{base_m:opening.sill_m,top_m:opening.sill_m+opening.height_m},plan.walls).some(part=>intersects(polygon,part));
  };
  const blockingWall=plan.walls.find(other=>blockedByWall(candidate,wall,other)&&!blockedByWall(before,beforeWall,other));
  if(blockingWall!==undefined)return fail('Проём перекрывает другая стена. Выберите свободный участок.',[ref,{kind:'wall',id:blockingWall.id}]);
  const openings=plan.openings.map(opening=>opening.id===candidate.id?candidate:opening);
  for(const object of plan.objects){
    if(!(findObjectType(plan.catalog,object.typeId)?.physical??true))continue;
    if(objectHitsWall(object,wall,openings,plan.walls)&&!objectHitsWall(object,wall,plan.openings,plan.walls))
      return fail('После изменения проёма стена перекрывает оборудование «'+object.label+'». Переместите предмет или оставьте проход шире.',[ref,{kind:'object',id:object.id},{kind:'wall',id:wall.id}]);
  }
  return null;
}

/** Removing a hole restores solid wall, unless another opening still covers it. */
export function openingDeleteRejection(plan: PlanDocument, id: string): Issue | null {
  const opening = plan.openings.find(opening => opening.id === id);
  if (opening === undefined) return null;
  const wall = plan.walls.find(wall => wall.id === opening.wallId);
  if (wall === undefined) return null;
  const openings = plan.openings.filter(opening => opening.id !== id);
  const blocked = plan.objects.find(object =>
    (findObjectType(plan.catalog, object.typeId)?.physical ?? true) &&
    objectHitsWall(object, wall, openings, plan.walls) &&
    !objectHitsWall(object, wall, plan.openings, plan.walls));
  return blocked === undefined ? null : {
    code: 'OPENING_DELETE_BLOCKED', severity: 'error',
    message: 'Нельзя удалить проём: восстановленная стена перекроет оборудование «' + blocked.label + '». Сначала переместите предмет.',
    refs: [{kind:'opening',id}, {kind:'wall',id:wall.id}, {kind:'object',id:blocked.id}],
  };
}

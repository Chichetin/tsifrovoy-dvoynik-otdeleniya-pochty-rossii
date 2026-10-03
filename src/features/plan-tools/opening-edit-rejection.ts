import * as polyclip from 'polyclip-ts';
import type { Equipment, Issue, Opening, PlanDocument, Polygon, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { findObjectType } from '../../domain/catalog';
import { footprint, intersects, objectHitsWall, polygonArea, wallLength, wallObstacles, wallSpanPolygon } from '../../domain/geometry';
import { introducesOpeningOverlap } from './opening-edit';

/** Slice at every aperture height so a partly obstructed imported object can be repaired. */
function occupiedWallVolume(object: Equipment, wall: Wall, openings: Opening[], walls: Wall[]): number {
  const low=Math.max(0,object.base_m), high=Math.min(wall.height_m,object.base_m+object.height_m);
  if(high-low<=TOLERANCE.coordinate_m)return 0;
  const levels=[low,high,...openings.filter(opening=>opening.wallId===wall.id)
    .flatMap(opening=>[opening.sill_m,opening.sill_m+opening.height_m])
    .filter(height=>height>low&&height<high)].sort((a,b)=>a-b);
  const closed=(polygon:Polygon):polyclip.Geom=>[[[...polygon,polygon[0]!]]];
  const shape=footprint(object);
  let volume=0;
  for(let i=1;i<levels.length;i++){
    const base=levels[i-1]!,top=levels[i]!;
    if(top-base<=TOLERANCE.coordinate_m)continue;
    for(const part of wallObstacles(wall,openings,{base_m:base,top_m:top},walls)){
      if(!intersects(shape,part))continue;
      const clipped=polyclip.intersection(closed(shape),closed(part));
      for(const polygon of clipped)polygon.forEach((ring,index)=>{
        volume+=(index===0?1:-1)*polygonArea(ring)*(top-base);
      });
    }
  }
  return volume;
}

function worsensObjectCollision(object: Equipment, wall: Wall, before: Opening[], after: Opening[], walls: Wall[]): boolean {
  if(!objectHitsWall(object,wall,after,walls))return false;
  if(!objectHitsWall(object,wall,before,walls))return true;
  const tolerance=TOLERANCE.area_m2*Math.max(1,object.height_m);
  return occupiedWallVolume(object,wall,after,walls)>occupiedWallVolume(object,wall,before,walls)+tolerance;
}

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
    const proposedOpenings=plan.openings.map(entry=>entry.id===opening.id?opening:entry);
    return wallObstacles(other,proposedOpenings,{base_m:opening.sill_m,top_m:opening.sill_m+opening.height_m},plan.walls).some(part=>intersects(polygon,part));
  };
  const blockingWall=plan.walls.find(other=>blockedByWall(candidate,wall,other)&&!blockedByWall(before,beforeWall,other));
  if(blockingWall!==undefined)return fail('Проём перекрывает другая стена. Выберите свободный участок.',[ref,{kind:'wall',id:blockingWall.id}]);
  const openings=plan.openings.map(opening=>opening.id===candidate.id?candidate:opening);
  for(const object of plan.objects){
    if(!(findObjectType(plan.catalog,object.typeId)?.physical??true))continue;
    if(worsensObjectCollision(object,wall,plan.openings,openings,plan.walls))
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
    worsensObjectCollision(object,wall,plan.openings,openings,plan.walls));
  return blocked === undefined ? null : {
    code: 'OPENING_DELETE_BLOCKED', severity: 'error',
    message: 'Нельзя удалить проём: восстановленная стена перекроет оборудование «' + blocked.label + '». Сначала переместите предмет.',
    refs: [{kind:'opening',id}, {kind:'wall',id:wall.id}, {kind:'object',id:blocked.id}],
  };
}

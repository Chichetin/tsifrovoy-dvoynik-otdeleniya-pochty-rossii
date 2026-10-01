import type { Id, Opening, OpeningKind, PlanDocument, Point } from '../../contracts/model';
import { nextFreeId, takenIds } from '../../domain/commands';
import { footprint, intersects, intervalsOverlap, objectInterval, wallLength, wallObstacles, wallSpanPolygon } from '../../domain/geometry';
import { findObjectType } from '../../domain/catalog';
import { openingsOverlap } from './opening-edit';
import { moveOpeningTo } from './vertex-edit';
import { nearestWall, OPENING_DEFAULTS } from './wall-draft';

export function openingPreview(plan: PlanDocument, point: Point, kind: OpeningKind, width: number, retired?: ReadonlySet<Id>, chosenWallId?: Id) {
  // Once clicked, the draft belongs to that wall; undo must not redirect it.
  const hit = nearestWall(chosenWallId === undefined ? plan.walls : plan.walls.filter(wall => wall.id === chosenWallId), point);
  if (hit === null && chosenWallId !== undefined) return {opening:null,message:'Выбранная стена изменилась или удалена. Нажмите на стену заново.'};
  if (hit === null) return { opening: null, message: 'Наведите курсор на стену, затем нажмите, чтобы подготовить проём.' };
  if (!Number.isFinite(width) || width <= 0) return { opening: null, message: 'Укажите ширину больше нуля.' };
  const length = wallLength(hit.wall);
  if (width > length) return { opening: null, message: 'Ширина проёма больше длины стены. Уменьшите ширину.' };
  const base: Opening = { id: nextFreeId('op_', takenIds(plan, retired)), wallId: hit.wall.id,
    offset_m: 0, kind, ...OPENING_DEFAULTS[kind] };
  const opening = moveOpeningTo({ ...base, width_m: width }, hit.wall, point);
  const overlap = plan.openings.some(other => openingsOverlap(opening, other));
  if (overlap) return {opening,message:'Здесь уже есть другой проём. Выберите свободный участок стены.'};
  if (opening.sill_m+opening.height_m > Math.min(hit.wall.height_m,plan.room.ceilingHeight_m)) return {opening,message:'Высота выбранного вида проёма больше стены или потолка.'};
  const polygon=wallSpanPolygon(hit.wall,opening.offset_m,opening.offset_m+opening.width_m);
  const interval={base_m:opening.sill_m,top_m:opening.sill_m+opening.height_m};
  if(plan.walls.some(wall=>wall.id!==hit.wall.id&&wallObstacles(wall,plan.openings,interval,plan.walls).some(part=>intersects(polygon,part))))
    return {opening,message:'Проём перекрывает другая стена. Выберите свободный участок.'};
  const blocked=plan.objects.find(object=>(findObjectType(plan.catalog,object.typeId)?.physical ?? true)&&
    intervalsOverlap(objectInterval(object),{base_m:opening.sill_m,top_m:opening.sill_m+opening.height_m})&&intersects(footprint(object),polygon));
  return {opening,message:blocked ? 'Проём перекрывает оборудование «'+blocked.label+'». Сначала переместите предмет или выберите другое место.' : null};
}

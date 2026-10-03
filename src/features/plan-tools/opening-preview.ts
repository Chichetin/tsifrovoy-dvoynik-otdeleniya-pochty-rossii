import type { Id, Opening, OpeningKind, PlanDocument, Point } from '../../contracts/model';
import { nextFreeId, takenIds } from '../../domain/commands';
import { wallLength } from '../../domain/geometry';
import { openingRejection } from '../../domain/physics';
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
  // The store gates the put with the same rule: the preview only says it first.
  return { opening, message: openingRejection(plan, opening)?.message ?? null };
}

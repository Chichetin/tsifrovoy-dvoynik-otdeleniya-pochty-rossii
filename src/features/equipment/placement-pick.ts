import type { Equipment, PlanDocument, Point } from '../../contracts/model';
import { footprint, locatePoint, pointSegmentDistance } from '../../domain/geometry';

/** A near miss should feel like the same target at every zoom level. */
export const PLACEMENT_PICK_TOLERANCE_PX = 8;

function distanceToObject(point: Point, object: Equipment): number {
  const polygon = footprint(object);
  if (locatePoint(point, polygon) !== 'outside') return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(
      distance,
      pointSegmentDistance(point, polygon[index]!, polygon[(index + 1) % polygon.length]!),
    );
  }
  return distance;
}

export function findPlacementPick(
  plan: PlanDocument,
  typeId: string,
  point: Point,
  scale: number,
): Equipment | null {
  if (scale <= 0) return null;
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const tolerance_m = PLACEMENT_PICK_TOLERANCE_PX / scale;
  let nearest: Equipment | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const object of plan.objects) {
    if (object.typeId !== typeId || !visible.has(object.layerId)) continue;
    const distance = distanceToObject(point, object);
    // `<=` makes the later, visually upper object win an exact tie.
    if (distance > tolerance_m || distance > nearestDistance) continue;
    nearest = object;
    nearestDistance = distance;
  }
  return nearest;
}

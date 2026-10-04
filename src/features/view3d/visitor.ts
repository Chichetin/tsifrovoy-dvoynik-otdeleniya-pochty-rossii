/**
 * Pose of a visitor who has just come in: eye height, standing a little inside
 * the entrance, looking across the room. Pure function of the plan; the camera
 * code only applies the result.
 */

import type { Opening, PlanDocument, Point } from '../../contracts/model';
import { openingCentre } from '../../domain/geometry';

export const EYE_HEIGHT_M = 1.6;
const STEP_INSIDE_M = 0.6;

export type VisitorPose = { position: Point; heading: Point };
export type VisitorResult = { pose: VisitorPose } | { reason: string };

/** Entrance first, then the first door. Windows are not a way in. */
function pickOpening(openings: Opening[]): Opening | undefined {
  return openings.find((o) => o.kind === 'entrance') ?? openings.find((o) => o.kind === 'door');
}

export function visitorPose(document: PlanDocument): VisitorResult {
  const opening = pickOpening(document.openings);
  if (opening === undefined) return { reason: 'В плане нет входа и дверей: камеру поставить некуда.' };
  const wall = document.walls.find((w) => w.id === opening.wallId);
  if (wall === undefined) return { reason: 'Проём ссылается на стену, которой нет в плане.' };
  const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
  if (length === 0) return { reason: 'Стена входа имеет нулевую длину.' };

  const xs = document.walls.flatMap((w) => [w.from[0], w.to[0]]);
  const ys = document.walls.flatMap((w) => [w.from[1], w.to[1]]);
  const centre: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];

  const door = openingCentre(opening, wall);
  let normal: Point = [-(wall.to[1] - wall.from[1]) / length, (wall.to[0] - wall.from[0]) / length];
  // The normal that points toward the middle of the plan is the way into the room.
  if ((centre[0] - door[0]) * normal[0] + (centre[1] - door[1]) * normal[1] < 0) {
    normal = [-normal[0], -normal[1]];
  }
  return {
    pose: {
      position: [door[0] + normal[0] * STEP_INSIDE_M, door[1] + normal[1] * STEP_INSIDE_M],
      heading: normal,
    },
  };
}

/**
 * Pose of a visitor who has just come in: eye height, standing a little inside
 * the entrance, looking across the room. Pure function of the plan; the camera
 * code only applies the result.
 */

import type { Opening, PlanDocument, Point, Polygon } from '../../contracts/model';
import { intersects, openingCentre } from '../../domain/geometry';

export const EYE_HEIGHT_M = 1.6;
const STEP_INSIDE_M = 0.6;

export type VisitorPose = { position: Point; heading: Point };
export type VisitorResult = { pose: VisitorPose } | { reason: string };

/** A swept 30 cm footprint prevents crossing thin walls between frames. */
export function visitorStep(position: Point, heading: Point, input: Point, seconds: number,
  walls: readonly Polygon[], fast = false): Point {
  if (![...position, ...heading, ...input, seconds].every(Number.isFinite) || seconds <= 0) return position;
  const magnitude = Math.hypot(...input);
  const headingLength = Math.hypot(...heading);
  if (magnitude === 0 || headingLength === 0) return position;
  const distance = 1.4 * (fast ? 2 : 1) * Math.min(seconds, 0.1) / Math.max(1, magnitude);
  const dx = (heading[0] * input[1] + heading[1] * input[0]) / headingLength * distance;
  const dy = (heading[1] * input[1] - heading[0] * input[0]) / headingLength * distance;
  const next: Point = [position[0] + dx, position[1] + dy];
  const radius = 0.15;
  const left = Math.min(position[0], next[0]) - radius;
  const right = Math.max(position[0], next[0]) + radius;
  const bottom = Math.min(position[1], next[1]) - radius;
  const top = Math.max(position[1], next[1]) + radius;
  const swept: Polygon = [[left, bottom], [right, bottom], [right, top], [left, top]];
  return walls.some((wall) => intersects(swept, wall)) ? position : next;
}

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

/**
 * #124: the inventory walk — the order in which a person goes round the
 * branch, and the marks they leave on each object.
 *
 * The route starts at the main entrance and visits every object once. It is a
 * greedy nearest-neighbour path improved by 2-opt: good enough for a walk on
 * foot, not an optimum. Distance is a straight line between object centres;
 * walls and furniture between them are not taken into account.
 *
 * A mark is a plain object attribute. It travels in the plan file with the
 * object, survives a reopen and is undone like any other edit — no second
 * store and no change to the file format.
 */

import type { Attributes, Equipment, Id, PlanDocument, Point } from '../../contracts/model';
import { openingCentre } from '../geometry';

/** Attribute that holds the mark of the walk. */
export const WALK_MARK_KEY = 'inventoryCheck';
/** Attribute that holds the number found on the object, for «другой номер». */
export const WALK_FOUND_NUMBER_KEY = 'inventoryFoundNumber';

export type WalkMark = 'present' | 'missing' | 'other-number' | 'broken';

export const WALK_MARKS: readonly WalkMark[] = ['present', 'missing', 'other-number', 'broken'];

export const WALK_MARK_LABELS: Record<WalkMark, string> = {
  present: 'на месте',
  missing: 'нет',
  'other-number': 'другой номер',
  broken: 'сломан',
};

/** More passes than this buy little on a plan of a branch and cost time on 2000 objects. */
const MAX_TWO_OPT_PASSES = 20;

/**
 * Where the walk begins: the middle of the main entrance; without one, of the
 * first opening; without openings, the first corner of the room.
 */
export function walkStart(plan: PlanDocument): Point {
  const entrance =
    plan.openings.find((opening) => opening.kind === 'entrance') ?? plan.openings[0];
  if (entrance !== undefined) {
    const wall = plan.walls.find((item) => item.id === entrance.wallId);
    if (wall !== undefined) return openingCentre(entrance, wall);
  }
  return plan.room.boundary[0] ?? [0, 0];
}

type Step = { id: Id; at: Point };

/** Every object id of the plan, once, in the order of the walk. */
export function walkRoute(plan: PlanDocument): Id[] {
  const start = walkStart(plan);
  const left: Step[] = plan.objects.map((object) => ({ id: object.id, at: object.position }));
  const path: Step[] = [];

  let here = start;
  while (left.length > 0) {
    let best = 0;
    let bestDistance = Infinity;
    left.forEach((step, index) => {
      const gap = distance(here, step.at);
      if (gap < bestDistance) {
        best = index;
        bestDistance = gap;
      }
    });
    const next = left.splice(best, 1)[0];
    if (next === undefined) break;
    path.push(next);
    here = next.at;
  }

  return twoOpt(start, path).map((step) => step.id);
}

/**
 * 2-opt on an open path with a fixed start: reverse a stretch when that makes
 * the walk shorter. The end of the path is free, so the last edge may vanish.
 */
function twoOpt(start: Point, steps: Step[]): Step[] {
  let path = steps;
  const at = (index: number): Point => (index < 0 ? start : (path[index]?.at ?? start));
  for (let pass = 0; pass < MAX_TWO_OPT_PASSES; pass += 1) {
    let improved = false;
    for (let i = 0; i < path.length - 1; i += 1) {
      for (let j = i + 1; j < path.length; j += 1) {
        const tail = j + 1 < path.length;
        const before = distance(at(i - 1), at(i)) + (tail ? distance(at(j), at(j + 1)) : 0);
        const after = distance(at(i - 1), at(j)) + (tail ? distance(at(i), at(j + 1)) : 0);
        if (after < before - 1e-9) {
          path = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return path;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** The mark on an object, or `null` when the walk has not reached it. */
export function walkMarkOf(object: Equipment): WalkMark | null {
  const value = object.attributes[WALK_MARK_KEY];
  return typeof value === 'string' && (WALK_MARKS as readonly string[]).includes(value)
    ? (value as WalkMark)
    : null;
}

/** The number written for «другой номер», trimmed; `null` when there is none. */
export function walkFoundNumberOf(object: Equipment): string | null {
  const value = object.attributes[WALK_FOUND_NUMBER_KEY];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The object with its mark. The found number is kept only for «другой
 * номер»: any other mark drops a number left by an earlier pass.
 */
export function markObject(object: Equipment, mark: WalkMark, foundNumber: string | null = null): Equipment {
  const attributes: Attributes = { ...object.attributes, [WALK_MARK_KEY]: mark };
  delete attributes[WALK_FOUND_NUMBER_KEY];
  const found = foundNumber?.trim() ?? '';
  if (mark === 'other-number' && found !== '') attributes[WALK_FOUND_NUMBER_KEY] = found;
  return { ...object, attributes };
}

/**
 * The next object to look at after `currentId`: the first unmarked one further
 * along the route, then from the route start. `null` — every object is marked.
 */
export function nextUnmarked(plan: PlanDocument, route: readonly Id[], currentId: Id | null): Id | null {
  const objects = new Map(plan.objects.map((object) => [object.id, object]));
  const from = currentId === null ? 0 : route.indexOf(currentId) + 1;
  for (let step = 0; step < route.length; step += 1) {
    const id = route[(from + step) % route.length];
    const object = id === undefined ? undefined : objects.get(id);
    if (object !== undefined && walkMarkOf(object) === null) return object.id;
  }
  return null;
}

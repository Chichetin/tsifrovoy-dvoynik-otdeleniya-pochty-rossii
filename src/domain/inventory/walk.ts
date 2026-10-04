/**
 * #124: the inventory walk — the order in which a person goes round the
 * branch, and the marks they leave on each object.
 *
 * The route starts at the main entrance and visits every object once. It is a
 * greedy nearest-neighbour path improved by 2-opt within a time budget: good
 * enough for a walk on foot, not an optimum. Distance is a straight line
 * between object centres; walls and furniture between them are not taken into
 * account.
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

/** How the card names the two attributes: they are not catalog attributes. */
export const WALK_ATTRIBUTE_LABELS: Record<string, string> = {
  [WALK_MARK_KEY]: 'Отметка обхода',
  [WALK_FOUND_NUMBER_KEY]: 'Найденный номер',
};

export type WalkMark = 'present' | 'missing' | 'other-number' | 'broken';

export const WALK_MARKS: readonly WalkMark[] = ['present', 'missing', 'other-number', 'broken'];

export const WALK_MARK_LABELS: Record<WalkMark, string> = {
  present: 'на месте',
  missing: 'нет',
  'other-number': 'другой номер',
  broken: 'сломан',
};

/** Mark text for an object the walk has not reached. */
export const WALK_UNCHECKED_LABEL = 'не проверен';

/**
 * Time 2-opt may take. The greedy path is already a walk; 2-opt only shortens
 * it, so on 2000 objects it stops on time instead of freezing the page.
 */
export const TWO_OPT_BUDGET_MS = 150;

type Owner = { attributes: Attributes };

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

/** Every object id of the plan, once, in the order of the walk. */
export function walkRoute(plan: PlanDocument, budget_ms: number = TWO_OPT_BUDGET_MS): Id[] {
  const count = plan.objects.length;
  // Slot 0 is the entrance; slots 1..count are the objects in document order.
  const xs = new Float64Array(count + 1);
  const ys = new Float64Array(count + 1);
  const start = walkStart(plan);
  xs[0] = start[0];
  ys[0] = start[1];
  plan.objects.forEach((object, index) => {
    xs[index + 1] = object.position[0];
    ys[index + 1] = object.position[1];
  });
  const gap = (a: number, b: number): number => Math.hypot((xs[a] ?? 0) - (xs[b] ?? 0), (ys[a] ?? 0) - (ys[b] ?? 0));

  // Greedy: from where we stand, to the nearest object not yet visited.
  const path = new Int32Array(count + 1);
  const visited = new Uint8Array(count + 1);
  let here = 0;
  for (let step = 1; step <= count; step += 1) {
    let best = -1;
    let bestGap = Infinity;
    for (let slot = 1; slot <= count; slot += 1) {
      if (visited[slot] === 1) continue;
      const length = gap(here, slot);
      if (length < bestGap) {
        best = slot;
        bestGap = length;
      }
    }
    visited[best] = 1;
    path[step] = best;
    here = best;
  }

  twoOpt(path, gap, budget_ms);

  const ids: Id[] = [];
  for (let step = 1; step <= count; step += 1) {
    const object = plan.objects[(path[step] ?? 1) - 1];
    if (object !== undefined) ids.push(object.id);
  }
  return ids;
}

/**
 * 2-opt on an open path with a fixed start (`path[0]`): reverse a stretch in
 * place when that makes the walk shorter. The end is free, so the last edge
 * may vanish. Stops when nothing improves or the budget is spent.
 */
function twoOpt(path: Int32Array, gap: (a: number, b: number) => number, budget_ms: number): void {
  const deadline = performance.now() + budget_ms;
  const last = path.length - 1;
  const at = (index: number): number => path[index] ?? 0;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < last; i += 1) {
      if (performance.now() > deadline) return;
      for (let j = i + 1; j <= last; j += 1) {
        const tail = j < last;
        const before = gap(at(i - 1), at(i)) + (tail ? gap(at(j), at(j + 1)) : 0);
        const after = gap(at(i - 1), at(j)) + (tail ? gap(at(i), at(j + 1)) : 0);
        if (after < before - 1e-9) {
          path.subarray(i, j + 1).reverse();
          improved = true;
        }
      }
    }
  }
}

/**
 * The route for the plan as it is now: ids of deleted objects dropped, a new
 * object put where it lengthens the walk least. Unchanged — the same array.
 */
export function reconcileRoute(plan: PlanDocument, route: readonly Id[]): readonly Id[] {
  const present = new Set(plan.objects.map((object) => object.id));
  const inRoute = new Set(route);
  const added = plan.objects.filter((object) => !inRoute.has(object.id));
  const kept = route.filter((id) => present.has(id));
  if (added.length === 0 && kept.length === route.length) return route;

  const positions = new Map(plan.objects.map((object) => [object.id, object.position]));
  const start = walkStart(plan);
  const at = (id: Id | undefined): Point => (id === undefined ? start : (positions.get(id) ?? start));
  const gap = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const result = [...kept];
  for (const object of added) {
    let bestIndex = result.length;
    let bestCost = Infinity;
    for (let index = 0; index <= result.length; index += 1) {
      const before = index === 0 ? start : at(result[index - 1]);
      const after = result[index];
      const cost =
        gap(before, object.position) +
        (after === undefined ? 0 : gap(object.position, at(after)) - gap(before, at(after)));
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }
    result.splice(bestIndex, 0, object.id);
  }
  return result;
}

/** The mark on an object, or `null` when the walk has not reached it. */
export function walkMarkOf(owner: Owner): WalkMark | null {
  const value = owner.attributes[WALK_MARK_KEY];
  return typeof value === 'string' && (WALK_MARKS as readonly string[]).includes(value)
    ? (value as WalkMark)
    : null;
}

/** The number written for «другой номер», trimmed; `null` when there is none. */
export function walkFoundNumberOf(owner: Owner): string | null {
  const value = owner.attributes[WALK_FOUND_NUMBER_KEY];
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

/** The object without any trace of the walk; the same object when it has none. */
export function unmarkObject(object: Equipment): Equipment {
  if (!(WALK_MARK_KEY in object.attributes) && !(WALK_FOUND_NUMBER_KEY in object.attributes)) return object;
  const attributes: Attributes = { ...object.attributes };
  delete attributes[WALK_MARK_KEY];
  delete attributes[WALK_FOUND_NUMBER_KEY];
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

/** One line of the discrepancy report: what persistence writes, already worded. */
export type WalkActEntry = { id: Id; mark: string; foundNumber: string | null };

/**
 * The discrepancy report: every object not marked «на месте», unchecked ones
 * included, in route order; objects outside the route follow in document order.
 */
export function walkActEntries(plan: PlanDocument, route: readonly Id[] = []): WalkActEntry[] {
  const order = new Map(route.map((id, index) => [id, index]));
  return plan.objects
    .map((object, index) => ({ object, key: order.get(object.id) ?? route.length + index }))
    .sort((a, b) => a.key - b.key)
    .flatMap(({ object }) => {
      const mark = walkMarkOf(object);
      if (mark === 'present') return [];
      return [{
        id: object.id,
        mark: mark === null ? WALK_UNCHECKED_LABEL : WALK_MARK_LABELS[mark],
        foundNumber: mark === 'other-number' ? walkFoundNumberOf(object) : null,
      }];
    });
}

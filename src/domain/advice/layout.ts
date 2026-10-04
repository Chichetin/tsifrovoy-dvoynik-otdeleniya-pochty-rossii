/**
 * #122: «Разложи зону» — code rearranges the floor objects of a zone and
 * returns up to three variants as edit proposals (move and rotate).
 *
 * Search is simulated annealing over the positions and quarter turns of the
 * movable objects. Each variant has its own goal: objects along the edges, objects
 * near the entrance, the widest narrowest passage. A state that breaks
 * physics or leaves the zone costs much more than any goal, so the search
 * returns only states without new violations. The whole variant is then
 * checked as one `batch`, as «Применить» will apply it: two objects may swap
 * places, which a check edit by edit would refuse halfway.
 *
 * The random source is seeded: the same plan gives the same variants, so the
 * numbers in the answer and in a test agree.
 */

import type { Fact } from '../../contracts/advice';
import { AGENT_LIMITS, type AgentEditChange, type AgentEditProposal } from '../../contracts/advice-chat';
import type { Command } from '../../contracts/commands';
import type { Equipment, Id, Issue, PlanDocument, Point, Polygon, Ref } from '../../contracts/model';
import { applyCommand } from '../commands';
import { contains, footprint, objectHitsWall, openingCentre, polygonGap, polygonSegmentDistance } from '../geometry';
import { editRejection, objectPhysicsIssues } from '../physics';
import { validatePlan, VALIDATION_ISSUE_CODES } from '../validation';
import { count, effectFacts, errorKeys, pose } from './agent-edits';
import { issueKey } from './placement';

type Goal = 'edges' | 'entrance' | 'passage';

const VARIANTS: { goal: Goal; title: string }[] = [
  { goal: 'edges', title: 'вдоль стен, середина зоны свободна' },
  { goal: 'entrance', title: 'ближе ко входу' },
  { goal: 'passage', title: 'шире проходы' },
];

/** Shapes closer than this stand together and form no passage (contract, `layout.passage`). */
const TOUCH_M = 0.05;
const ITERATIONS = 800;
const STEP_M = 0.05;

/** The physics a move must not create; the same codes gate a drag (D-286). */
const GATED = new Set<string>([
  VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
  VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING,
  VALIDATION_ISSUE_CODES.OBJECT_BLOCKS_OPENING,
  VALIDATION_ISSUE_CODES.OBJECT_UNSUPPORTED,
]);

const cm = (value: number): number => Math.round(value * 100) / 100;
const snap = (value: number): number => Math.round(value / STEP_M) * STEP_M;

/** Deterministic random numbers in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function signature(issue: Issue): string {
  return `${issue.code}|${issue.refs.map((ref) => `${ref.kind}:${ref.id}`).join(',')}`;
}

/** Distance from a shape to the nearest edge of the zone outline. */
function edgeGap(shape: Polygon, zone: Polygon): number {
  let best = Infinity;
  for (let i = 0; i < zone.length; i += 1) {
    best = Math.min(best, polygonSegmentDistance(shape, zone[i]!, zone[(i + 1) % zone.length]!));
  }
  return best;
}

/** The narrowest passage (contract: `layout.passage`), or null when nothing stands apart. */
function narrowestPassage(objects: readonly Equipment[], zone: Polygon): number | null {
  const shapes = objects.map(footprint);
  let best: number | null = null;
  const take = (gap: number): void => {
    if (gap > TOUCH_M && (best === null || gap < best)) best = gap;
  };
  for (let i = 0; i < shapes.length; i += 1) {
    take(edgeGap(shapes[i]!, zone));
    for (let j = i + 1; j < shapes.length; j += 1) take(polygonGap(shapes[i]!, shapes[j]!)?.distance ?? 0);
  }
  return best;
}

/** Entrances, else every door: a zone deep inside the office is reached through doors. */
function entrancePoints(plan: PlanDocument): Point[] {
  const walls = new Map(plan.walls.map((wall) => [wall.id, wall]));
  const points = (kind: string): Point[] =>
    plan.openings.flatMap((opening) => {
      const wall = walls.get(opening.wallId);
      return opening.kind === kind && wall !== undefined ? [openingCentre(opening, wall)] : [];
    });
  const entrances = points('entrance');
  return entrances.length > 0 ? entrances : points('door');
}

/** Mean distance of objects to the nearest entrance (contract: `layout.entrance`). */
function meanEntrance(objects: readonly Equipment[], entrances: readonly Point[]): number | null {
  if (objects.length === 0 || entrances.length === 0) return null;
  const nearest = (point: Point): number =>
    Math.min(...entrances.map((entrance) => Math.hypot(point[0] - entrance[0], point[1] - entrance[1])));
  return objects.reduce((sum, object) => sum + nearest(object.position), 0) / objects.length;
}

/** Floor objects of the zone a layout may move: not locked, nothing standing on them. */
export function layoutMovable(plan: PlanDocument, zoneId: Id, typeIds: readonly Id[] | null): Equipment[] {
  const raised = plan.objects.filter((object) => object.base_m > 0);
  return plan.objects.filter(
    (object) =>
      object.zoneId === zoneId &&
      object.base_m === 0 &&
      object.locked !== true &&
      (typeIds === null || typeIds.includes(object.typeId)) &&
      !raised.some((other) => contains(footprint(object), footprint(other))),
  );
}

type Search = {
  plan: PlanDocument;
  zone: Polygon;
  floor: Equipment[];
  entrances: Point[];
  known: Set<string>;
};

function withObjects(plan: PlanDocument, moved: ReadonlyMap<Id, Equipment>): PlanDocument {
  return { ...plan, objects: plan.objects.map((object) => moved.get(object.id) ?? object) };
}

/** Walls the object runs into, as `object|wall` keys. */
function wallHits(plan: PlanDocument, object: Equipment): string[] {
  return plan.walls.filter((wall) => objectHitsWall(object, wall, plan.openings, plan.walls)).map((wall) => `${object.id}|${wall.id}`);
}

/**
 * New physics problems, new wall crossings and objects outside the zone: what
 * a variant must not have. A zone's edge runs along a wall's axis, so an object
 * inside the zone can still stand in the wall — validation reports that.
 */
function violations(search: Search, state: ReadonlyMap<Id, Equipment>): number {
  const plan = withObjects(search.plan, state);
  let found = 0;
  for (const object of state.values()) {
    if (!contains(search.zone, footprint(object))) found += 1;
    for (const hit of wallHits(plan, object)) if (!search.known.has(hit)) found += 1;
    for (const issue of objectPhysicsIssues(plan, object)) {
      if (GATED.has(issue.code) && !search.known.has(signature(issue))) found += 1;
    }
  }
  return found;
}

function goalCost(search: Search, goal: Goal, state: ReadonlyMap<Id, Equipment>): number {
  const moved = [...state.values()];
  if (goal === 'edges') return moved.reduce((sum, object) => sum + edgeGap(footprint(object), search.zone), 0) / moved.length;
  if (goal === 'entrance') return meanEntrance(moved, search.entrances) ?? 0;
  const floor = search.floor.map((object) => state.get(object.id) ?? object);
  return -Math.min(narrowestPassage(floor, search.zone) ?? 0, 3);
}

function anneal(search: Search, goal: Goal, start: ReadonlyMap<Id, Equipment>, seed: number): Map<Id, Equipment> | null {
  const next = random(seed);
  const ids = [...start.keys()];
  const cost = (state: ReadonlyMap<Id, Equipment>): number => 100 * violations(search, state) + goalCost(search, goal, state);
  let state = new Map(start);
  let current = cost(state);
  let best: Map<Id, Equipment> | null = null;
  let bestCost = Infinity;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const cooling = 1 - i / ITERATIONS;
    const id = ids[Math.floor(next() * ids.length)]!;
    const object = state.get(id)!;
    const sigma = Math.max(0.1, 1.5 * cooling);
    const trial: Equipment =
      next() < 0.2
        ? { ...object, rotation_deg: (object.rotation_deg + 90) % 360 }
        : {
            ...object,
            position: [snap(object.position[0] + (next() * 2 - 1) * sigma), snap(object.position[1] + (next() * 2 - 1) * sigma)],
          };
    const candidate = new Map(state).set(id, trial);
    const trialCost = cost(candidate);
    const temperature = 0.5 * cooling + 0.01;
    if (trialCost < current || next() < Math.exp((current - trialCost) / temperature)) {
      state = candidate;
      current = trialCost;
      if (current < bestCost && violations(search, state) === 0) {
        best = new Map(state);
        bestCost = current;
      }
    }
  }
  return best;
}

/** Variant facts: passage and entrance before → after → delta, by code. */
/** `movableIds`: every object the layout may move, so all variants share one «было». */
function layoutFacts(id: Id, search: Search, after: PlanDocument, zoneId: Id, movableIds: readonly Id[]): Fact[] {
  const refs: Ref[] = [{ kind: 'zone', id: zoneId }];
  const floorAfter = search.floor.map((object) => after.objects.find((entry) => entry.id === object.id) ?? object);
  const movedBefore = search.floor.filter((object) => movableIds.includes(object.id));
  const movedAfter = floorAfter.filter((object) => movableIds.includes(object.id));
  const pairs: [Fact['metric'], number | null, number | null][] = [
    ['layout.passage', narrowestPassage(search.floor, search.zone), narrowestPassage(floorAfter, search.zone)],
    ['layout.entrance', meanEntrance(movedBefore, search.entrances), meanEntrance(movedAfter, search.entrances)],
  ];
  return pairs.flatMap(([metric, before, after]) =>
    before === null || after === null
      ? []
      : [
          { id: `${id}.${metric}.before`, metric, phase: 'before' as const, value: cm(before), unit: 'm' as const, refs },
          { id: `${id}.${metric}.after`, metric, phase: 'after' as const, value: cm(after), unit: 'm' as const, refs },
          { id: `${id}.${metric}.delta`, metric, phase: 'delta' as const, value: cm(after - before), unit: 'm' as const, refs },
        ],
  );
}

/**
 * Up to `AGENT_LIMITS.layoutVariants` layouts of the zone. A variant that
 * moves nothing, repeats another or fails the batch check is left out.
 */
export function layoutZone(plan: PlanDocument, zoneId: Id, typeIds: readonly Id[] | null, prefix = 'layout'): AgentEditProposal[] {
  const zone = plan.zones.find((entry) => entry.id === zoneId);
  if (zone === undefined) return [];
  const movable = layoutMovable(plan, zoneId, typeIds);
  if (movable.length === 0) return [];
  const initialIssues = validatePlan(plan);
  // What the movable objects already break stays allowed: a layout fixes or
  // keeps old problems but never adds new ones.
  const known = new Set([
    ...movable.flatMap((object) => objectPhysicsIssues(plan, object)).map(signature),
    ...movable.flatMap((object) => wallHits(plan, object)),
  ]);
  const search: Search = {
    plan,
    zone: zone.polygon,
    floor: plan.objects.filter((object) => object.zoneId === zoneId && object.base_m === 0),
    entrances: entrancePoints(plan),
    known,
  };
  const start = new Map(movable.map((object) => [object.id, object]));
  const proposals: AgentEditProposal[] = [];
  const seen = new Set<string>();

  VARIANTS.slice(0, AGENT_LIMITS.layoutVariants).forEach(({ goal, title }, index) => {
    const best = anneal(search, goal, start, 122 + index);
    if (best === null) return;
    const changed = [...best.values()].filter((object) => {
      const was = start.get(object.id)!;
      return Math.hypot(object.position[0] - was.position[0], object.position[1] - was.position[1]) > 0.01 || object.rotation_deg !== was.rotation_deg;
    });
    if (changed.length === 0) return;
    const key = changed.map((object) => `${object.id}:${object.position.join(',')}:${object.rotation_deg}`).join('|');
    if (seen.has(key)) return;
    seen.add(key);

    const commands: Command[] = changed.map((object) => ({ type: 'object.put', object }));
    const batch: Command = { type: 'batch', commands };
    const applied = applyCommand(plan, batch);
    if (!applied.ok || editRejection(plan, applied.value, batch) !== null) return;
    const issues = validatePlan(applied.value);
    const before = errorKeys(initialIssues);
    if (issues.some((issue) => issue.severity === 'error' && !before.has(issueKey(issue)))) return;

    const id = `${prefix}_${proposals.length + 1}`;
    const changes: AgentEditChange[] = changed.map((object) => {
      const was = start.get(object.id)!;
      const movedFar = Math.hypot(object.position[0] - was.position[0], object.position[1] - was.position[1]) > 0.01;
      return { op: movedFar ? 'move' : 'rotate', id: object.id, typeId: object.typeId, label: object.label, before: pose(was), after: pose(object) };
    });
    proposals.push({
      id,
      title: `Вариант ${proposals.length + 1}: ${title}`,
      commands,
      changes,
      rejected: [],
      facts: [...effectFacts(id, plan, applied.value, 0, 0), ...layoutFacts(id, search, applied.value, zoneId, [...start.keys()])],
      findings: {
        errors: { before: count(initialIssues, true), after: count(issues, true) },
        warnings: { before: count(initialIssues, false), after: count(issues, false) },
      },
    });
  });
  return proposals;
}

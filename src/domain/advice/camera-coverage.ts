/**
 * Issue #32: how much of the client area the cameras see, counted by code.
 *
 * The method is a grid, not a clipper: the plan is cut into squares of
 * `COVERAGE_GRID.cell_m`, a square belongs to a zone when its centre does, and
 * it is seen when its centre lies in the sector of at least one camera. The
 * sector is the same one the «Камеры и зоны обзора» layer draws — angle and
 * range from the camera's attributes, the layer type's defaults for the gaps,
 * heading along the camera's own rotation — so what is hatched on the plan and
 * what the assistant counts are one calculation. Walls and furniture do not
 * cut a sector, and nothing here knows about video: it is a planning estimate
 * of where a camera looks, said so in every recommendation that uses it.
 *
 * Which zones are «client» is read from the plan, not listed in code (D-306):
 * the zone's `publicAccess` attribute, else its zone type's default for it,
 * else the answer of the zone it is nested in. A queue drawn inside the client
 * hall is a client zone without saying so; a storage room is not.
 */

import type { Catalog, Id, LayerRepresentation, PlanDocument, Point, Zone } from '../../contracts/model';
import { findZoneType } from '../catalog';
import { boundingBox, locatePoint, pointInViewSector } from '../geometry';

export type CameraFieldRepresentation = Extract<LayerRepresentation, { kind: 'object-field' }>;

export const COVERAGE_GRID = {
  /** Side of a grid square, metres. */
  cell_m: 0.25,
} as const;

/** The zone attribute that says whether visitors are let in. */
export const CLIENT_ZONE_ATTRIBUTE = 'publicAccess';

/** A camera as the coverage sees it: where it hangs, where it looks, how wide and far. */
export type CameraField = {
  objectId: Id;
  position: Point;
  rotation_deg: number;
  angle_deg: number;
  range_m: number;
};

/** An unseen strip of grid squares, model metres: lower-left corner and size. */
export type BlindRect = { x: number; y: number; width: number; height: number };

export type CoverageTally = {
  cells: number;
  covered: number;
  area_m2: number;
  covered_m2: number;
  blind_m2: number;
  /** Seen share, 0…100; `null` when the zone holds no grid square at all. */
  percent: number | null;
};

export type ZoneCoverage = CoverageTally & {
  zoneId: Id;
  /** Cameras that see at least one square of the zone, plan order. */
  cameraIds: Id[];
};

export type CameraCoverage = {
  cell_m: number;
  /** Client zones, plan order. */
  zones: ZoneCoverage[];
  /** All client zones together; a square shared by nested zones counts once. */
  total: CoverageTally;
  /** Unseen squares of all client zones, merged into row strips. */
  blind: BlindRect[];
  cameras: CameraField[];
};

function booleanAttribute(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Whether visitors are let into the zone (D-306): its own `publicAccess`,
 * else the zone type's default, else the parent's answer; nothing anywhere —
 * not a client zone. A cycle of parents in a half-edited plan ends the walk.
 */
export function isClientZone(plan: Pick<PlanDocument, 'zones' | 'catalog'>, zone: Zone): boolean {
  const byId = new Map(plan.zones.map((entry) => [entry.id, entry]));
  const seen = new Set<Id>();
  let current: Zone | undefined = zone;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    const own = booleanAttribute(current.attributes[CLIENT_ZONE_ATTRIBUTE]);
    if (own !== null) return own;
    const typeDefault = booleanAttribute(
      findZoneType(plan.catalog, current.typeId)?.attributes.find((attribute) => attribute.key === CLIENT_ZONE_ATTRIBUTE)
        ?.default,
    );
    if (typeDefault !== null) return typeDefault;
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return false;
}

export function clientZones(plan: Pick<PlanDocument, 'zones' | 'catalog'>): Zone[] {
  return plan.zones.filter((zone) => isClientZone(plan, zone));
}

/** The first sector layer type of the catalog that draws objects of `typeId`, if any. */
export function fieldRepresentationFor(catalog: Catalog, typeId: Id): CameraFieldRepresentation | null {
  for (const type of catalog.layerTypes) {
    const representation = type.representation;
    if (representation.kind === 'object-field' && representation.objectTypeIds.includes(typeId)) return representation;
  }
  return null;
}

function numberAttribute(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Cameras of the representation with their sectors — exactly what the layer draws. */
export function cameraFields(plan: Pick<PlanDocument, 'objects'>, representation: CameraFieldRepresentation): CameraField[] {
  const types = new Set(representation.objectTypeIds);
  return plan.objects
    .filter((object) => types.has(object.typeId))
    .map((object) => ({
      objectId: object.id,
      position: object.position,
      rotation_deg: object.rotation_deg,
      angle_deg: numberAttribute(object.attributes[representation.angleAttribute]) ?? representation.angle_deg,
      range_m: numberAttribute(object.attributes[representation.rangeAttribute]) ?? representation.range_m,
    }));
}

export function fieldSees(field: CameraField, point: Point): boolean {
  return pointInViewSector(field.position, field.rotation_deg, field.angle_deg, field.range_m, point);
}

/** A grid square: its column, row and centre. */
export type GridCell = { ix: number; iy: number; centre: Point };

export function cellKey(ix: number, iy: number): string {
  return `${ix},${iy}`;
}

/** Squares whose centre is inside the polygon or on its edge. */
export function zoneCells(zone: Pick<Zone, 'polygon'>, cell_m: number = COVERAGE_GRID.cell_m): GridCell[] {
  if (zone.polygon.length < 3) return [];
  const box = boundingBox(zone.polygon);
  const cells: GridCell[] = [];
  const fromX = Math.floor(box.minX / cell_m);
  const toX = Math.ceil(box.maxX / cell_m);
  const fromY = Math.floor(box.minY / cell_m);
  const toY = Math.ceil(box.maxY / cell_m);
  for (let iy = fromY; iy < toY; iy += 1) {
    for (let ix = fromX; ix < toX; ix += 1) {
      const centre: Point = [(ix + 0.5) * cell_m, (iy + 0.5) * cell_m];
      if (locatePoint(centre, zone.polygon) !== 'outside') cells.push({ ix, iy, centre });
    }
  }
  return cells;
}

function tally(cells: number, covered: number, cell_m: number): CoverageTally {
  const square = cell_m * cell_m;
  return {
    cells,
    covered,
    area_m2: cells * square,
    covered_m2: covered * square,
    blind_m2: (cells - covered) * square,
    percent: cells === 0 ? null : (covered / cells) * 100,
  };
}

/** Unseen squares merged along each row: far fewer shapes to draw than squares. */
export function blindStrips(cells: readonly GridCell[], cell_m: number = COVERAGE_GRID.cell_m): BlindRect[] {
  const sorted = [...cells].sort((a, b) => a.iy - b.iy || a.ix - b.ix);
  const strips: BlindRect[] = [];
  let start: GridCell | null = null;
  let last: GridCell | null = null;
  const flush = (): void => {
    if (start === null || last === null) return;
    strips.push({ x: start.ix * cell_m, y: start.iy * cell_m, width: (last.ix - start.ix + 1) * cell_m, height: cell_m });
  };
  for (const entry of sorted) {
    if (last !== null && start !== null && entry.iy === last.iy && entry.ix === last.ix + 1) {
      last = entry;
      continue;
    }
    flush();
    start = entry;
    last = entry;
  }
  flush();
  return strips;
}

/** Which cameras could see this square at all: a box test before the angle. */
function reaches(field: CameraField, centre: Point): boolean {
  return (
    Math.abs(centre[0] - field.position[0]) <= field.range_m &&
    Math.abs(centre[1] - field.position[1]) <= field.range_m
  );
}

/**
 * Coverage of the plan's client zones by the cameras of `representation`.
 * Every square is decided once, whatever number of nested zones holds it.
 */
export function cameraCoverage(
  plan: Pick<PlanDocument, 'zones' | 'objects' | 'catalog'>,
  representation: CameraFieldRepresentation,
  cell_m: number = COVERAGE_GRID.cell_m,
): CameraCoverage {
  const cameras = cameraFields(plan, representation);
  const decided = new Map<string, { cell: GridCell; seenBy: number[] }>();
  const decide = (cell: GridCell): number[] => {
    const key = cellKey(cell.ix, cell.iy);
    const known = decided.get(key);
    if (known !== undefined) return known.seenBy;
    const seenBy: number[] = [];
    cameras.forEach((field, index) => {
      if (reaches(field, cell.centre) && fieldSees(field, cell.centre)) seenBy.push(index);
    });
    decided.set(key, { cell, seenBy });
    return seenBy;
  };

  const zones: ZoneCoverage[] = clientZones(plan).map((zone) => {
    const cells = zoneCells(zone, cell_m);
    const seers = new Set<number>();
    let covered = 0;
    for (const cell of cells) {
      const seenBy = decide(cell);
      if (seenBy.length > 0) covered += 1;
      for (const index of seenBy) seers.add(index);
    }
    return {
      zoneId: zone.id,
      ...tally(cells.length, covered, cell_m),
      cameraIds: cameras.filter((_, index) => seers.has(index)).map((field) => field.objectId),
    };
  });

  const all = [...decided.values()];
  const blindCells = all.filter((entry) => entry.seenBy.length === 0).map((entry) => entry.cell);
  return {
    cell_m,
    zones,
    total: tally(all.length, all.length - blindCells.length, cell_m),
    blind: blindStrips(blindCells, cell_m),
    cameras,
  };
}

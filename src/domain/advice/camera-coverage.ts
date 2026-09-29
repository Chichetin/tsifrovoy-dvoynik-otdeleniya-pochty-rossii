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
import { boundingBox, locatePoint, pointInViewSector, viewSectorTest } from '../geometry';

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

/** Column and row range of the grid squares a polygon's bounding box touches, end-exclusive. */
type GridSpan = { fromX: number; toX: number; fromY: number; toY: number };

function spanOf(polygon: Zone['polygon'], cell_m: number): GridSpan {
  const box = boundingBox(polygon);
  return {
    fromX: Math.floor(box.minX / cell_m),
    toX: Math.ceil(box.maxX / cell_m),
    fromY: Math.floor(box.minY / cell_m),
    toY: Math.ceil(box.maxY / cell_m),
  };
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

/**
 * Columns of one grid row whose square centre lies in the polygon or on its
 * edge. A scanline, not a point test per square: the crossings of the row's
 * centre line with the edges give the inside runs directly. A row that runs
 * exactly through a vertex is answered square by square with `locatePoint`,
 * the same rule as everywhere else, so no edge case is decided differently.
 */
function rowColumns(polygon: Zone['polygon'], iy: number, span: GridSpan, cell_m: number): number[] {
  const y = (iy + 0.5) * cell_m;
  const columns: number[] = [];
  if (polygon.some((vertex) => Math.abs(vertex[1] - y) <= 1e-9)) {
    for (let ix = span.fromX; ix < span.toX; ix += 1) {
      if (locatePoint([(ix + 0.5) * cell_m, y], polygon) !== 'outside') columns.push(ix);
    }
    return columns;
  }
  const crossings: number[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i]!;
    const [bx, by] = polygon[(i + 1) % polygon.length]!;
    if ((ay < y && by > y) || (by < y && ay > y)) crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
  }
  crossings.sort((a, b) => a - b);
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    // Inclusive at both ends: a centre on a vertical edge belongs to the zone.
    const from = Math.max(span.fromX, Math.ceil(crossings[i]! / cell_m - 0.5 - 1e-9));
    const to = Math.min(span.toX - 1, Math.floor(crossings[i + 1]! / cell_m - 0.5 + 1e-9));
    for (let ix = from; ix <= to; ix += 1) columns.push(ix);
  }
  return columns;
}

const OUTSIDE = 0;
const BLIND = 1;
const SEEN = 2;

/**
 * Coverage of the plan's client zones by the cameras of `representation`.
 *
 * One flat grid over all client zones: a square is decided once, whatever
 * number of nested zones holds it; each camera visits only the squares within
 * its range; the blind strips are read off the grid row by row. No object per
 * square, so a 5 000 m² plan with dozens of cameras is counted within a frame
 * or two (D-307).
 */
export function cameraCoverage(
  plan: Pick<PlanDocument, 'zones' | 'objects' | 'catalog'>,
  representation: CameraFieldRepresentation,
  cell_m: number = COVERAGE_GRID.cell_m,
): CameraCoverage {
  const cameras = cameraFields(plan, representation);
  const client = clientZones(plan).filter((zone) => zone.polygon.length >= 3);
  const spans = client.map((zone) => spanOf(zone.polygon, cell_m));
  const grid: GridSpan =
    spans.length === 0
      ? { fromX: 0, toX: 0, fromY: 0, toY: 0 }
      : {
          fromX: Math.min(...spans.map((span) => span.fromX)),
          toX: Math.max(...spans.map((span) => span.toX)),
          fromY: Math.min(...spans.map((span) => span.fromY)),
          toY: Math.max(...spans.map((span) => span.toY)),
        };
  const width = grid.toX - grid.fromX;
  const height = grid.toY - grid.fromY;
  const state = new Uint8Array(width * height);

  // Which squares each client zone holds; a square of nested zones is in both
  // lists. `owner` keeps the first zone of a square, `moreOwners` the rest.
  const owner = new Int32Array(width * height).fill(-1);
  const moreOwners = new Map<number, number[]>();
  const members: number[][] = client.map((zone, zoneIndex) => {
    const span = spans[zoneIndex]!;
    const list: number[] = [];
    for (let iy = span.fromY; iy < span.toY; iy += 1) {
      for (const ix of rowColumns(zone.polygon, iy, span, cell_m)) {
        const at = (iy - grid.fromY) * width + (ix - grid.fromX);
        if (state[at] === OUTSIDE) {
          state[at] = BLIND;
          owner[at] = zoneIndex;
        } else {
          const more = moreOwners.get(at);
          if (more === undefined) moreOwners.set(at, [zoneIndex]);
          else more.push(zoneIndex);
        }
        list.push(at);
      }
    }
    return list;
  });

  // Each camera looks only at the squares its range can reach.
  const zoneSeers = client.map(() => new Set<number>());
  let seen = 0;
  cameras.forEach((field, index) => {
    const sees = viewSectorTest(field.position, field.rotation_deg, field.angle_deg, field.range_m);
    const fromX = Math.max(grid.fromX, Math.floor((field.position[0] - field.range_m) / cell_m));
    const toX = Math.min(grid.toX - 1, Math.floor((field.position[0] + field.range_m) / cell_m));
    const fromY = Math.max(grid.fromY, Math.floor((field.position[1] - field.range_m) / cell_m));
    const toY = Math.min(grid.toY - 1, Math.floor((field.position[1] + field.range_m) / cell_m));
    for (let iy = fromY; iy <= toY; iy += 1) {
      for (let ix = fromX; ix <= toX; ix += 1) {
        const at = (iy - grid.fromY) * width + (ix - grid.fromX);
        if (state[at] === OUTSIDE) continue;
        if (!sees([(ix + 0.5) * cell_m, (iy + 0.5) * cell_m])) continue;
        if (state[at] === BLIND) {
          state[at] = SEEN;
          seen += 1;
        }
        zoneSeers[owner[at]!]!.add(index);
        for (const other of moreOwners.get(at) ?? []) zoneSeers[other]!.add(index);
      }
    }
  });

  const zones: ZoneCoverage[] = client.map((zone, zoneIndex) => {
    const list = members[zoneIndex]!;
    let covered = 0;
    for (const at of list) if (state[at] === SEEN) covered += 1;
    const seers = zoneSeers[zoneIndex]!;
    return {
      zoneId: zone.id,
      ...tally(list.length, covered, cell_m),
      cameraIds: cameras.filter((_, index) => seers.has(index)).map((field) => field.objectId),
    };
  });

  // Unseen squares merged along each row: far fewer shapes to draw than squares.
  const blind: BlindRect[] = [];
  let decided = 0;
  for (let row = 0; row < height; row += 1) {
    let start = -1;
    for (let column = 0; column <= width; column += 1) {
      const value = column < width ? state[row * width + column] : OUTSIDE;
      if (value !== OUTSIDE) decided += 1;
      const isBlind = value === BLIND;
      if (isBlind && start < 0) start = column;
      if (!isBlind && start >= 0) {
        blind.push({
          x: (grid.fromX + start) * cell_m,
          y: (grid.fromY + row) * cell_m,
          width: (column - start) * cell_m,
          height: cell_m,
        });
        start = -1;
      }
    }
  }

  return { cell_m, zones, total: tally(decided, seen, cell_m), blind, cameras };
}

/**
 * D01: the 3D scene as data. `buildScene` turns the current PlanDocument into
 * a list of prisms — footprint polygon, base and height — and nothing else.
 * No Three.js here: the renderer only extrudes what it is given.
 *
 * Every footprint comes from src/domain/geometry: the rotated object in 3D is
 * the same polygon the 2D canvas draws (D-010), not a second rotation.
 */

import type {
  Catalog,
  Equipment,
  Opening,
  PlanDocument,
  Polygon,
  Ref,
  Wall,
  Zone,
} from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import {
  boundingBox,
  footprint,
  wallLength,
  wallObstacles,
  wallSpanPolygon,
  type BoundingBox,
} from '../../domain/geometry';
import { zoneDepth } from '../../domain/relations';

export type PrismKind = 'floor' | 'zone' | 'wall' | 'opening' | 'object';

/** A vertical extrusion of a world polygon: footprint in metres, z from `base_m`. */
export type ScenePrism = {
  kind: PrismKind;
  ref: Ref;
  label: string;
  polygon: Polygon;
  base_m: number;
  height_m: number;
  /** #RRGGBB */
  color: string;
  /** 1 is opaque; openings are translucent panes. */
  opacity: number;
};

export type Scene = {
  prisms: ScenePrism[];
  /** Extent of the room boundary, for framing the camera. */
  bounds: BoundingBox;
  ceilingHeight_m: number;
};

/**
 * Conventional colours for parts the catalog does not describe. Zone and
 * object colours come from the catalog; these are only the fallbacks.
 */
export const SCENE_COLORS = {
  floor: '#D0D4D9',
  wall: '#9AA0A6',
  zone: '#E9ECEF',
  object: '#868E96',
  entrance: '#2F9E44',
  door: '#E8590C',
  window: '#74C0FC',
} as const;

/** Floor slab lies below z = 0 so that zones and objects stand on it. */
const FLOOR_THICKNESS_M = 0.1;
/** Each nesting level lifts a zone by one slab, so children read above parents. */
const ZONE_SLAB_M = 0.02;
const OPENING_OPACITY = 0.45;
/** Pane thickness as a share of the wall: visible from both sides, never wider than the wall. */
const PANE_SHARE = 0.4;

/** Selection is a Ref; a prism answers to it by kind and id, so a wall and an object never mix. */
export function isSelected(prism: ScenePrism, selection: Ref | null): boolean {
  return selection !== null && prism.ref.kind === selection.kind && prism.ref.id === selection.id;
}

export function buildScene(plan: PlanDocument, catalog: Catalog = plan.catalog): Scene {
  // Скрытый слой не рисуется и здесь: 3D показывает то же, что холст 2D, иначе
  // выключенный «глаз» в панели слоёв врал бы в одном из двух видов. Помещение,
  // стены и проёмы слоёв не имеют и остаются всегда. Ссылка на несуществующий
  // слой не показывается — то же правило, что в `EquipmentLayer`.
  const shown = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const prisms: ScenePrism[] = [
    floorPrism(plan),
    // Глубина вложенности считается по всем зонам: родитель может быть скрыт.
    ...plan.zones
      .filter((zone) => shown.has(zone.layerId))
      .map((zone) => zonePrism(zone, plan.zones, catalog)),
    ...plan.walls.flatMap((wall) => wallPrisms(wall, plan.openings)),
    ...plan.openings.flatMap((opening) => openingPrism(opening, plan.walls)),
    ...plan.objects
      .filter((object) => shown.has(object.layerId))
      .map((object) => objectPrism(object, catalog)),
  ];
  return {
    prisms,
    bounds: boundingBox(plan.room.boundary),
    ceilingHeight_m: plan.room.ceilingHeight_m,
  };
}

function floorPrism(plan: PlanDocument): ScenePrism {
  return {
    kind: 'floor',
    ref: { kind: 'room', id: plan.room.id },
    label: plan.name,
    polygon: plan.room.boundary,
    base_m: -FLOOR_THICKNESS_M,
    height_m: FLOOR_THICKNESS_M,
    color: SCENE_COLORS.floor,
    opacity: 1,
  };
}

function zonePrism(zone: Zone, zones: Zone[], catalog: Catalog): ScenePrism {
  const type = catalog.zoneTypes.find((candidate) => candidate.id === zone.typeId);
  return {
    kind: 'zone',
    ref: { kind: 'zone', id: zone.id },
    label: zone.name,
    polygon: zone.polygon,
    // A nested zone's slab sits one step above its parent's; a broken or
    // cyclic chain (domain returns null) lies flat rather than guessing.
    base_m: (zoneDepth(zone.id, zones) ?? 0) * ZONE_SLAB_M,
    height_m: ZONE_SLAB_M,
    color: type?.color ?? SCENE_COLORS.zone,
    opacity: 1,
  };
}

/**
 * A wall is cut into horizontal bands at every sill and lintel; inside each
 * band the solid parts come from geometry's `wallObstacles`, which already
 * knows which openings clear the band. A doorway is therefore a real hole and
 * the wall above the lintel stays.
 */
function wallPrisms(wall: Wall, openings: Opening[]): ScenePrism[] {
  const own = openings.filter((opening) => opening.wallId === wall.id);
  const levels = [0, wall.height_m];
  for (const opening of own) {
    levels.push(opening.sill_m, opening.sill_m + opening.height_m);
  }
  const bands = [...new Set(levels)]
    .filter((level) => level >= 0 && level <= wall.height_m)
    .sort((a, b) => a - b);

  const prisms: ScenePrism[] = [];
  for (let index = 0; index + 1 < bands.length; index += 1) {
    const base_m = bands[index]!;
    const top_m = bands[index + 1]!;
    if (top_m - base_m <= TOLERANCE.coordinate_m) continue;
    for (const part of wallObstacles(wall, own, { base_m, top_m })) {
      prisms.push({
        kind: 'wall',
        ref: { kind: 'wall', id: wall.id },
        label: wall.id,
        polygon: part,
        base_m,
        height_m: top_m - base_m,
        color: SCENE_COLORS.wall,
        opacity: 1,
      });
    }
  }
  return prisms;
}

/**
 * Translucent pane in the wall plane: the opening stays visible as a thing with
 * an id. The rectangle is geometry's own `wallSpanPolygon` with a thinner
 * thickness, so the pane never drifts from the wall it belongs to (D-199).
 */
function openingPrism(opening: Opening, walls: Wall[]): ScenePrism[] {
  const wall = walls.find((candidate) => candidate.id === opening.wallId);
  if (!wall) return [];
  const length = wallLength(wall);
  if (length <= TOLERANCE.coordinate_m) return [];

  const polygon: Polygon = wallSpanPolygon(
    wall,
    opening.offset_m,
    opening.offset_m + opening.width_m,
    wall.thickness_m * PANE_SHARE,
  );
  return [
    {
      kind: 'opening',
      ref: { kind: 'opening', id: opening.id },
      label: opening.id,
      polygon,
      base_m: opening.sill_m,
      height_m: opening.height_m,
      color: SCENE_COLORS[opening.kind],
      opacity: OPENING_OPACITY,
    },
  ];
}

function objectPrism(object: Equipment, catalog: Catalog): ScenePrism {
  const type = catalog.objectTypes.find((candidate) => candidate.id === object.typeId);
  return {
    kind: 'object',
    ref: { kind: 'object', id: object.id },
    label: object.label,
    polygon: footprint(object),
    base_m: object.base_m,
    height_m: object.height_m,
    color: type?.color ?? SCENE_COLORS.object,
    opacity: 1,
  };
}

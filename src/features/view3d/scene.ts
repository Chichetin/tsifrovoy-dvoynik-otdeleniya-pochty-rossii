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
  LayerType,
  Opening,
  PlanDocument,
  Point,
  Polygon,
  Ref,
  Viewport,
  Wall,
  Zone,
} from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { sameOutline, symbolOutline } from '../../contracts/outline';
import {
  boundingBox,
  footprint,
  rotateOffset,
  screenToModel,
  wallLength,
  wallObstacles,
  wallSpanPolygon,
  type BoundingBox,
} from '../../domain/geometry';
import { findLayerType } from '../../domain/catalog';
import { heatColor } from '../../domain/heat-color';
import { formatShort, NBSP } from '../../domain/number-format';
import { zoneDepth } from '../../domain/relations';
import { zoneCaptionBoxes } from '../../domain/zone-caption-layout';

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
  /** Windows block walking; entrance and door panes only show the opening. */
  openingKind?: Opening['kind'];
  /** #59: the type's 3D model that stands in for the prism of an object. */
  model?: SceneModel;
};

/**
 * Where a model stands: the footprint centre and the object's local axes in
 * world metres, from the same rotation as the footprint (D-010).
 */
export type SceneModel = {
  name: string;
  center: Point;
  xAxis: Point;
  yAxis: Point;
  size_m: [number, number, number];
};

/**
 * A zone's name standing over its floor. `value` is the heat reading when a
 * heat layer paints the zone — the colour alone would not say what it means.
 */
export type SceneLabel = {
  ref: Ref;
  text: string;
  value?: string;
  /** Where the caption sits: the plan's own placement (D-348), in world metres. */
  center: Point;
  z_m: number;
  /** The caption never grows wider than the room it was placed in. */
  width_m: number;
};

export type Scene = {
  prisms: ScenePrism[];
  labels: SceneLabel[];
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
  wall: '#C3C8CE',
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
/** Zone captions are placed by the 2D layout at this scale; its pixels read back as metres. */
const LABEL_VIEWPORT: Viewport = { origin: [0, 0], scale: 40 };
/** Captions float a little above the slab, clear of the floor's z-fighting. */
const LABEL_LIFT_M = 0.1;
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
  const heat = heatLayers(plan);
  const shownZones = plan.zones.filter((zone) => shown.has(zone.layerId));
  const byId = new Map(plan.zones.map((zone) => [zone.id, zone]));
  const readings = new Map(shownZones.map((zone) => [zone.id, heatReading(zone, byId, heat)]));
  const prisms: ScenePrism[] = [
    floorPrism(plan),
    // Глубина вложенности считается по всем зонам: родитель может быть скрыт.
    ...shownZones.map((zone) => zonePrism(zone, plan.zones, catalog, readings.get(zone.id) ?? null)),
    ...plan.walls.flatMap((wall) => wallPrisms(wall, plan.openings, plan.walls)),
    ...plan.openings.flatMap((opening) => openingPrism(opening, plan.walls)),
    ...plan.objects
      .filter((object) => shown.has(object.layerId))
      .map((object) => objectPrism(object, catalog)),
  ];
  return {
    prisms,
    labels: zoneLabels(plan, shownZones, readings),
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

type ZoneHeat = Extract<LayerType['representation'], { kind: 'zone-heat' }>;
type HeatReading = { color: string; value: string };

/** Visible heat layers, the topmost first: where two have a value, the upper one paints. */
function heatLayers(plan: PlanDocument): ZoneHeat[] {
  return plan.layers
    .filter((layer) => layer.visible)
    .sort((a, b) => b.order - a.order)
    .flatMap((layer) => {
      const representation = findLayerType(plan.catalog, layer.typeId)?.representation;
      return representation?.kind === 'zone-heat' ? [representation] : [];
    });
}

/**
 * Deepest zone with a value paints each point (D-138): a zone without its own
 * value shows the nearest parent's, as the 2D layer does.
 */
function heatReading(zone: Zone, byId: Map<string, Zone>, heat: ZoneHeat[]): HeatReading | null {
  for (const representation of heat) {
    // A cyclic parent chain ends at the first zone seen twice.
    const seen = new Set<string>();
    let current: Zone | undefined = zone;
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const value = current.attributes[representation.attribute];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const unit = representation.unit === '' ? '' : `${NBSP}${representation.unit}`;
        return {
          color: heatColor(representation.colors, value, representation.max),
          value: `${formatShort(value)}${unit}`,
        };
      }
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  return null;
}

/** Zone names for 3D sit where the 2D editor puts them, so both views read the same. */
function zoneLabels(plan: PlanDocument, zones: Zone[], readings: Map<string, HeatReading | null>): SceneLabel[] {
  const boxes = zoneCaptionBoxes(plan, LABEL_VIEWPORT);
  return zones.flatMap((zone) => {
    const box = boxes.get(zone.id);
    if (box === undefined || zone.name.trim() === '') return [];
    const reading = readings.get(zone.id);
    return [
      {
        ref: { kind: 'zone', id: zone.id },
        text: zone.name,
        ...(reading == null ? {} : { value: reading.value }),
        center: screenToModel([box.x + box.width / 2, box.y + box.height / 2], LABEL_VIEWPORT),
        z_m: (zoneDepth(zone.id, plan.zones) ?? 0) * ZONE_SLAB_M + ZONE_SLAB_M + LABEL_LIFT_M,
        width_m: box.width / LABEL_VIEWPORT.scale,
      },
    ];
  });
}

function zonePrism(zone: Zone, zones: Zone[], catalog: Catalog, heat: HeatReading | null): ScenePrism {
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
    color: heat?.color ?? type?.color ?? SCENE_COLORS.zone,
    opacity: 1,
  };
}

/**
 * A wall is cut into horizontal bands at every sill and lintel; inside each
 * band the solid parts come from geometry's `wallObstacles`, which already
 * knows which openings clear the band. A doorway is therefore a real hole and
 * the wall above the lintel stays.
 */
function wallPrisms(wall: Wall, openings: Opening[], walls: Wall[]): ScenePrism[] {
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
    for (const part of wallObstacles(wall, openings, { base_m, top_m }, walls)) {
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
      openingKind: opening.kind,
      opacity: OPENING_OPACITY,
    },
  ];
}

function objectPrism(object: Equipment, catalog: Catalog): ScenePrism {
  const type = catalog.objectTypes.find((candidate) => candidate.id === object.typeId);
  // A model knows only its type's shape: a drawn outline (D-277) stays a prism.
  const model =
    type?.model3d !== undefined && type.outline === undefined && sameOutline(object.outline, symbolOutline(type.symbol))
      ? {
          name: type.model3d,
          center: object.position,
          xAxis: rotateOffset([1, 0], object.rotation_deg),
          yAxis: rotateOffset([0, 1], object.rotation_deg),
          size_m: [object.size_m[0], object.size_m[1], object.height_m] as [number, number, number],
        }
      : undefined;
  return {
    kind: 'object',
    ref: { kind: 'object', id: object.id },
    label: object.label,
    polygon: footprint(object),
    base_m: object.base_m,
    height_m: object.height_m,
    color: type?.color ?? SCENE_COLORS.object,
    opacity: 1,
    ...(model === undefined ? {} : { model }),
  };
}

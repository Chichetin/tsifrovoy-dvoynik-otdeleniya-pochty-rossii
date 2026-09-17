/**
 * The catalog the application starts with, and the plan a user gets on "new".
 *
 * The library is read from data/catalog/*.json at build time — the same files
 * the tests read — so adding an equipment type stays a JSON edit and never
 * becomes a code change.
 */

import layerTypes from '../../data/catalog/layer-types.json';
import objectTypes from '../../data/catalog/object-types.json';
import rules from '../../data/catalog/rules.json';
import zoneTypes from '../../data/catalog/zone-types.json';
import type { Catalog, Layer, PlanDocument } from '../contracts/model';
import { SCHEMA_VERSION } from '../contracts/model';
import { parseCatalog } from '../contracts/schema';

/** Conventional size of a new branch, in metres. The user redraws it. */
const NEW_ROOM = { width: 12, height: 9, ceiling: 3 } as const;
const WALL_THICKNESS_M = 0.25;
const BASE_LAYER = 'l_base';

function loadCatalog(): Catalog {
  const parsed = parseCatalog({
    version: '1.0.0',
    objectTypes,
    zoneTypes,
    layerTypes,
    rules,
  });
  if (!parsed.ok) {
    // A broken catalog is a build-time data error, not something the user can
    // work around: failing loudly beats an editor with an empty library.
    const where = parsed.issues.map((issue) => issue.path ?? issue.code).join(', ');
    throw new Error(`Справочник в data/catalog не разобрался: ${where}`);
  }
  return parsed.value;
}

export const catalog: Catalog = loadCatalog();

/**
 * Layers a new plan starts with: one ordinary layer that owns the content, and
 * one overlay per informational type from the catalog. The overlays are off
 * until someone asks for them, and they own nothing — they paint over the whole
 * plan, so a camera stays on its own layer and is still drawn with its sector.
 */
function startingLayers(): Layer[] {
  const base: Layer = {
    id: BASE_LAYER,
    name: 'Основной',
    visible: true,
    locked: false,
    order: 0,
    typeId: null,
  };
  const overlays = catalog.layerTypes.map((type, index) => ({
    id: `l_${type.id}`,
    name: type.label,
    visible: false,
    locked: false,
    order: index + 1,
    typeId: type.id,
  }));
  return [base, ...overlays];
}

/** An empty branch: four walls, one entrance, layers, nothing placed yet. */
export function createEmptyPlan(): PlanDocument {
  const { width, height, ceiling } = NEW_ROOM;
  const corners = {
    sw: [0, 0] as [number, number],
    se: [width, 0] as [number, number],
    ne: [width, height] as [number, number],
    nw: [0, height] as [number, number],
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `plan_${Date.now().toString(36)}`,
    name: 'Новое отделение',
    room: {
      id: 'room_main',
      boundary: [corners.sw, corners.se, corners.ne, corners.nw],
      ceilingHeight_m: ceiling,
    },
    walls: [
      { id: 'w_south', from: corners.sw, to: corners.se, thickness_m: WALL_THICKNESS_M, height_m: ceiling },
      { id: 'w_east', from: corners.se, to: corners.ne, thickness_m: WALL_THICKNESS_M, height_m: ceiling },
      { id: 'w_north', from: corners.ne, to: corners.nw, thickness_m: WALL_THICKNESS_M, height_m: ceiling },
      { id: 'w_west', from: corners.nw, to: corners.sw, thickness_m: WALL_THICKNESS_M, height_m: ceiling },
    ],
    openings: [
      {
        id: 'op_entrance',
        wallId: 'w_north',
        offset_m: width / 2 - 0.75,
        width_m: 1.5,
        kind: 'entrance',
        sill_m: 0,
        height_m: 2.1,
      },
    ],
    layers: startingLayers(),
    zones: [],
    objects: [],
    catalog,
    extensions: {},
  };
}

export const BASE_LAYER_ID = BASE_LAYER;

/**
 * The catalog the application starts with, and the plan a user gets on "new".
 *
 * The library is read from data/catalog/*.json at build time — the same files
 * the tests read — so adding an equipment type stays a JSON edit and never
 * becomes a code change.
 */

import objectTypes from '../../data/catalog/object-types.json';
import rules from '../../data/catalog/rules.json';
import zoneTypes from '../../data/catalog/zone-types.json';
import type { Catalog, PlanDocument } from '../contracts/model';
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

/** An empty branch: four walls, one entrance, one layer, nothing placed yet. */
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
    layers: [{ id: BASE_LAYER, name: 'Основной', visible: true, locked: false, order: 0 }],
    zones: [],
    objects: [],
    catalog,
    extensions: {},
  };
}

export const BASE_LAYER_ID = BASE_LAYER;

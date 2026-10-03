/**
 * IO02: reads the organizers' example into our own document.
 *
 * `example_plan.json` is a sample, not data we were given, and it stays exactly
 * as the organizers published it — this module never rewrites it. What it does
 * is translate: their flat walls/doors/windows become our walls with openings,
 * their four zones regain the nesting our model needs, and every field we do
 * not model is parked in `extensions` instead of being dropped.
 *
 * Two things it deliberately does NOT do. It does not fix the geometry: the
 * racks still cross the partition and the overlapping objects still overlap,
 * because that example is our test set for the correctness checks. And it does
 * not recompute zone membership — the declared `zone` is kept as imported, so
 * the first explicit edit in the editor is what reconciles the links.
 *
 * The example is silent about wall thickness, object heights and window sills.
 * Every value invented here is a team assumption, written into
 * `extensions['organizer-import'].assumptions` so it travels with the plan.
 */

import { z } from 'zod';
import {
  CONTRACT_ISSUE_CODES,
  type AttributeDef,
  type Attributes,
  type Catalog,
  type Equipment,
  type Id,
  type Issue,
  type ObjectType,
  type Opening,
  type OpeningKind,
  type PlanDocument,
  type Point,
  type Polygon,
  type Result,
  type Wall,
  type Zone,
  type ZoneType,
  SCHEMA_VERSION,
  TOLERANCE,
} from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';
import { applyCommand } from '../domain/commands';
import { normalizeAngle, projectOnSegment, segmentLength } from '../domain/geometry';
import { parentZoneFor } from '../domain/relations';

/** Codes owned by this module. */
export const IMPORT_ISSUE_CODES = {
  /** The payload is not the organizers' example format at all. */
  ORGANIZER_UNREADABLE: 'ORGANIZER_UNREADABLE',
  /** A door or window does not sit on any declared wall. */
  OPENING_WITHOUT_WALL: 'OPENING_WITHOUT_WALL',
} as const;

/**
 * Values the example does not state. They are assumptions of this team, not
 * norms of Почта России, and each one is reported with the imported plan.
 */
const ASSUMED = {
  outerWallThickness_m: 0.25,
  partitionThickness_m: 0.1,
  doorHeight_m: 2.1,
  windowSill_m: 0.9,
  defaultObjectHeight_m: 1,
} as const;

const ASSUMPTIONS: string[] = [
  `Толщина наружной стены ${ASSUMED.outerWallThickness_m} м и перегородки ${ASSUMED.partitionThickness_m} м — допущение команды: в примере организаторов толщина не указана.`,
  `Высота дверного проёма ${ASSUMED.doorHeight_m} м, подоконник окна ${ASSUMED.windowSill_m} м — допущение команды.`,
  'Высота оборудования взята из справочника команды по сопоставленному типу; в примере высоты нет.',
  'Стены получили высоту потолка помещения: отдельной высоты стен в примере нет.',
  'Принадлежность объекта зоне взята из поля «zone» как есть и не пересчитывалась по геометрии — иначе стеллажи потеряли бы заявленную связь.',
  'Родитель зоны восстановлен по полному геометрическому вложению полигонов: в примере вложенность не записана.',
];

/** One synthesised catalog entry per organizer type. */
type TypeSpec = {
  id: Id;
  label: string;
  category: string;
  size_m: Point;
  height_m: number;
  physical: boolean;
  occupiesFloor: boolean;
  symbol: ObjectType['symbol'];
  /** 3D model (D-356): our catalog's model for a known type, own model for ATM, safe, counter. */
  model3d?: string;
  color: string;
  attributes?: AttributeDef[];
};

const CAPACITY_ATTRIBUTE: AttributeDef = {
  key: 'capacity_persons',
  label: 'Мест для посетителей',
  type: 'number',
  required: false,
};

/**
 * Organizer type → our catalog id. Where our library already has the same
 * thing, the id matches it, so the stocking rules in data/catalog apply to the
 * imported plan once the catalogs are merged. Types our library does not have
 * get a new id and are marked as coming from the example.
 */
const OBJECT_TYPES: Record<string, TypeSpec> = {
  cashier_window: {
    id: 'ot_cashier_window',
    label: 'Кассовое окно / операционное место',
    category: 'Зона обслуживания клиентов',
    size_m: [1.6, 0.9],
    height_m: 1.1,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'cashier-window',
    color: '#0CA678',
  },
  pvz_counter: {
    id: 'ot_pvz_counter',
    label: 'Стойка ПВЗ (выдача посылок)',
    category: 'Зона обслуживания клиентов',
    size_m: [2, 0.8],
    height_m: 1.1,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'pvz-counter',
    color: '#0B7285',
  },
  self_service_kiosk: {
    id: 'ot_queue_terminal',
    label: 'Терминал электронной очереди',
    category: 'Зона обслуживания клиентов',
    size_m: [0.5, 0.5],
    height_m: 1.4,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'queue-terminal',
    color: '#087F5B',
  },
  atm: {
    id: 'ot_atm',
    label: 'Банкомат',
    category: 'Зона обслуживания клиентов',
    size_m: [0.7, 0.5],
    height_m: 1.6,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'atm',
    color: '#2B8A3E',
  },
  info_stand: {
    id: 'ot_info_stand',
    label: 'Информационный стенд / указатель',
    category: 'Вспомогательные элементы',
    size_m: [0.9, 0.2],
    height_m: 1.8,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'info-stand',
    color: '#D6336C',
  },
  waiting_seat: {
    id: 'ot_bench',
    label: 'Скамья / кресло для ожидания',
    category: 'Зона обслуживания клиентов',
    size_m: [1.6, 0.5],
    height_m: 0.45,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'bench',
    color: '#F59F00',
    attributes: [CAPACITY_ATTRIBUTE],
  },
  storage_rack: {
    id: 'ot_parcel_rack',
    label: 'Стеллаж / полки для посылок',
    category: 'Вспомогательные элементы',
    size_m: [1.2, 0.5],
    height_m: 2,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'parcel-rack',
    color: '#E03131',
  },
  safe: {
    id: 'ot_safe',
    label: 'Сейф',
    category: 'Безопасность и коммуникации',
    size_m: [0.6, 0.6],
    height_m: 0.8,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'safe',
    color: '#5F3DC4',
  },
  back_office_workplace: {
    id: 'ot_workplace',
    label: 'Рабочее место сотрудника',
    category: 'Рабочее место оператора',
    size_m: [1.4, 0.8],
    height_m: 0.75,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    model3d: 'workplace',
    color: '#4C6EF5',
  },
  fitting_room: {
    id: 'ot_fitting_room',
    label: 'Примерочная',
    category: 'Вспомогательные элементы',
    size_m: [1, 1],
    height_m: 2,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    color: '#9C36B5',
  },
  weighing_station: {
    id: 'ot_scales',
    label: 'Весы',
    category: 'Вспомогательные элементы',
    size_m: [0.4, 0.35],
    height_m: 0.12,
    physical: true,
    occupiesFloor: false,
    symbol: 'rect',
    model3d: 'scales',
    color: '#A61E4D',
  },
  package_drop_box: {
    id: 'ot_package_drop_box',
    label: 'Ящик приёма отправлений',
    category: 'Зона обслуживания клиентов',
    size_m: [0.6, 0.5],
    height_m: 1.2,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    color: '#099268',
  },
  trash_bin: {
    id: 'ot_trash_bin',
    label: 'Урна',
    category: 'Вспомогательные элементы',
    size_m: [0.35, 0.35],
    height_m: 0.7,
    physical: true,
    occupiesFloor: true,
    symbol: 'circle',
    color: '#868E96',
  },
  potted_plant: {
    id: 'ot_potted_plant',
    label: 'Растение в кадке',
    category: 'Вспомогательные элементы',
    size_m: [0.5, 0.5],
    height_m: 1,
    physical: true,
    occupiesFloor: true,
    symbol: 'circle',
    color: '#2F9E44',
  },
};

const ZONE_TYPES: Record<string, ZoneType> = {
  client_area: { id: 'zt_client', label: 'Клиентская зона', color: '#E7F5FF', attributes: [] },
  back_office: { id: 'zt_storage', label: 'Хранение и посылки', color: '#FFF5F5', attributes: [] },
  waiting: {
    id: 'zt_waiting',
    label: 'Зона ожидания',
    color: '#FFF4E6',
    attributes: [
      {
        key: 'expected_capacity_persons',
        label: 'Расчётная вместимость, человек',
        type: 'number',
        required: false,
      },
    ],
  },
  queue_accumulator: { id: 'zt_queue', label: 'Зона очереди', color: '#FFF0F6', attributes: [] },
};

const finite = z.number().finite();
const pointSchema = z.tuple([finite, finite]);

const organizerSchema = z.object({
  ops: z.object({
    id: z.string().min(1),
    ceiling_height_m: finite.positive(),
    bbox: z.object({ width_m: finite.positive(), height_m: finite.positive() }),
    name: z.string().optional(),
  }),
  walls: z
    .array(
      z.object({
        id: z.string().min(1),
        from: pointSchema,
        to: pointSchema,
        type: z.string().optional(),
      }),
    )
    .min(1),
  doors: z
    .array(
      z.object({
        id: z.string().min(1),
        wall: z.tuple([finite, finite, finite, finite]),
        type: z.string().optional(),
        width_m: finite.positive().optional(),
      }),
    )
    .optional(),
  windows: z
    .array(
      z.object({
        id: z.string().min(1),
        wall: z.tuple([finite, finite, finite, finite]),
        height_m: finite.positive().optional(),
      }),
    )
    .optional(),
  zones: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      label: z.string().optional(),
      polygon: z.array(pointSchema).min(3),
    }),
  ),
  equipment: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      label: z.string().optional(),
      position: pointSchema,
      size_m: z.tuple([finite.positive(), finite.positive()]),
      rotation_deg: finite.optional(),
      zone: z.string().nullable().optional(),
    }),
  ),
});

type OrganizerPlan = z.infer<typeof organizerSchema>;

/** Fields of an entity we model explicitly; everything else is kept aside. */
const MODELLED_FIELDS = {
  wall: new Set(['id', 'from', 'to']),
  opening: new Set(['id', 'wall', 'width_m']),
  zone: new Set(['id', 'type', 'label', 'polygon']),
  object: new Set(['id', 'type', 'label', 'position', 'size_m', 'rotation_deg', 'zone']),
  document: new Set(['ops', 'walls', 'doors', 'windows', 'zones', 'equipment']),
};

const LAYER_ID = 'l_imported';

function issue(code: string, message: string, path?: string): Issue {
  return path === undefined
    ? { code, severity: 'error', message, refs: [] }
    : { code, severity: 'error', message, refs: [], path };
}

/** Everything of `source` this module does not put into a typed field. */
function leftovers(source: unknown, modelled: Set<string>): Record<string, unknown> {
  if (typeof source !== 'object' || source === null) return {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!modelled.has(key)) rest[key] = value;
  }
  return rest;
}

/** Scalar leftovers become attributes; anything structured stays in extensions. */
function splitLeftovers(
  rest: Record<string, unknown>,
  allowed: Set<string>,
): { attributes: Attributes; extras: Record<string, unknown> } {
  const attributes: Attributes = {};
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    const scalar =
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value));
    if (scalar && allowed.has(key)) {
      attributes[key] = value as string | number | boolean;
    } else {
      extras[key] = value;
    }
  }
  return { attributes, extras };
}

function normalizeRotation(value: number | undefined): number {
  return value === undefined ? 0 : normalizeAngle(value);
}

/** Distance from `wall.from` to `point`, if the point lies on the wall segment. */
function offsetAlongWall(wall: Wall, point: Point): number | null {
  const length = segmentLength(wall.from, wall.to);
  if (length === 0) return null;
  // The foot is clamped to the segment, so a point past either end shows up
  // as a distance to that end, and a point beside the wall as a distance to it.
  const { t, distance } = projectOnSegment(point, wall.from, wall.to);
  // Millimetres are the file's precision; `t · length` alone leaves 5.3999999.
  return distance > TOLERANCE.coordinate_m ? null : Math.round(t * length * 1000) / 1000;
}

/**
 * The example places a door by its own segment, not by a wall id. The wall is
 * the one that carries both ends of that segment.
 */
function locateOpening(
  walls: Wall[],
  segment: [number, number, number, number],
): { wall: Wall; offset_m: number; width_m: number } | null {
  const ends: [Point, Point] = [
    [segment[0], segment[1]],
    [segment[2], segment[3]],
  ];
  for (const wall of walls) {
    const first = offsetAlongWall(wall, ends[0]);
    const second = offsetAlongWall(wall, ends[1]);
    if (first === null || second === null) continue;
    return {
      wall,
      offset_m: Math.min(first, second),
      width_m: Math.abs(first - second),
    };
  }
  return null;
}

function openingKind(declared: string | undefined, isWindow: boolean): OpeningKind {
  if (isWindow) return 'window';
  return declared === 'entrance' ? 'entrance' : 'door';
}

function wallThickness(declaredType: string | undefined): number {
  return declaredType === 'partition'
    ? ASSUMED.partitionThickness_m
    : ASSUMED.outerWallThickness_m;
}

/** Unknown organizer types still get a catalog entry, so nothing dangles. */
function objectTypeSpec(organizerType: string): TypeSpec {
  const known = OBJECT_TYPES[organizerType];
  if (known !== undefined) return known;
  return {
    id: `ot_${organizerType}`,
    label: organizerType,
    category: 'Импорт примера организаторов',
    size_m: [0.6, 0.6],
    height_m: ASSUMED.defaultObjectHeight_m,
    physical: true,
    occupiesFloor: true,
    symbol: 'rect',
    color: '#868E96',
  };
}

function zoneTypeSpec(organizerType: string): ZoneType {
  const known = ZONE_TYPES[organizerType];
  if (known !== undefined) return known;
  return { id: `zt_${organizerType}`, label: organizerType, color: '#E9ECEF', attributes: [] };
}

function specToObjectType(spec: TypeSpec, fromExample: boolean): ObjectType {
  return {
    id: spec.id,
    label: spec.label,
    category: spec.category,
    defaultSize_m: spec.size_m,
    defaultHeight_m: spec.height_m,
    defaultBase_m: 0,
    physical: spec.physical,
    occupiesFloor: spec.occupiesFloor,
    symbol: spec.symbol,
    ...(spec.model3d === undefined ? {} : { model3d: spec.model3d }),
    color: spec.color,
    attributes: spec.attributes ?? [],
    provenance: fromExample
      ? 'Допущение команды: тип из example_plan.json, размеры и высота — из справочника команды по сопоставленному типу.'
      : 'Допущение команды: тип объявлен в equipment_types_catalog примера, но в плане не встречается.',
  };
}

/**
 * Translates the organizers' example into a plan document. The input is never
 * modified; unknown fields travel in `extensions`.
 */
export function importOrganizerExample(input: unknown): Result<PlanDocument> {
  const parsed = organizerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((entry) =>
        issue(
          IMPORT_ISSUE_CODES.ORGANIZER_UNREADABLE,
          entry.message,
          entry.path.join('.') || undefined,
        ),
      ),
    };
  }

  const source = parsed.data;
  const raw = input as Record<string, unknown>;
  const issues: Issue[] = [];

  const { width_m: width, height_m: height } = source.ops.bbox;
  const boundary: Polygon = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];

  const rawWalls = Array.isArray(raw.walls) ? raw.walls : [];
  const walls: Wall[] = source.walls.map((wall) => ({
    id: wall.id,
    from: wall.from,
    to: wall.to,
    thickness_m: wallThickness(wall.type),
    height_m: source.ops.ceiling_height_m,
  }));

  const rawDoors = Array.isArray(raw.doors) ? raw.doors : [];
  const rawWindows = Array.isArray(raw.windows) ? raw.windows : [];
  const openings: Opening[] = [];
  const openingExtras: Record<string, unknown> = {};

  const addOpening = (
    entry: { id: string; wall: [number, number, number, number]; width_m?: number },
    isWindow: boolean,
    declaredKind: string | undefined,
    declaredHeight: number | undefined,
    rawEntry: unknown,
  ): void => {
    const located = locateOpening(walls, entry.wall);
    if (located === null) {
      issues.push(
        issue(
          IMPORT_ISSUE_CODES.OPENING_WITHOUT_WALL,
          `Проём «${entry.id}» не лежит ни на одной объявленной стене.`,
          entry.id,
        ),
      );
      return;
    }
    openings.push({
      id: entry.id,
      wallId: located.wall.id,
      offset_m: located.offset_m,
      width_m: entry.width_m ?? located.width_m,
      kind: openingKind(declaredKind, isWindow),
      sill_m: isWindow ? ASSUMED.windowSill_m : 0,
      height_m: declaredHeight ?? ASSUMED.doorHeight_m,
    });
    const rest = leftovers(rawEntry, MODELLED_FIELDS.opening);
    if (Object.keys(rest).length > 0) openingExtras[entry.id] = rest;
  };

  (source.doors ?? []).forEach((door, index) => {
    addOpening(door, false, door.type, undefined, rawDoors[index]);
  });
  (source.windows ?? []).forEach((window, index) => {
    addOpening(window, true, undefined, window.height_m, rawWindows[index]);
  });

  const rawZones = Array.isArray(raw.zones) ? raw.zones : [];
  // No nesting yet: every zone is a root while parents are being derived.
  const zoneShapes = source.zones.map((zone) => ({ id: zone.id, polygon: zone.polygon, parentId: null }));
  const zoneExtras: Record<string, unknown> = {};
  const zones: Zone[] = source.zones.map((zone, index) => {
    const rest = leftovers(rawZones[index], MODELLED_FIELDS.zone);
    const split = splitLeftovers(rest, new Set(['expected_capacity_persons']));
    if (Object.keys(split.extras).length > 0) zoneExtras[zone.id] = split.extras;
    return {
      id: zone.id,
      typeId: zoneTypeSpec(zone.type).id,
      name: zone.label ?? zone.id,
      polygon: zone.polygon,
      parentId: parentZoneFor(zone.polygon, zoneShapes, zone.id),
      layerId: LAYER_ID,
      attributes: split.attributes,
    };
  });

  const rawObjects = Array.isArray(raw.equipment) ? raw.equipment : [];
  const objectExtras: Record<string, unknown> = {};
  const objects: Equipment[] = source.equipment.map((item, index) => {
    const spec = objectTypeSpec(item.type);
    const rest = leftovers(rawObjects[index], MODELLED_FIELDS.object);
    const split = splitLeftovers(rest, new Set(['capacity_persons']));
    if (Object.keys(split.extras).length > 0) objectExtras[item.id] = split.extras;
    return {
      id: item.id,
      typeId: spec.id,
      label: item.label ?? item.id,
      position: item.position,
      size_m: item.size_m,
      rotation_deg: normalizeRotation(item.rotation_deg),
      base_m: 0,
      height_m: spec.height_m,
      // Declared membership is kept as imported; reconciliation is an edit.
      zoneId: item.zone ?? null,
      layerId: LAYER_ID,
      attributes: split.attributes,
    };
  });

  const catalog = buildCatalog(source, raw);

  const document: PlanDocument = {
    schemaVersion: SCHEMA_VERSION,
    id: source.ops.id,
    name: source.ops.name ?? source.ops.id,
    room: { id: 'room_main', boundary, ceilingHeight_m: source.ops.ceiling_height_m },
    walls,
    openings,
    layers: [
      {
        id: LAYER_ID,
        name: 'Импортированный план',
        visible: true,
        locked: false,
        order: 0,
        typeId: null,
      },
    ],
    zones,
    objects,
    catalog,
    extensions: {
      'organizer-import': {
        source: 'example_plan.json',
        assumptions: ASSUMPTIONS,
        ops: raw.ops,
        rest: leftovers(raw, MODELLED_FIELDS.document),
        walls: collectExtras(rawWalls, source.walls, MODELLED_FIELDS.wall),
        openings: openingExtras,
        zones: zoneExtras,
        objects: objectExtras,
      },
    },
  };

  if (issues.length > 0) return { ok: false, issues };

  const validated = parsePlanDocument(document);
  if (!validated.ok) {
    return {
      ok: false,
      issues: [
        issue(
          CONTRACT_ISSUE_CODES.SCHEMA_INVALID,
          'Импортированный план не прошёл собственную схему — это дефект адаптера, а не примера.',
        ),
        ...validated.issues,
      ],
    };
  }
  return validated;
}

function collectExtras(
  rawEntries: unknown[],
  entries: { id: string }[],
  modelled: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  entries.forEach((entry, index) => {
    const rest = leftovers(rawEntries[index], modelled);
    if (Object.keys(rest).length > 0) out[entry.id] = rest;
  });
  return out;
}

/**
 * The snapshot that travels with the file. It covers every type the plan uses
 * and every type the example only announces in `equipment_types_catalog`, so a
 * later addition from that list opens without a dangling reference.
 */
function buildCatalog(source: OrganizerPlan, raw: Record<string, unknown>): Catalog {
  const used = new Set(source.equipment.map((item) => item.type));
  const announced = announcedTypes(raw);
  const objectTypes: ObjectType[] = [];
  const seen = new Set<Id>();

  for (const organizerType of [...used, ...announced]) {
    const spec = objectTypeSpec(organizerType);
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    objectTypes.push(specToObjectType(spec, used.has(organizerType)));
  }

  const zoneTypes: ZoneType[] = [];
  const seenZones = new Set<Id>();
  for (const zone of source.zones) {
    const spec = zoneTypeSpec(zone.type);
    if (seenZones.has(spec.id)) continue;
    seenZones.add(spec.id);
    zoneTypes.push(spec);
  }

  // The example carries no stocking rules; ours live in data/catalog and are
  // merged by an explicit catalog.replace, not smuggled in by the importer.
  // Layer types are ours too: the example knows nothing about informational
  // layers, so they arrive with the same catalog.replace as the rules.
  return { version: ORGANIZER_CATALOG_VERSION, objectTypes, zoneTypes, layerTypes: [], rules: [] };
}

/** Catalog version the importer stamps; `withTeamCatalog` recognises it by this. */
export const ORGANIZER_CATALOG_VERSION = 'organizer-example-1';

/**
 * Merges the team catalog into an imported example: our types win where the id
 * matches, the example's own types stay, and our stocking rules and
 * informational layer types come along — with one hidden overlay layer per
 * layer type, as a new plan gets. Without this the example opened with only
 * geometric checks: the "terminal within 3 m of the entrance" rule lives in
 * data/catalog and never reached the imported plan (jury run, 2026-09-19).
 * Nothing partial: a refused merge returns the issues and the plan is unchanged.
 */
export function withTeamCatalog(plan: PlanDocument, team: Catalog): Result<PlanDocument> {
  const teamObjectIds = new Set(team.objectTypes.map((type) => type.id));
  const teamZoneIds = new Set(team.zoneTypes.map((type) => type.id));
  const merged = applyCommand(plan, {
    type: 'catalog.replace',
    catalog: {
      version: `${team.version}+organizer-example`,
      objectTypes: [
        ...team.objectTypes,
        ...plan.catalog.objectTypes.filter((type) => !teamObjectIds.has(type.id)),
      ],
      zoneTypes: [
        ...team.zoneTypes,
        ...plan.catalog.zoneTypes.filter((type) => !teamZoneIds.has(type.id)),
      ],
      layerTypes: team.layerTypes,
      rules: team.rules,
    },
  });
  if (!merged.ok) return merged;

  let result = merged.value;
  const present = new Set(result.layers.map((layer) => layer.typeId));
  let order = Math.max(0, ...result.layers.map((layer) => layer.order)) + 1;
  for (const type of team.layerTypes) {
    if (present.has(type.id)) continue;
    const put = applyCommand(result, {
      type: 'layer.put',
      layer: { id: `l_${type.id}`, name: type.label, visible: false, locked: false, order, typeId: type.id },
    });
    if (!put.ok) return put;
    result = put.value;
    order += 1;
  }
  return { ok: true, value: result };
}

function announcedTypes(raw: Record<string, unknown>): string[] {
  const notes = raw._format_notes;
  if (typeof notes !== 'object' || notes === null) return [];
  const list = (notes as Record<string, unknown>).equipment_types_catalog;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === 'string');
}

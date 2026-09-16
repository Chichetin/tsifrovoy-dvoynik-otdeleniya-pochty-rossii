/**
 * Contracts v1: plan document model. Frozen by F02, see docs/contracts-v1.md.
 * No implementation is imported here — this module only declares shared shapes.
 */

export type Id = string;

/** World point in metres: X to the right, Y up. */
export type Point = [number, number];

/** Unclosed ring, at least 3 vertices, no holes. */
export type Polygon = Point[];

export type Attributes = Record<string, string | number | boolean | null>;

export type RefKind = 'room' | 'zone' | 'object' | 'layer' | 'wall' | 'opening';

export type Ref = { kind: RefKind; id: Id };

export type Severity = 'error' | 'warning';

export type Issue = {
  code: string;
  severity: Severity;
  message: string;
  refs: Ref[];
  /** JSON pointer-like path into the document, for structural issues. */
  path?: string;
  /** Geometry that shows the problem on the plan. */
  polygon?: Polygon;
};

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export type Layer = {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
};

export type Zone = {
  id: Id;
  typeId: Id;
  name: string;
  polygon: Polygon;
  parentId: Id | null;
  layerId: Id;
  attributes: Attributes;
};

export type Equipment = {
  id: Id;
  typeId: Id;
  label: string;
  /** Centre of the object. */
  position: Point;
  /** Local extent along X and Y before rotation. */
  size_m: Point;
  /** Normalised to [0, 360); positive turns clockwise. */
  rotation_deg: number;
  base_m: number;
  height_m: number;
  zoneId: Id | null;
  layerId: Id;
  attributes: Attributes;
};

export type Wall = {
  id: Id;
  from: Point;
  to: Point;
  thickness_m: number;
  height_m: number;
};

export type OpeningKind = 'entrance' | 'door' | 'window';

export type Opening = {
  id: Id;
  wallId: Id;
  /** Distance from the wall's `from` end to the opening's near edge. */
  offset_m: number;
  width_m: number;
  kind: OpeningKind;
  sill_m: number;
  height_m: number;
};

export type AttributeType = 'string' | 'number' | 'boolean';

export type AttributeDef = {
  key: string;
  label: string;
  type: AttributeType;
  required: boolean;
  default?: string | number | boolean;
};

export type ObjectSymbol = 'rect' | 'circle' | 'triangle';

export type ObjectType = {
  id: Id;
  label: string;
  category: string;
  defaultSize_m: Point;
  defaultHeight_m: number;
  defaultBase_m: number;
  /** Takes part in collision checks. */
  physical: boolean;
  /** Counts towards occupied floor area. */
  occupiesFloor: boolean;
  symbol: ObjectSymbol;
  color: string;
  attributes: AttributeDef[];
  /** Where the defaults come from; synthetic assumptions say so here. */
  provenance: string;
};

export type ZoneType = {
  id: Id;
  label: string;
  color: string;
  attributes: AttributeDef[];
};

export type RuleSource = {
  id: Id;
  source: 'team-assumption' | 'organizer-material';
  rationale: string;
};

export type CountRule = RuleSource & {
  kind: 'count';
  zoneTypeId: Id;
  objectTypeId: Id;
  /** `direct` counts the zone itself, `inclusive` also counts descendants. */
  scope: 'direct' | 'inclusive';
  min: number | null;
  max: number | null;
};

export type DistanceToEntranceRule = RuleSource & {
  kind: 'distance-to-entrance';
  objectTypeId: Id;
  maxDistance_m: number;
  /** `null` means the nearest entrance. */
  entranceId: Id | null;
};

export type Rule = CountRule | DistanceToEntranceRule;

export type Catalog = {
  version: string;
  objectTypes: ObjectType[];
  zoneTypes: ZoneType[];
  rules: Rule[];
};

export type Room = {
  id: Id;
  boundary: Polygon;
  ceilingHeight_m: number;
};

export type PlanDocument = {
  schemaVersion: 1;
  id: Id;
  name: string;
  room: Room;
  walls: Wall[];
  openings: Opening[];
  layers: Layer[];
  zones: Zone[];
  objects: Equipment[];
  /** Catalog snapshot travels with the file so custom types survive transfer. */
  catalog: Catalog;
  /** JSON values only; importers park unknown data here. */
  extensions: Record<string, unknown>;
};

/** Current document schema version. A higher version in a file is rejected. */
export const SCHEMA_VERSION = 1 as const;

/** Derived shapes shared between domain modules and UI. */

export type Viewport = { origin: Point; scale: number };

export type ZoneResolution = { zoneId: Id | null; issues: Issue[] };

export type AreaMetrics = { total_m2: number; occupied_m2: number; free_m2: number };

export type Metrics = { room: AreaMetrics; zones: Record<Id, AreaMetrics> };

export type Inventory = {
  rows: Equipment[];
  byType: Record<Id, number>;
  byZoneDirect: Record<Id, number>;
  byZoneInclusive: Record<Id, number>;
  unassigned: number;
};

/**
 * Numeric tolerances. Touching borders without positive overlap area is not a
 * collision; clearance between objects is a separate rule, not this tolerance.
 */
export const TOLERANCE = {
  coordinate_m: 1e-6,
  area_m2: 1e-8,
} as const;

/**
 * Input limits for v1. These bound what the schema accepts; they are not a
 * statement about measured performance.
 */
export const LIMITS = {
  maxObjects: 2000,
  maxZones: 200,
  maxPolygonVertices: 256,
  maxTotalVertices: 20000,
  maxQueryChars: 2000,
  maxRequestBytes: 5 * 1024 * 1024,
} as const;

/**
 * Issue codes owned by F02: structure, schema and zone resolution. Other
 * packages add their own codes next to their own checks.
 */
export const CONTRACT_ISSUE_CODES = {
  /** Payload is not JSON, or not an object at all. */
  DOCUMENT_UNREADABLE: 'DOCUMENT_UNREADABLE',
  /** A field is missing or has the wrong type. */
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  /** schemaVersion is newer than this build understands. */
  FUTURE_VERSION: 'FUTURE_VERSION',
  /** Two entities of the plan share an id. */
  DUPLICATE_ID: 'DUPLICATE_ID',
  /** A reference points at an id that does not exist. */
  BROKEN_REF: 'BROKEN_REF',
  /** Zone parentId chain closes on itself. */
  ZONE_CYCLE: 'ZONE_CYCLE',
  /** A document must keep at least one layer. */
  NO_LAYERS: 'NO_LAYERS',
  /** Input exceeds a value from LIMITS. */
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  /** Several equally deep zones contain the footprint. */
  ZONE_AMBIGUOUS: 'ZONE_AMBIGUOUS',
  /** Geometry cannot be computed, so relations need a recalculation. */
  RELATIONS_STALE: 'RELATIONS_STALE',
} as const;

export type ContractIssueCode =
  (typeof CONTRACT_ISSUE_CODES)[keyof typeof CONTRACT_ISSUE_CODES];

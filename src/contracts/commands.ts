/**
 * Contracts v1: editing commands and the pure-function signatures that consume
 * them. Frozen by F02, see docs/contracts-v1.md.
 *
 * A `put` command creates or replaces a whole entity; the id is generated before
 * the command and a deleted id is never reused.
 */

import type {
  Catalog,
  Equipment,
  Id,
  Inventory,
  Issue,
  Layer,
  Metrics,
  Opening,
  PlanDocument,
  Point,
  Polygon,
  Ref,
  Result,
  Viewport,
  Wall,
  Zone,
  ZoneResolution,
} from './model';

export type Command =
  | { type: 'room.set'; boundary: Polygon }
  | { type: 'zone.put'; zone: Zone }
  | { type: 'zone.delete'; id: Id }
  | { type: 'object.put'; object: Equipment }
  | { type: 'object.delete'; id: Id }
  | { type: 'layer.put'; layer: Layer }
  /** Content of the removed layer moves to `moveTo`, which must exist. */
  | { type: 'layer.delete'; id: Id; moveTo: Id }
  | { type: 'wall.put'; wall: Wall }
  /** Deletes the wall and its openings in one undo step. */
  | { type: 'wall.delete'; id: Id }
  | { type: 'opening.put'; opening: Opening }
  | { type: 'opening.delete'; id: Id }
  | { type: 'catalog.replace'; catalog: Catalog }
  /** Plan name: shown in the header and used for the file name; must not be blank. */
  | { type: 'plan.rename'; name: string }
  /** Ceiling height; outer walls follow it, partitions keep their own height. */
  | { type: 'room.setCeiling'; ceilingHeight_m: number }
  | { type: 'relations.reconcile' };

export type CommandType = Command['type'];

/** src/domain/geometry */
export type Footprint = (object: Equipment) => Polygon;
export type Contains = (container: Polygon, shape: Polygon) => boolean;
export type Intersects = (a: Polygon, b: Polygon) => boolean;
export type ModelToScreen = (point: Point, viewport: Viewport) => Point;
export type ScreenToModel = (point: Point, viewport: Viewport) => Point;

/** src/domain/relations */
export type ResolveZone = (object: Equipment, zones: Zone[]) => ZoneResolution;
/**
 * Returns ok:true even when objects stay unassigned — `zoneId` is then null and
 * validatePlan reports it. ok:false is for structural failures only.
 */
export type ReconcileZones = (plan: PlanDocument) => Result<PlanDocument>;

/** src/domain/metrics */
export type MeasurePlan = (plan: PlanDocument) => Result<Metrics>;

/** src/domain/catalog */
export type ValidateCatalog = (catalog: Catalog) => Issue[];

/** src/domain/inventory */
export type BuildInventory = (plan: PlanDocument) => Inventory;

/** src/domain/validation */
export type ValidatePlan = (plan: PlanDocument) => Issue[];

/** src/domain/commands */
export type ApplyCommand = (plan: PlanDocument, command: Command) => Result<PlanDocument>;

/** src/domain/persistence */
export type DecodePlan = (text: string) => Result<PlanDocument>;
export type EncodePlan = (plan: PlanDocument) => Result<string>;
export type ImportOrganizerExample = (input: unknown) => Result<PlanDocument>;

/** Where a document replacing the current one came from. */
export type DocumentOrigin = 'file' | 'new' | 'draft';

/**
 * Read-only store surface. A successful dispatch/replace/undo/redo raises
 * `revision`; preparing an export does not. `dirty` compares document content
 * against the last baseline, so undo back to it clears dirty.
 */
export type PlanStore = {
  readonly document: PlanDocument;
  readonly revision: number;
  readonly selection: Ref | null;
  readonly dirty: boolean;
  /**
   * Ids retired by a delete in this session (D-019): a put with one of them is
   * refused, so whoever mints ids for new entities must skip them.
   */
  readonly retired: ReadonlySet<Id>;
  dispatch(command: Command): Result<PlanDocument>;
  replaceDocument(plan: PlanDocument, origin: DocumentOrigin): Result<PlanDocument>;
  undo(): void;
  redo(): void;
  select(ref: Ref | null): void;
  /** Marks an export prepared for this revision; a stale revision is ignored. */
  markExported(revision: number): void;
};

/**
 * Contracts v1: UI props and editor tool seams. Frozen by F02, see
 * docs/contracts-v1.md. React types are allowed here and only here; domain and
 * server modules never import this file.
 *
 * Pointer events carry world coordinates. Tools never convert Y themselves —
 * every conversion goes through src/domain/geometry with one session viewport.
 */

import type { ReactNode } from 'react';
import type { AdviceRequest, AdviceResponse, Candidate } from './advice';
import type { Command } from './commands';
import type {
  Catalog,
  Id,
  Inventory,
  Issue,
  PlanDocument,
  Point,
  Ref,
  Result,
  Viewport,
} from './model';

export type Tool =
  | { kind: 'select' | 'pan' | 'room.draw' | 'zone.draw' | 'wall.draw' | 'opening.place' }
  | { kind: 'object.place'; typeId: Id };

export type ToolKind = Tool['kind'];

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

export type WorldPointer = {
  phase: PointerPhase;
  /** World point in metres. */
  point: Point;
  shift: boolean;
  alt: boolean;
  button: number;
};

/** `sequence` lets the canvas react to a repeated focus on the same ref. */
export type FocusRequest = { ref: Ref; sequence: number };

export type ToolController = {
  handlePointer(event: WorldPointer): void;
  cancel(): void;
  /** Vertices drawn so far, or null when no gesture is in progress. */
  draft: Point[] | null;
};

/** Coordinated by src/app and never persisted. */
export type EditorSession = {
  tool: Tool;
  viewport: Viewport;
  selection: Ref | null;
  /**
   * Objects picked as a group (`PlanStore.selected`): a marquee or Shift+click
   * fills it, the primary `selection` is one of them. Optional so a harness
   * without a store still types; absent means «only `selection`».
   */
  selected?: ReadonlySet<Id>;
  preview: Candidate | null;
  focus: FocusRequest | null;
  /**
   * Ids a delete has retired in this session (`PlanStore.retired`): tools that
   * mint ids for what they draw or place skip them, or the store refuses the
   * put. Optional so a harness without a store still types.
   */
  retired?: ReadonlySet<Id>;
};

export type CommandSink = (command: Command) => Result<PlanDocument>;
export type SelectSink = (ref: Ref | null) => void;

/** A frame of an object move: visible in the card, absent from document history. */
export type ObjectGesturePreview = { objectId: Id; position: Point } | null;

/** Read-only external store: subscribing re-renders the card, not the whole app. */
export type ObjectGesturePreviewSource = {
  getSnapshot: () => ObjectGesturePreview;
  subscribe: (listener: () => void) => () => void;
};
/** A group of objects at once (`PlanStore.selectMany`). */
export type SelectManySink = (ids: readonly Id[]) => void;
export type FocusSink = (ref: Ref) => void;

export type EditorCanvasProps = {
  document: PlanDocument;
  session: EditorSession;
  onPointer: (event: WorldPointer) => void;
  onViewport: (viewport: Viewport) => void;
  onSelect: SelectSink;
  /** Shape layers supplied by the app composition. */
  children: ReactNode;
};

export type PlanToolsProps = {
  document: PlanDocument;
  session: EditorSession;
  onTool: (tool: Tool) => void;
  onCommand: CommandSink;
};

export type PlanGeometryLayerProps = {
  document: PlanDocument;
  session: EditorSession;
  draft: Point[] | null;
  onCommand: CommandSink;
  onSelect: SelectSink;
};

export type EquipmentLayerProps = {
  document: PlanDocument;
  session: EditorSession;
  /** Findings shown in the hover summary; optional for isolated package stands. */
  issues?: Issue[];
  onCommand: CommandSink;
  onSelect: SelectSink;
  /** Group selection; optional until the app wires it (marquee, Shift+click). */
  onSelectMany?: SelectManySink;
  /** Drawn translucently; never turns into a command on its own. */
  preview: Candidate | null;
  /** Current move frame for the properties card; null when the gesture ends. */
  onGesturePreview?: (preview: ObjectGesturePreview) => void;
};

/**
 * The card of the selected zone or object. Fields come from the catalog, so a
 * new attribute in the type dictionary shows up here without touching the
 * component; a refused edit reports itself next to the field that caused it.
 */
export type PropertiesPanelProps = {
  document: PlanDocument;
  session: EditorSession;
  onCommand: CommandSink;
  /** Live move coordinates; optional for isolated package stands. */
  gesturePreview?: ObjectGesturePreviewSource;
};

export type LayersPanelProps = {
  document: PlanDocument;
  session: EditorSession;
  onCommand: CommandSink;
  onSelect: SelectSink;
};

/**
 * Informational layers paint over the whole plan and own nothing: the layer
 * only says which representation is on. Nothing here dispatches a command —
 * switching a layer on must not touch the document.
 */
export type InformationLayerProps = {
  document: PlanDocument;
  session: EditorSession;
};

export type LibraryPanelProps = {
  catalog: Catalog;
  /** Type armed for the next canvas click, or null in selection mode. */
  activeTypeId: Id | null;
  /** Selects object.place; the app routes the following world click. */
  onTool: (tool: Tool) => void;
};

export type InventoryPanelProps = {
  inventory: Inventory;
  onFocus: FocusSink;
};

export type ValidationPanelProps = {
  issues: Issue[];
  onFocus: FocusSink;
};

/** Distinguishes loading, error and empty result; error text stays in the DOM. */
export type RequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done' };

export type AssistantPanelRequest =
  | Exclude<AdviceRequest, { scenario: 'compare' }>
  | { scenario: 'compare' };

export type AssistantPanelProps = {
  document: PlanDocument;
  revision: number;
  response: AdviceResponse | null;
  state: RequestState;
  onPreview: (candidate: Candidate | null) => void;
  onFocus: FocusSink;
  /**
   * The panel owns the scenario and its parameters, so it is the panel that
   * starts the request; the app owns the transport and the resulting state.
   */
  onAsk: (request: AssistantPanelRequest, query?: string) => void;
};

export type View3DProps = {
  document: PlanDocument;
  selection: Ref | null;
  onSelect: SelectSink;
};

/** Tool controllers exported by U03 and U04. */
export type UsePlanToolController = (input: {
  document: PlanDocument;
  session: EditorSession;
  onCommand: CommandSink;
}) => ToolController;

export type UseEquipmentToolController = UsePlanToolController;

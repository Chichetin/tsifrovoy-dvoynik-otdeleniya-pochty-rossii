/**
 * Contracts v1: UI props and editor tool seams. Frozen by F02, see
 * docs/contracts-v1.md. React types are allowed here and only here; domain and
 * server modules never import this file.
 *
 * Pointer events carry world coordinates. Tools never convert Y themselves —
 * every conversion goes through src/domain/geometry with one session viewport.
 */

import type { ReactNode } from 'react';
import type { AdviceResponse, Candidate } from './advice';
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
  preview: Candidate | null;
  focus: FocusRequest | null;
};

export type CommandSink = (command: Command) => Result<PlanDocument>;
export type SelectSink = (ref: Ref | null) => void;
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
  onCommand: CommandSink;
  onSelect: SelectSink;
  /** Drawn translucently; never turns into a command on its own. */
  preview: Candidate | null;
};

export type LibraryPanelProps = {
  catalog: Catalog;
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

export type AssistantPanelProps = {
  document: PlanDocument;
  revision: number;
  response: AdviceResponse | null;
  state: RequestState;
  onPreview: (candidate: Candidate | null) => void;
  onFocus: FocusSink;
};

export type View3DProps = {
  document: PlanDocument;
  selection: Ref | null;
};

/** Tool controllers exported by U03 and U04. */
export type UsePlanToolController = (input: {
  document: PlanDocument;
  session: EditorSession;
  onCommand: CommandSink;
}) => ToolController;

export type UseEquipmentToolController = UsePlanToolController;

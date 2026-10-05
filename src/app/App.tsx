import { useOpeningController } from '../features/plan-tools/use-opening-controller';
import { OpeningControls } from '../features/plan-tools/OpeningControls';
import { OpeningPreviewLayer } from '../features/plan-tools/OpeningPreviewLayer';
/**
 * U01: the one place where the editor is assembled.
 *
 * Panels are independent modules that know nothing about each other; this file
 * holds the session (tool, viewport, selection, preview) and routes every
 * command into the single store. Derived data — inventory, issues — is
 * recomputed from the document, never stored beside it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer } from 'react-konva';
import { useStore } from 'zustand';
import type { Candidate } from '../contracts/advice';
import type { Command, DocumentOrigin } from '../contracts/commands';
import type { Equipment, Id, PlanDocument, Point, Ref, Result, Viewport } from '../contracts/model';
import type { EditorSession, Tool } from '../contracts/ui';
import { buildInventory, inventoryLinkTarget } from '../domain/inventory';
import { takenIds } from '../domain/commands';
import { modelToScreen, normalizeAngle, screenToModel } from '../domain/geometry';
import { measurePlan } from '../domain/metrics';
import {
  mountScopeLayer,
  objectMount,
  revealMountOf,
  withHiddenMounts,
  type ObjectMount,
} from '../domain/object-mount';
import { isEmptyPlan, planHealth, validatePlan } from '../domain/validation';
import { candidateObjectForInsert } from '../domain/advice';
import { AssistantPanel } from '../features/assistant/AssistantPanel';
import { selectionQuestions } from '../features/assistant/AgentChat';
import { AssistantLauncher } from '../features/assistant/AssistantLauncher';
import { ComparisonPanel } from '../features/assistant/ComparisonPanel';
import { useComparisonSource } from '../features/assistant/use-comparison-source';
import { useAssistantSession, type EditGhosts } from '../features/assistant/use-assistant-session';
import { EditorCanvas } from '../features/editor/EditorCanvas';
import { CanvasStatus, publishCanvasCursor } from '../features/editor/CanvasStatus';
import { PlacementGhostLayer } from '../features/equipment/PlacementGhostLayer';
import { placementGhost } from '../features/equipment/placement-ghost';
import { ObjectContextMenu } from '../features/equipment/ObjectContextMenu';
import type { ObjectMenuAction } from '../features/equipment/object-menu';
import { duplicateObjects, rotateObjects } from '../features/equipment/selection-edit';
import { ROTATION_SNAP_DEG } from '../features/equipment/transform';
import { planExtent } from '../features/editor/focus';
import { fitToExtent } from '../features/editor/viewport';
import { editorHotkey, historyHotkey, isTypingTarget } from '../features/editor/hotkeys';
import { EquipmentLayer } from '../features/equipment/EquipmentLayer';
import { findPlacementPick } from '../features/equipment/placement-pick';
import { useEquipmentToolController } from '../features/equipment/use-equipment-tool-controller';
import { FileControls } from '../features/files/FileControls';
import { InventoryPanel } from '../features/inventory/InventoryPanel';
import { InventoryLinkNotice } from '../features/inventory/InventoryLinkNotice';
import { InventoryWalk, type WalkState, walkOf } from '../features/inventory/InventoryWalk';
import { WalkRouteLayer } from '../features/inventory/WalkRouteLayer';
import { InformationLayer } from '../features/layers/InformationLayer';
import { LayersPanel } from '../features/layers/LayersPanel';
import { MetricsPanel } from '../features/inventory/MetricsPanel';
import { RuleChecklist } from '../features/inventory/RuleChecklist';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { Onboarding } from '../features/onboarding/Onboarding';
import { browserStorage as tourStorage, rememberTour, shouldShowTour, type TourOutcome } from '../features/onboarding/tour';
import { MeasureLayer } from '../features/plan-tools/MeasureLayer';
import { ObjectShapeLayer } from '../features/plan-tools/ObjectShapeLayer';
import { PlanGeometryLayer } from '../features/plan-tools/PlanGeometryLayer';
import { PropertiesPanel } from '../features/properties/PropertiesPanel';
import { PlanTools } from '../features/plan-tools/PlanTools';
import { OCCUPIED_PLACE_PREFIX, getNotice, occupiedPlaceNotice, setNotice } from '../features/plan-tools/notice';
import { InternalRoomControls } from '../features/plan-tools/InternalRoomControls';
import { useInternalRoomController } from '../features/plan-tools/use-internal-room-controller';
import { DrawingControls } from '../features/plan-tools/DrawingControls';
import { ZoneNameLayer } from '../features/plan-tools/ZoneNameLayer';
import { usePlanToolController } from '../features/plan-tools/use-plan-tool-controller';
import { IssueLayer } from '../features/validation/IssueLayer';
import { FindingCard } from '../features/validation/FindingCard';
import { ValidationPanel, type FixApplication } from '../features/validation/ValidationPanel';
import { HealthBadge } from '../features/validation/HealthScore';
import { View3D } from '../features/view3d/View3D';
import { encodePlan } from '../persistence/codec';
import { readPlanFile } from '../persistence/format';
import { ORGANIZER_CATALOG_VERSION, withTeamCatalog } from '../persistence/organizer-import';
import { createPlanStore } from '../state/plan-store';
import { catalog, createEmptyPlan, openStartPlan, START_PLAN_ID } from './default-plan';
import { documentNotice, isEditErrorCurrent, refusalOf, type EditError } from './edit-error';
import { createObjectGesturePreviewChannel } from './gesture-preview';
import {
  LEFT_TABS,
  RIGHT_TABS,
  browserStorage as sideTabsStorage,
  loadSideTabs,
  saveSideTabs,
  type LeftTab,
  type RightTab,
} from './side-tabs';
import { ObjectQuickActions } from './ObjectQuickActions';
import { SelectionDelete } from './SelectionDelete';
import { selectionDeletion } from './selection-delete';
import { SideTabs } from './SideTabs';
import { PlanTitle } from './PlanTitle';
import { SettingsDialog } from './SettingsDialog';
import { HotkeysMapDialog } from './HotkeysMapDialog';
import { QuickSearchDialog } from './QuickSearchDialog';
import type { SearchItem } from './quick-search';
import { useHotkeysMapDialog } from './hotkeys-map';
import './styles.css';

const START_VIEWPORT: Viewport = { origin: [0, 0], scale: 48 };
// #105: panel widths are in rem — the interface scales with the root font size —
// so the key is new: widths saved in px by the old key would read as 260 rem.
const PANEL_WIDTHS_KEY = 'posttech.panel-widths.v2';
const PANEL_HANDLE_REM = 0.5;
const MIN_CANVAS_REM = 22.5;
const PANEL_LIMITS = { left: [10, 27.5], right: [12.5, 31.25] } as const;
const PANEL_STEP_REM = 1;
type PanelSide = 'left' | 'right';
type PanelWidths = { left: number; right: number };

/** One rem in pixels: pointer and window sizes come in px, panel widths are in rem. */
function remPx(): number {
  return Number.parseFloat(window.getComputedStyle(window.document.documentElement).fontSize) || 16;
}

function clampPanelWidth(side: PanelSide, width: number, available: number, other: number): number {
  const [minimum, maximum] = PANEL_LIMITS[side];
  const room = available - other - PANEL_HANDLE_REM * 2 - MIN_CANVAS_REM;
  return Math.round(Math.max(minimum, Math.min(width, maximum, Math.max(minimum, room))) * 100) / 100;
}

function initialPanelWidths(): PanelWidths {
  const fallback = { left: 16.25, right: 21.25 };
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(PANEL_WIDTHS_KEY) ?? 'null');
    if (saved === null || typeof saved !== 'object') return fallback;
    const widths = saved as Partial<PanelWidths>;
    if (!Number.isFinite(widths.left) || !Number.isFinite(widths.right)) return fallback;
    const available = window.innerWidth / remPx();
    const left = clampPanelWidth('left', widths.left as number, available, widths.right as number);
    const right = clampPanelWidth('right', widths.right as number, available, left);
    return { left, right };
  } catch {
    return fallback;
  }
}

export function App(): React.JSX.Element {
  const [store, setStore] = useState(() => createPlanStore(openStartPlan(), 'file'));
  const [gesturePreview] = useState(createObjectGesturePreviewChannel);
  const document = useStore(store, (state) => state.document);
  const baseline = useStore(store, (state) => state.baseline);
  const comparison = useComparisonSource();
  const clearComparison = comparison.clear;
  const revision = useStore(store, (state) => state.revision);
  const contentRevision = useStore(store, (state) => state.contentRevision);
  const selection = useStore(store, (state) => state.selection);
  const dirty = useStore(store, (state) => state.dirty);
  const variants = useStore(store, (state) => state.variants);

  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  // #219: the «already here» line belongs to the placement mode and leaves with it.
  useEffect(() => {
    if (tool.kind !== 'object.place' && getNotice()?.startsWith(OCCUPIED_PLACE_PREFIX)) setNotice(null);
  }, [tool.kind]);
  const [roomMode, setRoomMode] = useState<'internal' | 'boundary'>('internal');
  // 3D is an overlay over the same document; the 2D canvas stays mounted below it.
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(initialPanelWidths);
  const [planOnly, setPlanOnly] = useState(false);
  const canvasRef = useRef<HTMLElement>(null);
  // #224: hidden interface gives the whole window to the canvas. The canvas
  // corner moves, so the viewport moves by the same pixels in the same frame:
  // every point of the plan stays where it was on the screen.
  const planOnlyFrom = useRef<DOMRect | null>(null);
  const [planOnlyShift, setPlanOnlyShift] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const togglePlanOnly = useCallback((): void => {
    planOnlyFrom.current = canvasRef.current?.getBoundingClientRect() ?? null;
    setPlanOnly((value) => !value);
  }, []);
  useLayoutEffect(() => {
    const before = planOnlyFrom.current;
    planOnlyFrom.current = null;
    const after = canvasRef.current?.getBoundingClientRect();
    if (before === null || after === undefined) return;
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (dx !== 0 || dy !== 0) {
      setViewport((current) => ({ ...current, origin: [current.origin[0] + dx, current.origin[1] + dy] }));
    }
    // The eye and captions buttons keep their place on the screen.
    setPlanOnlyShift(planOnly ? { top: dy, right: after.right - before.right } : { top: 0, right: 0 });
  }, [planOnly]);
  useEffect(() => {
    if (!planOnly) return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      togglePlanOnly();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [planOnly, togglePlanOnly]);
  type CanvasBeforeResize = { width: number; height: number; fitted: boolean };
  const resizeStart = useRef<{ side: PanelSide; x: number; width: number; canvas: CanvasBeforeResize | null } | null>(null);
  const canvasBeforeResize = (): CanvasBeforeResize | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    const size = { width: rect.width, height: rect.height };
    const extent = planExtent(document);
    const fitted = fitToExtent(extent, size);
    return {
      ...size,
      fitted: Math.abs(viewport.scale - fitted.scale) < fitted.scale * 0.02 &&
        extent.every((point) => {
          const [x, y] = modelToScreen(point, viewport);
          return x >= 0 && x <= size.width && y >= 0 && y <= size.height;
        }),
    };
  };
  const reframeAfterResize = (before: CanvasBeforeResize | null): void => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (before === null || rect === undefined || Math.abs(rect.width - before.width) < 1) return;
    const after = { width: rect.width, height: rect.height };
    if (before.fitted) {
      setViewport(fitToExtent(planExtent(document), after));
    } else {
      // A deliberately zoomed view keeps its scale and the same world point
      // under the centre of the canvas while the side panel moves.
      setViewport((current) => ({
        ...current,
        origin: [
          current.origin[0] + (after.width - before.width) / 2,
          current.origin[1] + (after.height - before.height) / 2,
        ],
      }));
    }
  };
  useEffect(() => {
    try { window.localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(panelWidths)); } catch { /* private mode */ }
  }, [panelWidths]);
  const startResize = (side: PanelSide, event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    resizeStart.current = { side, x: event.clientX, width: panelWidths[side], canvas: canvasBeforeResize() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (side: PanelSide, event: React.PointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current;
    if (start === null || start.side !== side) return;
    const unit = remPx();
    const width = start.width + (side === 'left' ? event.clientX - start.x : start.x - event.clientX) / unit;
    const available = (event.currentTarget.parentElement?.clientWidth ?? window.innerWidth) / unit;
    setPanelWidths((current) => ({
      ...current,
      [side]: clampPanelWidth(side, width, available, current[side === 'left' ? 'right' : 'left']),
    }));
  };
  const stopResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current;
    resizeStart.current = null;
    if (start !== null) reframeAfterResize(start.canvas);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeByKey = (side: PanelSide, event: React.KeyboardEvent<HTMLDivElement>): void => {
    const direction = side === 'left' ? 1 : -1;
    const [minimum, maximum] = PANEL_LIMITS[side];
    const step = event.key === 'ArrowLeft' ? -PANEL_STEP_REM * direction : event.key === 'ArrowRight' ? PANEL_STEP_REM * direction : 0;
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const before = canvasBeforeResize();
    const available = (event.currentTarget.parentElement?.clientWidth ?? window.innerWidth) / remPx();
    setPanelWidths((current) => ({
      ...current,
      [side]: clampPanelWidth(
        side,
        event.key === 'Home' ? minimum : event.key === 'End' ? maximum : current[side] + step,
        available,
        current[side === 'left' ? 'right' : 'left'],
      ),
    }));
    window.requestAnimationFrame(() => reframeAfterResize(before));
  };
  // D-274: the plaque keeps the refs and revision of the refusal, so it
  // disappears by itself once the plan it spoke about is gone.
  const [lastError, setLastError] = useState<EditError | null>(null);
  const focusSequence = useRef(0);
  // First-run tour: whether it was seen is a fact about this browser, kept in
  // localStorage and never in the plan (D-194).
  const [tourOpen, setTourOpen] = useState(() =>
    inventoryLinkTarget(window.location.search) === null && shouldShowTour(tourStorage()));
  const [demoRequest, setDemoRequest] = useState<{ id: number; variant: 'before' | 'after' } | null>(null);
  const closeTour = useCallback((outcome: TourOutcome) => {
    rememberTour(tourStorage(), outcome);
    setTourOpen(false);
  }, []);
  // UX-3: карта горячих клавиш по «?» — открытие, закрытие и возврат фокуса
  // живут в самом хуке (hotkeys-map.ts), здесь только кнопка и накладка.
  const hotkeysMap = useHotkeysMapDialog();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const [focus, setFocus] = useState<EditorSession['focus']>(null);
  const [preview, setPreview] = useState<Candidate | null>(null);
  // #126: ghosts of the agent's edits, for the plan revision they were built on.
  const [editGhosts, setEditGhosts] = useState<EditGhosts | null>(null);
  // D-290: the object in shape mode; the equipment layer hides its handles.
  const [shapeEditingId, setShapeEditingId] = useState<string | null>(null);
  // #105: the object whose «Изменить форму» switch is on. It belongs to one
  // selection: picking something else, or nothing, puts it back to «off».
  const [reshapeFor, setReshapeFor] = useState<Id | null>(null);
  // #167: the wall whose «Изменить перегородку» switch is on, and the tool it
  // was turned on under. Another selection or another tool turns it off.
  const [wallEdit, setWallEdit] = useState<{ id: Id; tool: Tool['kind'] } | null>(null);
  /**
   * Сколько раз документ заменяли целиком. Холст помнит, какой документ он уже
   * вписал, по `id` и имени, а два файла могут нести одну личность:
   * `demo/before.json` и `demo/after.json` именно такие — второй это тот же
   * план после рекомендации. Жюри открывает их подряд, поэтому «документ
   * заменили» решается по самому действию, а не по содержимому файла: смена
   * этого числа пересоздаёт холст, и вид считается заново.
   */
  const [documentEpoch, setDocumentEpoch] = useState(0);

  // D-249: which tab each side column shows — a fact about this browser,
  // kept in localStorage like the tour (D-195), never in the plan. The value
  // the initializer returned is not written straight back: comparing by
  // reference skips the mount (StrictMode included, see D-226), so nothing
  // lands in localStorage before the person touches a tab.
  const [tabs, setTabs] = useState(() => loadSideTabs(sideTabsStorage()));
  const initialTabs = useRef(tabs);
  useEffect(() => {
    if (tabs === initialTabs.current) return;
    saveSideTabs(sideTabsStorage(), tabs);
  }, [tabs]);
  // #184: the tab to fold the assistant to when «Свойства» open.
  const lastRightTab = useRef<RightTab>('inventory');
  useEffect(() => {
    if (tabs.right !== 'assistant') lastRightTab.current = tabs.right;
  }, [tabs.right]);
  const showLeftTab = useCallback((left: LeftTab) => {
    setTabs((prev) => (prev.left === left ? prev : { ...prev, left }));
  }, []);
  const showRightTab = useCallback((right: RightTab) => {
    setTabs((prev) => (prev.right === right ? prev : { ...prev, right }));
  }, []);
  // The header button «Ассистент» is deliberately only an entry point: the
  // right-column panel remains the one place where assistant state and chat
  // history live. It switches the column to the assistant tab. «Свойства» sit
  // above the tabs, so the selection stays: the assistant can be asked about
  // what is selected.
  const retired = useStore(store, (state) => state.retired);
  const selected = useStore(store, (state) => state.selected);
  // Any edit after the answer makes the ghosts stale: they leave the plan.
  const previewEdits = editGhosts !== null && editGhosts.revision === contentRevision ? editGhosts.preview : null;
  const session: EditorSession = useMemo(
    () => ({ tool, viewport, selection, selected, preview, previewEdits, focus, retired }),
    [tool, viewport, selection, selected, preview, previewEdits, focus, retired],
  );

  // #105: «Свойства» stand in the right column above its tabs, so the library
  // on the left stays open while something is selected. A layer has no card of
  // its own (its settings live in «Слои»).
  // #184: not together with the assistant tab; the selection stays for its questions.
  // #222: with a selection the column is that card alone; the tab row and its
  // panels are hidden (they stay mounted) until the selection goes.
  // #225: a finding opened from «Проверка» or a marker takes the card's place.
  const [findingRef, setFindingRef] = useState<Ref | null>(null);
  const issues = useMemo(() => validatePlan(document), [document]);
  const propsShown = selection !== null && selection.kind !== 'layer' && tabs.right !== 'assistant';
  const findingIssues = useMemo(
    () =>
      findingRef === null
        ? []
        : issues.filter((issue) => issue.refs.some((ref) => ref.kind === findingRef.kind && ref.id === findingRef.id)),
    [findingRef, issues],
  );
  const findingShown =
    propsShown && findingRef !== null && selection?.kind === findingRef.kind && selection.id === findingRef.id && findingIssues.length > 0;
  const cardOnly = propsShown;

  // #105: «Повернуть» and «Изменить форму» go with a single selected object.
  if (reshapeFor !== null && !(selection !== null && selection.kind === 'object' && selection.id === reshapeFor)) {
    setReshapeFor(null);
  }
  if (wallEdit !== null && !(selection?.kind === 'wall' && selection.id === wallEdit.id && tool.kind === wallEdit.tool)) {
    setWallEdit(null);
  }
  const selectedWallId = selection?.kind === 'wall' ? selection.id : null;
  const changeWallEdit = useCallback(
    (on: boolean) => setWallEdit(on && selectedWallId !== null ? { id: selectedWallId, tool: tool.kind } : null),
    [selectedWallId, tool.kind],
  );
  const quickObject =
    selection !== null && selection.kind === 'object' && selected.size <= 1
      ? document.objects.find((entry) => entry.id === selection.id)
      : undefined;
  const quickLayer = quickObject === undefined ? undefined : document.layers.find((layer) => layer.id === quickObject.layerId);
  const quickDisabled =
    quickObject === undefined || quickObject.locked === true || quickLayer === undefined || !quickLayer.visible || quickLayer.locked;

  // #121: «Удалить» with its name and its consequence, for any selected thing.
  const deletion = selectionDeletion(selection, selected, document);

  const select = useCallback(
    (ref: Ref | null) => {
      setFindingRef(null);
      store.getState().select(ref);
    },
    [store],
  );
  const selectMany = useCallback(
    (ids: readonly Id[]) => {
      setFindingRef(null);
      store.getState().selectMany(ids);
    },
    [store],
  );
  // #184: a click on the plan opens «Свойства», so the assistant tab folds to
  // the tab the person had before it. The selection itself is not touched.
  const leaveAssistant = useCallback(() => {
    setTabs((prev) => (prev.right === 'assistant' ? { ...prev, right: lastRightTab.current } : prev));
  }, []);
  const planSelect = useCallback(
    (ref: Ref | null) => {
      select(ref);
      if (ref !== null && ref.kind !== 'layer') leaveAssistant();
    },
    [select, leaveAssistant],
  );
  // #226: a double click on an object turns «Изменить форму» on for it.
  const reshapeObject = useCallback(
    (id: Id) => {
      planSelect({ kind: 'object', id });
      setReshapeFor(id);
    },
    [planSelect],
  );
  const planSelectMany = useCallback(
    (ids: readonly Id[]) => {
      selectMany(ids);
      if (ids.length > 0) leaveAssistant();
    },
    [selectMany, leaveAssistant],
  );

  const dispatch = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = store.getState().dispatch(command);
      // A refused command is not a silent no-op: the user has to learn why the
      // thing they just dragged snapped back.
      setLastError(result.ok ? null : refusalOf(result.issues, store.getState().revision));
      return result;
    },
    [store],
  );

  // A drawing tool that just created something hands it over selected: the
  // card shows what was drawn, not what was picked a minute ago (operator
  // finding 9). The room is not created, only reshaped, so `room.set` stays
  // out.
  //
  // A `put` from a tool also arrives when an existing entity is dragged or
  // resized, and it selects that entity too: the person has just handled it,
  // so the card follows their hand. Deletions and commands from panels go
  // through plain `dispatch` and leave the selection alone.
  const dispatchAndSelect = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatch(command);
      if (!result.ok) return result;
      if (command.type === 'zone.put') select({ kind: 'zone', id: command.zone.id });
      if (command.type === 'object.put') select({ kind: 'object', id: command.object.id });
      if (command.type === 'wall.put') select({ kind: 'wall', id: command.wall.id });
      if (command.type === 'opening.put') select({ kind: 'opening', id: command.opening.id });
      return result;
    },
    [dispatch, select],
  );

  // «Подтвердить» under a fix variant of «Проверка»: the shown ghost goes in as
  // one command — the spot the search checked, with the size it checked — or
  // the named object is deleted. A moved object keeps its id, name and
  // attributes.
  const applyFix = useCallback(
    (application: FixApplication): Result<PlanDocument> => {
      if (application.kind === 'delete') {
        const result = dispatch({ type: 'object.delete', id: application.id });
        if (result.ok) select(null);
        return result;
      }
      const { candidate, movedId } = application;
      const current = store.getState();
      const moved = movedId === null ? undefined : current.document.objects.find((entry) => entry.id === movedId);
      const object =
        moved === undefined
          ? candidateObjectForInsert(current.document, candidate, current.retired)
          : {
              ...moved,
              position: candidate.object.position,
              size_m: candidate.object.size_m,
              rotation_deg: candidate.object.rotation_deg,
              zoneId: candidate.object.zoneId,
            };
      const result = dispatchAndSelect({ type: 'object.put', object });
      if (result.ok) setPreview(null);
      return result;
    },
    [dispatch, dispatchAndSelect, select, store],
  );

  // #124: route of the inventory walk — screen state; the marks live in the plan.
  const [walk, setWalk] = useState<WalkState | null>(null);
  const activeWalk = useMemo(() => walkOf(walk, document), [walk, document]);
  const focusOn = useCallback(
    (ref: Ref) => {
      focusSequence.current += 1;
      setFocus({ ref, sequence: focusSequence.current });
      select(ref);
    },
    [select],
  );
  // #25: quick search by Ctrl+K — focus returns where it was when it closes.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchReturnFocus.current?.focus();
    searchReturnFocus.current = null;
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== 'KeyK' && event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (searchOpen) return;
      searchReturnFocus.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  // #141: Ctrl+C/V/D copy objects only (EquipmentLayer); on a zone the key says so.
  const [zoneCopyHint, setZoneCopyHint] = useState(false);
  useEffect(() => {
    if (!zoneCopyHint) return;
    const timer = window.setTimeout(() => setZoneCopyHint(false), 4000);
    return () => window.clearTimeout(timer);
  }, [zoneCopyHint]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (selection?.kind !== 'zone' || view !== '2d' || isTypingTarget(event.target)) return;
      if (event.code !== 'KeyC' && event.code !== 'KeyV' && event.code !== 'KeyD') return;
      if (event.code === 'KeyD') event.preventDefault();
      setZoneCopyHint(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, view]);

  // «×» drops the selection; the card goes, so focus lands on the open tab of
  // the same column rather than on the removed button.
  // #222: the tab row is hidden while the card shows, so focus moves once it is back.
  const refocusTabs = useRef(false);
  const closeProps = useCallback(() => {
    refocusTabs.current = true;
    select(null);
  }, [select]);
  useEffect(() => {
    if (cardOnly || !refocusTabs.current) return;
    refocusTabs.current = false;
    window.document.getElementById(`side-right-tab-${tabs.right}`)?.focus();
  }, [cardOnly, tabs.right]);

  // #121: the button of the card sends the command the key would send.
  const deleteSelection = useCallback(() => {
    if (deletion?.command != null && dispatch(deletion.command).ok) select(null);
  }, [deletion, dispatch, select]);

  // A click on an issue marker (V02-marker-click) is a request for the list:
  // the selection goes to the card, «Проверка» comes to the front
  // beneath it, both on the right.
  const focusFromMarker = useCallback(
    (ref: Ref) => {
      focusOn(ref);
      setFindingRef(ref);
      showRightTab('validation');
    },
    [focusOn, showRightTab],
  );

  // #225: a pick in «Проверка» opens the finding card, not «Свойства».
  const focusFinding = useCallback(
    (ref: Ref) => {
      focusOn(ref);
      setFindingRef(ref);
    },
    [focusOn],
  );

  const placedType = useRef<Id | null>(null);
  // D-275: hidden floor/ceiling groups (view state, see `shownDocument` below).
  const [hiddenMounts, setHiddenMounts] = useState<ReadonlySet<ObjectMount>>(() => new Set());
  // Значки типов на плане: состояние вида. Выключение оставляет цвет, форму и
  // подписи и ничего не пишет в документ, поэтому отмена его не видит.
  const [pictograms, setPictograms] = useState(true);
  // D-362: names on objects are off until asked for; the icon in the shape says what it is.
  const [captions, setCaptions] = useState(false);
  const pictogramsView = useMemo(
    () => ({ shown: pictograms, onToggle: () => setPictograms((shown) => !shown) }),
    [pictograms],
  );
  // D-275: a placement into a hidden group shows that group — otherwise the
  // new object is invisible and the next click places a duplicate.
  const revealPlaced = useCallback(
    (placed: Equipment) => {
      const scope = mountScopeLayer(store.getState().document.layers);
      if (scope !== undefined) setHiddenMounts((current) => revealMountOf(current, scope.id, placed));
    },
    [store],
  );
  // D-279: a drawn shape is a placement too — into a hidden group it shows that group.
  const dispatchPlanCommand = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatchAndSelect(command);
      if (result.ok && tool.kind === 'shape.draw' && command.type === 'object.put') {
        revealPlaced(command.object);
      }
      return result;
    },
    [dispatchAndSelect, revealPlaced, tool],
  );
  const planTool = usePlanToolController({ document, session, onCommand: dispatchPlanCommand }, documentEpoch);
  const dispatchInternalRoom = useCallback((command: Command): Result<PlanDocument> => {
    const result = dispatchPlanCommand(command);
    if (result.ok && command.type === 'batch') {
      const zone = command.commands.find((step) => step.type === 'zone.put');
      if (zone?.type === 'zone.put') select({ kind: 'zone', id: zone.zone.id });
    }
    return result;
  }, [dispatchPlanCommand, select]);
  const internalRoom = useInternalRoomController({ document, session, onCommand: dispatchInternalRoom }, view === '2d' && tool.kind === 'room.draw' && roomMode === 'internal', documentEpoch);
  const placingOpening = view === '2d' && tool.kind === 'opening.place';
  const applyOpeningCommand = useCallback((command: Command): Result<PlanDocument> => {
    const result = dispatchPlanCommand(command);
    if (result.ok) setTool({kind:'select'});
    return result;
  }, [dispatchPlanCommand, setTool]);
  const openingTool = useOpeningController({document,session,onCommand:applyOpeningCommand}, placingOpening, documentEpoch);
  const drawingRoom = view === '2d' && tool.kind === 'room.draw' && roomMode === 'internal';
  const hasDrawingDraft = view === '2d' && (placingOpening ? openingTool.ready : drawingRoom ? internalRoom.start !== null :
    (tool.kind === 'room.draw' || tool.kind === 'zone.draw' || tool.kind === 'shape.draw' || tool.kind === 'wall.draw') && planTool.draft !== null);
  const undo = () => {
    if (hasDrawingDraft) {
      if (placingOpening) openingTool.cancel();
      else if (drawingRoom) internalRoom.removeLast();
      else planTool.removeLast();
    } else store.getState().undo();
  };
  const redo = () => { if (!hasDrawingDraft) store.getState().redo(); };
  // The visible undo and shortcut remove a draft corner before touching plan history.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = historyHotkey(event);
      if (action === null) return;
      event.preventDefault();
      // Holding undo must not fall through from the last draft point to old plan edits.
      if (event.repeat) return;
      if (action === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const dispatchEquipmentCommand = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatchAndSelect(command);
      // Remember an accepted placement until pointer-up. Keeping the placement
      // tool through the matching click prevents that same click from falling
      // through to the room selection layer after React re-renders.
      if (result.ok && tool.kind === 'object.place' && command.type === 'object.put') {
        placedType.current = tool.typeId;
        revealPlaced(command.object);
      }
      return result;
    },
    [dispatchAndSelect, revealPlaced, tool],
  );
  const equipmentTool = useEquipmentToolController({
    document,
    session,
    onCommand: dispatchEquipmentCommand,
  });

  // D-275: floor/ceiling groups of the base layer — view state like the tab
  // choice, never in the plan and never in undo. The canvas and 3D draw a view
  // document where a hidden group sits on a hidden view-only layer; commands,
  // inventory and checks keep the real one.
  const mountLayer = mountScopeLayer(document.layers);
  const shownDocument = useMemo(
    () =>
      mountLayer === undefined ? document : withHiddenMounts(document, mountLayer.id, hiddenMounts),
    [document, mountLayer, hiddenMounts],
  );
  const toggleMount = useCallback(
    (mount: ObjectMount) => {
      const hiding = !hiddenMounts.has(mount);
      const next = new Set(hiddenMounts);
      if (hiding) next.add(mount);
      else next.delete(mount);
      setHiddenMounts(next);
      if (!hiding || mountLayer === undefined) return;
      // A hidden object cannot stay picked on a canvas that no longer draws
      // it: drop it from the selection, keep the rest of a group.
      const state = store.getState();
      const goes = new Set(
        state.document.objects
          .filter((object) => object.layerId === mountLayer.id && objectMount(object) === mount)
          .map((object) => object.id),
      );
      const kept = [...state.selected].filter((id) => !goes.has(id));
      const primaryGoes = state.selection?.kind === 'object' && goes.has(state.selection.id);
      if (kept.length === state.selected.size && !primaryGoes) return;
      if (kept.length === 0) select(null);
      else state.selectMany(kept);
    },
    [hiddenMounts, mountLayer, select, store],
  );
  const objectMounts = useMemo(
    () =>
      mountLayer === undefined
        ? undefined
        : { layerId: mountLayer.id, hidden: hiddenMounts, onToggle: toggleMount },
    [mountLayer, hiddenMounts, toggleMount],
  );

  const inventory = useMemo(() => buildInventory(document), [document]);
  // #125: the header score reads the same findings as «Проверка».
  const health = useMemo(() => planHealth(issues), [issues]);
  const [healthRequest, setHealthRequest] = useState(0);
  const metrics = useMemo(() => measurePlan(document), [document]);

  // D-249: the one live signal a tab keeps while its panel is hidden — how
  // many findings «Проверка» has, red when any of them is a real error (the
  // same test `ValidationPanel` uses for its own red `panel__count`).
  const validationBadge = useMemo(
    () =>
      issues.length === 0
        ? undefined
        : {
            text: String(issues.length),
            tone: issues.some((issue) => issue.severity === 'error') ? ('error' as const) : undefined,
          },
    [issues],
  );

  // D-258: ring on the plan without selecting — the agent points, the
  // person decides what to pick.
  const highlight = useCallback((ref: Ref) => {
    focusSequence.current += 1;
    setFocus({ ref, sequence: focusSequence.current });
  }, []);

  const {
    advice,
    adviceState,
    exchanges,
    actionStatus: agentActionStatus,
    ask: askAssistant,
    askAgent,
    runAction: runAssistantAction,
    resetAdvice,
    clearChat,
    forget: forgetAdvice,
  } = useAssistantSession({
    document,
    revision: contentRevision,
    baseline,
    comparisonBase: comparison.source?.plan ?? null,
    current: store.getState,
    dispatch,
    dispatchAndSelect,
    setPreview,
    setEditGhosts,
    highlight,
    focusOn,
    showLeftTab,
    showRightTab,
  });

  // #24: the menu of an object — a right click that did not drag, or Shift+F10
  // for the selected one. The actions are the commands the keys already run;
  // on a member of a picked group they act on the whole group, like the keys.
  const [objectMenu, setObjectMenu] = useState<{ id: Id; at: Point } | null>(null);
  const menuObject = objectMenu === null ? undefined : document.objects.find((entry) => entry.id === objectMenu.id);
  const menuReturnFocus = useRef<HTMLElement | null>(null);
  const rightPress = useRef<Point | null>(null);
  const closeObjectMenu = useCallback(() => {
    setObjectMenu(null);
    menuReturnFocus.current?.focus();
    menuReturnFocus.current = null;
  }, []);
  // Undo, or any edit, can take the object away from under an open menu: it
  // closes, and a redo does not bring it back.
  if (objectMenu !== null && menuObject === undefined) setObjectMenu(null);
  const openObjectMenu = useCallback(
    (id: Id, at: Point) => {
      menuReturnFocus.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
      if (!(selected.has(id) && selected.size > 1)) planSelect({ kind: 'object', id });
      setObjectMenu({ id, at });
    },
    [selected, planSelect],
  );
  const runObjectMenu = useCallback(
    (action: ObjectMenuAction) => {
      const object = menuObject;
      closeObjectMenu();
      if (object === undefined) return;
      const targets = selected.has(object.id) && selected.size > 1 ? document.objects.filter((entry) => selected.has(entry.id)) : [object];
      const put = (entry: Equipment): Command => ({ type: 'object.put', object: entry });
      if (action === 'rotate') {
        dispatch({ type: 'batch', commands: rotateObjects(targets, ROTATION_SNAP_DEG).map(put) });
      } else if (action === 'duplicate') {
        const copies = duplicateObjects(targets, takenIds(document, retired));
        if (copies.length > 0 && dispatch({ type: 'batch', commands: copies.map(put) }).ok) {
          if (copies.length > 1) selectMany(copies.map((entry) => entry.id));
          else select({ kind: 'object', id: copies[0]!.id });
        }
      } else if (action === 'delete') {
        dispatch({ type: 'batch', commands: targets.map((entry): Command => ({ type: 'object.delete', id: entry.id })) });
      } else if (action === 'inventory') {
        showRightTab('inventory');
        focusOn({ kind: 'object', id: object.id });
      } else {
        showRightTab('assistant');
        // The assistant's own question for an object: it answers from the calculation.
        const [question] = selectionQuestions(document, { kind: 'object', id: object.id });
        if (question !== undefined) askAgent(question);
      }
    },
    [askAgent, closeObjectMenu, dispatch, document, focusOn, menuObject, retired, selected, selectMany, select, showRightTab],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      if (objectMenu !== null || isTypingTarget(event.target) || view !== '2d' || selection?.kind !== 'object') return;
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== null) return;
      const object = document.objects.find((entry) => entry.id === selection.id);
      const canvas = window.document.querySelector('[data-testid="editor-canvas"]');
      // An object on a hidden layer is not on the screen: no keys act on it either.
      if (object === undefined || canvas === null || document.layers.find((layer) => layer.id === object.layerId)?.visible !== true) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const [x, y] = modelToScreen(object.position, viewport);
      openObjectMenu(object.id, [bounds.left + x, bounds.top + y]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [document, objectMenu, openObjectMenu, selection, view, viewport]);

  // #182: bare keys for the toolbar tools, «Изменить перегородку» and the assistant.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const hotkey = editorHotkey(event);
      if (hotkey === null || event.repeat || objectMenu !== null || view !== '2d') return;
      if (window.document.querySelector('[aria-modal="true"]') !== null) return;
      if (hotkey.action === 'tool') {
        event.preventDefault();
        setTool({ kind: hotkey.tool });
      } else if (hotkey.action === 'wall-edit') {
        if (selectedWallId === null) return;
        event.preventDefault();
        changeWallEdit(wallEdit === null);
      } else {
        event.preventDefault();
        showRightTab('assistant');
        // The panel may mount after this render: focus the question field once it is there.
        window.setTimeout(() => window.document.querySelector<HTMLElement>('textarea[name="agent-question"]')?.focus(), 50);
        const [question] = selectionQuestions(document, selection);
        if (question !== undefined) askAgent(question);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askAgent, changeWallEdit, document, objectMenu, selectedWallId, selection, showRightTab, view, wallEdit]);

  const replaceDocument = useCallback(
    (plan: PlanDocument, origin: DocumentOrigin) => {
      // 'file' — план пришёл из файла и считается сохранённым состоянием;
      // 'draft' — восстановленный черновик, он никуда ещё не выгружен.
      // Пример организаторов приходит без наших правил и слоёв: сомкнуть с
      // командным справочником здесь, где он есть, — иначе на примере видны
      // только геометрические ошибки, а «терминал не далее 3 м» молчит.
      const merged =
        plan.catalog.version === ORGANIZER_CATALOG_VERSION ? withTeamCatalog(plan, catalog) : null;
      const document = merged?.ok ? merged.value : plan;
      store.getState().replaceDocument(document, origin);
      // Another plan opens with the selection tool, as a new plan does.
      setTool({ kind: 'select' });
      // Loading shows every layer again (plan-store); the groups follow.
      setHiddenMounts(new Set());
      // A refused merge is not a silent success: the plan opens as it came,
      // and the user is told the team rules and layers did not apply.
      setLastError(
        merged === null || merged.ok
          ? null
          : documentNotice(`Справочник команды к примеру не применён (план открыт без правил комплектования и информационных слоёв): ${merged.issues
              .map((issue) => issue.message)
              .join('; ')}`, store.getState().revision),
      );
      // Открыт другой документ: вид считается заново, даже если файл несёт ту
      // же личность, что и прежний.
      setDocumentEpoch((epoch) => epoch + 1);
      clearComparison();
      forgetAdvice();
    },
    [store, forgetAdvice, clearComparison],
  );

  const startNewPlan = useCallback(() => {
    const fresh = createPlanStore(createEmptyPlan(), 'new');
    setStore(fresh);
    setHiddenMounts(new Set());
    setTool({ kind: 'select' });
    setLastError(null);
    setDocumentEpoch((epoch) => epoch + 1);
    clearComparison();
    forgetAdvice();
  }, [forgetAdvice, clearComparison]);

  const shownError = lastError !== null && isEditErrorCurrent(lastError, document, revision) ? lastError : null;

  // A refusal does not bump the revision, so it would hang for ever over the
  // plan while the person works elsewhere (#146): it leaves after a while.
  useEffect(() => {
    if (lastError === null || lastError.scope !== 'edit') return undefined;
    const timer = window.setTimeout(() => setLastError(null), 8000);
    return () => window.clearTimeout(timer);
  }, [lastError]);

  return (
    <div
      className={`shell${planOnly ? ' shell--plan-only' : ''}`}
      style={{ '--side-left': `${panelWidths.left}rem`, '--side-right': `${panelWidths.right}rem` } as React.CSSProperties}
    >
      <header className="shell__bar">
        {/* D-350: the product name is a small caption, the plan name under it is
            what the person works on — always visible, renamed in place. */}
        <div className="shell__heading">
          <h1 className="shell__title">Цифровой двойник ОПС</h1>
          <div className="shell__doc-row">
            <PlanTitle
              name={document.name}
              dirty={dirty}
              onRename={(name) => dispatch({ type: 'plan.rename', name }).ok}
            />
            <HealthBadge
              health={health}
              empty={isEmptyPlan(document)}
              onOpen={() => {
                showRightTab('validation');
                setHealthRequest((count) => count + 1);
              }}
            />
            <button
              type="button"
              className="shell__quiet shell__settings"
              aria-label="Настройки"
              aria-haspopup="dialog"
              title="Настройки плана: название, потолок, типы оборудования и зон, правила"
              onClick={() => setSettingsOpen(true)}
            >
              <svg className="shell__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
        {/* data-tour marks what the first-run tour highlights; display: contents keeps the header layout. */}
        <div className="shell__anchor" data-tour="tools">
          <PlanTools document={document} session={session} onTool={(next) => {
            if (next.kind === 'room.draw') {
              planTool.cancel();
              setRoomMode('internal');
            }
            setTool(next);
          }} onCommand={dispatch}
            boundaryEditing={roomMode === 'boundary'}
            drawingActive={tool.kind === 'zone.draw' || tool.kind === 'room.draw' || tool.kind === 'shape.draw'}
          />
        </div>
        <div className="shell__view" role="group" aria-label="Вид плана">
          <button type="button" className="files__button" aria-pressed={view === '2d'} onClick={() => setView('2d')}>
            2D
          </button>
          <button type="button" className="files__button" aria-pressed={view === '3d'} onClick={() => setView('3d')}>
            3D
          </button>
        </div>
        <div className="shell__history" role="group" aria-label="История правок">
          <button type="button" className="shell__quiet" title={hasDrawingDraft ? placingOpening ? 'Отменить подготовленный проём (Ctrl+Z)' : 'Убрать последний угол рисунка (Ctrl+Z)' : 'Отменить последнюю правку (Ctrl+Z)'} onClick={undo}>
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3.5 2.5 6.5l3 3" />
              <path d="M2.5 6.5h7a4 4 0 0 1 0 8h-3" />
            </svg>
            <span className="shell__label">Отменить</span>
          </button>
          <button type="button" className="shell__quiet" disabled={hasDrawingDraft} title={hasDrawingDraft ? 'Завершите или отмените рисунок, чтобы вернуть правку плана' : 'Вернуть отменённую правку (Ctrl+Y или Ctrl+Shift+Z)'} onClick={redo}>
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10.5 3.5 3 3-3 3" />
              <path d="M13.5 6.5h-7a4 4 0 0 0 0 8h3" />
            </svg>
            <span className="shell__label">Вернуть</span>
          </button>
        </div>
        {/* D-260: the hotkeys map lives in the header, icon only — the row has
            little slack left at 1280 px. D-261:
            aria-keyshortcuts takes a KeyboardEvent.key value, so "?", not the
            code "Shift+Slash". */}
        <div className="shell__aux">
          <button
            type="button"
            className="shell__quiet shell__help"
            aria-label="Горячие клавиши"
            aria-keyshortcuts="?"
            title="Горячие клавиши (?)"
            onClick={hotkeysMap.show}
          >
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
              <path d="M4 6.5h1M7.5 6.5h1M11 6.5h1M4 9.5h8" />
            </svg>
          </button>
        </div>
        <div className="shell__anchor" data-tour="files">
        <FileControls
          document={document}
          dirty={dirty}
          revision={revision}
          untouchedSample={document.id === START_PLAN_ID && revision === 0}
          demoRequest={demoRequest}
          read={readPlanFile}
          encode={encodePlan}
          onReplace={replaceDocument}
          onNew={startNewPlan}
          onEditBoundary={() => {
            internalRoom.cancel();
            planTool.cancel();
            setRoomMode('boundary');
            setView('2d');
            setTool({ kind: 'room.draw' });
          }}
          onExported={() => {
            store.getState().markExported(revision);
          }}
          onShowValidation={() => showRightTab('validation')}
          variants={variants}
          onKeepVariant={() => store.getState().keepVariant()}
          onSwitchVariant={() => {
            store.getState().switchVariant();
            setTool({ kind: 'select' });
          }}
        />
        </div>
      </header>

      <div className={`shell__body${planOnly ? ' shell__body--plan-only' : ''}`}>
        <aside id="side-panel-left" className="shell__side" data-tour="side-left">
          {placingOpening ? <OpeningControls ready={openingTool.ready} valid={openingTool.valid} message={openingTool.message} kind={openingTool.kind} width={openingTool.width} onKind={openingTool.changeKind} onWidth={openingTool.setWidth} onApply={openingTool.apply} onCancel={openingTool.cancel} /> : null}
          {drawingRoom ? <InternalRoomControls draft={internalRoom.draft} ready={internalRoom.ready} valid={internalRoom.valid} message={internalRoom.message} name={internalRoom.name} typeId={internalRoom.typeId} types={document.catalog.zoneTypes} onName={internalRoom.setName} onType={internalRoom.setTypeId} onApply={internalRoom.apply} onCancel={internalRoom.cancel} onRemoveLast={internalRoom.removeLast} /> : null}
          {view === '2d' && !drawingRoom && (tool.kind === 'zone.draw' || tool.kind === 'room.draw' || tool.kind === 'shape.draw') ? (
            <DrawingControls name={tool.kind === 'zone.draw' ? 'зону' : tool.kind === 'room.draw' ? 'границу отделения' : 'фигуру'}
              shapeLabel={tool.kind === 'shape.draw' ? (document.catalog.objectTypes.find((type) => type.id === tool.typeId)?.label ?? tool.typeId) : undefined}
              roomBoundary={tool.kind === 'room.draw'} pendingRoom={planTool.pendingRoom} onConfirmRoom={planTool.confirmRoom}
              draft={planTool.draft} onFinish={planTool.finish} onRemoveLast={planTool.removeLast}
              onCancel={() => { planTool.cancel(); setTool({ kind: 'select' }); }} />
          ) : null}
          <SideTabs
            label="Панели слева"
            idPrefix="side-left"
            tabs={LEFT_TABS}
            active={tabs.left}
            onSelect={showLeftTab}
            panels={{
              layers: (
                <LayersPanel
                  document={document}
                  session={session}
                  onCommand={dispatch}
                  onSelect={select}
                  onFocus={focusOn}
                  objectMounts={objectMounts}
                  pictograms={pictogramsView}
                />
              ),
              library: (
                <LibraryPanel
                  key={documentEpoch}
                  catalog={document.catalog}
                  activeTypeId={tool.kind === 'object.place' || tool.kind === 'shape.draw' ? tool.typeId : null}
                  onTool={setTool}
                />
              ),
            }}
          />
          <div className="shell__side-foot">
            <button
              type="button"
              className="shell__tour"
              title="Четыре шага: открыть план, изменить, проверить, сохранить"
              onClick={() => setTourOpen(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 5v15M12 5C9 3 5 3 3 4v14c3-1 6 0 9 2 3-2 6-3 9-2V4c-2-1-6-1-9 1Z" />
              </svg>
              Обучение
            </button>
          </div>
        </aside>

        <div
          className="shell__resize"
          role="separator"
          aria-label="Изменить ширину левой панели"
          aria-orientation="vertical"
          aria-controls="side-panel-left"
          aria-valuemin={PANEL_LIMITS.left[0]}
          aria-valuemax={PANEL_LIMITS.left[1]}
          aria-valuenow={panelWidths.left}
          tabIndex={0}
          onPointerDown={(event) => startResize('left', event)}
          onPointerMove={(event) => moveResize('left', event)}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={(event) => resizeByKey('left', event)}
        />

        <main
          className="shell__canvas"
          data-view={view}
          ref={canvasRef}
          style={{ '--plan-only-top': `${planOnlyShift.top}px`, '--plan-only-right': `${planOnlyShift.right}px` } as React.CSSProperties}
          // The silhouette follows the pointer: outside the canvas there is none (#26).
          onPointerLeave={() => placementGhost.publish(null)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) placementGhost.publish(null);
          }}
          // A right button that goes and comes back to the same place is a click
          // (the menu); one that moved was a pan of the plan.
          onPointerDown={(event) => {
            if (event.button === 2) rightPress.current = [event.clientX, event.clientY];
          }}
          onPointerUp={(event) => {
            const from = rightPress.current;
            rightPress.current = null;
            if (event.button !== 2 || from === null || view !== '2d') return;
            if (Math.hypot(event.clientX - from[0], event.clientY - from[1]) > 4) return;
            if (tool.kind !== 'select' && tool.kind !== 'pan') return;
            // Only the plan itself: the buttons and the status line lie over it.
            const canvas = event.currentTarget.querySelector('[data-testid="editor-canvas"]');
            if (canvas === null || !canvas.contains(event.target as Node)) return;
            const bounds = canvas.getBoundingClientRect();
            const object = findPlacementPick(
              shownDocument,
              null,
              screenToModel([event.clientX - bounds.left, event.clientY - bounds.top], viewport),
              viewport.scale,
            );
            if (object !== null) openObjectMenu(object.id, [event.clientX, event.clientY]);
          }}
        >
          <button
            type="button"
            className="shell__plan-only-toggle"
            aria-label={planOnly ? 'Показать интерфейс' : 'Скрыть интерфейс'}
            title={planOnly ? 'Показать интерфейс' : 'Показать только план'}
            aria-pressed={planOnly}
            onClick={togglePlanOnly}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12c2.5-4 5.8-6 10-6s7.5 2 10 6c-2.5 4-5.8 6-10 6s-7.5-2-10-6Z" />
              <circle cx="12" cy="12" r="3" />
              {planOnly ? <path d="M3 21 21 3" /> : null}
            </svg>
          </button>
          {/* The captions apply to the 2D canvas only. The state stays in App,
              so it survives a round trip through 3D. */}
          {view === '2d' ? (
            <button
              type="button"
              className="shell__plan-only-toggle shell__captions-toggle"
              aria-label="Подписи объектов"
              title={captions ? 'Убрать подписи объектов' : 'Показать подписи объектов'}
              aria-pressed={captions}
              onClick={() => setCaptions((shown) => !shown)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7V5h16v2" />
                <path d="M12 5v14" />
                <path d="M9 19h6" />
              </svg>
            </button>
          ) : null}
          {/* The refusal floats over the canvas: a row above it would push the
              plan down under the pointer that just made the gesture. */}
          {shownError === null ? null : (
            <p className="shell__error" role="alert">
              <span className="shell__error-text">
                {shownError.scope === 'edit' ? 'Правка отклонена: ' : null}
                {shownError.message}
              </span>
              <button
                type="button"
                className="shell__error-close"
                aria-label="Скрыть сообщение"
                title="Скрыть сообщение"
                onClick={() => setLastError(null)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </p>
          )}
          <EditorCanvas
            key={documentEpoch}
            document={document}
            session={session}
            onPointer={(event) => {
              if (event.phase !== 'cancel') publishCanvasCursor(event.point);
              // Esc drops the type taken from the library, as it drops a drawing.
              else if (tool.kind === 'object.place') setTool({ kind: 'select' });
              if (placingOpening) openingTool.handlePointer(event);
              else if (drawingRoom) internalRoom.handlePointer(event);
              else planTool.handlePointer(event);
              if ((event.phase === 'down' || event.phase === 'move') && tool.kind === 'object.place') {
                const existing = findPlacementPick(
                  shownDocument,
                  tool.typeId,
                  event.point,
                  viewport.scale,
                );
                if (existing !== null) {
                  // A click here selects the object instead of placing a new one,
                  // so the silhouette that promises a placement is not shown (#26);
                  // the hint line says why nothing new appeared (#219).
                  if (event.phase === 'down') {
                    planSelect({ kind: 'object', id: existing.id });
                    setNotice(occupiedPlaceNotice(existing.label.trim() || existing.id));
                  } else placementGhost.publish(null);
                  return;
                }
                if (event.phase === 'down' && getNotice()?.startsWith(OCCUPIED_PLACE_PREFIX)) setNotice(null);
              }
              equipmentTool.handlePointer(event);
              if (event.phase === 'up' && placedType.current !== null) {
                const completedType = placedType.current;
                placedType.current = null;
                // Browser click follows pointer-up. Disarm after it, so the
                // placement click cannot also select the room underneath.
                window.setTimeout(() => {
                  setTool((current) =>
                    current.kind === 'object.place' && current.typeId === completedType
                      ? { kind: 'select' }
                      : current,
                  );
                }, 0);
              }
            }}
            onViewport={setViewport}
            onSelect={planSelect}
            overlay={
              <>
              {/* После оборудования — иначе объект, вставший на подпись, закрывает
                  название зоны целиком; полупрозрачность не даёт подписи закрыть
                  сам объект. */}
              <ZoneNameLayer document={shownDocument} viewport={viewport} />
              {/* Правка формы объекта (D-279) — над оборудованием: её ручки
                  должны перехватывать жест раньше переноса и размера объекта. */}
              <ObjectShapeLayer
                document={document}
                session={session}
                onCommand={dispatch}
                onEditingChange={setShapeEditingId}
                reshapeFor={reshapeFor}
                onReshapeRequest={reshapeObject}
              />
              <InformationLayer document={document} session={session} />
              {/* Силуэт ставимого типа под указателем: зелёный — примет, красный —
                  откажет, причина рядом (#26). Над объектами, под линейкой. */}
              <PlacementGhostLayer active={tool.kind === 'object.place'} viewport={viewport} />
              {/* Линейка — поверх плана: измеряют по тому, что видно, и отрезок не
                  должен уходить под объект или под имя зоны. В план она ничего не
                  кладёт (D-256). */}
              <MeasureLayer viewport={viewport} />
              {activeWalk === null ? null : (
                <WalkRouteLayer document={document} viewport={viewport} route={activeWalk.route} currentId={activeWalk.currentId} />
              )}
              {/* Подсветка идёт от выделения, не от фокуса: клик по объекту на холсте
                  тоже показывает его находки, а Escape гасит подсветку вместе с выбором. */}
              <IssueLayer
                issues={issues}
                focus={selection}
                viewport={viewport}
                // Маркер ловит клик только в «Выбор»/«Обзор»: во время рисования
                // клик должен по-прежнему идти инструменту, ставящему точки.
                onMarkerClick={tool.kind === 'select' || tool.kind === 'pan' ? focusFromMarker : undefined}
              />
              </>
            }
          >
            <Layer name="plan">
              <PlanGeometryLayer
                document={document}
                session={session}
                draft={drawingRoom ? internalRoom.draft : planTool.draft}
                draftCursor={drawingRoom ? null : planTool.cursor}
                rectangleCorners={drawingRoom ? internalRoom.corners : undefined}
                wallEditing={wallEdit !== null}
                onWallEditingChange={changeWallEdit}
                onCommand={dispatch}
                onSelect={planSelect}
              />
              <OpeningPreviewLayer opening={openingTool.preview} plan={document} viewport={viewport} valid={openingTool.valid} />
            </Layer>
            <EquipmentLayer
              document={shownDocument}
              session={session}
              issues={issues}
              onCommand={dispatch}
              onSelect={planSelect}
              onSelectMany={planSelectMany}
              preview={preview}
              previewEdits={previewEdits}
              onGesturePreview={gesturePreview.publish}
              hideHandlesFor={shapeEditingId}
              reshapeFor={reshapeFor}
              pictograms={pictograms}
              captions={captions}
            />
          </EditorCanvas>
          {view === '2d' ? (
            <CanvasStatus
              document={shownDocument}
              session={session}
              draft={drawingRoom ? null : planTool.draft}
              draftCursor={drawingRoom ? null : planTool.cursor}
            />
          ) : null}
          {zoneCopyHint && view === '2d' ? (
            <p className="canvas-hint" role="status">Зону копировать нельзя: Ctrl+C, Ctrl+V и Ctrl+D работают для объектов.</p>
          ) : null}
          {view === '3d' ? (
            <View3D document={shownDocument} selection={selection} onSelect={planSelect} />
          ) : null}
          {view === '2d' ? <AssistantLauncher onOpen={() => showRightTab('assistant')} /> : null}
        </main>

        <div
          className="shell__resize"
          role="separator"
          aria-label="Изменить ширину правой панели"
          aria-orientation="vertical"
          aria-controls="side-panel-right"
          aria-valuemin={PANEL_LIMITS.right[0]}
          aria-valuemax={PANEL_LIMITS.right[1]}
          aria-valuenow={panelWidths.right}
          tabIndex={0}
          onPointerDown={(event) => startResize('right', event)}
          onPointerMove={(event) => moveResize('right', event)}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onKeyDown={(event) => resizeByKey('right', event)}
        />

        <aside id="side-panel-right" className="shell__side shell__side--wide" data-tour="side-right">
          <InventoryLinkNotice document={document} onFocus={focusOn} />
          {/* #105 (was D-268): «Свойства» stand above the right column's tabs;
              «×» drops the selection (the same as Escape on the canvas). D-272: the band
              is the card's only title and its only heading — the card has
              none of its own and stays the region «Свойства» by its
              aria-label (it renders the same without the band). */}
          {findingShown && findingRef !== null ? (
            <FindingCard
              plan={document}
              issues={findingIssues}
              allIssues={issues}
              target={findingRef}
              onClose={closeProps}
              onShowProps={() => setFindingRef(null)}
            />
          ) : propsShown ? (
            <div className={cardOnly ? 'shell__props shell__props--alone' : 'shell__props'}>
              <div className="shell__props-band">
                {/* A heading by role, not an <h2>: the band keeps its look without
                    new styles, and a screen reader's heading list finds the
                    card by it — the card has no heading of its own. */}
                <span className="shell__props-caption" role="heading" aria-level={2}>
                  Свойства
                </span>
                <button
                  type="button"
                  className="shell__props-close"
                  aria-label="Снять выделение"
                  title="Снять выделение (Esc)"
                  onClick={closeProps}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              {quickObject === undefined ? (
                deletion === null ? null : (
                  <section className="props-quick" aria-label="Удаление">
                    <SelectionDelete deletion={deletion} onDelete={deleteSelection} />
                  </section>
                )
              ) : (
                <ObjectQuickActions
                  object={quickObject}
                  disabled={quickDisabled}
                  reshape={reshapeFor === quickObject.id}
                  onReshape={(on) => setReshapeFor(on ? quickObject.id : null)}
                  onRotate={(deltaDeg) => {
                    dispatch({
                      type: 'object.put',
                      object: { ...quickObject, rotation_deg: normalizeAngle(quickObject.rotation_deg + deltaDeg) || 0 },
                    });
                  }}
                >
                  {deletion === null ? null : <SelectionDelete deletion={deletion} onDelete={deleteSelection} />}
                </ObjectQuickActions>
              )}
              <div className="shell__props-body">
                <PropertiesPanel
                  document={document}
                  session={session}
                  onCommand={dispatch}
                  gesturePreview={gesturePreview}
                  wallEditing={wallEdit !== null}
                  onWallEditingChange={changeWallEdit}
                />
              </div>
            </div>
          ) : null}
          <SideTabs
            label="Панели справа"
            hidden={cardOnly}
            idPrefix="side-right"
            tabs={RIGHT_TABS}
            active={tabs.right}
            onSelect={showRightTab}
            badges={{ validation: validationBadge }}
            panels={{
              assistant: (
                <AssistantPanel
                  document={document}
                  revision={contentRevision}
                  response={advice}
                  state={adviceState}
                  onPreview={setPreview}
                  onFocus={focusOn}
                  onAsk={askAssistant}
                  exchanges={exchanges}
                  actionStatus={agentActionStatus}
                  onAskAgent={askAgent}
                  onAgentAction={runAssistantAction}
                  onClearChat={clearChat}
                  selection={selection}
                  comparisonBusy={comparison.loading}
                  comparisonUnrelated={comparison.source !== null && comparison.source.plan.id !== document.id}
                  comparison={<ComparisonPanel current={document} baseline={baseline} source={comparison.source}
                    loading={comparison.loading} error={comparison.error} onFocus={focusOn}
                    onLoad={async (file) => {
                      resetAdvice();
                      await comparison.load(file);
                    }}
                    onClear={() => {
                      comparison.clear();
                      resetAdvice();
                    }} />}
                />
              ),
              metrics: <MetricsPanel document={document} metrics={metrics} onFocus={focusOn} />,
              validation: <ValidationPanel issues={issues} document={document} onFocus={focusFinding} focus={focus} onPreview={setPreview} onApplyFix={applyFix} healthRequest={healthRequest} />,
              inventory: (
                <>
                  <RuleChecklist
                    document={document}
                    onAsk={(question) => {
                      showRightTab('assistant');
                      askAgent(question);
                    }}
                  />
                  <InventoryWalk document={document} walk={activeWalk} onWalkChange={setWalk} onCommand={dispatch} onFocus={focusOn} selectedId={selection?.kind === 'object' ? selection.id : null} />
                  <InventoryPanel inventory={inventory} document={document} onFocus={focusOn} />
                </>
              ),
            }}
          />
        </aside>
      </div>

      <Onboarding open={tourOpen} onClose={closeTour} onOpenDemo={(variant) => {
        closeTour('done');
        setDemoRequest((previous) => ({ id: (previous?.id ?? 0) + 1, variant }));
      }} />
      <HotkeysMapDialog open={hotkeysMap.open} onClose={hotkeysMap.hide} />
      {menuObject === undefined || objectMenu === null ? null : (
        <ObjectContextMenu object={menuObject} count={selected.has(menuObject.id) ? selected.size : 1} at={objectMenu.at} onAction={runObjectMenu} onClose={closeObjectMenu} />
      )}
      {/* Mounted only while open: every opening starts with an empty query. */}
      {!searchOpen ? null : <QuickSearchDialog
        plan={document}
        onClose={closeSearch}
        onPick={(item: SearchItem) => {
          setSearchOpen(false);
          searchReturnFocus.current = null;
          if (item.kind === 'ref') focusOn(item.ref);
          else if (item.kind === 'place') setTool({ kind: 'object.place', typeId: item.typeId });
          else {
            const layer = document.layers.find((entry) => entry.id === item.layerId);
            if (layer !== undefined) dispatch({ type: 'layer.put', layer: { ...layer, visible: !layer.visible } });
          }
        }}
      />}
      <SettingsDialog
        open={settingsOpen}
        onClose={closeSettings}
        document={document}
        onCommand={dispatch}
        session={session}
        onSelect={select}
      />
    </div>
  );
}

import { openingEditRejection } from '../features/plan-tools/opening-edit-rejection';
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AdviceRequest, AdviceResponse, Candidate } from '../contracts/advice';
import type { AgentAnswer, AgentExchange, AssistantAction } from '../contracts/advice-chat';
import type { Command, DocumentOrigin } from '../contracts/commands';
import type { Id, PlanDocument, Ref, Result, Viewport } from '../contracts/model';
import type { AssistantPanelRequest, EditorSession, RequestState, Tool } from '../contracts/ui';
import { buildInventory } from '../domain/inventory';
import { modelToScreen } from '../domain/geometry';
import { measurePlan } from '../domain/metrics';
import {
  mountScopeLayer,
  objectMount,
  revealMountOf,
  withHiddenMounts,
  type ObjectMount,
} from '../domain/object-mount';
import { validatePlan } from '../domain/validation';
import { candidateObjectForInsert } from '../domain/advice';
import { AssistantPanel } from '../features/assistant/AssistantPanel';
import { ComparisonPanel } from '../features/assistant/ComparisonPanel';
import { useComparisonSource } from '../features/assistant/use-comparison-source';
import { requestAdvice } from '../features/assistant/advice-client';
import { requestAgent, turnsOf } from '../features/assistant/agent-client';
import { EditorCanvas } from '../features/editor/EditorCanvas';
import { planExtent } from '../features/editor/focus';
import { fitToExtent } from '../features/editor/viewport';
import { historyHotkey } from '../features/editor/hotkeys';
import { EquipmentLayer } from '../features/equipment/EquipmentLayer';
import { findPlacementPick } from '../features/equipment/placement-pick';
import { useEquipmentToolController } from '../features/equipment/use-equipment-tool-controller';
import { FileControls } from '../features/files/FileControls';
import { CatalogPanel } from '../features/catalog-editor/CatalogPanel';
import { InventoryPanel } from '../features/inventory/InventoryPanel';
import { InformationLayer } from '../features/layers/InformationLayer';
import { LayersPanel } from '../features/layers/LayersPanel';
import { MetricsPanel } from '../features/inventory/MetricsPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { Onboarding } from '../features/onboarding/Onboarding';
import { browserStorage as tourStorage, rememberTour, shouldShowTour, type TourOutcome } from '../features/onboarding/tour';
import { MeasureLayer } from '../features/plan-tools/MeasureLayer';
import { ObjectShapeLayer } from '../features/plan-tools/ObjectShapeLayer';
import { PlanGeometryLayer } from '../features/plan-tools/PlanGeometryLayer';
import { PropertiesPanel } from '../features/properties/PropertiesPanel';
import { PlanTools } from '../features/plan-tools/PlanTools';
import { InternalRoomControls } from '../features/plan-tools/InternalRoomControls';
import { useInternalRoomController } from '../features/plan-tools/use-internal-room-controller';
import { DrawingControls } from '../features/plan-tools/DrawingControls';
import { ZoneNameLayer } from '../features/plan-tools/ZoneNameLayer';
import { usePlanToolController } from '../features/plan-tools/use-plan-tool-controller';
import { IssueLayer } from '../features/validation/IssueLayer';
import { ValidationPanel } from '../features/validation/ValidationPanel';
import { View3D } from '../features/view3d/View3D';
import { encodePlan } from '../persistence/codec';
import { readPlanFile } from '../persistence/format';
import { ORGANIZER_CATALOG_VERSION, withTeamCatalog } from '../persistence/organizer-import';
import { createPlanStore } from '../state/plan-store';
import { catalog, createEmptyPlan } from './default-plan';
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
import { SideTabs } from './SideTabs';
import { sameRef, showsPropsCard } from './props-column';
import { HotkeysMapDialog } from './HotkeysMapDialog';
import { useHotkeysMapDialog } from './hotkeys-map';
import './styles.css';

const START_VIEWPORT: Viewport = { origin: [0, 0], scale: 48 };
const PANEL_WIDTHS_KEY = 'posttech.panel-widths';
const PANEL_HANDLE_PX = 8;
const MIN_CANVAS_PX = 360;
const PANEL_LIMITS = { left: [160, 440], right: [200, 500] } as const;
type PanelSide = 'left' | 'right';
type PanelWidths = { left: number; right: number };

function clampPanelWidth(side: PanelSide, width: number, available: number, other: number): number {
  const [minimum, maximum] = PANEL_LIMITS[side];
  const room = available - other - PANEL_HANDLE_PX * 2 - MIN_CANVAS_PX;
  return Math.round(Math.max(minimum, Math.min(width, maximum, Math.max(minimum, room))));
}

function initialPanelWidths(): PanelWidths {
  const fallback = { left: 260, right: 340 };
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(PANEL_WIDTHS_KEY) ?? 'null');
    if (saved === null || typeof saved !== 'object') return fallback;
    const widths = saved as Partial<PanelWidths>;
    if (!Number.isFinite(widths.left) || !Number.isFinite(widths.right)) return fallback;
    const left = clampPanelWidth('left', widths.left as number, window.innerWidth, widths.right as number);
    const right = clampPanelWidth('right', widths.right as number, window.innerWidth, left);
    return { left, right };
  } catch {
    return fallback;
  }
}

function candidateOf(answer: AgentAnswer, recommendationId: Id, candidateId: Id): Candidate | null {
  return answer.recommendations.find((entry) => entry.id === recommendationId)?.candidates.find((entry) => entry.id === candidateId) ?? null;
}

export function App(): React.JSX.Element {
  const [store, setStore] = useState(() => createPlanStore(createEmptyPlan(), 'new'));
  const [gesturePreview] = useState(createObjectGesturePreviewChannel);
  const document = useStore(store, (state) => state.document);
  const baseline = useStore(store, (state) => state.baseline);
  const comparison = useComparisonSource();
  const clearComparison = comparison.clear;
  const revision = useStore(store, (state) => state.revision);
  const contentRevision = useStore(store, (state) => state.contentRevision);
  const selection = useStore(store, (state) => state.selection);
  const dirty = useStore(store, (state) => state.dirty);

  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [roomMode, setRoomMode] = useState<'internal' | 'boundary'>('internal');
  // 3D is an overlay over the same document; the 2D canvas stays mounted below it.
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT);
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(initialPanelWidths);
  const [planOnly, setPlanOnly] = useState(false);
  const canvasRef = useRef<HTMLElement>(null);
  const viewportBeforePlanOnly = useRef<Viewport | null>(null);
  const togglePlanOnly = useCallback((): void => {
    if (!planOnly) viewportBeforePlanOnly.current = viewport;
    setPlanOnly(!planOnly);
    // Presentation mode uses the whole canvas; returning restores the exact
    // working view the person had before hiding the editor.
    window.requestAnimationFrame(() => {
      if (planOnly) {
        if (viewportBeforePlanOnly.current !== null) setViewport(viewportBeforePlanOnly.current);
        return;
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect !== undefined) setViewport(fitToExtent(planExtent(document), { width: rect.width, height: rect.height }));
    });
  }, [document, planOnly, viewport]);
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
    const width = start.width + (side === 'left' ? event.clientX - start.x : start.x - event.clientX);
    const available = event.currentTarget.parentElement?.clientWidth ?? window.innerWidth;
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
    const step = event.key === 'ArrowLeft' ? -16 * direction : event.key === 'ArrowRight' ? 16 * direction : 0;
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const before = canvasBeforeResize();
    const available = event.currentTarget.parentElement?.clientWidth ?? window.innerWidth;
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
  const [tourOpen, setTourOpen] = useState(() => shouldShowTour(tourStorage()));
  const [demoRequest, setDemoRequest] = useState<{ id: number; variant: 'before' | 'after' } | null>(null);
  const closeTour = useCallback((outcome: TourOutcome) => {
    rememberTour(tourStorage(), outcome);
    setTourOpen(false);
  }, []);
  // UX-3: карта горячих клавиш по «?» — открытие, закрытие и возврат фокуса
  // живут в самом хуке (hotkeys-map.ts), здесь только кнопка и накладка.
  const hotkeysMap = useHotkeysMapDialog();

  // Ctrl+Z / Ctrl+Y — те же undo/redo, что и кнопки в шапке: история живёт в
  // store, поэтому слушатель один, здесь, а не в каждом слое холста.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const action = historyHotkey(event);
      if (action === null) return;
      event.preventDefault();
      store.getState()[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
  const [focus, setFocus] = useState<EditorSession['focus']>(null);
  const [preview, setPreview] = useState<Candidate | null>(null);
  // D-290: the object in shape mode; the equipment layer hides its handles.
  const [shapeEditingId, setShapeEditingId] = useState<string | null>(null);
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  // A response belongs to the latest request, not merely to a plan revision.
  // A new plan starts at revision 0 too, so comparing revisions cannot reject
  // a late answer from the document that was open before «Новый».
  const adviceRequestSequence = useRef(0);
  // D-258: the conversation with the plan agent — interface state, never in
  // the plan file. Its own sequence drops a late answer after «Новый»/«Открыть».
  const [exchanges, setExchanges] = useState<AgentExchange[]>([]);
  const [agentActionStatus, setAgentActionStatus] = useState<string | null>(null);
  const agentSequence = useRef(0);
  /**
   * Сколько раз документ заменяли целиком. Холст помнит, какой документ он уже
   * вписал, по `id` и имени, а два файла могут нести одну личность:
   * `demo/before.json` и `demo/after.json` именно такие — второй это тот же
   * план после рекомендации. Жюри открывает их подряд, поэтому «документ
   * заменили» решается по самому действию, а не по содержимому файла: смена
   * этого числа пересоздаёт холст, и вид считается заново.
   */
  const [documentEpoch, setDocumentEpoch] = useState(0);
  const [adviceState, setAdviceState] = useState<RequestState>({ status: 'idle' });

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
  const showLeftTab = useCallback((left: LeftTab) => {
    setTabs((prev) => (prev.left === left ? prev : { ...prev, left }));
  }, []);
  const showRightTab = useCallback((right: RightTab) => {
    setTabs((prev) => (prev.right === right ? prev : { ...prev, right }));
  }, []);
  // The launcher is deliberately only an entry point: the right-column panel
  // remains the one place where assistant state and future chat history live.
  // It switches the column to the assistant tab — a hidden panel is not
  // "opened" by scrolling to it. Since D-268 «Свойства» live on the left, so
  // the selection stays: the assistant can be asked about what is selected.
  const retired = useStore(store, (state) => state.retired);
  const selected = useStore(store, (state) => state.selected);
  const session: EditorSession = useMemo(
    () => ({ tool, viewport, selection, selected, preview, focus, retired }),
    [tool, viewport, selection, selected, preview, focus, retired],
  );

  // D-268: «Свойства» stand in the left column in place of its open tab. The
  // one piece of state is the selection the card was sent away for (a click
  // on «Библиотека»/«Слои», a fresh placement): for it the tab stays, and any
  // new pick shows the card again.
  const [propsHiddenFor, setPropsHiddenFor] = useState<Ref | null>(null);
  const propsShown = showsPropsCard(selection, propsHiddenFor);
  // `null` when already `null` is a bail-out: a repeated pick mid-gesture does
  // not re-render the app.
  const showPropsAgain = useCallback(() => setPropsHiddenFor(null), []);
  const keepLeftTab = useCallback((ref: Ref | null) => {
    setPropsHiddenFor((prev) => (sameRef(prev, ref) ? prev : ref));
  }, []);

  const select = useCallback(
    (ref: Ref | null) => {
      store.getState().select(ref);
    },
    [store],
  );
  const selectMany = useCallback(
    (ids: readonly Id[]) => {
      store.getState().selectMany(ids);
      showPropsAgain();
    },
    [showPropsAgain, store],
  );
  // A tab click on the left while the card stands there brings the panel back
  // and keeps the selection; so does a panel opened by the assistant.
  const revealLeftTab = useCallback(
    (left: LeftTab) => {
      keepLeftTab(store.getState().selection);
      showLeftTab(left);
    },
    [keepLeftTab, showLeftTab, store],
  );
  // A pick made inside the left column (a row of «Слои») must not cover the
  // very panel it was made in.
  const selectFromLeft = useCallback(
    (ref: Ref | null) => {
      select(ref);
      keepLeftTab(ref);
    },
    [keepLeftTab, select],
  );

  const dispatch = useCallback(
    (command: Command): Result<PlanDocument> => {
      const openingError = command.type === 'opening.put' ? openingEditRejection(store.getState().document,command.opening) : null;
      const result: Result<PlanDocument> = openingError === null ? store.getState().dispatch(command) : {ok:false,issues:[openingError]};
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

  const focusOn = useCallback(
    (ref: Ref) => {
      focusSequence.current += 1;
      setFocus({ ref, sequence: focusSequence.current });
      select(ref);
      showPropsAgain();
    },
    [select, showPropsAgain],
  );

  // A pick on the plan (2D or 3D) is a new pick: the card comes back to the
  // left column even for the entity it was sent away for.
  const selectOnPlan = useCallback(
    (ref: Ref | null) => {
      select(ref);
      showPropsAgain();
    },
    [select, showPropsAgain],
  );
  // «×» drops the selection; the card goes and the column shows its tab
  // again, so focus lands on that tab rather than on the removed button.
  const closeProps = useCallback(() => {
    select(null);
    window.document.getElementById(`side-left-tab-${tabs.left}`)?.focus();
  }, [select, tabs.left]);

  // A click on an issue marker (V02-marker-click) is a request for the list:
  // the selection goes to the card on the left, «Проверка» comes to the front
  // on the right.
  const focusFromMarker = useCallback(
    (ref: Ref) => {
      focusOn(ref);
      showRightTab('validation');
    },
    [focusOn, showRightTab],
  );

  const placedType = useRef<Id | null>(null);
  // D-275: hidden floor/ceiling groups (view state, see `shownDocument` below).
  const [hiddenMounts, setHiddenMounts] = useState<ReadonlySet<ObjectMount>>(() => new Set());
  // Значки типов на плане: состояние вида. Выключение оставляет цвет, форму и
  // подписи и ничего не пишет в документ, поэтому отмена его не видит.
  const [pictograms, setPictograms] = useState(true);
  const pictogramsView = useMemo(
    () => ({ shown: pictograms, onToggle: () => setPictograms((shown) => !shown) }),
    [pictograms],
  );
  // D-279: a drawn shape is a placement too — into a hidden group it shows that group.
  const dispatchPlanCommand = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatchAndSelect(command);
      if (result.ok && tool.kind === 'shape.draw' && command.type === 'object.put') {
        const scope = mountScopeLayer(store.getState().document.layers);
        if (scope !== undefined) {
          const placed = command.object;
          setHiddenMounts((current) => revealMountOf(current, scope.id, placed));
        }
      }
      return result;
    },
    [dispatchAndSelect, store, tool],
  );
  const planTool = usePlanToolController({ document, session, onCommand: dispatchPlanCommand }, documentEpoch);
  const dispatchInternalRoom = useCallback((command: Command): Result<PlanDocument> => {
    const result = dispatchPlanCommand(command);
    if (result.ok && command.type === 'batch') {
      const zone = command.commands.find((step) => step.type === 'zone.put');
      if (zone?.type === 'zone.put') selectOnPlan({ kind: 'zone', id: zone.zone.id });
    }
    return result;
  }, [dispatchPlanCommand, selectOnPlan]);
  const internalRoom = useInternalRoomController({ document, session, onCommand: dispatchInternalRoom }, view === '2d' && tool.kind === 'room.draw' && roomMode === 'internal', documentEpoch);
  const placingOpening = view === '2d' && tool.kind === 'opening.place';
  const applyOpeningCommand = useCallback((command: Command): Result<PlanDocument> => {
    const result = dispatchPlanCommand(command);
    if (result.ok) setTool({kind:'select'});
    return result;
  }, [dispatchPlanCommand, setTool]);
  const openingTool = useOpeningController({document,session,onCommand:applyOpeningCommand}, placingOpening, documentEpoch);
  const drawingRoom = view === '2d' && tool.kind === 'room.draw' && roomMode === 'internal';
  const dispatchEquipmentCommand = useCallback(
    (command: Command): Result<PlanDocument> => {
      const result = dispatchAndSelect(command);
      // Remember an accepted placement until pointer-up. Keeping the placement
      // tool through the matching click prevents that same click from falling
      // through to the room selection layer after React re-renders.
      if (result.ok && tool.kind === 'object.place' && command.type === 'object.put') {
        placedType.current = tool.typeId;
        // D-268: a placement from the library keeps the library open — the
        // next item is usually placed right after. The new object's card
        // opens with a click on it.
        keepLeftTab({ kind: 'object', id: command.object.id });
        // D-275: a placement into a hidden group shows that group — otherwise
        // the new object is invisible and the next click places a duplicate.
        const scope = mountScopeLayer(store.getState().document.layers);
        if (scope !== undefined) {
          const placed = command.object;
          setHiddenMounts((current) => revealMountOf(current, scope.id, placed));
        }
      }
      return result;
    },
    [dispatchAndSelect, keepLeftTab, store, tool],
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
  const issues = useMemo(() => validatePlan(document), [document]);
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

  const askAssistant = useCallback(
    (request: AssistantPanelRequest, query?: string) => {
      const sequence = ++adviceRequestSequence.current;
      setAdviceState({ status: 'loading' });
      // Ответ привязан к ревизии запроса: панель сама скажет, что он устарел,
      // если план успели поправить, пока сервер считал.
      // The panel knows no document history and sends the current plan as
      // "before"; only the app knows the real one.
      const grounded: AdviceRequest =
        request.scenario === 'compare' ? { ...request, before: comparison.source?.plan ?? baseline } : request;
      const asked = { plan: document, revision: contentRevision, request: grounded, ...(query === undefined ? {} : { query }) };
      void requestAdvice(asked).then((result) => {
        // The document may have been replaced, or another request may have
        // started while this one was in flight. In either case this answer no
        // longer owns the panel.
        if (sequence !== adviceRequestSequence.current) return;
        if (!result.ok) {
          setAdvice(null);
          setAdviceState({
            status: 'error',
            message: result.issues.map((issue) => issue.message).join('; '),
          });
          return;
        }
        setAdvice(result.value);
        setAdviceState({ status: 'done' });
      });
    },
    [baseline, comparison.source, contentRevision, document],
  );

  // D-258: ring on the plan without selecting — the agent points, the
  // person decides what to pick.
  const highlight = useCallback((ref: Ref) => {
    focusSequence.current += 1;
    setFocus({ ref, sequence: focusSequence.current });
  }, []);

  const askAgent = useCallback(
    (question: string) => {
      const sequence = ++agentSequence.current;
      const id = `ask-${sequence}`;
      const update = (change: (exchange: AgentExchange) => AgentExchange): void => {
        if (sequence !== agentSequence.current) return;
        setExchanges((previous) => previous.map((exchange) => (exchange.id === id ? change(exchange) : exchange)));
      };
      setAgentActionStatus(null);
      setExchanges((previous) => [...previous, { id, question, revision: contentRevision, steps: [], answer: null, error: null }]);
      const input = { plan: document, revision: contentRevision, query: question, history: turnsOf(exchanges), before: baseline };
      void requestAgent(input, (step) => update((exchange) => ({ ...exchange, steps: [...exchange.steps, step] }))).then((result) => {
        if (sequence !== agentSequence.current) return;
        if (!result.ok) {
          update((exchange) => ({ ...exchange, error: result.issues.map((issue) => issue.message).join('; ') }));
          return;
        }
        const answer = result.value;
        update((exchange) => ({ ...exchange, answer }));
        // The agent shows what it found: the offered variant ghosted on the
        // plan, otherwise a ring round the first entity of the answer.
        const offered = answer.actions.find((action) => action.kind === 'preview-candidate');
        const candidate = offered === undefined ? null : candidateOf(answer, offered.recommendationId, offered.candidateId);
        if (candidate !== null) {
          setPreview(candidate);
          if (candidate.object.zoneId !== null) highlight({ kind: 'zone', id: candidate.object.zoneId });
        } else if (answer.refs[0] !== undefined) {
          highlight(answer.refs[0]);
        }
      });
    },
    [baseline, contentRevision, document, exchanges, highlight],
  );

  const runAgentAction = useCallback(
    (action: AssistantAction, answer: AgentAnswer) => {
      if (answer.revision !== store.getState().contentRevision) {
        setAgentActionStatus('План изменился после ответа — спросите заново.');
        return;
      }
      switch (action.kind) {
        case 'focus': {
          const exists = action.ref.kind === 'zone' ? document.zones.some((zone) => zone.id === action.ref.id) : document.objects.some((object) => object.id === action.ref.id);
          if (!exists) {
            setAgentActionStatus(`«${action.ref.id}» больше нет в плане.`);
            return;
          }
          focusOn(action.ref);
          setAgentActionStatus(null);
          return;
        }
        case 'preview-candidate':
        case 'apply-candidate': {
          const candidate = candidateOf(answer, action.recommendationId, action.candidateId);
          if (candidate === null) {
            setAgentActionStatus('Вариант не найден в ответе — спросите заново.');
            return;
          }
          if (action.kind === 'preview-candidate') {
            setPreview(candidate);
            if (candidate.object.zoneId !== null) highlight({ kind: 'zone', id: candidate.object.zoneId });
            setAgentActionStatus('Вариант показан на плане полупрозрачно.');
            return;
          }
          // The one edit an answer can lead to: the person pressed the button,
          // and the variant goes in as an ordinary command with its undo step.
          const current = store.getState();
          const object = candidateObjectForInsert(current.document, candidate, current.retired);
          const result = dispatchAndSelect({ type: 'object.put', object });
          setPreview(null);
          setAgentActionStatus(
            result.ok
              ? `Применено: «${candidate.object.label}» поставлен на план. Отменить — Ctrl+Z.`
              : `Не применено: ${result.issues.map((issue) => issue.message).join('; ')}`,
          );
          return;
        }
        case 'show-layer': {
          const layer = document.layers.find((entry) => entry.id === action.layerId);
          if (layer === undefined) {
            setAgentActionStatus('Слоя больше нет в плане.');
            return;
          }
          if (!layer.visible) dispatch({ type: 'layer.put', layer: { ...layer, visible: true } });
          revealLeftTab('layers');
          setAgentActionStatus(`Слой «${layer.name}» включён.`);
          return;
        }
        case 'open-panel':
          showRightTab(action.panel);
          return;
      }
    },
    [dispatch, dispatchAndSelect, document, focusOn, highlight, store, revealLeftTab, showRightTab],
  );

  const clearChat = useCallback(() => {
    agentSequence.current += 1;
    setExchanges([]);
    setAgentActionStatus(null);
    setPreview(null);
  }, []);

  // A recommendation belongs to the plan it was computed for: after «Открыть»
  // or «Новый» its ids point at objects that no longer exist, and «план
  // изменился» is too mild a warning for that — the answer goes away entirely.
  const forgetAdvice = useCallback(() => {
    // Invalidates an in-flight answer before clearing the visible one. Without
    // this, «Новый» briefly clears the panel and the old answer repopulates it.
    adviceRequestSequence.current += 1;
    setAdvice(null);
    setAdviceState({ status: 'idle' });
    setPreview(null);
    agentSequence.current += 1;
    setExchanges([]);
    setAgentActionStatus(null);
  }, []);

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

  return (
    <div
      className={`shell${planOnly ? ' shell--plan-only' : ''}`}
      style={{ '--side-left': `${panelWidths.left}px`, '--side-right': `${panelWidths.right}px` } as React.CSSProperties}
    >
      <header className="shell__bar">
        {/* D-260: two spans so the title can take two lines below 1600 px. */}
        <h1 className="shell__title">
          <span className="shell__title-line">Цифровой двойник</span> <span className="shell__title-line">ОПС</span>
        </h1>
        {/* data-tour marks what the first-run tour highlights; display: contents keeps the header layout. */}
        <div className="shell__anchor" data-tour="tools">
          <PlanTools document={document} session={session} onTool={setTool} onCommand={dispatch}
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
          <button type="button" className="shell__quiet" title="Отменить последнюю правку (Ctrl+Z)" onClick={() => store.getState().undo()}>
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 3.5 2.5 6.5l3 3" />
              <path d="M2.5 6.5h7a4 4 0 0 1 0 8h-3" />
            </svg>
            <span className="shell__label">Отменить</span>
          </button>
          <button type="button" className="shell__quiet" title="Вернуть отменённую правку (Ctrl+Y или Ctrl+Shift+Z)" onClick={() => store.getState().redo()}>
            <svg className="shell__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10.5 3.5 3 3-3 3" />
              <path d="M13.5 6.5h-7a4 4 0 0 0 0 8h3" />
            </svg>
            <span className="shell__label">Вернуть</span>
          </button>
        </div>
        {/* D-260: the hotkeys map lives in the header, icon only — the row has
            little slack left at 1280 px (tests/e2e/shell.spec.ts). D-261:
            aria-keyshortcuts takes a KeyboardEvent.key value, so "?", not the
            code "Shift+Slash". */}
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
        <div className="shell__anchor" data-tour="files">
        <FileControls
          document={document}
          dirty={dirty}
          revision={revision}
          demoRequest={demoRequest}
          read={readPlanFile}
          encode={encodePlan}
          onReplace={replaceDocument}
          onNew={startNewPlan}
          onExported={() => {
            store.getState().markExported(revision);
          }}
        />
        </div>
      </header>

      <div className={`shell__body${planOnly ? ' shell__body--plan-only' : ''}`}>
        <aside id="side-panel-left" className="shell__side" data-tour="side-left">
          {view === '2d' && tool.kind === 'room.draw' ? <fieldset className="drawing-controls"><legend>Что построить</legend>
            <label><input type="radio" name="room-mode" checked={roomMode === 'internal'} onChange={() => { planTool.cancel(); setRoomMode('internal'); }} /> Комнату внутри отделения</label>
            <label><input type="radio" name="room-mode" checked={roomMode === 'boundary'} onChange={() => { internalRoom.cancel(); setRoomMode('boundary'); }} /> Изменить внешний контур</label>
          </fieldset> : null}
          {placingOpening ? <OpeningControls ready={openingTool.ready} valid={openingTool.valid} message={openingTool.message} kind={openingTool.kind} width={openingTool.width} onKind={openingTool.changeKind} onWidth={openingTool.setWidth} onApply={openingTool.apply} onCancel={openingTool.cancel} /> : null}
          {drawingRoom ? <InternalRoomControls draft={internalRoom.draft} ready={internalRoom.ready} valid={internalRoom.valid} message={internalRoom.message} onApply={internalRoom.apply} onCancel={internalRoom.cancel} /> : null}
          {view === '2d' && !drawingRoom && (tool.kind === 'zone.draw' || tool.kind === 'room.draw' || tool.kind === 'shape.draw') ? (
            <DrawingControls name={tool.kind === 'zone.draw' ? 'зону' : tool.kind === 'room.draw' ? 'помещение' : 'фигуру'}
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
            onSelect={revealLeftTab}
            collapsed={propsShown}
            panels={{
              layers: (
                <LayersPanel
                  document={document}
                  session={session}
                  onCommand={dispatch}
                  onSelect={selectFromLeft}
                  objectMounts={objectMounts}
                  pictograms={pictogramsView}
                />
              ),
              library: (
                <LibraryPanel
                  catalog={document.catalog}
                  activeTypeId={tool.kind === 'object.place' || tool.kind === 'shape.draw' ? tool.typeId : null}
                  onTool={setTool}
                />
              ),
            }}
          />
          {/* D-268: «Свойства» stand in for the open left tab; «×» drops the
              selection (the same as Escape on the canvas). D-272: the band
              is the card's only title and its only heading — the card has
              none of its own and stays the region «Свойства» by its
              aria-label (it renders the same without the band). */}
          {propsShown ? (
            <div className="shell__props">
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
              <div className="shell__props-body">
                <PropertiesPanel
                  document={document}
                  session={session}
                  onCommand={dispatch}
                  gesturePreview={gesturePreview}
                />
              </div>
            </div>
          ) : null}
          <div className="shell__side-foot">
            {/* D-268: the selection outlived its card (a tab click, a fresh
                placement) — one click brings the card back. In the foot, so
                the library under the pointer does not shift. */}
            {selection !== null && selection.kind !== 'layer' && !propsShown ? (
              <button
                type="button"
                className="shell__props-return"
                title="Вернуть карточку «Свойства» выбранного на место вкладки"
                onClick={showPropsAgain}
              >
                Свойства выбранного
              </button>
            ) : null}
            <button
              type="button"
              className="shell__tour"
              title="Четыре шага: открыть план, изменить, проверить, сохранить"
              onClick={() => setTourOpen(true)}
            >
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

        <main className="shell__canvas" ref={canvasRef}>
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
              if (placingOpening) openingTool.handlePointer(event);
              else if (drawingRoom) internalRoom.handlePointer(event);
              else planTool.handlePointer(event);
              if (event.phase === 'down' && tool.kind === 'object.place') {
                const existing = findPlacementPick(
                  shownDocument,
                  tool.typeId,
                  event.point,
                  viewport.scale,
                );
                if (existing !== null) {
                  selectOnPlan({ kind: 'object', id: existing.id });
                  return;
                }
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
            onSelect={selectOnPlan}
          >
            <PlanGeometryLayer
              document={document}
              session={session}
              draft={drawingRoom ? internalRoom.draft : planTool.draft}
              draftCursor={drawingRoom ? null : planTool.cursor}
              onCommand={dispatch}
              onSelect={selectOnPlan}
            />
            <OpeningPreviewLayer opening={openingTool.preview} plan={document} viewport={viewport} valid={openingTool.valid} />
            <EquipmentLayer
              document={shownDocument}
              session={session}
              issues={issues}
              onCommand={dispatch}
              onSelect={selectOnPlan}
              onSelectMany={selectMany}
              preview={preview}
              onGesturePreview={gesturePreview.publish}
              hideHandlesFor={shapeEditingId}
              pictograms={pictograms}
            />
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
            />
            <InformationLayer document={document} session={session} />
            {/* Линейка — поверх плана: измеряют по тому, что видно, и отрезок не
                должен уходить под объект или под имя зоны. В план она ничего не
                кладёт (D-256). Ниже находок намеренно: слой находок остаётся
                предпоследним в сцене, как его ищет `issues-on-plan.spec.ts`. */}
            <MeasureLayer viewport={viewport} />
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
          </EditorCanvas>
          {view === '3d' ? (
            <View3D document={shownDocument} selection={selection} onSelect={selectOnPlan} />
          ) : null}
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
          <SideTabs
            label="Панели справа"
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
                  onAgentAction={runAgentAction}
                  onClearChat={clearChat}
                  comparisonBusy={comparison.loading}
                  comparisonUnrelated={comparison.source !== null && comparison.source.plan.id !== document.id}
                  comparison={<ComparisonPanel current={document} baseline={baseline} source={comparison.source}
                    loading={comparison.loading} error={comparison.error} onFocus={focusOn}
                    onLoad={async (file) => {
                      adviceRequestSequence.current += 1;
                      setAdvice(null);
                      setAdviceState({ status: 'idle' });
                      setPreview(null);
                      await comparison.load(file);
                    }}
                    onClear={() => {
                      comparison.clear();
                      adviceRequestSequence.current += 1;
                      setAdvice(null);
                      setAdviceState({ status: 'idle' });
                      setPreview(null);
                    }} />}
                />
              ),
              metrics: <MetricsPanel document={document} metrics={metrics} onFocus={focusOn} />,
              validation: <ValidationPanel issues={issues} document={document} onFocus={focusOn} focus={focus} />,
              inventory: <InventoryPanel inventory={inventory} document={document} onFocus={focusOn} />,
              catalog: <CatalogPanel document={document} onCommand={dispatch} />,
            }}
          />
        </aside>
      </div>

      <Onboarding open={tourOpen} onClose={closeTour} onOpenDemo={(variant) => {
        closeTour('done');
        setDemoRequest((previous) => ({ id: (previous?.id ?? 0) + 1, variant }));
      }} />
      <HotkeysMapDialog open={hotkeysMap.open} onClose={hotkeysMap.hide} />
    </div>
  );
}

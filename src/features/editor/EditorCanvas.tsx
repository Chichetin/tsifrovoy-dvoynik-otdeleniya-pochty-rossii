/**
 * U02: the canvas. Grid, pan, zoom, the translation of every pointer event into
 * world metres — and answering «покажи мне это».
 *
 * Shapes are not drawn here. The app composition passes them as children, so
 * the plan layer and the equipment layer stay independent of each other and of
 * this file; what they receive is already in world coordinates. `overlay` is
 * drawn above them in one layer. The one shape this file does draw is the
 * short-lived focus ring: it belongs to the view, never to the document, and
 * disappears by itself.
 *
 * Fitting is a view decision too, so it lives here, next to the only place that
 * knows the size of the canvas in pixels: a replaced document opens fitted, and
 * after that the view belongs to the user until they press F.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Circle, Group, Layer, Line, Shape, Stage } from 'react-konva';
import { flushSync } from 'react-dom';
import Konva from 'konva';
import { PlanMinimap } from './PlanMinimap';
import { ZONE_OVERVIEW_SCALE } from './ZoneOverviewLayer';
import type { Point, Polygon, Viewport } from '../../contracts/model';
import type { EditorCanvasProps, PointerPhase } from '../../contracts/ui';
import { boundingBox, modelToScreen, screenToModel } from '../../domain/geometry';
import { formatShort } from '../../domain/number-format';
import { focusViewport, planExtent, refExtent } from './focus';
import { isFitHotkey, isTypingTarget } from './hotkeys';
import {
  type CanvasSize,
  DEFAULT_SCALE,
  fitToExtent,
  gridLines,
  panBy,
  visibleExtent,
  wheelIntent,
  wheelPan,
  zoomAt,
  zoomByWheel,
} from './viewport';

const GRID_COLOR = '#E9ECEF';
const AXIS_COLOR = '#CED4DA';
const BACKGROUND = '#FFFFFF';
const FOCUS_STROKE = '#E8590C';
const FOCUS_FILL = 'rgba(232, 89, 12, 0.12)';

/** One press of «+» or «−»: about one wheel notch (×1.28 at `deltaY` 100). */
const ZOOM_STEP = 1.25;

/** #223: the wheel is at rest after this pause; then the plan is redrawn once. */
const WHEEL_SETTLE_MS = 120;

/** How long the ring stays on the found object, in milliseconds. */
const HIGHLIGHT_MS = 1600;

/** The ring is never smaller than this, or a 40 cm object stays invisible. */
const MIN_RING_PX = 28;
const RING_GAP_PX = 14;

/**
 * #190: above this many Konva nodes a pan or wheel frame does not repaint the
 * plan: it moves the canvases already drawn. The demo plan has about 400
 * nodes, the plan of 1000 objects about 6400 (one repaint 25–45 ms).
 */
const LIVE_DRAW_NODES = 2000;

/** Mouse buttons that pan instead of drawing: middle, and right. */
const PAN_BUTTONS = new Set([1, 2]);

/**
 * #190: changes Konva attributes without Konva's own redraw. A changed
 * attribute of the stage asks every layer to redraw its scene and its hit
 * canvas in the next frame. A gesture frame paints the scene itself, so that
 * second paint doubled each pan or wheel step on a large plan.
 */
function quietly(change: () => void): void {
  const auto = Konva.autoDrawEnabled;
  Konva.autoDrawEnabled = false;
  try {
    change();
  } finally {
    Konva.autoDrawEnabled = auto;
  }
}

function nodeCount(container: Konva.Container): number {
  let count = 0;
  for (const child of container.getChildren()) {
    count += 1;
    if (child instanceof Konva.Container) count += nodeCount(child);
  }
  return count;
}

/** Мировой контур в плоский список экранных координат для Konva. */
function screenPoints(extent: Polygon, viewport: { origin: Point; scale: number }): number[] {
  return extent.flatMap((point) => modelToScreen(point, viewport));
}

/** Кольцо вокруг найденного: видно даже там, где сам отпечаток в пару пикселей. */
function ringOf(
  extent: Polygon,
  viewport: { origin: Point; scale: number },
): { centre: Point; radius: number } | null {
  if (extent.length === 0) return null;
  const box = boundingBox(extent);
  const centre = modelToScreen([(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], viewport);
  const half = (Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2) * viewport.scale;
  return { centre, radius: Math.max(MIN_RING_PX, half + RING_GAP_PX) };
}

export function EditorCanvas({
  document: plan,
  session,
  onPointer,
  onViewport,
  onSelect,
  children,
  overlay,
}: EditorCanvasProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const panning = useRef<Point | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Browsers may not deliver pointermove for a middle-button drag after the
  // canvas captures the pointer. Keep a DOM mouse fallback for that button.
  const middleMousePanning = useRef<Point | null>(null);
  const userInteracted = useRef(false);
  // Several wheel/pointer events can arrive before React re-renders. Each one
  // must build on the latest viewport, not on the one from the last render,
  // otherwise all but the last delta of a burst are lost.
  const liveViewport = useRef(session.viewport);
  const pendingPan = useRef<Point>([0, 0]);
  // Zoom deltas add up exactly: exp(-a/k) * exp(-b/k) = exp(-(a+b)/k).
  const pendingZoom = useRef<{ deltaY: number; anchor: Point } | null>(null);
  const panFrame = useRef<number | null>(null);
  // #223: a wheel frame does not re-render the app. The layers stay drawn for
  // `drawnViewport`, and the Konva stage is moved and scaled onto the live
  // viewport — one canvas redraw, no React work. When the wheel rests, the
  // live viewport goes to the app once and the stage transform returns to 1.
  const stage = useRef<Konva.Stage>(null);
  const drawnViewport = useRef(session.viewport);
  const wheelCommit = useRef<Viewport | null>(null);
  const settleTimer = useRef<number | null>(null);
  // Wheel frames repaint the visible canvas only. The hit canvas, which finds
  // the shape under the pointer, is repainted once the gesture is committed.
  const hitStale = useRef(false);
  // #190: a drag pan works like the wheel. Each step moves the stage only; the
  // app gets the viewport once, when the button is released. Before, each
  // step sent the viewport to the app: on 1000 objects 0.1 s a step.
  const dragPan = useRef(false);
  // The grid is drawn for the live viewport, so the stage transform is undone
  // for its layer: a pan or a zoom never shows an edge without grid lines.
  const gridLayerRef = useRef<Konva.Layer>(null);
  // How the current gesture shows the live viewport: false — the stage
  // transform and one repaint a frame; true — a CSS transform of the drawn
  // layer canvases and a repaint of the grid only. null — no gesture.
  const shiftCanvases = useRef<boolean | null>(null);
  const gestureOver = useCallback(
    (): boolean => settleTimer.current === null && panFrame.current === null && !dragPan.current,
    [],
  );
  /** Puts the stage transform onto the live viewport; true when it changed. */
  const showLive = useCallback((): boolean => {
    const node = stage.current;
    if (node === null) return false;
    const drawn = drawnViewport.current;
    const live = liveViewport.current;
    const k = live.scale / drawn.scale;
    const x = live.origin[0] - k * drawn.origin[0];
    const y = live.origin[1] - k * drawn.origin[1];
    if (node.scaleX() === k && node.x() === x && node.y() === y) return false;
    quietly(() => {
      node.scale({ x: k, y: k });
      node.position({ x, y });
      gridLayerRef.current?.scale({ x: 1 / k, y: 1 / k });
      gridLayerRef.current?.position({ x: -x / k, y: -y / k });
    });
    return true;
  }, []);
  /** Puts the drawn layer canvases, all but the grid, onto the live viewport by CSS. */
  const showShifted = useCallback((): void => {
    const node = stage.current;
    if (node === null) return;
    const drawn = drawnViewport.current;
    const live = liveViewport.current;
    const k = live.scale / drawn.scale;
    const x = live.origin[0] - k * drawn.origin[0];
    const y = live.origin[1] - k * drawn.origin[1];
    const transform = k === 1 && x === 0 && y === 0 ? '' : `matrix(${k}, 0, 0, ${k}, ${x}, ${y})`;
    for (const layer of node.getLayers()) {
      if (layer === gridLayerRef.current) continue;
      const style = layer.getNativeCanvasElement().style;
      style.transformOrigin = '0 0';
      style.transform = transform;
      // Its own compositor layer: the browser moves the canvas, not repaints it.
      style.willChange = transform === '' ? '' : 'transform';
    }
  }, []);
  const drawAll = useCallback((): void => {
    stage.current?.batchDraw();
    hitStale.current = false;
  }, []);
  const foldPending = useCallback((): void => {
    if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
    panFrame.current = null;
    const delta = pendingPan.current;
    const zoom = pendingZoom.current;
    pendingPan.current = [0, 0];
    pendingZoom.current = null;
    let next = liveViewport.current;
    if (delta[0] !== 0 || delta[1] !== 0) next = panBy(next, wheelPan(delta));
    if (zoom !== null) next = zoomByWheel(next, zoom.anchor, zoom.deltaY);
    liveViewport.current = next;
  }, []);
  const commitWheel = useCallback((): void => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
    foldPending();
    if (liveViewport.current === drawnViewport.current) {
      if (shiftCanvases.current === true) showShifted();
      if (showLive() || hitStale.current) drawAll();
      if (gestureOver()) shiftCanvases.current = null;
      return;
    }
    wheelCommit.current = liveViewport.current;
    onViewport(liveViewport.current);
  }, [drawAll, foldPending, gestureOver, onViewport, showLive, showShifted]);
  const flushPan = useCallback((): void => {
    foldPending();
    const node = stage.current;
    if (node !== null) shiftCanvases.current ??= nodeCount(node) > LIVE_DRAW_NODES;
    // Called from an animation frame: the scene is painted right here.
    if (shiftCanvases.current === true) {
      showShifted();
      gridLayerRef.current?.drawScene();
      hitStale.current = true;
    } else if (showLive()) {
      for (const layer of node?.getLayers() ?? []) layer.drawScene();
      hitStale.current = true;
    }
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = null;
    // A drag pan hands the view over on release, not after a pause.
    if (!dragPan.current) settleTimer.current = window.setTimeout(commitWheel, WHEEL_SETTLE_MS);
  }, [commitWheel, foldPending, showLive, showShifted]);
  /** One step of a drag pan: the stage moves in the next animation frame. */
  const panStep = useCallback(
    (delta: Point): void => {
      if (!dragPan.current) {
        dragPan.current = true;
        // A pan is not a hover or a click on what lies under the pointer.
        quietly(() => stage.current?.listening(false));
      }
      liveViewport.current = panBy(liveViewport.current, delta);
      if (panFrame.current === null) panFrame.current = requestAnimationFrame(flushPan);
    },
    [flushPan],
  );
  /** The end of a drag pan: the app gets the view once. */
  const panEnd = useCallback((): void => {
    if (!dragPan.current) return;
    dragPan.current = false;
    quietly(() => stage.current?.listening(true));
    commitWheel();
  }, [commitWheel]);
  // Runs after react-konva has updated the shapes, in the same frame: the
  // stage transform shrinks to whatever the wheel did since the commit.
  useLayoutEffect(() => {
    drawnViewport.current = session.viewport;
    if (session.viewport !== wheelCommit.current) {
      // Fit, «+»/«−», focus or the minimap: the new view replaces the live one.
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
      settleTimer.current = null;
      panFrame.current = null;
      pendingPan.current = [0, 0];
      pendingZoom.current = null;
      liveViewport.current = session.viewport;
    }
    wheelCommit.current = null;
    if (shiftCanvases.current === true) {
      drawAll();
      // Runs after the layers' own repaint in the same frame: the CSS shift
      // shrinks to whatever the gesture did since the commit.
      const frame = requestAnimationFrame(() => {
        showShifted();
        if (gestureOver()) shiftCanvases.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (gestureOver()) shiftCanvases.current = null;
    if (showLive() || hitStale.current) drawAll();
    // The grid shape reads the live viewport: its props do not change with it.
    else gridLayerRef.current?.batchDraw();
  }, [drawAll, gestureOver, session.viewport, showLive, showShifted]);
  useEffect(
    () => () => {
      if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );
  const applyViewport = useCallback(
    (next: Viewport): void => {
      liveViewport.current = next;
      onViewport(next);
    },
    [onViewport],
  );
  /** Документ, который уже вписан: смена плана — это другой id или другое имя. */
  const fitted = useRef<string | null>(null);
  /** Номер последнего запроса, подсветка которого уже погасла. */
  const [dismissed, setDismissed] = useState(0);
  const handledFocus = useRef(0);
  const documentKey = `${plan.id}\u0000${plan.name}`;

  const focus = session.focus;
  const focusExtent = focus === null ? null : refExtent(plan, focus.ref);
  const highlighted = focus !== null && focusExtent !== null && focus.sequence > dismissed;

  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * Показать весь план (клавиша F): помещение вместе с тем, что вынесено за его стены.
   * По границе помещения вписывать нельзя — объект, о котором как раз кричит
   * проверка, остался бы за кадром.
   */
  const fitPlan = useCallback((): void => {
    if (size.width === 0 || size.height === 0) return;
    onViewport(fitToExtent(planExtent(plan), size));
  }, [onViewport, plan, size]);

  /** Кнопки «+» и «−»: масштаб вокруг центра холста, как колесо вокруг курсора. */
  const zoomStep = useCallback(
    (factor: number): void => {
      if (size.width === 0 || size.height === 0) return;
      userInteracted.current = true;
      commitWheel();
      onViewport(zoomAt(liveViewport.current, [size.width / 2, size.height / 2], factor));
    },
    [commitWheel, onViewport, size],
  );

  // Каждый новый документ открывается вписанным — открытый файл, «Новый»,
  // восстановленный черновик и пример организаторов одинаково. Дальше вид
  // принадлежит пользователю: правка плана масштаб не сбрасывает.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    if (fitted.current === documentKey) return;
    if (userInteracted.current) return;
    fitted.current = documentKey;
    fitPlan();
  }, [documentKey, fitPlan, size]);

  // «Покажи мне это»: панель называет ссылку, холст переводит взгляд. Масштаб
  // меняется только если иначе не влезает, а видный целиком объект вид не
  // двигает — иначе список находок дёргает план на каждом клике.
  //
  // Ссылка на то, чего в плане нет (панель могла отстать от документа), даёт
  // пустой `extent`: вид не двигается и подсветки не появляется.
  useEffect(() => {
    if (focus === null || focusExtent === null || size.width === 0 || size.height === 0) return;
    if (handledFocus.current === focus.sequence) return;
    handledFocus.current = focus.sequence;

    const detail = session.viewport.scale < ZONE_OVERVIEW_SCALE &&
      (focus.ref.kind === 'zone' || focus.ref.kind === 'object')
      ? zoomAt(session.viewport, [size.width / 2, size.height / 2], ZONE_OVERVIEW_SCALE * 1.25 / session.viewport.scale)
      : session.viewport;
    const next = focusViewport(focusExtent, detail, size);
    if (next !== session.viewport) onViewport(next);
  }, [focus, focusExtent, onViewport, session.viewport, size]);

  // Подсветка живёт секунду с небольшим и гаснет сама: это подсказка «вот оно»,
  // а не состояние документа. Гасит её таймер, а состояние хранит номер уже
  // погашенного запроса — сама подсветка выводится из props при отрисовке.
  useEffect(() => {
    if (!highlighted || focus === null) return;
    const sequence = focus.sequence;
    const timer = window.setTimeout(() => setDismissed(sequence), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [focus, highlighted]);

  // Клавиша вписывания — по коду, а не по букве: на русской раскладке та же
  // клавиша даёт «а», и hotkey не должен от этого пропадать.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!isFitHotkey(event)) return;
      event.preventDefault();
      fitPlan();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitPlan]);

  const toWorld = useCallback(
    (stage: Konva.Stage): Point | null => {
      const position = stage.getPointerPosition();
      if (position === null) return null;
      // The live viewport: during a wheel gesture the stage shows it already.
      return screenToModel([position.x, position.y], liveViewport.current);
    },
    [],
  );

  const emit = useCallback(
    (phase: PointerPhase, event: Konva.KonvaEventObject<PointerEvent>): void => {
      const point = toWorld(event.target.getStage() as Konva.Stage);
      if (point === null) return;
      onPointer({
        phase,
        point,
        shift: event.evt.shiftKey,
        alt: event.evt.altKey,
        button: event.evt.button,
      });
    },
    [onPointer, toWorld],
  );

  const handleDown = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>): void => {
      if (PAN_BUTTONS.has(event.evt.button) || session.tool.kind === 'pan') {
        userInteracted.current = true;
        panning.current = [event.evt.clientX, event.evt.clientY];
        return;
      }
      emit('down', event);
    },
    [emit, session.tool.kind],
  );

  const handleMove = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>): void => {
      const from = panning.current;
      if (from !== null) {
        panning.current = [event.evt.clientX, event.evt.clientY];
        panStep([event.evt.clientX - from[0], event.evt.clientY - from[1]]);
        return;
      }
      emit('move', event);
    },
    [emit, panStep],
  );

  const handleUp = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>): void => {
      if (panning.current !== null) {
        panning.current = null;
        panEnd();
        return;
      }
      emit('up', event);
    },
    [emit, panEnd],
  );

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>): void => {
      event.evt.preventDefault();
      userInteracted.current = true;
      const stage = event.target.getStage();
      const position = stage?.getPointerPosition();
      if (position === undefined || position === null) return;
      if (
        wheelIntent({
          deltaX: event.evt.deltaX,
          deltaY: event.evt.deltaY,
          deltaMode: event.evt.deltaMode,
          ctrlKey: event.evt.ctrlKey,
        }) === 'pan'
      ) {
        const pending = pendingPan.current;
        pendingPan.current = [pending[0] + event.evt.deltaX, pending[1] + event.evt.deltaY];
      } else {
        const zoom = pendingZoom.current;
        pendingZoom.current = {
          deltaY: (zoom?.deltaY ?? 0) + event.evt.deltaY,
          anchor: [position.x, position.y],
        };
      }
      if (panFrame.current === null) panFrame.current = requestAnimationFrame(flushPan);
    },
    [flushPan],
  );

  // A library drag becomes the same `down` event as a click on the canvas.
  // The equipment controller therefore remains the single path for catalog
  // defaults, snapping, layer checks, selection and one-shot placement.
  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (session.tool.kind !== 'object.place') return;
      if (!event.dataTransfer.types.includes('text/plain')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      // The dragged type is carried by the pointer like a click-armed one: a
      // `move` lets the equipment controller show where it would land (#26).
      const bounds = event.currentTarget.getBoundingClientRect();
      onPointer({
        phase: 'move',
        point: screenToModel([event.clientX - bounds.left, event.clientY - bounds.top], session.viewport),
        shift: event.shiftKey,
        alt: event.altKey,
        button: 0,
      });
    },
    [onPointer, session.tool, session.viewport],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (session.tool.kind !== 'object.place') return;
      if (event.dataTransfer.getData('text/plain') !== session.tool.typeId) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const screen: Point = [event.clientX - bounds.left, event.clientY - bounds.top];
      if (screen[0] < 0 || screen[1] < 0 || screen[0] > bounds.width || screen[1] > bounds.height) return;
      event.preventDefault();
      const pointer = {
        point: screenToModel(screen, session.viewport),
        shift: event.shiftKey,
        alt: event.altKey,
        button: 0,
      };
      onPointer({
        phase: 'down',
        ...pointer,
      });
      // Native HTML drop has no pointer-up for the Konva stage. Completing
      // this tiny synthetic gesture lets App disarm one-shot object.place in
      // exactly the same way as a real canvas click.
      onPointer({ phase: 'up', ...pointer });
    },
    [onPointer, session.tool, session.viewport],
  );

  // Capture before Konva: Space must pan even over an object or a vertex,
  // without starting its selection, drag or drawing gesture.
  useEffect(() => {
    let held = false;
    let from: Point | null = null;
    const reset = (): void => {
      held = false;
      from = null;
      setSpaceHeld(false);
      panEnd();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') { reset(); return; }
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('button, a, summary, [role="button"], [aria-modal="true"]') !== null) return;
      event.preventDefault();
      held = true;
      setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      held = false;
      setSpaceHeld(false);
      // Keep the active drag until pointer-up, even if Space is released first.
    };
    const onDown = (event: PointerEvent): void => {
      if (!held || event.button !== 0 || !(event.target instanceof Node) || !host.current?.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      userInteracted.current = true;
      from = [event.clientX, event.clientY];
    };
    const onMove = (event: PointerEvent): void => {
      if (from === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      panStep([event.clientX - from[0], event.clientY - from[1]]);
      from = [event.clientX, event.clientY];
    };
    const onUp = (event: PointerEvent): void => {
      if (from === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      from = null;
      panEnd();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
    };
  }, [panEnd, panStep]);

  // A press during a wheel gesture first redraws the plan for the live view,
  // synchronously: shapes, drags and tools then see the view the user sees.
  // The capture phase on the host runs before Konva's own listener.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const onPress = (): void => {
      if (settleTimer.current === null && panFrame.current === null) return;
      flushSync(commitWheel);
      // The hit canvas must match the plan before Konva looks up the shape.
      stage.current?.draw();
    };
    element.addEventListener('pointerdown', onPress, true);
    return () => element.removeEventListener('pointerdown', onPress, true);
  }, [commitWheel]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 1) return;
      event.preventDefault();
      userInteracted.current = true;
      middleMousePanning.current = [event.clientX, event.clientY];
    };
    const onMouseMove = (event: MouseEvent): void => {
      const from = middleMousePanning.current;
      if (from === null) return;
      middleMousePanning.current = [event.clientX, event.clientY];
      panStep([event.clientX - from[0], event.clientY - from[1]]);
    };
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 1 || middleMousePanning.current !== null) {
        event.preventDefault();
        middleMousePanning.current = null;
      }
      // Any release ends a pan, also one outside the canvas or over a button.
      panEnd();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 1) return;
      event.preventDefault();
      middleMousePanning.current = [event.clientX, event.clientY];
    };
    const onPointerMove = (event: PointerEvent): void => {
      const from = middleMousePanning.current;
      if (from === null) return;
      middleMousePanning.current = [event.clientX, event.clientY];
      panStep([event.clientX - from[0], event.clientY - from[1]]);
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (event.button === 1 || middleMousePanning.current !== null) {
        event.preventDefault();
        middleMousePanning.current = null;
      }
      // Any release ends a pan, also one outside the canvas or over a button.
      panEnd();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [panEnd, panStep]);

  // Escape cancels the drawing in progress; with nothing in progress it clears
  // the selection. Both are what a drawing tool is expected to do.
  //
  // A drag on a shape is a gesture of its own: while one is running, Escape
  // belongs to the layer that started it — it undoes the drag and the object
  // stays selected, so the card of the thing just restored is still open. The
  // check has to happen before the layer stops the drag, and layer effects are
  // registered first (children mount before this parent), so this listener
  // takes the capture phase, which runs ahead of every bubbling one — and
  // ahead of a modal window's own capture listener, registered later: Escape
  // pressed inside an `aria-modal` window closes that window, not the
  // selection behind it (D-351); pressed in an object's menu it closes the
  // menu (#24).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"], [role="menu"]') !== null) return;
      if (Konva.isDragging()) return;
      onPointer({ phase: 'cancel', point: [0, 0], shift: false, alt: false, button: 0 });
      onSelect(null);
    };
    // #128: Escape in a field lets the field go, so the next Escape clears the
    // selection. This one bubbles: a field with an Escape of its own (the X/Y
    // reset) stops the event in React, before it gets here.
    const onFieldKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"], [role="menu"]') !== null) return;
      if (event.target instanceof HTMLElement) event.target.blur();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onFieldKey);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keydown', onFieldKey);
    };
  }, [onPointer, onSelect]);

  const grid = useMemo(
    () => (size.width > 0 ? gridLines(session.viewport, size) : null),
    [session.viewport, size],
  );
  // One shape draws the grid and the axes for the live viewport. A wheel or a
  // pan step repaints it with the stage and React is not involved. A new
  // function is made only on resize, so a click in a panel does not repaint
  // the grid layer (D-177).
  const drawGrid = useCallback(
    (context: Konva.Context): void => {
      const live = liveViewport.current;
      const lines = gridLines(live, size);
      context.beginPath();
      for (const x of lines.vertical) {
        context.moveTo(x, 0);
        context.lineTo(x, size.height);
      }
      for (const y of lines.horizontal) {
        context.moveTo(0, y);
        context.lineTo(size.width, y);
      }
      context.setAttr('strokeStyle', GRID_COLOR);
      context.setAttr('lineWidth', 1);
      context.stroke();
      context.beginPath();
      context.moveTo(live.origin[0], 0);
      context.lineTo(live.origin[0], size.height);
      context.moveTo(0, live.origin[1]);
      context.lineTo(size.width, live.origin[1]);
      context.setAttr('strokeStyle', AXIS_COLOR);
      context.setAttr('lineWidth', 1.5);
      context.stroke();
    },
    [size],
  );
  // Видимый кусок мира числами: на нём держится браузерная проверка «объект
  // действительно в кадре», которую по картинке не сделать.
  const visible = size.width > 0 ? boundingBox(visibleExtent(session.viewport, size)) : null;
  const ring = highlighted ? ringOf(focusExtent as Polygon, session.viewport) : null;

  return (
    <div
      className="editor-canvas"
      style={spaceHeld ? { cursor: 'grab' } : undefined}
      ref={host}
      data-testid="editor-canvas"
      tabIndex={0}
      aria-label="План помещения"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-visible={
        visible === null
          ? undefined
          : [visible.minX, visible.minY, visible.maxX, visible.maxY]
              .map((value) => value.toFixed(3))
              .join(',')
      }
      data-focus={highlighted && focus !== null ? `${focus.ref.kind}:${focus.ref.id}` : undefined}
    >
      {size.width > 0 && size.height > 0 ? (
        <Stage
          ref={stage}
          width={size.width}
          height={size.height}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onWheel={handleWheel}
          onContextMenu={(event: Konva.KonvaEventObject<PointerEvent>) =>
            event.evt.preventDefault()
          }
          style={{ background: BACKGROUND }}
        >
          <Layer listening={false} name="grid" ref={gridLayerRef}>
            <Shape sceneFunc={drawGrid} />
          </Layer>
          {children}
          {/* The overlay layer is always mounted: adding or removing a Konva
              layer makes the stage repaint every layer, which on a plan of
              1000 objects turned each click in a panel into seconds of drawing
              (Q02, D-177). One layer for the overlay and the focus ring keeps
              the stage within Konva's 3–5 layers (#51). */}
          <Layer name="overlay">
            {overlay}
            {ring === null || focusExtent === null ? null : (
              <Group listening={false} name="focus-ring">
              <Line
                points={screenPoints(focusExtent, session.viewport)}
                closed
                stroke={FOCUS_STROKE}
                strokeWidth={2}
                dash={[10, 6]}
                fill={FOCUS_FILL}
              />
              <Circle
                x={ring.centre[0]}
                y={ring.centre[1]}
                radius={ring.radius}
                stroke={FOCUS_STROKE}
                strokeWidth={2}
                opacity={0.8}
              />
              </Group>
            )}
          </Layer>
        </Stage>
      ) : null}
      {/* Подпись и кнопка держатся вместе в одном углу: каждый угол, занятый
          накладкой, — это угол помещения, куда не поставить объект. */}
      {size.width > 0 && size.height > 0 ? <PlanMinimap document={plan} viewport={session.viewport} size={size} onViewport={applyViewport} /> : null}
      {grid === null ? null : (
        <div className="editor-canvas__hud">
          <p
            className="editor-canvas__scale"
            data-testid="canvas-scale"
            title={`${Math.round(session.viewport.scale)} px/м; 100 % — масштаб, с которого открывается пустой план`}
          >
            Сетка {formatShort(grid.step_m, 2)} м · {Math.round((session.viewport.scale / DEFAULT_SCALE) * 100)} %
          </p>
          <button
            type="button"
            className="editor-canvas__fit editor-canvas__zoom"
            data-testid="canvas-zoom-out"
            aria-label="Уменьшить"
            title="Уменьшить масштаб"
            onClick={() => zoomStep(1 / ZOOM_STEP)}
          >
            −
          </button>
          <button
            type="button"
            className="editor-canvas__fit editor-canvas__zoom"
            data-testid="canvas-zoom-in"
            aria-label="Увеличить"
            title="Увеличить масштаб"
            onClick={() => zoomStep(ZOOM_STEP)}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

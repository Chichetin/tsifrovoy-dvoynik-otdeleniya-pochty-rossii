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
 * after that the view belongs to the user until they ask for «Вписать».
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Circle, Group, Layer, Line, Stage } from 'react-konva';
import Konva from 'konva';
import type { Point, Polygon, Viewport } from '../../contracts/model';
import type { EditorCanvasProps, PointerPhase } from '../../contracts/ui';
import { boundingBox, modelToScreen, screenToModel } from '../../domain/geometry';
import { focusViewport, planExtent, refExtent } from './focus';
import { isFitHotkey, isTypingTarget } from './hotkeys';
import {
  type CanvasSize,
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

/** How long the ring stays on the found object, in milliseconds. */
const HIGHLIGHT_MS = 1600;

/** The ring is never smaller than this, or a 40 cm object stays invisible. */
const MIN_RING_PX = 28;
const RING_GAP_PX = 14;

/** Mouse buttons that pan instead of drawing: middle, and right. */
const PAN_BUTTONS = new Set([1, 2]);

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
  useLayoutEffect(() => {
    liveViewport.current = session.viewport;
  }, [session.viewport]);
  useEffect(
    () => () => {
      if (panFrame.current !== null) cancelAnimationFrame(panFrame.current);
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
  const flushPan = useCallback((): void => {
    panFrame.current = null;
    const delta = pendingPan.current;
    const zoom = pendingZoom.current;
    pendingPan.current = [0, 0];
    pendingZoom.current = null;
    let next = liveViewport.current;
    if (delta[0] !== 0 || delta[1] !== 0) next = panBy(next, wheelPan(delta));
    if (zoom !== null) next = zoomByWheel(next, zoom.anchor, zoom.deltaY);
    if (next !== liveViewport.current) applyViewport(next);
  }, [applyViewport]);
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
   * Вписать весь план: помещение вместе с тем, что вынесено за его стены.
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
      onViewport(zoomAt(session.viewport, [size.width / 2, size.height / 2], factor));
    },
    [onViewport, session.viewport, size],
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

    const next = focusViewport(focusExtent, session.viewport, size);
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
      return screenToModel([position.x, position.y], session.viewport);
    },
    [session.viewport],
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
        applyViewport(
          panBy(liveViewport.current, [event.evt.clientX - from[0], event.evt.clientY - from[1]]),
        );
        return;
      }
      emit('move', event);
    },
    [emit, applyViewport],
  );

  const handleUp = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>): void => {
      if (panning.current !== null) {
        panning.current = null;
        return;
      }
      emit('up', event);
    },
    [emit],
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
      applyViewport(panBy(liveViewport.current, [event.clientX - from[0], event.clientY - from[1]]));
    };
    const onMouseUp = (event: MouseEvent): void => {
      if (event.button === 1 || middleMousePanning.current !== null) {
        event.preventDefault();
        middleMousePanning.current = null;
      }
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
      applyViewport(panBy(liveViewport.current, [event.clientX - from[0], event.clientY - from[1]]));
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (event.button === 1 || middleMousePanning.current !== null) {
        event.preventDefault();
        middleMousePanning.current = null;
      }
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
  }, [applyViewport]);

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
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPointer, onSelect]);

  const grid = useMemo(
    () => (size.width > 0 ? gridLines(session.viewport, size) : null),
    [session.viewport, size],
  );
  // Grid and axes depend on the viewport and the canvas size only. Built on
  // every render, their `points` arrays would be "new" props for react-konva
  // and repaint the grid layer on every click in a panel (D-177).
  const gridLayer = useMemo(
    () =>
      grid === null ? null : (
        <>
          {grid.vertical.map((x) => (
            <Line key={`v${x}`} points={[x, 0, x, size.height]} stroke={GRID_COLOR} strokeWidth={1} />
          ))}
          {grid.horizontal.map((y) => (
            <Line key={`h${y}`} points={[0, y, size.width, y]} stroke={GRID_COLOR} strokeWidth={1} />
          ))}
          <Line
            points={[session.viewport.origin[0], 0, session.viewport.origin[0], size.height]}
            stroke={AXIS_COLOR}
            strokeWidth={1.5}
          />
          <Line
            points={[0, session.viewport.origin[1], size.width, session.viewport.origin[1]]}
            stroke={AXIS_COLOR}
            strokeWidth={1.5}
          />
        </>
      ),
    [grid, session.viewport, size.width, size.height],
  );
  // Видимый кусок мира числами: на нём держится браузерная проверка «объект
  // действительно в кадре», которую по картинке не сделать.
  const visible = size.width > 0 ? boundingBox(visibleExtent(session.viewport, size)) : null;
  const ring = highlighted ? ringOf(focusExtent as Polygon, session.viewport) : null;

  return (
    <div
      className="editor-canvas"
      ref={host}
      data-testid="editor-canvas"
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
          <Layer listening={false} name="grid">
            {gridLayer}
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
      {grid === null ? null : (
        <div className="editor-canvas__hud">
          <p className="editor-canvas__scale" data-testid="canvas-scale">
            Сетка {grid.step_m} м · {Math.round(session.viewport.scale)} px/м
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
          <button
            type="button"
            className="editor-canvas__fit"
            data-testid="canvas-fit"
            title="Показать план целиком (клавиша F)"
            onClick={fitPlan}
          >
            Вписать
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * U02: the canvas. Grid, pan, zoom and the translation of every pointer event
 * into world metres — and nothing else.
 *
 * Shapes are not drawn here. The app composition passes them as children, so
 * the plan layer and the equipment layer stay independent of each other and of
 * this file; what they receive is already in world coordinates.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Layer, Line, Stage } from 'react-konva';
import type Konva from 'konva';
import type { Point } from '../../contracts/model';
import type { EditorCanvasProps, PointerPhase } from '../../contracts/ui';
import { screenToModel } from '../../domain/geometry';
import { type CanvasSize, fitToExtent, gridLines, panBy, zoomByWheel } from './viewport';

const GRID_COLOR = '#E9ECEF';
const AXIS_COLOR = '#CED4DA';
const BACKGROUND = '#FFFFFF';

/** Mouse buttons that pan instead of drawing: middle, and right. */
const PAN_BUTTONS = new Set([1, 2]);

export function EditorCanvas({
  document: plan,
  session,
  onPointer,
  onViewport,
  onSelect,
  children,
}: EditorCanvasProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const panning = useRef<Point | null>(null);
  const fitted = useRef(false);

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

  // The plan opens already fitted; after that the view belongs to the user.
  useEffect(() => {
    if (fitted.current || size.width === 0 || size.height === 0) return;
    fitted.current = true;
    onViewport(fitToExtent(plan.room.boundary, size));
  }, [plan.room.boundary, size, onViewport]);

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
        onViewport(
          panBy(session.viewport, [event.evt.clientX - from[0], event.evt.clientY - from[1]]),
        );
        return;
      }
      emit('move', event);
    },
    [emit, onViewport, session.viewport],
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
      const stage = event.target.getStage();
      const position = stage?.getPointerPosition();
      if (position === undefined || position === null) return;
      onViewport(zoomByWheel(session.viewport, [position.x, position.y], event.evt.deltaY));
    },
    [onViewport, session.viewport],
  );

  // Escape cancels the gesture in progress; with nothing in progress it clears
  // the selection. Both are what a drawing tool is expected to do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      onPointer({ phase: 'cancel', point: [0, 0], shift: false, alt: false, button: 0 });
      onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPointer, onSelect]);

  const grid = size.width > 0 ? gridLines(session.viewport, size) : null;

  return (
    <div className="editor-canvas" ref={host} data-testid="editor-canvas">
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
          <Layer listening={false}>
            {grid?.vertical.map((x) => (
              <Line
                key={`v${x}`}
                points={[x, 0, x, size.height]}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
            ))}
            {grid?.horizontal.map((y) => (
              <Line
                key={`h${y}`}
                points={[0, y, size.width, y]}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
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
          </Layer>
          {children}
        </Stage>
      ) : null}
      {grid === null ? null : (
        <p className="editor-canvas__scale" data-testid="canvas-scale">
          Сетка {grid.step_m} м · {Math.round(session.viewport.scale)} px/м
        </p>
      )}
    </div>
  );
}

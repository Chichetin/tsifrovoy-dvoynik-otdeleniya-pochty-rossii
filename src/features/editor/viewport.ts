/**
 * U02: the viewport — where the plan sits on the canvas and how big it looks.
 *
 * Pure arithmetic, no React and no Konva: panning, zooming at the cursor and
 * fitting a plan into a canvas are the operations a test can pin exactly, and
 * the canvas component is left with nothing but wiring.
 *
 * The Y flip is not here. `modelToScreen` in src/domain/geometry owns it, and
 * this module only moves and scales, so there is still exactly one place that
 * knows the screen has Y pointing down.
 */

import type { Point, Polygon, Viewport } from '../../contracts/model';
import { boundingBox, modelToScreen, screenToModel } from '../../domain/geometry';

/** Pixels per metre. Below the minimum a branch is unreadable, above it useless. */
export const SCALE_LIMITS = { min: 4, max: 400 } as const;

/** Free space left around the plan when fitting it into the canvas. */
const FIT_PADDING_PX = 32;

/**
 * Band kept free under a fitted plan (#233, #243): the scale panel and the
 * cursor coordinates sit along the bottom edge, their top 40 px above it.
 * With the padding the plan extent ends 56 px above the edge. The assistant
 * avatar (bottom-right, 58 px from the right edge) stays right of the plan
 * because of the right band below.
 */
export const OVERLAY_RESERVE_PX = 24;

/**
 * Band kept free right of a fitted plan (#236): the «hide interface» and
 * captions buttons sit in the top-right corner, 2.875rem (46-52 px) from the
 * edge to their left side. With the padding this keeps the plan extent 80 px
 * from the right edge; the half wall thickness outside the extent still has a
 * gap, so a wall or an object never lies under the buttons and a click into
 * the room corner does not hit one.
 */
export const OVERLAY_RIGHT_RESERVE_PX = 48;

/** Fallback when a plan has no extent at all — a fresh, empty document. */
export const DEFAULT_SCALE = 48;

export type CanvasSize = { width: number; height: number };

export type WheelInput = {
  deltaX: number;
  deltaY: number;
  /** Some browser/Konva paths omit deltaMode; omitted means pixel mode. */
  deltaMode?: number;
  ctrlKey: boolean;
};

export type WheelIntent = 'pan' | 'zoom';

/**
 * Browser wheel events do not expose whether their source is a mouse or a
 * trackpad. Smooth pixel deltas are the useful signal for a two-finger swipe;
 * line-based and large pixel steps are the discrete rotation of a wheel.
 */
const TRACKPAD_DELTA_LIMIT_PX = 50;

export function wheelIntent(input: WheelInput): WheelIntent {
  if (input.ctrlKey) return 'zoom';
  // A diagonal, small-delta gesture is the browser's most reliable signal
  // for a trackpad swipe, even when a browser/Konva adapter reports line mode.
  if (input.deltaX !== 0 && Math.abs(input.deltaY) < TRACKPAD_DELTA_LIMIT_PX) return 'pan';
  if (input.deltaMode === 1 || input.deltaMode === 2) return 'zoom';
  if (input.deltaX !== 0) return 'pan';
  return Math.abs(input.deltaY) < TRACKPAD_DELTA_LIMIT_PX ? 'pan' : 'zoom';
}

/**
 * D-272: the screen shift for an accumulated two-finger swipe. The wheel delta
 * says where the reader wants to scroll, so the plan moves the other way — the
 * same as a page under the same fingers. Only the wheel/trackpad pan goes
 * through here; drag pans (middle button, Space + drag) pass the pointer's own
 * movement to `panBy` as is.
 */
export function wheelPan(delta: Point): Point {
  return [-delta[0], -delta[1]];
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return SCALE_LIMITS.min;
  return Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, scale));
}

/** Moves the plan under the cursor by a screen-space delta. */
export function panBy(viewport: Viewport, delta: Point): Viewport {
  return {
    scale: viewport.scale,
    origin: [viewport.origin[0] + delta[0], viewport.origin[1] + delta[1]],
  };
}

/**
 * Zooms so that the world point under the cursor stays under the cursor. That
 * is the whole contract of this function: any other anchor makes the plan slide
 * away while the user is trying to look closer at something.
 */
export function zoomAt(viewport: Viewport, anchor: Point, factor: number): Viewport {
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return viewport;

  const world = screenToModel(anchor, viewport);
  // Solve modelToScreen(world, next) === anchor for the new origin.
  return {
    scale,
    origin: [anchor[0] - world[0] * scale, anchor[1] + world[1] * scale],
  };
}

/** A wheel notch. Positive `deltaY` scrolls down, which zooms out. */
export function zoomByWheel(viewport: Viewport, anchor: Point, deltaY: number): Viewport {
  const factor = Math.exp(-deltaY / 400);
  return zoomAt(viewport, anchor, factor);
}

/**
 * Places the given world extent into the canvas with a margin and free bands
 * at the bottom and on the right for the overlays. A short or narrow canvas
 * gives each band at most a third of its side. An empty or degenerate extent keeps a usable default
 * instead of dividing by zero.
 */
export function fitToExtent(
  extent: Polygon,
  canvas: CanvasSize,
  padding = FIT_PADDING_PX,
  bottomReserve = OVERLAY_RESERVE_PX,
  rightReserve = OVERLAY_RIGHT_RESERVE_PX,
): Viewport {
  const reserve = Math.max(0, Math.min(bottomReserve, canvas.height / 3));
  const right = Math.max(0, Math.min(rightReserve, canvas.width / 3));
  const usableWidth = Math.max(1, canvas.width - padding * 2 - right);
  const usableHeight = Math.max(1, canvas.height - padding * 2 - reserve);

  if (extent.length === 0) {
    return { scale: DEFAULT_SCALE, origin: [padding, canvas.height - padding] };
  }

  const box = boundingBox(extent);
  const worldWidth = box.maxX - box.minX;
  const worldHeight = box.maxY - box.minY;

  const scale = clampScale(
    worldWidth <= 0 || worldHeight <= 0
      ? DEFAULT_SCALE
      : Math.min(usableWidth / worldWidth, usableHeight / worldHeight),
  );

  // Centre the extent: the origin is the screen position of world (0, 0).
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;
  return {
    scale,
    origin: [(canvas.width - right) / 2 - centreX * scale, (canvas.height - reserve) / 2 + centreY * scale],
  };
}

/** World rectangle currently visible, as an unclosed ring. */
export function visibleExtent(viewport: Viewport, canvas: CanvasSize): Polygon {
  const topLeft = screenToModel([0, 0], viewport);
  const bottomRight = screenToModel([canvas.width, canvas.height], viewport);
  return [
    [topLeft[0], bottomRight[1]],
    [bottomRight[0], bottomRight[1]],
    [bottomRight[0], topLeft[1]],
    [topLeft[0], topLeft[1]],
  ];
}

/**
 * Grid step in metres, chosen so lines stay between 24 and 240 pixels apart at
 * any zoom. Steps follow 1-2-5 so the labels read as round numbers.
 */
export function gridStep(scale: number): number {
  const targetPx = 64;
  const raw = targetPx / clampScale(scale);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Grid lines covering the visible area, in world coordinates. Returned as
 * screen-space segments because that is what the canvas draws.
 */
export function gridLines(
  viewport: Viewport,
  canvas: CanvasSize,
): { vertical: number[]; horizontal: number[]; step_m: number } {
  const step = gridStep(viewport.scale);
  const extent = boundingBox(visibleExtent(viewport, canvas));

  const vertical: number[] = [];
  for (let x = Math.ceil(extent.minX / step) * step; x <= extent.maxX; x += step) {
    vertical.push(modelToScreen([x, 0], viewport)[0]);
  }

  const horizontal: number[] = [];
  for (let y = Math.ceil(extent.minY / step) * step; y <= extent.maxY; y += step) {
    horizontal.push(modelToScreen([0, y], viewport)[1]);
  }

  return { vertical, horizontal, step_m: step };
}

/**
 * G01: the one place where the model↔screen convention lives.
 *
 * Model: metres, X to the right, Y up, a positive rotation turns clockwise.
 * Screen: pixels, Y down. Nothing outside this file flips Y — a tool that does
 * its own conversion is the bug this module exists to prevent.
 */

import type { Point, Viewport } from '../../contracts/model';

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Normalises any angle into [0, 360). */
export function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Rotates a local offset clockwise by `degrees`.
 * At +90° the local vector (1,0) becomes (0,-1).
 */
export function rotateOffset(offset: Point, degrees: number): Point {
  const angle = degToRad(normalizeAngle(degrees));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [dx, dy] = offset;
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/** Places a local offset of a rotated object into world coordinates. */
export function toWorld(centre: Point, offset: Point, degrees: number): Point {
  const [rx, ry] = rotateOffset(offset, degrees);
  return [centre[0] + rx, centre[1] + ry];
}

export function modelToScreen(point: Point, viewport: Viewport): Point {
  return [
    viewport.origin[0] + point[0] * viewport.scale,
    viewport.origin[1] - point[1] * viewport.scale,
  ];
}

export function screenToModel(point: Point, viewport: Viewport): Point {
  return [
    (point[0] - viewport.origin[0]) / viewport.scale,
    (viewport.origin[1] - point[1]) / viewport.scale,
  ];
}

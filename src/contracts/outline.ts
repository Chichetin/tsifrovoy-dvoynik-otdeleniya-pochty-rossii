/**
 * Object outline (D-277): the shape of an object on the floor, as data.
 *
 * An outline is a ring in fractions of the object's `size_m`, centred on the
 * object and taken before rotation: X to the right, Y up, exactly the local
 * frame `toWorld` turns. Its bounding box spans [-0.5, 0.5] on both axes, so
 * `size_m` stays the true extent and stretching the frame stretches the shape.
 *
 * The shape resolves in one order — the object's own outline, then its type's
 * outline, then the type's `symbol`, then the rectangle — and this file is the
 * one place that knows it. The schema materialises the result into every
 * object on load (`withTypeOutline`), so geometry reads the shape from the
 * object alone and never needs the catalog.
 */

import { LIMITS, type Equipment, type ObjectSymbol, type ObjectType, type Polygon } from './model';

/** How far a stored outline box may miss [-0.5, 0.5] before it is refused rather than rescaled. */
export const OUTLINE_SPAN_TOLERANCE = 1e-3;

/** Vertices of the ellipse a `circle` symbol stands for; a multiple of four keeps the box exact. */
export const CIRCLE_OUTLINE_VERTICES = 24;

/** The default shape: the full `size_m` rectangle, counter-clockwise from the lower left. */
export const UNIT_SQUARE: Polygon = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/** Six decimals: a stable file, far below a millimetre on any real object. */
function round(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

function ellipse(steps: number): Polygon {
  const ring: Polygon = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = (2 * Math.PI * step) / steps;
    ring.push([round(Math.cos(angle) / 2), round(Math.sin(angle) / 2)]);
  }
  return ring;
}

const CIRCLE: Polygon = ellipse(CIRCLE_OUTLINE_VERTICES);

/** Apex at the top middle (local +Y), base along the bottom — as the plan drew it before D-277. */
const TRIANGLE: Polygon = [
  [0, 0.5],
  [-0.5, -0.5],
  [0.5, -0.5],
];

/** Outline a catalog symbol stands for; `undefined` for the rectangle, which needs none. */
export function symbolOutline(symbol: ObjectSymbol): Polygon | undefined {
  if (symbol === 'circle') return CIRCLE;
  if (symbol === 'triangle') return TRIANGLE;
  return undefined;
}

/** A type's shape: its own outline, else its symbol's; `undefined` means the rectangle. */
export function typeOutline(type: ObjectType): Polygon | undefined {
  return type.outline ?? symbolOutline(type.symbol);
}

/** The shape an object is drawn and checked with. */
export function objectOutline(object: Equipment): Polygon {
  return object.outline ?? UNIT_SQUARE;
}

/**
 * The object with its type's shape: a new object from the library, an object
 * whose type changed, a type whose shape changed. A rectangle type leaves no
 * field behind, so a plain plan keeps its plain file.
 */
export function withTypeOutline(object: Equipment, type: ObjectType | null | undefined): Equipment {
  const outline = type === null || type === undefined ? undefined : typeOutline(type);
  if (outline === undefined) {
    if (object.outline === undefined) return object;
    const rest = { ...object };
    delete rest.outline;
    return rest;
  }
  return { ...object, outline };
}

/** Same ring, vertex for vertex. Used to tell an inherited shape from an object's own. */
export function sameOutline(a: Polygon | undefined, b: Polygon | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1]);
}

/**
 * Is this ring usable as an outline: 3 to 256 finite vertices whose box spans
 * [-0.5, 0.5] on both axes, give or take rounding? Anything else would make
 * `size_m` lie about the object's extent. Self-crossing is not decided here:
 * like a zone, a crossed outline opens and validation reports it (D-013).
 */
export function outlineFits(ring: Polygon): boolean {
  if (ring.length < 3 || ring.length > LIMITS.maxPolygonVertices) return false;
  if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return false;
  const xs = ring.map((point) => point[0]);
  const ys = ring.map((point) => point[1]);
  const near = (value: number, target: number): boolean => Math.abs(value - target) <= OUTLINE_SPAN_TOLERANCE;
  return (
    near(Math.min(...xs), -0.5) && near(Math.max(...xs), 0.5) && near(Math.min(...ys), -0.5) && near(Math.max(...ys), 0.5)
  );
}

/**
 * Rescales a ring so its box spans exactly [-0.5, 0.5] on both axes. A ring
 * already spanning it comes back untouched: rescaling an exact ring again
 * would only add rounding noise to a saved file.
 */
export function normalizeOutline(ring: Polygon): Polygon {
  const xs = ring.map((point) => point[0]);
  const ys = ring.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (minX === -0.5 && maxX === 0.5 && minY === -0.5 && maxY === 0.5) return ring;
  return ring.map(([x, y]) => [
    round((x - minX) / (maxX - minX) - 0.5),
    round((y - minY) / (maxY - minY) - 0.5),
  ]);
}

/**
 * #59: fits a catalog 3D model to an object's size. Numbers only, no Three.js.
 *
 * A model is built once at its type's default size (scripts/models/build.py)
 * and carries its own resize rule as glTF extras:
 *
 * - `slice`: margins keep their size and the middle stretches — a longer desk
 *   keeps thin legs and a pedestal of the same width;
 * - `contain`: one scale for all three axes that fits the box — a printer
 *   never becomes a long printer;
 * - `repeat` on a part: the part is one copy of a row (shelf, seat, parcels)
 *   and is repeated along a track at about its pitch — a taller rack gets more
 *   shelves, not thicker ones.
 *
 * Model space is the object's local space: X across, Y to the front (D-010),
 * Z up from the base. The fitted box always spans exactly the footprint.
 */

export type Vec3 = [number, number, number];

/** gap0, gap1, pitch: the track runs from gap0 to size - gap1 at about pitch. */
export type Track = [number, number, number];

export type Fit =
  | { fit: 'slice'; size: Vec3; margins: [number, number, number, number, number, number] }
  | { fit: 'contain'; size: Vec3 };

export type Repeat = { x?: Track; y?: Track; z?: Track; skipTop?: boolean };

const AXES = ['x', 'y', 'z'] as const;
const EPSILON = 1e-6;

/** Offsets of a row's copies from its first copy along one axis. */
export function track([gap0, gap1, pitch]: Track, size: number): number[] {
  const span = size - gap0 - gap1;
  const count = span <= EPSILON || pitch <= EPSILON ? 1 : Math.max(1, Math.round(span / pitch) + 1);
  const step = count > 1 ? span / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => index * step);
}

/**
 * New coordinate on one axis. Model coordinates span [lo, lo + length]; the
 * fitted ones span [-size / 2, size / 2] across and [0, size] in height.
 * Margins that do not fit the new size give way to a plain stretch.
 */
function sliceAxis(value: number, lo: number, length: number, size: number, m0: number, m1: number, axis: number): number {
  const t = value - lo;
  const middle = length - m0 - m1;
  let fitted: number;
  if (middle <= EPSILON || size < m0 + m1) fitted = (t * size) / length;
  else if (t <= m0) fitted = t;
  else if (t >= length - m1) fitted = t - length + size;
  else fitted = m0 + ((t - m0) * (size - m0 - m1)) / middle;
  return axis === 2 ? fitted : fitted - size / 2;
}

/**
 * Fits the vertex positions (x, y, z triples) of one model part to `size`.
 * A part with `repeat` comes back once per copy; the other parts once.
 */
export function fitPositions(positions: ArrayLike<number>, model: Fit, size: Vec3, repeat?: Repeat): Float32Array[] {
  const lo: Vec3 = [-model.size[0] / 2, -model.size[1] / 2, 0];

  if (model.fit === 'contain') {
    const k = Math.min(size[0] / model.size[0], size[1] / model.size[1], size[2] / model.size[2]);
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      out[i] = positions[i]! * k;
      out[i + 1] = positions[i + 1]! * k;
      out[i + 2] = (positions[i + 2]! - lo[2]) * k;
    }
    return [out];
  }

  // A repeated axis is not stretched: copies move along it instead.
  const repeated = AXES.map((name) => repeat?.[name]);
  const offsets = repeated.map((spec, axis) => {
    if (spec === undefined) return [0];
    const steps = track(spec, size[axis]!);
    // The track starts at the near end, which moves when a centred axis changes.
    const shift = axis === 2 ? 0 : (model.size[axis]! - size[axis]!) / 2;
    const kept = axis === 2 && repeat?.skipTop === true && steps.length > 1 ? steps.slice(0, -1) : steps;
    return kept.map((step) => step + shift);
  });

  const base = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis]!;
      base[i + axis] = repeated[axis] === undefined
        ? sliceAxis(value, lo[axis]!, model.size[axis]!, size[axis]!, model.margins[axis * 2]!, model.margins[axis * 2 + 1]!, axis)
        : value;
    }
  }

  const copies: Float32Array[] = [];
  for (const dx of offsets[0]!) {
    for (const dy of offsets[1]!) {
      for (const dz of offsets[2]!) {
        const copy = new Float32Array(base);
        for (let i = 0; i < copy.length; i += 3) {
          copy[i] = copy[i]! + dx;
          copy[i + 1] = copy[i + 1]! + dy;
          copy[i + 2] = copy[i + 2]! + dz;
        }
        copies.push(copy);
      }
    }
  }
  return copies;
}

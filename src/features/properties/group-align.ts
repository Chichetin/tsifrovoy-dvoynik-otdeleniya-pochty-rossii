/**
 * #21: align and distribute the objects of a group.
 *
 * Align puts one edge or the middle of every object's box on a common line;
 * distribute leaves equal gaps between three or more objects, the two
 * outermost staying put. One click is one `batch` command, so the store
 * keeps it as one undo step and the command check refuses the whole batch
 * when any object lands on a forbidden place.
 */

import type { Command } from '../../contracts/commands';
import type { Equipment, Point } from '../../contracts/model';
import { boundingBox, footprint } from '../../domain/geometry';

/** The model's Y points up, so «top» is the largest Y. */
export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export const DISTRIBUTE_MIN = 3;

const toCentimetre = (value: number): number => Math.round(value * 100) / 100;

/** Objects moved so the chosen edge (or middle) of their boxes lies on one line. */
export function alignObjects(objects: readonly Equipment[], edge: AlignEdge): Equipment[] {
  const axis = edge === 'left' || edge === 'centerX' || edge === 'right' ? 0 : 1;
  const boxes = objects.map((object) => boundingBox(footprint(object)));
  const lows = boxes.map((box) => (axis === 0 ? box.minX : box.minY));
  const highs = boxes.map((box) => (axis === 0 ? box.maxX : box.maxY));
  const low = Math.min(...lows);
  const high = Math.max(...highs);
  const side = edge === 'left' || edge === 'bottom' ? 'low' : edge === 'right' || edge === 'top' ? 'high' : 'middle';
  const line = side === 'low' ? low : side === 'high' ? high : (low + high) / 2;
  return objects.map((object, i) => {
    const at = side === 'low' ? lows[i]! : side === 'high' ? highs[i]! : (lows[i]! + highs[i]!) / 2;
    const position: Point = [object.position[0], object.position[1]];
    position[axis] = toCentimetre(position[axis] + line - at);
    return { ...object, position };
  });
}

/**
 * Equal gaps between the boxes along `axis` (0 — X, 1 — Y); the two outermost
 * stay where they are. Gaps rather than equal centre steps: objects of
 * different size would collide on an equal step. Fewer than `DISTRIBUTE_MIN`
 * objects: unchanged. The result keeps the order of the input.
 */
export function distributeObjects(objects: readonly Equipment[], axis: 0 | 1): Equipment[] {
  if (objects.length < DISTRIBUTE_MIN) return [...objects];
  const spans = objects.map((object) => {
    const box = boundingBox(footprint(object));
    return axis === 0 ? [box.minX, box.maxX] : [box.minY, box.maxY];
  });
  const order = objects.map((_, i) => i).sort((a, b) => spans[a]![0]! + spans[a]![1]! - spans[b]![0]! - spans[b]![1]!);
  const start = spans[order[0]!]![0]!;
  const end = spans[order.at(-1)!]![1]!;
  const sizes = spans.reduce((sum, [low, high]) => sum + high! - low!, 0);
  const gap = (end - start - sizes) / (objects.length - 1);
  const placed = [...objects];
  let edge = start;
  for (const index of order) {
    const [low, high] = spans[index]!;
    const position: Point = [objects[index]!.position[0], objects[index]!.position[1]];
    position[axis] = toCentimetre(position[axis] + edge - low!);
    placed[index] = { ...objects[index]!, position };
    edge += high! - low! + gap;
  }
  return placed;
}

/** The moved objects as one undo step. */
export function putAll(objects: readonly Equipment[]): Command {
  return { type: 'batch', commands: objects.map((object) => ({ type: 'object.put', object })) };
}

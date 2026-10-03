import type { Opening, Point, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { projectOnSegment, wallLength } from '../../domain/geometry';

/** One edge follows the pointer on the wall; the opposite edge remains fixed. */
export function resizeOpening(opening: Opening, wall: Wall, edge: 'start' | 'end', point: Point): Opening {
  const length = wallLength(wall);
  if (length <= TOLERANCE.coordinate_m) return opening;
  const along = Math.round(projectOnSegment(point, wall.from, wall.to).t * length * 100) / 100;
  const minimum = Math.min(0.2, length);
  const offset = opening.offset_m >= length ? length - minimum : opening.offset_m;
  const fixedEnd = Math.min(length, opening.offset_m + opening.width_m);
  if (edge === 'start') {
    const start = Math.min(fixedEnd - Math.min(0.2, fixedEnd), Math.max(0, along));
    return { ...opening, offset_m: start, width_m: fixedEnd - start };
  }
  const end = Math.max(offset + Math.min(minimum, length - offset), Math.min(length, along));
  return { ...opening, offset_m: offset, width_m: end - offset };
}


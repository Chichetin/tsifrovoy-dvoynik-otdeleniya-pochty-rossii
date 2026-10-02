import type { Opening, Point, Wall } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { intervalsOverlap, projectOnSegment, wallLength } from '../../domain/geometry';

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

/** Geometric intersection of two openings on the same wall, including height. */
export function openingsOverlap(a: Opening, b: Opening): boolean {
  return a.id !== b.id && a.wallId === b.wallId &&
    intervalsOverlap({ base_m: a.offset_m, top_m: a.offset_m + a.width_m }, { base_m: b.offset_m, top_m: b.offset_m + b.width_m }) &&
    intervalsOverlap({ base_m: a.sill_m, top_m: a.sill_m + a.height_m }, { base_m: b.sill_m, top_m: b.sill_m + b.height_m });
}
/** Opening intersection in the wall's horizontal/vertical plane, in square metres. */
function overlapArea(a: Opening, b: Opening): number {
  if (!openingsOverlap(a,b)) return 0;
  const width=Math.min(a.offset_m+a.width_m,b.offset_m+b.width_m)-Math.max(a.offset_m,b.offset_m);
  const height=Math.min(a.sill_m+a.height_m,b.sill_m+b.height_m)-Math.max(a.sill_m,b.sill_m);
  return width*height;
}

/** Allow gradual repair, but refuse new or increased overlap with each neighbour. */
export function introducesOpeningOverlap(candidate: Opening, before: Opening, openings: Opening[]): boolean {
  return openings.some((other) => openingsOverlap(candidate,other) &&
    (!openingsOverlap(before,other) || overlapArea(candidate,other)>overlapArea(before,other)+TOLERANCE.area_m2));
}

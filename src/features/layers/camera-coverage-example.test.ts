/**
 * Issue #32 on the organizers' example: its zones reach the coverage through the
 * same import and team catalog merge the editor uses. Lives here, not in
 * `domain/advice`, because domain may not import persistence.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { cameraCoverage, fieldRepresentationFor, type CameraFieldRepresentation } from '../../domain/advice';
import { importOrganizerExample, withTeamCatalog } from '../../persistence/organizer-import';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error(path);
  return parsed.value;
}

test('example_plan.json со справочником команды: зал, ожидание и очередь клиентские, камер нет — 0 %', () => {
  const team = load('demo/before.json').catalog;
  const imported = importOrganizerExample(JSON.parse(readFileSync('example_plan.json', 'utf8')));
  if (!imported.ok) throw new Error('example');
  const merged = withTeamCatalog(imported.value, team);
  if (!merged.ok) throw new Error('merge');
  const representation = fieldRepresentationFor(merged.value.catalog, 'ot_camera') as CameraFieldRepresentation;
  const result = cameraCoverage(merged.value, representation);
  expect(result.zones.map((entry) => entry.zoneId)).toEqual(['z_client', 'z_waiting', 'z_queue']);
  expect(result.total.percent).toBe(0);
  // The hall is 7.5 × 7.5 m: every square of it is a blind spot.
  expect(result.total.area_m2).toBeCloseTo(56.25, 9);
  expect(result.total.blind_m2).toBeCloseTo(56.25, 9);
});

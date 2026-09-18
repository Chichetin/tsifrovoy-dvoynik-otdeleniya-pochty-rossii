/** Deterministic, synthetic Q02 plans. No personal or real branch data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Catalog, PlanDocument, Point, Zone } from '../src/contracts/model';

export const BENCHMARK_SEED = 20260918;
export const CASES = [
  { objects: 100, zones: 10, columns: 5, rows: 2 },
  { objects: 500, zones: 30, columns: 6, rows: 5 },
  { objects: 1000, zones: 50, columns: 10, rows: 5 },
] as const;

const WIDTH = 100;
const HEIGHT = 50;

function point(x: number, y: number): Point { return [x, y]; }
function catalogFile(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../data/catalog/${name}.json`, import.meta.url), 'utf8'));
}
const catalog: Catalog = {
  version: '1.0.0',
  objectTypes: catalogFile('object-types') as Catalog['objectTypes'],
  zoneTypes: catalogFile('zone-types') as Catalog['zoneTypes'],
  layerTypes: catalogFile('layer-types') as Catalog['layerTypes'],
  rules: catalogFile('rules') as Catalog['rules'],
};

export function generateBenchmark(objects: 100 | 500 | 1000): PlanDocument {
  const config = CASES.find((entry) => entry.objects === objects);
  if (!config) throw new Error(`Неизвестный размер набора: ${objects}`);
  const corners = [point(0, 0), point(WIDTH, 0), point(WIDTH, HEIGHT), point(0, HEIGHT)];
  const plan: PlanDocument = {
    schemaVersion: 1, id: `benchmark_${BENCHMARK_SEED}_${objects}`,
    name: `Синтетический Q02 — ${objects} объектов`,
    room: { id: 'room_main', boundary: corners, ceilingHeight_m: 3 },
    walls: ['w_south', 'w_east', 'w_north', 'w_west'].map((id, i) => ({
      id, from: corners[i]!, to: corners[(i + 1) % 4]!, thickness_m: 0.25, height_m: 3,
    })),
    openings: [{ id: 'op_entrance', wallId: 'w_north', offset_m: WIDTH / 2 - 0.75,
      width_m: 1.5, kind: 'entrance', sill_m: 0, height_m: 2.1 }],
    layers: [{ id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
      ...catalog.layerTypes.map((type, i) => ({ id: `l_${type.id}`, name: type.label,
        visible: false, locked: false, order: i + 1, typeId: type.id }))],
    zones: [], objects: [], catalog, extensions: {},
  };

  const cellW = WIDTH / config.columns;
  const cellH = HEIGHT / config.rows;
  const zones: Zone[] = [];
  for (let row = 0; row < config.rows; row += 1) {
    for (let col = 0; col < config.columns; col += 1) {
      const x = col * cellW;
      const y = row * cellH;
      zones.push({
        id: `z_${row}_${col}`, typeId: 'zt_client', name: `Сектор ${row + 1}/${col + 1}`,
        polygon: [point(x, y), point(x + cellW, y), point(x + cellW, y + cellH), point(x, y + cellH)],
        parentId: null, layerId: 'l_base', attributes: {},
      });
    }
  }
  plan.zones = zones;

  // A 40×25 grid yields exactly 1000 non-overlapping 0.5 m objects. The seed
  // fixes the cyclic shift of equipment types without relying on Math.random.
  const types = plan.catalog.objectTypes.filter((type) => type.physical && type.occupiesFloor);
  if (types.length === 0) throw new Error('Нет физических типов оборудования');
  for (let index = 0; index < objects; index += 1) {
    const x = 1.25 + (index % 40) * 2.5;
    const y = 1 + Math.floor(index / 40) * 2;
    const col = Math.min(config.columns - 1, Math.floor(x / cellW));
    const row = Math.min(config.rows - 1, Math.floor(y / cellH));
    const type = types[(index + BENCHMARK_SEED) % types.length]!;
    plan.objects.push({
      id: `eq_${index}`, typeId: type.id, label: `${type.label} ${index + 1}`,
      position: point(x, y), size_m: point(0.5, 0.5), rotation_deg: 0,
      base_m: type.defaultBase_m, height_m: type.defaultHeight_m,
      zoneId: `z_${row}_${col}`, layerId: 'l_base', attributes: {},
    });
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const size = Number(process.argv[2]);
  const output = process.argv[3];
  if (![100, 500, 1000].includes(size) || !output) {
    throw new Error('Использование: npx tsx scripts/generate-benchmark.ts 100|500|1000 <output.json>');
  }
  writeFileSync(output, JSON.stringify(generateBenchmark(size as 100 | 500 | 1000)));
  process.stdout.write(`Создан синтетический план: ${size} объектов → ${output}\n`);
}

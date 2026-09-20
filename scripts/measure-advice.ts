/**
 * Q02 for the assistant: how long the calculation behind a recommendation takes
 * on the synthetic plans of 100, 500 and 1000 objects (D-205). Pure domain code,
 * no browser: `npx tsx scripts/measure-advice.ts`. Prints the median of three
 * runs per step, in milliseconds. The numbers belong to the machine that ran it —
 * quote them together with its CPU.
 */

import { calculateAdvice } from '../src/domain/advice';
import { measurePlan } from '../src/domain/metrics';
import { validatePlan } from '../src/domain/validation';
import { generateBenchmark } from './generate-benchmark';

const RUNS = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function timed(work: () => unknown): number {
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    work();
    times.push(performance.now() - started);
  }
  return median(times);
}

console.log('объектов\tmeasurePlan\tvalidatePlan\tplace\tequipment\tcompare');
for (const size of [100, 500, 1000] as const) {
  const plan = generateBenchmark(size);
  const typeId = plan.catalog.objectTypes[0]?.id;
  const zoneId = plan.zones[0]?.id ?? null;
  if (typeId === undefined) throw new Error('в справочнике нагрузочного плана нет типов');
  const row = [
    timed(() => measurePlan(plan)),
    timed(() => validatePlan(plan)),
    timed(() => calculateAdvice(plan, { scenario: 'place', typeId, zoneId })),
    timed(() => calculateAdvice(plan, { scenario: 'equipment', zoneId: null })),
    timed(() => calculateAdvice(plan, { scenario: 'compare', before: plan })),
  ];
  console.log([size, ...row.map((ms) => ms.toFixed(0))].join('\t'));
}

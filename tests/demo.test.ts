/**
 * E01: the submission set is checked as the jury will use it.
 *
 * Four things are proven here, and each of them has failed at least once during
 * development: the two plans on disk are the ones the calculation produces, they
 * open through the same code path as the "Открыть" button, the numbers in
 * effect.md are the calculated ones, and the ZIP really unpacks back into those
 * files. Nothing here trusts a file because it is committed.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, test } from 'vitest';
import {
  REQUESTS,
  rebuildFromFile,
  renderModeSection,
  withModeSection,
  type DemoRecommendationFile,
} from '../demo/build';
import {
  DEFAULT_OUTPUT,
  DEMO_FILES,
  collectDemoFiles,
  crc32,
  packageDemo,
  readZip,
} from '../scripts/package-demo';
import { openStartPlan } from '../src/app/default-plan';
import type { Recommendation } from '../src/contracts/advice';
import type { PlanDocument } from '../src/contracts/model';
import { calculateAdvice, routeAgentQuery, verifyExplanation } from '../src/domain/advice';
import { countInZoneScope } from '../src/domain/inventory';
import { measurePlan } from '../src/domain/metrics';
import { reconcileZones } from '../src/domain/relations';
import { planHealth, validatePlan } from '../src/domain/validation';
import { encodePlan } from '../src/persistence/codec';
import { readPlanFile } from '../src/persistence/format';

const DEMO_DIR = join(process.cwd(), 'demo');

test('оборудование у стены демо смотрит от стены внутрь комнаты', () => {
  for (const name of ['before.json', 'after.json']) {
    const plan = JSON.parse(readFileSync(join(DEMO_DIR, name), 'utf8')) as PlanDocument;
    const mounts = {
      eq_5: 'w_south', eq_24: 'w_west', eq_37: 'w_east', eq_38: 'w_hall_back',
      eq_47: 'w_north', eq_48: 'w_north', eq_49: 'w_east', eq_52: 'w_staff',
      eq_13: 'w_notch_south', eq_14: 'w_notch_south', eq_15: 'w_notch_south',
      eq_36: 'w_storage', eq_50: 'w_north',
    };
    for (const [id, wallId] of Object.entries(mounts)) {
      const object = plan.objects.find((entry) => entry.id === id)!;
      const wall = plan.walls.find((entry) => entry.id === wallId)!;
      const wallPoint = wall.from[0] === wall.to[0]
        ? [wall.from[0], object.position[1]] : [object.position[0], wall.from[1]];
      const dx = object.position[0] - wallPoint[0]!;
      const dy = object.position[1] - wallPoint[1]!;
      const angle = object.rotation_deg * Math.PI / 180;
      const inward = (Math.sin(angle) * dx + Math.cos(angle) * dy) / Math.hypot(dx, dy);
      expect(inward, `${name}: ${id}`).toBeGreaterThan(0.99);
    }
  }
});

test('дверь служебной зоны демо не захватывает примыкание перегородки хранения', () => {
  for (const name of ['before.json', 'after.json']) {
    const plan = JSON.parse(readFileSync(join(DEMO_DIR, name), 'utf8')) as PlanDocument;
    const door = plan.openings.find((opening) => opening.id === 'op_door_back')!;
    const partition = plan.walls.find((wall) => wall.id === 'w_storage')!;
    expect(door.offset_m + door.width_m).toBeLessThan(partition.from[1] - partition.thickness_m / 2);
  }
});

test('вопрос о составе зоны ведёт к зоне, даже если её имя похоже на тип объекта (#34)', () => {
  const plan = JSON.parse(readFileSync(join(DEMO_DIR, 'before.json'), 'utf8')) as PlanDocument;
  // «Зона ожидания» shares a word with the bench type: it used to route to find_place.
  expect(routeAgentQuery(plan, 'Что находится в зоне «Зона ожидания» (z_waiting)?', false)[0]).toEqual({
    name: 'zone_details',
    args: { zoneId: 'z_waiting' },
  });
  // «Весы» stem to three letters, below the type threshold: the question used to fall to plan_overview.
  expect(routeAgentQuery(plan, 'Где поставить ещё весы?', false)[0]).toMatchObject({ name: 'find_place', args: { typeId: 'ot_scales' } });
  // #150: a question outside the supported calculation scenarios asks for
  // clarification rather than silently routing to the whole-plan overview.
  expect(routeAgentQuery(plan, 'Покажи весь план', false)).toEqual([]);
});

test('стартовый план совпадает с исходным демо из ZIP и показывает находки (#111)', () => {
  const plan = openStartPlan();
  expect(plan).toEqual(JSON.parse(readFileSync(join(DEMO_DIR, 'before.json'), 'utf8')));
  expect(validatePlan(plan).length).toBeGreaterThan(0);
  const reconciled = reconcileZones(plan);
  expect(reconciled.ok && reconciled.value.objects.map((object) => object.zoneId)).toEqual(
    plan.objects.map((object) => object.zoneId),
  );
});

function demoFile(name: string): string {
  return readFileSync(join(DEMO_DIR, name), 'utf8');
}

/** Opens a demo file exactly as the "Открыть" button does. */
function open(name: string): PlanDocument {
  const result = readPlanFile(demoFile(name));
  if (!result.ok) {
    throw new Error(
      `${name} не открылся: ${result.issues.map((issue) => issue.code).join(', ')}`,
    );
  }
  expect(result.value.format).toBe('ours');
  // Our own format invents nothing, so the importer has nothing to assume.
  expect(result.value.assumptions).toEqual([]);
  return result.value.plan;
}

const before = open('before.json');
const after = open('after.json');
const recommendationFile = JSON.parse(demoFile('recommendation.json')) as DemoRecommendationFile;

const tempDirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'demo-zip-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Запас по времени для двух тестов, которые пересчитывают демо-комплект с нуля.
 * Дефолтные 5 с срывались таймаутом на чужой нагрузке, а не на дефекте (D-126),
 * но и 30 с были взяты с потолка: красный тест столько не должен висеть.
 * Измерено `npx vitest run --reporter=verbose` (D-142): отдельным файлом 589 мс
 * и 466 мс, в полном прогоне трижды 1,92 / 1,57 / 1,56 с и 1,25 / 1,25 / 1,18 с.
 * 10 с — пятикратный запас к худшему измеренному, а не к округлённой оценке.
 */
const SLOW_CALCULATION = { timeout: 10_000 };

describe('комплект демо-проекта', () => {
  test('файлы на диске — это то, что считает код, а не устаревшая копия', SLOW_CALCULATION, () => {
    // Everything is recalculated; only what the code cannot reproduce is taken
    // from the file — the fallback reason, or the model's choice, which must
    // still pass the same check the route applies (D-188). A byte-equal rebuild
    // therefore pins every id, number and effect row in both modes.
    const build = rebuildFromFile(recommendationFile);
    expect(demoFile('before.json')).toBe(build.beforeText);
    expect(readFileSync(join(process.cwd(), 'public/demo/before.json'), 'utf8')).toBe(build.beforeText);
    expect(readFileSync(join(process.cwd(), 'public/demo/after.json'), 'utf8')).toBe(build.afterText);
    expect(demoFile('after.json')).toBe(build.afterText);
    expect(demoFile('recommendation.json')).toBe(build.recommendationText);
    // The mode paragraph of effect.md is generated from the same file.
    const effect = demoFile('effect.md');
    expect(effect).toBe(withModeSection(effect, renderModeSection(recommendationFile)));
  });

  test('оба плана открываются с зонами, оборудованием, id и атрибутами', () => {
    for (const plan of [before, after]) {
      expect(plan.schemaVersion).toBe(1);
      expect(plan.zones).toHaveLength(8);
      expect(plan.layers.length).toBeGreaterThan(1);
      expect(plan.objects.length).toBeGreaterThanOrEqual(50);
      // Every object keeps its own id, a known type and a zone computed from
      // geometry; a plan where these are missing would open but say nothing.
      const ids = new Set(plan.objects.map((object) => object.id));
      expect(ids.size).toBe(plan.objects.length);
      for (const object of plan.objects) {
        expect(plan.catalog.objectTypes.some((type) => type.id === object.typeId)).toBe(true);
        expect(object.zoneId === null || ids.has(object.id)).toBe(true);
        expect(typeof object.attributes.inventoryNumber).toBe('string');
      }
      for (const zone of plan.zones) {
        expect(plan.catalog.zoneTypes.some((type) => type.id === zone.typeId)).toBe(true);
      }
    }

    // Spot checks on the things the jury looks at in the properties card.
    const window1 = before.objects.find((object) => object.id === 'eq_10');
    expect(window1?.typeId).toBe('ot_cashier_window');
    expect(window1?.attributes.windowNumber).toBe(1);
    expect(window1?.zoneId).toBe('z_client');
    expect(before.zones.find((zone) => zone.id === 'z_waiting')?.parentId).toBe('z_client');
    expect(before.zones.find((zone) => zone.id === 'z_waiting')?.attributes.queueLength).toBe(4);
  });

  test('сохранить → открыть → сохранить даёт тот же файл', () => {
    for (const name of ['before.json', 'after.json']) {
      const text = demoFile(name);
      const reopened = encodePlan(open(name));
      expect(reopened.ok).toBe(true);
      if (reopened.ok) expect(reopened.value).toBe(text);
    }
  });

  test('исходный план содержит ровно те нарушения, которые чинит рекомендация', () => {
    const issues = validatePlan(before);
    expect(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)).toEqual([
      'RULE_TOO_FAR_FROM_ENTRANCE',
    ]);
    expect(
      issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code).sort(),
    ).toEqual(['RULE_COUNT_BELOW_MIN']);
    // The changed plan is clean: that is the point of the recommendation.
    expect(validatePlan(after)).toEqual([]);
    // #125: the score in the header says the same — «after» is higher.
    expect(planHealth(issues).score).toBeLessThan(planHealth(validatePlan(after)).score);
  });

  test('рекомендация в файле повторяется расчётом на before.json', SLOW_CALCULATION, () => {
    const fromCalculation: Recommendation[] = [
      ...run(before, REQUESTS.equipment),
      ...run(before, REQUESTS.bench),
      ...run(before, REQUESTS.terminal),
      ...run(after, { scenario: 'compare', before }),
    ];
    for (const stored of recommendationFile.recommendations) {
      const computed = fromCalculation.find((entry) => entry.id === stored.id);
      expect(computed, `рекомендация ${stored.id} не воспроизвелась`).toBeDefined();
      expect(stored).toEqual(computed);
    }
    // Exactly one of the two is filled: a file cannot be both, or neither.
    if (recommendationFile.mode === 'llm') {
      expect(recommendationFile.fallbackReason).toBeNull();
      expect(recommendationFile.llm?.provider.length).toBeGreaterThan(0);
      expect(recommendationFile.llm?.model.length).toBeGreaterThan(0);
      expect(recommendationFile.llm?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } else {
      expect(recommendationFile.mode).toBe('fallback');
      expect(recommendationFile.llm).toBeNull();
      expect(recommendationFile.fallbackReason?.length).toBeGreaterThan(0);
    }
  });

  test('объяснения проходят проверку кодом и ссылаются на существующие id', () => {
    // The same gate an LLM answer goes through: shape, ids, reason code and
    // the facts the code allows it to cite.
    const verified = verifyExplanation(
      { explanations: recommendationFile.explanations },
      recommendationFile.recommendations,
    );
    expect(verified.ok ? 'ok' : verified.issues).toBe('ok');

    const known = new Set<string>([
      before.room.id,
      ...before.zones.map((zone) => zone.id),
      ...before.objects.map((object) => object.id),
      ...before.layers.map((layer) => layer.id),
    ]);
    for (const recommendation of recommendationFile.recommendations) {
      for (const ref of recommendation.refs) expect(known.has(ref.id)).toBe(true);
      for (const rule of recommendation.ruleIds) {
        expect(before.catalog.rules.some((entry) => entry.id === rule)).toBe(true);
      }

    }
  });

  test('применённые изменения — ровно те, что описаны в рекомендации', () => {
    const applied = new Map(
      recommendationFile.applied.map((entry) => [entry.objectId, entry]),
    );
    expect([...applied.keys()].sort()).toEqual(['eq_1', 'eq_54']);

    // Added: the bench, with the geometry of the candidate it came from.
    const bench = after.objects.find((object) => object.id === 'eq_54');
    const candidate = recommendationFile.recommendations
      .find((entry) => entry.id === 'adv_place_ot_bench_z_waiting')
      ?.candidates.find((entry) => entry.id === applied.get('eq_54')?.candidateId);
    expect(bench?.position).toEqual(candidate?.object.position);
    expect(bench?.rotation_deg).toBe(candidate?.object.rotation_deg);
    expect(bench?.zoneId).toBe('z_waiting');
    expect(before.objects.some((object) => object.id === 'eq_54')).toBe(false);

    // Nothing is removed: the queue display stays, the rule allows two.
    expect(after.objects.length).toBe(before.objects.length + 1);

    // Moved: the same object, same id and attributes, new position.
    const wasTerminal = before.objects.find((object) => object.id === 'eq_1');
    const isTerminal = after.objects.find((object) => object.id === 'eq_1');
    expect(isTerminal?.typeId).toBe(wasTerminal?.typeId);
    expect(isTerminal?.attributes).toEqual(wasTerminal?.attributes);
    expect(isTerminal?.position).not.toEqual(wasTerminal?.position);
    expect(isTerminal?.zoneId).toBe('z_entrance');
  });

  test('эффект в effect.md совпадает с расчётом по обоим планам', () => {
    const table = effectTable(demoFile('effect.md'));
    expect(table.size).toBe(recommendationFile.effect.length);

    for (const row of recommendationFile.effect) {
      const written = table.get(row.metric);
      expect(written, `в effect.md нет строки ${row.metric}`).toBeDefined();
      expect([row.before, row.after, row.delta]).toEqual(written);
    }

    // The stored numbers are re-derived from the files themselves, so a hand
    // edit of before.json cannot leave the table quietly right.
    const freeBefore = free(before);
    const freeAfter = free(after);
    expect(value('area.free')).toEqual([round2(freeBefore), round2(freeAfter)]);
    expect(value('equipment.count')).toEqual([before.objects.length, after.objects.length]);
    expect(value('bench.in.waiting')).toEqual([
      countInZoneScope(before, 'ot_bench', 'z_waiting', 'direct'),
      countInZoneScope(after, 'ot_bench', 'z_waiting', 'direct'),
    ]);
    expect(value('display.in.client')).toEqual([
      countInZoneScope(before, 'ot_info_display', 'z_client', 'inclusive'),
      countInZoneScope(after, 'ot_info_display', 'z_client', 'inclusive'),
    ]);
    expect(value('issues.error')).toEqual([
      validatePlan(before).filter((issue) => issue.severity === 'error').length,
      validatePlan(after).filter((issue) => issue.severity === 'error').length,
    ]);
  });

  test('в комплекте нет реальных персональных и адресных данных', () => {
    const forbiddenKeys = [
      'fio',
      'surname',
      'lastname',
      'firstname',
      'patronymic',
      'phone',
      'email',
      'passport',
      'snils',
      'inn',
      'employeeid',
      'personnelnumber',
      'tabelnumber',
      'address',
    ];
    const forbiddenText: [RegExp, string][] = [
      [/\+7\s*\(?\d{3}/, 'телефон'],
      [/\b8[\s-]?\(?9\d{2}\)?[\s-]?\d{3}/, 'телефон'],
      [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, 'адрес электронной почты'],
      [/\b\d{3}-\d{3}-\d{3}\s\d{2}\b/, 'СНИЛС'],
      [/\bул\.\s?[А-ЯЁ]/, 'улица'],
      [/\bд\.\s?\d+\b/, 'номер дома'],
      [/115534/, 'номер отделения из материалов организаторов'],
      [/\bБТИ\b/, 'план БТИ'],
    ];

    for (const name of DEMO_FILES) {
      const text = demoFile(name);
      for (const key of forbiddenKeys) {
        expect(text.toLowerCase(), `${name}: запрещённое поле ${key}`).not.toContain(`"${key}"`);
      }
      for (const [pattern, what] of forbiddenText) {
        expect(pattern.test(text), `${name}: похоже на ${what}`).toBe(false);
      }
    }
  });

  test('ZIP собирается, распаковывается и оба плана из него открываются', () => {
    const file = join(temp(), 'submission.zip');
    const result = packageDemo(file);

    // Literal list on purpose: comparing with DEMO_FILES would pass even if a
    // file were dropped from both the packer and the expectation.
    expect(result.entries.map((entry) => entry.name)).toEqual([
      'README.md',
      'before.json',
      'after.json',
      'recommendation.json',
      'effect.md',
    ]);
    expect(result.size).toBeGreaterThan(0);

    const unpacked = readZip(readFileSync(file));
    const sources = collectDemoFiles(DEMO_DIR);
    expect([...unpacked.keys()]).toEqual([
      'README.md',
      'before.json',
      'after.json',
      'recommendation.json',
      'effect.md',
    ]);
    for (const [name, content] of sources) {
      expect(unpacked.get(name)?.equals(content), `${name} распаковался иначе`).toBe(true);
    }

    // The point of the archive: what comes out of it opens in the editor.
    for (const name of ['before.json', 'after.json']) {
      const opened = readPlanFile(unpacked.get(name)!.toString('utf8'));
      expect(opened.ok, `${name} из архива не открылся`).toBe(true);
      if (opened.ok) expect(opened.value.plan.zones).toHaveLength(8);
    }
  });

  test('архив соответствует формату ZIP, а не только нашему читателю', () => {
    // Our writer and our reader share the same code, so a wrong checksum or a
    // wrong local header would agree with itself. Both are checked here against
    // the format: the published CRC-32 check value, and a second pass that
    // walks the local headers the way a streaming unzip tool does.
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);

    const file = join(temp(), 'format.zip');
    packageDemo(file);
    const archive = readFileSync(file);

    const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = archive.readUInt16LE(end + 10);
    expect(count).toBe(DEMO_FILES.length);

    let cursor = archive.readUInt32LE(end + 16);
    const walked = new Map<string, Buffer>();
    for (let index = 0; index < count; index += 1) {
      const nameLength = archive.readUInt16LE(cursor + 28);
      const local = archive.readUInt32LE(cursor + 42);
      const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);

      // The local header must repeat the central directory exactly: a tool that
      // reads the stream front to back sees only this copy.
      expect(archive.readUInt32LE(local), `${name}: подпись локального заголовка`).toBe(0x04034b50);
      expect(archive.readUInt16LE(local + 8), `${name}: метод сжатия`).toBe(
        archive.readUInt16LE(cursor + 10),
      );
      expect(archive.readUInt32LE(local + 14), `${name}: контрольная сумма`).toBe(
        archive.readUInt32LE(cursor + 16),
      );
      expect(archive.readUInt32LE(local + 18), `${name}: сжатый размер`).toBe(
        archive.readUInt32LE(cursor + 20),
      );
      expect(archive.readUInt32LE(local + 22), `${name}: исходный размер`).toBe(
        archive.readUInt32LE(cursor + 24),
      );

      const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const packed = archive.subarray(dataStart, dataStart + archive.readUInt32LE(local + 18));
      const content =
        archive.readUInt16LE(local + 8) === 0 ? Buffer.from(packed) : inflateRawSync(packed);
      expect(crc32(content), `${name}: сумма распакованных байтов`).toBe(
        archive.readUInt32LE(local + 14),
      );
      walked.set(name, content);
      cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
    }

    for (const [name, content] of collectDemoFiles(DEMO_DIR)) {
      expect(walked.get(name)?.equals(content), `${name}: собран не тот файл`).toBe(true);
    }
  });

  test('архив собирается побайтово одинаково', () => {
    const first = join(temp(), 'a.zip');
    const second = join(temp(), 'b.zip');
    packageDemo(first);
    packageDemo(second);
    expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
  });

  test('закоммиченный ZIP в output/ — это свежая сборка demo/, а не устаревшая копия', () => {
    const fresh = join(temp(), 'fresh.zip');
    packageDemo(fresh);
    const committed = readFileSync(join(process.cwd(), DEFAULT_OUTPUT));
    // Deflate output differs between zlib builds (Windows and Linux Node), so
    // the archives are compared by names and CRC-32 of the unpacked files.
    expect(
      entryChecksums(committed),
      `output/ отстал от demo/: выполните npm run package:demo и закоммитьте ${DEFAULT_OUTPUT}`,
    ).toEqual(entryChecksums(readFileSync(fresh)));
  });
});

/** Name → CRC-32 of the unpacked content, read from the central directory. */
function entryChecksums(archive: Buffer): Map<string, number> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entries = new Map<string, number>();
  let cursor = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index += 1) {
    const nameLength = archive.readUInt16LE(cursor + 28);
    entries.set(archive.toString('utf8', cursor + 46, cursor + 46 + nameLength), archive.readUInt32LE(cursor + 16));
    cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  return entries;
}

function run(
  plan: PlanDocument,
  request: Parameters<typeof calculateAdvice>[1],
): Recommendation[] {
  const result = calculateAdvice(plan, request);
  if (!result.ok) throw new Error(`Расчёт не выполнен: ${result.issues[0]?.code}`);
  return result.value;
}

function free(plan: PlanDocument): number {
  const measured = measurePlan(plan);
  if (!measured.ok) throw new Error('Площади не считаются');
  return measured.value.room.free_m2;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function value(metric: string): [number, number] {
  const row = recommendationFile.effect.find((entry) => entry.metric === metric);
  if (row === undefined) throw new Error(`Нет показателя ${metric}`);
  return [row.before, row.after];
}

/**
 * Reads the "было → стало" table of effect.md by the metric code in its second
 * column. Russian typography is normalised: a decimal comma and a true minus
 * sign are how the document reads, not how a number parses.
 */
function effectTable(markdown: string): Map<string, [number, number, number]> {
  const rows = new Map<string, [number, number, number]>();
  const pattern = /^\|[^|]+\|\s*`([a-z.]+)`\s*\|([^|]+)\|([^|]+)\|([^|]+)\|/gmu;
  for (const match of markdown.matchAll(pattern)) {
    const numbers = [match[2], match[3], match[4]].map((cell) => {
      const text = (cell ?? '').trim().replace(/−/g, '-').replace(',', '.').replace('+', '');
      const parsed = Number(text);
      if (!Number.isFinite(parsed)) throw new Error(`Не число в таблице эффекта: «${cell}»`);
      return parsed;
    });
    rows.set(match[1]!, [numbers[0]!, numbers[1]!, numbers[2]!]);
  }
  return rows;
}

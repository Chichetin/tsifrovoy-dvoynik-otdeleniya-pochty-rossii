/**
 * IO03: the "Открыть" button takes two formats, and tells them apart by the
 * shape of the file — not by its name or by a chooser the user has to get
 * right.
 *
 * The three inputs pinned here are the three the jury can produce: a plan we
 * wrote ourselves, the organizers' `example_plan.json` exactly as published,
 * and something that is neither.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CONTRACT_ISSUE_CODES } from '../contracts/model';
import { encodePlan } from './codec';
import { detectPlanFormat, droppedFields, readPlanFile } from './format';

function fixtureText(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8');
}

function exampleText(): string {
  return readFileSync(join(process.cwd(), 'example_plan.json'), 'utf8');
}

describe('detectPlanFormat', () => {
  test('наши фикстуры опознаются как наш формат', () => {
    for (const name of ['minimal.json', 'nested.json', 'rotated.json', 'collision.json']) {
      expect(detectPlanFormat(fixtureText(name))).toBe('ours');
    }
  });

  test('план будущей версии всё равно наш формат: отказ даёт кодек, а не определитель', () => {
    expect(detectPlanFormat(fixtureText('future-version.json'))).toBe('ours');
  });

  test('пример организаторов опознаётся по своим полям', () => {
    expect(detectPlanFormat(exampleText())).toBe('organizer');
  });

  test('чужой JSON, не-объект и мусор — неизвестный формат', () => {
    expect(detectPlanFormat('{"hello": "world"}')).toBe('unknown');
    expect(detectPlanFormat('[1, 2, 3]')).toBe('unknown');
    expect(detectPlanFormat('null')).toBe('unknown');
    expect(detectPlanFormat('не json вовсе')).toBe('unknown');
    expect(detectPlanFormat('')).toBe('unknown');
  });

  test('половина примера — ещё не пример: без ops или без zones формат неизвестен', () => {
    expect(detectPlanFormat('{"zones": [], "equipment": []}')).toBe('unknown');
    expect(detectPlanFormat('{"ops": {"id": "x"}, "equipment": []}')).toBe('unknown');
    expect(detectPlanFormat('{"ops": {"id": "x"}, "zones": [], "equipment": []}')).toBe('organizer');
  });

  test('файл без schemaVersion, но с помещением и объектами, — всё равно наш: отказ даёт кодек', () => {
    // Такой файл мог написать наш же экспорт до версионирования или собрать
    // руками проверяющий. Определитель не решает, годится ли он, — он только
    // выбирает, кому его отдать; отказ приходит от `decodePlan` с кодом схемы.
    const text = JSON.stringify({
      room: { id: 'room_main', boundary: [[0, 0], [4, 0], [4, 3], [0, 3]], ceilingHeight_m: 3 },
      objects: [],
    });
    expect(detectPlanFormat(text)).toBe('ours');

    const result = readPlanFile(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain(
      CONTRACT_ISSUE_CODES.SCHEMA_INVALID,
    );
  });

  test('наш формат проверяется раньше: файл с обоими наборами полей читается как наш', () => {
    expect(detectPlanFormat('{"schemaVersion": 1, "ops": {}, "zones": [], "equipment": []}')).toBe(
      'ours',
    );
  });
});

describe('readPlanFile', () => {
  test('наш файл открывается кодеком и помечен как наш формат', () => {
    const result = readPlanFile(fixtureText('nested.json'));
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join('; '));
    expect(result.value.format).toBe('ours');
    expect(result.value.assumptions).toEqual([]);
    expect(result.value.plan.zones.length).toBeGreaterThan(0);
  });

  test('поля вне формата названы при открытии, а не потеряны молча при сохранении', () => {
    const payload = JSON.parse(fixtureText('nested.json')) as Record<string, unknown>;
    payload.futureField = { a: 1 };
    (payload.objects as Record<string, unknown>[])[0]!.futureAttr = 5;
    (payload.zones as Record<string, unknown>[])[0]!.colorOverride = '#fff';
    // Атрибуты и extensions схема хранит целиком — они не «вне формата».
    ((payload.objects as Record<string, unknown>[])[0]!.attributes as Record<string, unknown>).custom = 'x';
    (payload.extensions as Record<string, unknown>).team = { note: 'ok' };
    const result = readPlanFile(JSON.stringify(payload));
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join('; '));
    const first = (payload.objects as { id: string }[])[0]!.id;
    const firstZone = (payload.zones as { id: string }[])[0]!.id;
    expect([...result.value.dropped].sort()).toEqual(
      ['futureField', `zones[${firstZone}].colorOverride`, `objects[${first}].futureAttr`].sort(),
    );
    // Сохранение и правда их не пишет.
    const encoded = encodePlan(result.value.plan);
    if (!encoded.ok) throw new Error('не закодировалось');
    expect(encoded.value).not.toContain('futureField');
    expect(encoded.value).toContain('custom');
    expect(encoded.value).toContain('"team"');
    // Чистый файл — пустой список.
    const clean = readPlanFile(fixtureText('nested.json'));
    expect(clean.ok && clean.value.dropped).toEqual([]);
    expect(droppedFields({ a: 1, b: [{ id: 'x', c: 2 }] }, { a: 1, b: [{ id: 'x' }] })).toEqual(['b[x].c']);
    // Ключи из цепочки прототипов — тоже «вне формата», а не «есть у любого объекта».
    expect(droppedFields({ toString: 1, constructor: 2 }, {})).toEqual(['toString', 'constructor']);
  });

  test('пример организаторов открывается импортёром, с допущениями для подписи', () => {
    const result = readPlanFile(exampleText());
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.code).join('; '));
    expect(result.value.format).toBe('organizer');
    expect(result.value.plan.zones.map((zone) => zone.id)).toContain('z_client');
    expect(result.value.plan.objects.map((object) => object.id)).toContain('eq_kiosk');
    // Допущения приходят из extensions импортёра (D-027), а не сочиняются здесь.
    expect(result.value.assumptions.length).toBeGreaterThan(0);
    expect(result.value.assumptions.join(' ')).toContain('допущение команды');
  });

  test('импортированный пример сохраняется нашим кодеком без правок', () => {
    const result = readPlanFile(exampleText());
    if (!result.ok) throw new Error('пример не открылся');
    const encoded = encodePlan(result.value.plan);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    // И читается обратно уже как наш формат — то, что увидит проверяющий после «Экспорт → JSON».
    expect(detectPlanFormat(encoded.value)).toBe('ours');
  });

  test('неизвестная структура отклоняется с объяснением обоих форматов', () => {
    const result = readPlanFile('{"hello": "world"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe(CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE);
    expect(result.issues[0]?.message).toContain('example_plan.json');
  });

  test('битый JSON объясняется ошибкой разбора кодека', () => {
    const result = readPlanFile('{"schemaVersion": 1, "zones": [');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe(CONTRACT_ISSUE_CODES.DOCUMENT_UNREADABLE);
    expect(result.issues[0]?.message).toContain('JSON');
  });

  test('наш файл с ошибкой схемы отклоняется кодеком, а не подсовывается импортёру', () => {
    const result = readPlanFile('{"schemaVersion": 1, "zones": []}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain(CONTRACT_ISSUE_CODES.SCHEMA_INVALID);
  });

  test('пример с проёмом вне стены отклоняется импортёром, а не открывается наполовину', () => {
    const broken = JSON.parse(exampleText()) as Record<string, unknown>;
    broken.doors = [{ id: 'd_air', wall: [100, 100, 101, 100], type: 'entrance', width_m: 1 }];
    const result = readPlanFile(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain('OPENING_WITHOUT_WALL');
  });
});

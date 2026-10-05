/**
 * Демо-планы, которые сервис раздаёт по своему адресу (`public/demo/*.json` →
 * `dist/demo/*.json`), — побайтовые копии тех, что лежат в `demo/` и попадают в
 * ZIP сдачи.
 *
 * Копия нужна потому, что в образ уезжает только собранный `dist`, а каталога
 * `demo/` там нет. Копия же тем и опасна, что расходится молча: `demo/*.json`
 * пересобирает генератор (`demo/build.ts`, сверяет `tests/demo.test.ts`), и
 * забытая синхронизация дала бы проверяющему один план по ссылке и другой в
 * архиве. Этот тест и есть защита от расхождения.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function bytes(path: string): Buffer {
  return readFileSync(join(ROOT, path));
}

describe('демо-планы, раздаваемые сервисом', () => {
  for (const name of ['before.json', 'after.json']) {
    it(`public/demo/${name} совпадает с demo/${name} побайтово`, () => {
      expect(bytes(`public/demo/${name}`).equals(bytes(`demo/${name}`))).toBe(true);
    });
  }

  it('раздаваемый план разбирается как план: зоны, объекты и справочник на месте', () => {
    const plan = JSON.parse(bytes('public/demo/before.json').toString('utf8')) as {
      zones: unknown[];
      objects: unknown[];
      catalog: { objectTypes: unknown[] };
    };
    expect(plan.zones.length).toBeGreaterThan(0);
    expect(plan.objects.length).toBeGreaterThan(0);
    expect(plan.catalog.objectTypes.length).toBeGreaterThan(0);
  });
});

/**
 * Порядок зон в таблице «Площади» с учётом вложенности.
 *
 * Список остаётся вертикальным и плоским — это по-прежнему таблица, которую
 * читают сверху вниз и в которой ищут глазами нужную строку. Меняется только
 * порядок строк и отступ: вложенная зона идёт сразу под своим родителем, а не
 * там, где она случайно оказалась в файле. Иначе примечание под таблицей
 * («вложенная зона входит в площадь родителя») не на что опереть: из плоского
 * списка не видно, какая зона в какую входит, и сумма колонки «Всего»
 * выглядит ошибкой расчёта, а не двойным счётом.
 *
 * Чистая функция: ни DOM, ни React, ни каталога — только `id`/`parentId`.
 */

import type { Id, Zone } from '../../contracts/model';

export type ZoneRow = {
  zone: Zone;
  /** 0 — зона верхнего уровня; каждый шаг вложенности прибавляет единицу. */
  depth: number;
};

/**
 * Зоны в порядке обхода дерева: родитель, за ним его дети, и так вглубь.
 * Порядок соседей — тот же, что в плане: пользователь уже видел его в других
 * местах интерфейса, и менять его без причины значит путать.
 *
 * Зона считается верхнеуровневой, если `parentId` пуст, указывает на зону не
 * из этого списка или замыкает цикл. Цикл в данных — это дефект, но таблица
 * площадей не то место, где о нём сообщают: она обязана показать все зоны,
 * ни одну не потеряв и не зациклившись. О самом дефекте говорит «Проверка».
 */
export function orderZonesByNesting(zones: readonly Zone[]): ZoneRow[] {
  const byParent = new Map<Id | null, Zone[]>();
  const present = new Set(zones.map((zone) => zone.id));

  for (const zone of zones) {
    const parent = zone.parentId !== undefined && zone.parentId !== null && present.has(zone.parentId)
      ? zone.parentId
      : null;
    // Зона, назначенная родителем самой себе, — тот же цикл длиной один.
    const key = parent === zone.id ? null : parent;
    const siblings = byParent.get(key);
    if (siblings === undefined) byParent.set(key, [zone]);
    else siblings.push(zone);
  }

  const rows: ZoneRow[] = [];
  const visited = new Set<Id>();

  const walk = (parent: Id | null, depth: number): void => {
    for (const zone of byParent.get(parent) ?? []) {
      // Страховка от цикла: зона, уже попавшая в таблицу, второй раз не идёт.
      if (visited.has(zone.id)) continue;
      visited.add(zone.id);
      rows.push({ zone, depth });
      walk(zone.id, depth + 1);
    }
  };

  walk(null, 0);

  // Зоны, оставшиеся в цикле (A внутри B, B внутри A), не имеют корня, с
  // которого начался бы обход: показываем их верхним уровнем в исходном
  // порядке, чтобы ни одна строка не пропала.
  for (const zone of zones) {
    if (visited.has(zone.id)) continue;
    visited.add(zone.id);
    rows.push({ zone, depth: 0 });
  }

  return rows;
}

/**
 * Стиль названия зоны по уровню вложенности (D-250, D-279).
 *
 * По названию видно, какая зона общая, а какая вложена в неё: имя зоны
 * верхнего уровня — самое яркое (фирменный синий, полужирное), вложенной —
 * приглушённое серое, вложенной во вложенную и глубже — ещё тише (светлее и
 * тоньше). Непрозрачность у всех уровней одна — 0,55 (D-237), её держит
 * `ZoneNameLayer`. «Клиентский зал» → «Зона ожидания» →
 * «Очередь» читаются как «общее → уточнение → уточнение уточнения», без
 * открытия свойств. Контраст подписи на любом полу из
 * `data/catalog/zone-types.json` (пол с непрозрачностью 0,75 поверх белого,
 * подпись 0,55 поверх пола, WCAG 2.1): корень 2,58–2,67, вложенная
 * 2,55–2,62, глубже 2,00–2,07 — ниже, чем у D-250 (2,98–3,20): прежнюю
 * прозрачность вернули по решению участника. Красный не берём — он занят
 * находками проверки.
 *
 * Это стиль интерфейса, а не справочник: он не зависит от типа зоны и не
 * настраивается данными.
 */

export type ZoneNameStyle = {
  fill: string;
  fontStyle: string;
};

export const ZONE_NAME_STYLES: readonly ZoneNameStyle[] = [
  { fill: '#0055A6', fontStyle: 'bold' },
  { fill: '#495057', fontStyle: '500' },
  { fill: '#6C757D', fontStyle: 'normal' },
];

export const ZONE_NAME_FILLS = ZONE_NAME_STYLES.map((style) => style.fill);

/**
 * `depth` — результат `zoneDepth`: 0 — корень, null — цикл в `parentId`
 * (красим как корень). «Висячий» `parentId` — ссылка на зону, которой в плане
 * нет, — цикла не образует: `zoneDepth` даёт для неё 1, и зона красится как
 * вложенная. Так и задумано: родитель в документе объявлен, потерялся он или
 * скрыт — подпись честно показывает объявленный уровень, а не корень.
 */
export function zoneNameStyle(depth: number | null): ZoneNameStyle {
  const root = ZONE_NAME_STYLES[0] as ZoneNameStyle;
  if (depth === null || depth <= 0) return root;
  return ZONE_NAME_STYLES[Math.min(depth, ZONE_NAME_STYLES.length - 1)] ?? root;
}

export function zoneNameFill(depth: number | null): string {
  return zoneNameStyle(depth).fill;
}

/**
 * U07: арифметика правок над выбранным набором объектов — без React, Konva и
 * пикселей, как и `transform.ts` рядом.
 *
 * Все функции принимают набор (`readonly Equipment[]`), а не один объект:
 * сегодня в наборе одна позиция — выбор в сессии пока одиночный
 * (`EditorSession.selection: Ref | null`), — но сдвиг стрелками, копирование и
 * попадание в рамку считаются одинаково для любого числа объектов, и когда
 * выбор станет набором, менять придётся только вызовы.
 *
 * Соглашения — D-010: метры, X вправо, Y вверх, `position` — центр. Отражение
 * Y живёт в `src/domain/geometry`, здесь его нет.
 */

import type { Equipment, Id, Point, Polygon } from '../../contracts/model';
import { footprint, intersects } from '../../domain/geometry';
import { snapPosition } from './transform';

/**
 * Шаг сдвига стрелкой и мелкий шаг с Shift. Шаг постоянный, а не «текущий шаг
 * сетки»: сетка меняется с зумом, и одна и та же клавиша двигала бы объект то
 * на 1 м, то на 5 м — повторить правку и проверить её числом стало бы нельзя.
 */
export const NUDGE_STEP_M = 0.5;
export const NUDGE_FINE_STEP_M = 0.05;

/**
 * Смещение вставленной копии от оригинала: вправо и вниз по экрану (Y в модели
 * вверх, поэтому по Y со знаком минус). Копия обязана быть видна отдельно от
 * оригинала, иначе «вставил» выглядит как «ничего не произошло».
 */
export const PASTE_OFFSET_M: Point = [0.5, -0.5];

/** Направление стрелки в метрах мира; не стрелка — `null`. */
export function arrowDelta(key: string, fine: boolean): Point | null {
  const step = fine ? NUDGE_FINE_STEP_M : NUDGE_STEP_M;
  switch (key) {
    case 'ArrowUp':
      return [0, step];
    case 'ArrowDown':
      return [0, -step];
    case 'ArrowLeft':
      return [-step, 0];
    case 'ArrowRight':
      return [step, 0];
    default:
      return null;
  }
}

/**
 * Набор, сдвинутый на `delta`. Позиции округляются до сантиметра тем же
 * `snapPosition`, что и перетаскивание мышью, — файл остаётся читаемым, а
 * сдвиг стрелкой и сдвиг мышью дают одинаковые числа.
 */
export function moveObjects(objects: readonly Equipment[], delta: Point): Equipment[] {
  return objects.map((object) => ({
    ...object,
    position: snapPosition([object.position[0] + delta[0], object.position[1] + delta[1]]),
  }));
}

/**
 * Первый свободный `eq_<n>`. `taken` — это и то, что на плане, и то, что
 * удалено в этой сессии (`PlanStore.retired`, D-156): повторно занятый id
 * команда отклонит с `ID_REUSED`.
 */
export function nextObjectId(taken: ReadonlySet<Id>): Id {
  for (let index = 1; ; index += 1) {
    const candidate = `eq_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Копии набора со свежими id и смещением `PASTE_OFFSET_M × step`.
 *
 * `step` — номер вставки подряд из одного буфера: вторая вставка уходит вдвое
 * дальше, иначе две копии легли бы одна на другую. `zoneId` копия не наследует
 * — зону пересчитает `object.put` (`withRelations`), и копия, уехавшая в
 * соседнюю зону, числится там, где лежит.
 */
export function pasteObjects(
  source: readonly Equipment[],
  taken: ReadonlySet<Id>,
  step = 1,
): Equipment[] {
  const used = new Set<Id>(taken);
  const [dx, dy] = PASTE_OFFSET_M;
  return source.map((object) => {
    const id = nextObjectId(used);
    used.add(id);
    return {
      ...object,
      id,
      position: snapPosition([object.position[0] + dx * step, object.position[1] + dy * step]),
      zoneId: null,
    };
  });
}

/**
 * Прямоугольник рамки выделения как полигон мира. Точки приходят в том
 * порядке, в каком их дал указатель, поэтому углы нормализуются: рамка,
 * протянутая справа налево, — та же рамка.
 */
export function marqueeRect(from: Point, to: Point): Polygon {
  const minX = Math.min(from[0], to[0]);
  const maxX = Math.max(from[0], to[0]);
  const minY = Math.min(from[1], to[1]);
  const maxY = Math.max(from[1], to[1]);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/** Рамка меньше этого по обеим сторонам — это клик, а не протягивание. */
export const MARQUEE_MIN_SIDE_M = 0.05;

/**
 * Объекты, попавшие в рамку: достаточно касания следа объекта, целиком
 * накрывать не требуется. Проектировщик обводит ряд стеллажей размашисто, и
 * «не захватил на два сантиметра» — это потерянное действие, а не точность.
 *
 * Поворот учитывается: сравнивается след (`footprint`), а не габарит.
 * Вырожденная рамка (клик без протягивания) не выделяет ничего — выбор по
 * клику остаётся делом самого объекта.
 */
export function marqueeHits(objects: readonly Equipment[], from: Point, to: Point): Id[] {
  if (
    Math.abs(from[0] - to[0]) < MARQUEE_MIN_SIDE_M &&
    Math.abs(from[1] - to[1]) < MARQUEE_MIN_SIDE_M
  ) {
    return [];
  }

  const rect = marqueeRect(from, to);
  // `intersects` — это положительная площадь пересечения: вложенность в любую
  // сторону она уже покрывает, отдельная проверка «целиком внутри» не нужна.
  return objects
    .filter((object) => intersects(rect, footprint(object)))
    .map((object) => object.id);
}

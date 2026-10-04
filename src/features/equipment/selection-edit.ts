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
import { nextFreeId } from '../../domain/commands';
import { boundingBox, footprint, intersects, normalizeAngle } from '../../domain/geometry';
import { ROTATION_SNAP_DEG, snapPosition } from './transform';

/**
 * Ключ атрибута «инвентарный номер» — тот же, что в
 * `data/catalog/object-types.json` и `INVENTORY_NUMBER_KEY`
 * (`src/features/inventory/rows.ts`). Импортировать оттуда нельзя: соседние
 * features не берут файлы друг у друга (`no-restricted-imports`,
 * `docs/project-structure.md`), поэтому строка продублирована здесь —
 * единственное место в этом файле, где она нужна.
 */
const INVENTORY_NUMBER_KEY = 'inventoryNumber';

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
 * `R` поворачивает выделенное на `ROTATION_SNAP_DEG` по часовой, `Shift+R` —
 * против. Шаг — тот же, что уже даёт `Shift` при поворотах указателем
 * (`ROTATION_SNAP_DEG` в `transform.ts`, D-235): одна клавиша не должна учить
 * пользователя второму числу для того же жеста. Не `R` — `null`.
 */
export function rotateDelta(code: string, shift: boolean): number | null {
  if (code !== 'KeyR') return null;
  return shift ? -ROTATION_SNAP_DEG : ROTATION_SNAP_DEG;
}

/** Набор, повёрнутый на `deltaDeg`; остальные поля не трогаются. */
export function rotateObjects(objects: readonly Equipment[], deltaDeg: number): Equipment[] {
  return objects.map((object) => ({
    ...object,
    // `|| 0` убирает «-0», как и в transform.ts: карточка не должна печатать
    // минус там, где угол на самом деле нулевой.
    rotation_deg: normalizeAngle(object.rotation_deg + deltaDeg) || 0,
  }));
}

/** Объекты — `eq_<n>`; правило выдачи одно на весь план (`nextFreeId`, D-198). */
export function nextObjectId(taken: Set<Id>): Id {
  return nextFreeId('eq_', taken);
}

/**
 * Копии набора со свежими id и смещением `PASTE_OFFSET_M × step`.
 *
 * `step` — номер вставки подряд из одного буфера: вторая вставка уходит вдвое
 * дальше, иначе две копии легли бы одна на другую. `zoneId` копия не наследует
 * — зону пересчитает `object.put` (`withRelations`), и копия, уехавшая в
 * соседнюю зону, числится там, где лежит.
 *
 * `inventoryNumber` копия не наследует — ни при вставке, ни при `Ctrl+D`:
 * это ярлык физического предмета, а копия — другой предмет, и одинаковый
 * номер у двух объектов проверка считает дублем. Номер пуст, а не «следующий
 * свободный»: копия — «такой же предмет» на время расстановки, реестровый номер
 * ей даёт человек (D-266, D-311); пустой номер «Проверка» показывает находкой
 * (D-312). Следующий номер серии получает только постановка из библиотеки (D-310).
 */
export function pasteObjects(
  source: readonly Equipment[],
  taken: ReadonlySet<Id>,
  step = 1,
): Equipment[] {
  const [dx, dy] = copyOffset(source);
  return copyObjects(source, taken, [dx * step, dy * step]);
}

/** Зазор между набором и его копией по X, когда сдвига `PASTE_OFFSET_M` не хватает. */
const COPY_GAP_M = 0.1;

/**
 * Смещение копии набора: `PASTE_OFFSET_M`, а если набор больше этого сдвига и
 * по X, и по Y, — по X на его ширину плюс зазор. Копия кассового окна
 * (1,6 × 0,9 м), сдвинутая на 0,5 м, легла бы на оригинал, и физика отказала
 * бы в правке (#89). Малый или тонкий набор остаётся при прежнем сдвиге.
 */
export function copyOffset(source: readonly Equipment[]): Point {
  if (source.length === 0) return PASTE_OFFSET_M;
  const boxes = source.map((object) => boundingBox(footprint(object)));
  const width = Math.max(...boxes.map((box) => box.maxX)) - Math.min(...boxes.map((box) => box.minX));
  const depth = Math.max(...boxes.map((box) => box.maxY)) - Math.min(...boxes.map((box) => box.minY));
  const overlaps = width > PASTE_OFFSET_M[0] && depth > Math.abs(PASTE_OFFSET_M[1]);
  return overlaps ? [width + COPY_GAP_M, PASTE_OFFSET_M[1]] : PASTE_OFFSET_M;
}

function copyObjects(source: readonly Equipment[], taken: ReadonlySet<Id>, [dx, dy]: Point): Equipment[] {
  const used = new Set<Id>(taken);
  return source.map((object) => {
    const id = nextObjectId(used);
    // Only clear a number the source has: a catalog type without the
    // attribute must not gain it on the copy.
    const attributes =
      INVENTORY_NUMBER_KEY in object.attributes
        ? { ...object.attributes, [INVENTORY_NUMBER_KEY]: null }
        : { ...object.attributes };
    return {
      ...object,
      ...(object.locked === true ? { locked: false } : {}),
      id,
      position: snapPosition([object.position[0] + dx, object.position[1] + dy]),
      zoneId: null,
      attributes,
    };
  });
}

/**
 * Копии набора для `Ctrl+D` — своя команда, не второе имя для `Ctrl+C`/
 * `Ctrl+V`: без буфера, всегда от текущего выделения. Смещение по умолчанию —
 * `copyOffset`; после сдвига копии вызывающий передаёт `repeatOffset`, и
 * ряд стульев набирается повторными нажатиями. `inventoryNumber` у копии
 * пуст, как и при вставке (D-243, D-266).
 */
export function duplicateObjects(
  source: readonly Equipment[],
  taken: ReadonlySet<Id>,
  offset: Point = copyOffset(source),
): Equipment[] {
  return copyObjects(source, taken, offset);
}

/**
 * Смещение следующей копии при повторном `Ctrl+D`: копию сдвинули от
 * оригинала — новая встаёт от неё на столько же. Копию вернули на оригинал:
 * нулевое смещение положило бы третий предмет на те же места, поэтому снова
 * `PASTE_OFFSET_M`.
 */
export function repeatOffset(source: Point, copy: Point): Point {
  const dx = copy[0] - source[0];
  const dy = copy[1] - source[1];
  return Math.hypot(dx, dy) < NUDGE_FINE_STEP_M / 2 ? PASTE_OFFSET_M : [dx, dy];
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

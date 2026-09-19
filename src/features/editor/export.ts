/**
 * U02: «Картинка PNG» — выгрузка плана для согласования и презентации (D-061,
 * D-136). Не формат хранения: из картинки план обратно не открывается.
 *
 * Здесь только то, что можно посчитать без браузера: какой прямоугольник
 * холста выгружать и с каким разрешением, как назвать файл, что подписать над
 * планом. Отрисовка и скачивание — в `export-image.ts`.
 *
 * Правило, ради которого модуль существует: выгружается весь план, а не тот
 * кусок, который пользователь сейчас разглядывает. Рамка строится по охвату
 * документа в мировых координатах и переводится в координаты холста текущего
 * вида — Konva рисует и то, что за краем экрана.
 */

import type { Id, LayerType, PlanDocument, Polygon, Viewport } from '../../contracts/model';
import { findLayerType } from '../../domain/catalog';
import { boundingBox, modelToScreen } from '../../domain/geometry';

/** Поля вокруг плана на картинке, в метрах: стена не должна касаться края. */
export const EXPORT_MARGIN_M = 0.5;

/** Разрешение не ниже двукратного экранного — текст и линии остаются чёткими. */
export const EXPORT_MIN_PIXEL_RATIO = 2;

/** Сколько пикселей картинки приходится на метр плана, если экран мельче. */
export const EXPORT_TARGET_PX_PER_M = 120;

/** Длинная сторона картинки: больше браузеры не рисуют надёжно. */
export const EXPORT_MAX_SIDE_PX = 8000;

const FILE_NAME_LIMIT = 80;
const FALLBACK_FILE_NAME = 'plan.png';
const FALLBACK_TITLE = 'План без названия';

/** Прямоугольник холста (px текущего вида) и множитель разрешения для Konva. */
export type ExportFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
};

export type ExportHeader = { title: string; notes: string[] };

/**
 * Рамка выгрузки по мировому охвату плана. `null` — выгружать нечего.
 *
 * Разрешение: не меньше двукратного и не меньше целевого числа пикселей на
 * метр, но длинная сторона не больше предела браузера — на сильном приближении
 * предел важнее двукратности.
 */
export function exportFrame(extent: Polygon, viewport: Viewport): ExportFrame | null {
  if (extent.length === 0) return null;

  const box = boundingBox(extent);
  // Экран: Y вниз, поэтому верхний левый угол — это (minX, maxY) мира.
  const [left, top] = modelToScreen(
    [box.minX - EXPORT_MARGIN_M, box.maxY + EXPORT_MARGIN_M],
    viewport,
  );
  const [right, bottom] = modelToScreen(
    [box.maxX + EXPORT_MARGIN_M, box.minY - EXPORT_MARGIN_M],
    viewport,
  );

  const x = Math.floor(left);
  const y = Math.floor(top);
  const width = Math.ceil(right) - x;
  const height = Math.ceil(bottom) - y;
  if (width <= 0 || height <= 0) return null;

  const wanted = Math.max(EXPORT_MIN_PIXEL_RATIO, EXPORT_TARGET_PX_PER_M / viewport.scale);
  const limit = EXPORT_MAX_SIDE_PX / Math.max(width, height);
  return { x, y, width, height, pixelRatio: Math.min(wanted, limit) };
}

/**
 * Имя файла из названия плана: буквы и цифры любых алфавитов остаются, всё
 * остальное — дефис. Пустое название — `plan.png`.
 */
export function exportFileName(planName: string): string {
  const cleaned = planName
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .slice(0, FILE_NAME_LIMIT)
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? FALLBACK_FILE_NAME : `${cleaned}.png`;
}

/**
 * Подпись над планом: название и по строке на каждый видимый информационный
 * слой. Подпись на самом холсте живёт в углу экрана и в рамку выгрузки может
 * не попасть — поэтому картинка несёт свою, того же вида.
 */
export function exportHeader(plan: PlanDocument): ExportHeader {
  const title = plan.name.trim() === '' ? FALLBACK_TITLE : plan.name.trim();
  const notes = plan.layers
    .filter((layer) => layer.visible)
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((layer): { id: Id; type: LayerType }[] => {
      const type = findLayerType(plan.catalog, layer.typeId ?? null);
      return type === null || type.representation.kind === 'objects'
        ? []
        : [{ id: layer.id, type }];
    })
    .map(({ type }) => `${type.label}: числа синтетические`);
  return { title, notes };
}

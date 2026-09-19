/**
 * U02: отрисовка рамки выгрузки в PNG и скачивание. Браузерная часть
 * «Картинки PNG»; что и с каким разрешением рисовать, решает `export.ts`.
 *
 * Konva сам рисует прямоугольник холста в отдельный canvas — и то, что за
 * краем экрана, тоже. Вид пользователя при этом не трогается: ни масштаб, ни
 * положение Stage не меняются. Служебные слои (сетка, кольцо «вот оно»)
 * прячутся на время одного синхронного снимка и возвращаются до следующего
 * кадра, так что на экране их исчезновения не видно.
 */

import type Konva from 'konva';
import type { ExportFrame, ExportHeader } from './export';

const BACKGROUND = '#FFFFFF';
const TITLE_FILL = '#212529';
const NOTE_FILL = '#495057';
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Размеры подписи в пикселях экрана; на картинке умножаются на pixelRatio. */
const HEADER_PADDING = 12;
const TITLE_SIZE = 15;
const NOTE_SIZE = 12;
const LINE_GAP = 5;

function headerHeight(header: ExportHeader): number {
  const notes = header.notes.length * (NOTE_SIZE + LINE_GAP);
  return HEADER_PADDING * 2 + TITLE_SIZE + notes;
}

/** Снимок рамки холста без служебных слоёв. Синхронно: между hide и show кадра нет. */
function snapshot(stage: Konva.Stage, frame: ExportFrame, hidden: Konva.Node[]): HTMLCanvasElement {
  const wasVisible = hidden.map((node) => node.visible());
  hidden.forEach((node) => node.visible(false));
  try {
    return stage.toCanvas({
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      pixelRatio: frame.pixelRatio,
    });
  } finally {
    hidden.forEach((node, index) => node.visible(wasVisible[index] ?? true));
  }
}

/**
 * PNG: белый фон, подпись сверху, под ней план. Ошибка не глотается — промис
 * отклоняется с понятным сообщением, и холст показывает его пользователю.
 */
export function renderPlanPng(
  stage: Konva.Stage,
  frame: ExportFrame,
  header: ExportHeader,
  hidden: Konva.Node[],
): Promise<Blob> {
  const plan = snapshot(stage, frame, hidden);
  const ratio = frame.pixelRatio;
  const top = Math.ceil(headerHeight(header) * ratio);

  const output = document.createElement('canvas');
  output.width = plan.width;
  output.height = plan.height + top;
  const context = output.getContext('2d');
  if (context === null || output.width === 0 || output.height === 0) {
    return Promise.reject(new Error('браузер не дал холст для картинки такого размера'));
  }

  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, output.width, output.height);

  context.textBaseline = 'top';
  context.fillStyle = TITLE_FILL;
  context.font = `600 ${TITLE_SIZE * ratio}px ${FONT_FAMILY}`;
  context.fillText(header.title, HEADER_PADDING * ratio, HEADER_PADDING * ratio);

  context.fillStyle = NOTE_FILL;
  context.font = `${NOTE_SIZE * ratio}px ${FONT_FAMILY}`;
  header.notes.forEach((note, index) => {
    const y = HEADER_PADDING + TITLE_SIZE + LINE_GAP + index * (NOTE_SIZE + LINE_GAP);
    context.fillText(note, HEADER_PADDING * ratio, y * ratio);
  });

  context.drawImage(plan, 0, top);

  return new Promise((resolve, reject) => {
    output.toBlob((blob) => {
      if (blob === null) reject(new Error('браузер не смог собрать PNG'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** Отдаёт файл браузеру через временную ссылку. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Ссылку освобождаем после того, как браузер начал скачивание.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

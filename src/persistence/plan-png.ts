/**
 * PNG-картинка плана для меню «Экспорт» (D-248).
 *
 * Рисовальщик один — `renderPlanSvg` (D-061): PNG не второй движок, а тот же
 * SVG, прогнанный через `<canvas>` (`Image` → `drawImage` → `toBlob`), без
 * новых зависимостей. Тот же документ даёт тот же SVG и, значит, ту же
 * картинку; скрытые слои, повороты и цвета берутся из одного источника.
 *
 * Растеризация зависит от браузера (`<canvas>`, декодирование `Image`), и
 * если он откажет — это не молчаливый пустой файл, а явная причина, которую
 * покажет вызывающий код (см. «Каждое действие пользователя имеет состояния…»
 * в CLAUDE.md).
 */

import type { PlanDocument } from '../contracts/model';
import { planFileName, renderPlanSvg } from './plan-svg';

/** Ширина и высота в пикселях — из атрибутов `<svg>`, которые пишет `renderPlanSvg`. */
function svgPixelSize(svg: string): { width: number; height: number } | null {
  const width = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg);
  const height = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
  if (width?.[1] === undefined || height?.[1] === undefined) return null;
  return { width: Number(width[1]), height: Number(height[1]) };
}

/** Растеризует текущий документ в PNG. Отказ — это отклонённый промис с причиной для человека. */
export function renderPlanPng(plan: PlanDocument): Promise<Blob> {
  const svg = renderPlanSvg(plan);
  const size = svgPixelSize(svg);
  if (size === null) {
    return Promise.reject(new Error('Не удалось определить размер картинки плана.'));
  }

  return new Promise((resolve, reject) => {
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.width));
    canvas.height = Math.max(1, Math.round(size.height));
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      reject(new Error('Растровый холст недоступен в этом браузере.'));
      return;
    }

    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = (): void => {
      URL.revokeObjectURL(svgUrl);
      // Белая подложка: SVG не красит фон, а PNG без альфы иначе даёт чёрный.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('Картинка не собралась: холст вернул пустой файл.'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    };
    image.onerror = (): void => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('Картинка не прочиталась браузером для растеризации.'));
    };
    image.src = svgUrl;
  });
}

/** Имя файла картинки — как у файла плана, но `.png`. */
export function pngFileName(plan: PlanDocument): string {
  return planFileName(plan, 'png');
}

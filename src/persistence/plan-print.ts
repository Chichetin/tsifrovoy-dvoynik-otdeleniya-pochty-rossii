/**
 * Печать плана в масштабе: страница из SVG плана, легенды, линейки и штампа.
 *
 * Расчёт размера — чистые функции: `printLayout` говорит, помещается ли план
 * на лист и сколько миллиметров занимает метр. Картинка — тот же
 * `renderPlanSvg`, что у экспорта; здесь меняются только `width` и `height`
 * корня: 1 м плана = 1000 / знаменатель мм на бумаге. Скрытые слои в SVG
 * уже не рисуются, в легенду они тоже не попадают.
 */

import type { PlanDocument } from '../contracts/model';
import { findZoneType } from '../domain/catalog';
import { renderPlanSvg } from './plan-svg';

export type PaperFormat = 'A4' | 'A3';
export type Orientation = 'portrait' | 'landscape';
export type PrintScale = 50 | 100 | 'fit';

const SHEET_MM: Record<PaperFormat, readonly [number, number]> = { A4: [210, 297], A3: [297, 420] };
/** Margin on every side, mm. */
export const PRINT_MARGIN_MM = 10;
/** Strip under the drawing: legend, ruler and stamp, mm. */
export const PRINT_FOOTER_MM = 36;

export type PrintLayout = {
  /** Printable drawing area (sheet minus margins and footer), mm. */
  areaMm: readonly [number, number];
  /** Size of the plan picture on paper, mm. */
  drawingMm: readonly [number, number];
  mmPerM: number;
  /** Denominator of the real scale: 100 means 1:100. */
  denominator: number;
  fits: boolean;
};

export function sheetMm(format: PaperFormat, orientation: Orientation): readonly [number, number] {
  const [short, long] = SHEET_MM[format];
  return orientation === 'portrait' ? [short, long] : [long, short];
}

/** Does a plan of `extentM` (width, height, metres) fit the sheet, and how big is it in mm. */
export function printLayout(
  extentM: readonly [number, number],
  format: PaperFormat,
  orientation: Orientation,
  scale: PrintScale,
): PrintLayout {
  const [sheetW, sheetH] = sheetMm(format, orientation);
  const areaMm: [number, number] = [sheetW - PRINT_MARGIN_MM * 2, sheetH - PRINT_MARGIN_MM * 2 - PRINT_FOOTER_MM];
  const fitMmPerM = Math.min(areaMm[0] / extentM[0], areaMm[1] / extentM[1]);
  const mmPerM = scale === 'fit' ? fitMmPerM : 1000 / scale;
  const drawingMm: [number, number] = [extentM[0] * mmPerM, extentM[1] * mmPerM];
  // 0.01 mm of slack: floating point must not turn an exact fit into a refusal.
  const fits = drawingMm[0] <= areaMm[0] + 0.01 && drawingMm[1] <= areaMm[1] + 0.01;
  return { areaMm, drawingMm, mmPerM, denominator: Math.round(1000 / mmPerM), fits };
}

/** Round length for the scale bar: 1, 2, 5, 10, 20 ... metres, at most `maxMm` on paper. */
export function rulerLengthM(mmPerM: number, maxMm: number): number {
  const limit = maxMm / mmPerM;
  let best = 0.5;
  for (let power = 0.1; power <= 1000; power *= 10) {
    for (const step of [1, 2, 5]) {
      if (step * power <= limit) best = step * power;
    }
  }
  return best;
}

/** Plan size in metres from the viewBox of `renderPlanSvg` output. */
export function svgExtentM(svg: string): readonly [number, number] {
  const match = /viewBox="[-\d.e]+ [-\d.e]+ ([\d.e]+) ([\d.e]+)"/.exec(svg);
  return match === null ? [1, 1] : [Number(match[1]), Number(match[2])];
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function metres(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

export type PrintOptions = { format: PaperFormat; orientation: Orientation; scale: PrintScale; date: Date };

/** A full HTML page for the browser print dialog; `null` when the plan does not fit the sheet. */
export function renderPrintPage(plan: PlanDocument, options: PrintOptions): string | null {
  const svg = renderPlanSvg(plan);
  const layout = printLayout(svgExtentM(svg), options.format, options.orientation, options.scale);
  if (!layout.fits) return null;
  const [w, h] = layout.drawingMm;
  const picture = svg
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/<svg ([^>]*?)width="[^"]*" height="[^"]*"/, `<svg $1width="${w.toFixed(2)}mm" height="${h.toFixed(2)}mm"`);

  const visibleLayers = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const layerRows = plan.layers
    .filter((layer) => layer.visible)
    .map((layer) => {
      const type = layer.typeId === null ? undefined : plan.catalog.layerTypes.find((t) => t.id === layer.typeId);
      return `<li>${esc(layer.name)}${type === undefined ? '' : ` (информационный слой, на плане не рисуется). ${esc(type.note)}`}</li>`;
    })
    .join('');
  const zoneTypeIds = new Set(plan.zones.filter((zone) => visibleLayers.has(zone.layerId)).map((zone) => zone.typeId));
  const zoneRows = [...zoneTypeIds]
    .map((id) => findZoneType(plan.catalog, id))
    .filter((type) => type !== null)
    .map((type) => `<li><i style="background:${esc(type.color)}"></i>${esc(type.label)}</li>`)
    .join('');

  const rulerM = rulerLengthM(layout.mmPerM, layout.areaMm[0] / 3);
  const rulerMm = rulerM * layout.mmPerM;
  const scaleText = options.scale === 'fit' ? `≈1:${layout.denominator} (вписано в лист)` : `1:${options.scale}`;
  const date = options.date.toLocaleDateString('ru-RU');
  const orientation = options.orientation === 'portrait' ? 'portrait' : 'landscape';
  const [areaW, areaH] = layout.areaMm;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${esc(plan.name)} — печать</title>
<style>
@page { size: ${options.format} ${orientation}; margin: ${PRINT_MARGIN_MM}mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #212529; font: 9pt system-ui, 'Segoe UI', Arial, sans-serif; }
.drawing { width: ${areaW}mm; height: ${areaH}mm; display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
.drawing svg { display: block; flex: none; }
.footer { width: ${areaW}mm; height: ${PRINT_FOOTER_MM}mm; display: flex; gap: 6mm; padding-top: 2mm; border-top: 0.3mm solid #212529; overflow: hidden; }
.legend { flex: 1; min-width: 0; }
.legend h2 { margin: 0 0 1mm; font-size: 9pt; }
.legend ul { margin: 0; padding: 0; list-style: none; font-size: 7.5pt; line-height: 1.25; }
.legend i { display: inline-block; width: 3mm; height: 3mm; margin-right: 1.5mm; vertical-align: -0.5mm; border: 0.2mm solid #868e96; }
.legend .zones { columns: 2; }
.ruler { width: ${rulerMm.toFixed(2)}mm; flex: none; align-self: flex-start; font-size: 7.5pt; }
.ruler .bar { height: 2mm; border: 0.3mm solid #212529; border-top: 0; background: linear-gradient(90deg, #212529 50%, #fff 50%); background-size: 50% 100%; }
.stamp { width: 62mm; flex: none; border: 0.3mm solid #212529; padding: 1.5mm 2mm; font-size: 8pt; line-height: 1.35; }
.stamp b { font-size: 10pt; }
</style></head><body>
<div class="drawing" data-testid="print-drawing">${picture}</div>
<div class="footer">
<div class="legend"><h2>Легенда</h2><ul>${layerRows}</ul><ul class="zones">${zoneRows}</ul></div>
<div class="ruler" data-testid="print-ruler" data-length-mm="${rulerMm.toFixed(2)}"><div class="bar"></div>0 — ${metres(rulerM)} м</div>
<div class="stamp"><b>${esc(plan.name)}</b><br>Дата: ${esc(date)}<br>Масштаб: ${esc(scaleText)}<br>Лист: ${options.format}, ${options.orientation === 'portrait' ? 'книжная' : 'альбомная'}</div>
</div>
</body></html>`;
}

/**
 * Печать плана (#36): формат, ориентация и масштаб. Если план не помещается на
 * лист в выбранном масштабе, окно говорит об этом и предлагает «вписать в лист»
 * или A3. Страницу печати собирает `persistence/plan-print.ts`; здесь она
 * отдаётся скрытому фрейму и `print()` открывает окно печати браузера.
 */

import { useState } from 'react';
import type { PlanDocument } from '../../contracts/model';
import {
  printLayout,
  renderPrintPage,
  svgExtentM,
  type Orientation,
  type PaperFormat,
  type PrintScale,
} from '../../persistence/plan-print';
import { renderPlanSvg } from '../../persistence/plan-svg';
import { FileDialog } from './FileDialog';

const FORMATS: PaperFormat[] = ['A4', 'A3'];
const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'portrait', label: 'Книжная' },
  { value: 'landscape', label: 'Альбомная' },
];
const SCALES: { value: PrintScale; label: string }[] = [
  { value: 50, label: '1:50' },
  { value: 100, label: '1:100' },
  { value: 'fit', label: 'Вписать в лист' },
];

const GROUP_STYLE: React.CSSProperties = { display: 'flex', gap: '1rem', flexWrap: 'wrap', border: 0, padding: 0, margin: 0 };

/** Hands the page to a hidden frame and opens the browser print dialog. */
function printPage(html: string): void {
  const frame = window.document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
  frame.srcdoc = html;
  frame.onload = () => {
    const target = frame.contentWindow;
    if (target === null) return;
    target.focus();
    target.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  window.document.body.appendChild(frame);
}

export function PrintDialog({ plan, onClose }: { plan: PlanDocument; onClose: () => void }): React.JSX.Element {
  const [format, setFormat] = useState<PaperFormat>('A4');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [scale, setScale] = useState<PrintScale>('fit');
  const extent = svgExtentM(renderPlanSvg(plan));
  const layout = printLayout(extent, format, orientation, scale);

  const print = (): void => {
    const html = renderPrintPage(plan, { format, orientation, scale, date: new Date() });
    if (html === null) return;
    printPage(html);
    onClose();
  };

  return (
    <FileDialog
      title="Печать плана"
      describedBy="print-dialog-body"
      testId="print-dialog"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="files__button" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="files__button is-primary" data-testid="print-go" disabled={!layout.fits} onClick={print}>
            Печать…
          </button>
        </>
      }
    >
      <fieldset style={GROUP_STYLE}>
        <legend>Формат листа</legend>
        {FORMATS.map((item) => (
          <label key={item}>
            <input type="radio" name="print-format" checked={format === item} onChange={() => setFormat(item)} /> {item}
          </label>
        ))}
      </fieldset>
      <fieldset style={GROUP_STYLE}>
        <legend>Ориентация</legend>
        {ORIENTATIONS.map((item) => (
          <label key={item.value}>
            <input type="radio" name="print-orientation" checked={orientation === item.value} onChange={() => setOrientation(item.value)} /> {item.label}
          </label>
        ))}
      </fieldset>
      <fieldset style={GROUP_STYLE}>
        <legend>Масштаб</legend>
        {SCALES.map((item) => (
          <label key={String(item.value)}>
            <input type="radio" name="print-scale" checked={scale === item.value} onChange={() => setScale(item.value)} /> {item.label}
          </label>
        ))}
      </fieldset>
      {layout.fits ? (
        <p className="panel__note" data-testid="print-info">
          План на листе: {Math.round(layout.drawingMm[0])} × {Math.round(layout.drawingMm[1])} мм, масштаб 1:{layout.denominator}.
          Печатаются только включённые слои.
        </p>
      ) : (
        <div role="alert" data-testid="print-nofit">
          <p>
            План не помещается на лист {format} в масштабе 1:{scale === 'fit' ? layout.denominator : scale}: нужно{' '}
            {Math.round(layout.drawingMm[0])} × {Math.round(layout.drawingMm[1])} мм, доступно{' '}
            {Math.round(layout.areaMm[0])} × {Math.round(layout.areaMm[1])} мм.
          </p>
          <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="files__button" onClick={() => setScale('fit')}>
              Вписать в лист
            </button>
            {format === 'A4' ? (
              <button type="button" className="files__button" onClick={() => setFormat('A3')}>
                Взять A3
              </button>
            ) : null}
          </p>
        </div>
      )}
    </FileDialog>
  );
}

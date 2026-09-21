/**
 * U05-ux: what an informational layer's colours and numbers mean.
 *
 * Everything comes from the layer type in the catalog: colours, unit and the
 * value that saturates the scale. The panel and the canvas print the same
 * legend, so a screenshot and the panel never disagree.
 */

import type { LayerType } from '../../contracts/model';
import { formatShort, NBSP } from '../../domain/number-format';

export type LayerLegend =
  /** Colour scale: low → high, and the value from which the colour stops changing. */
  | { kind: 'scale'; from: string; to: string; low: string; high: string; threshold: string }
  /** One colour: a badge or a sector. */
  | { kind: 'swatch'; color: string; text: string }
  | { kind: 'none' };

/** Number with a unit, decimal comma and a non-breaking space as the rest of the interface. */
export function formatValue(value: number, unit: string): string {
  const text = formatShort(value);
  return unit === '' ? text : `${text}${NBSP}${unit}`;
}

export function legendOf(type: LayerType): LayerLegend {
  const representation = type.representation;
  switch (representation.kind) {
    case 'zone-heat': {
      const high = formatValue(representation.max, representation.unit);
      return {
        kind: 'scale',
        from: representation.colors[0],
        to: representation.colors[1],
        low: formatValue(0, representation.unit),
        high,
        threshold: `от ${high} и выше — самый насыщенный цвет`,
      };
    }
    case 'zone-count':
      return {
        kind: 'swatch',
        color: representation.color,
        text: `метка в зоне — ${representation.unit}`,
      };
    case 'object-field':
      return {
        kind: 'swatch',
        color: representation.color,
        text: `сектор обзора; без атрибутов камеры — ${representation.angle_deg}°, ${formatValue(representation.range_m, 'м')}`,
      };
    case 'objects':
      return { kind: 'none' };
  }
}

/** One line for the canvas, where there is no room for a table. */
export function legendLine(type: LayerType, legend: LayerLegend): string {
  const scale = legend.kind === 'scale' ? `${legend.low} … ${legend.high}` : '';
  const body = legend.kind === 'swatch' ? legend.text : scale;
  return body === '' ? type.label : `${type.label}: ${body}`;
}

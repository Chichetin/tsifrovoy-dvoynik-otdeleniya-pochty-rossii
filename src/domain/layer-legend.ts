/**
 * U05-ux: what an informational layer's colours and numbers mean.
 *
 * Everything comes from the layer type in the catalog: colours, unit and the
 * value that saturates the scale. The panel, the canvas and the PNG/SVG export
 * (#220) print the same legend, so a picture and the panel never disagree.
 */

import type { LayerType } from '../contracts/model';
import { formatShort, NBSP } from './number-format';

export type LayerLegend =
  /** Colour scale: low → high, and the value from which the colour stops changing. */
  | { kind: 'scale'; from: string; to: string; low: string; high: string; threshold: string }
  /** One colour: a badge or a sector. */
  | { kind: 'swatch'; color: string; text: string }
  | { kind: 'palette'; values: { value: string; label: string; color: string }[] }
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
    case 'object-color':
      return { kind: 'palette', values: representation.values };
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

/**
 * Hatch of a blind spot: dark red lines, distinct from the violet sectors and
 * the pastel zones. Shared by the canvas, the panel swatch and the export (#220).
 */
export const BLIND_SPOT = {
  /** Solid colour of the hatch: the legend swatch, where lines are few and short. */
  color: '#C92A2A',
  /**
   * Lines on the plan: the same red, a little see-through, so zone names and
   * object labels under a large blind spot stay readable.
   */
  line: 'rgba(201, 42, 42, 0.6)',
  /** Faint tint under the lines, so a thin strip still reads as an area. */
  tint: 'rgba(201, 42, 42, 0.06)',
  /** Distance between hatch lines, screen px. */
  spacing_px: 9,
} as const;

/** The legend line of the blind spots, the same on the canvas and in the export. */
export function blindSpotLine(percent: number): string {
  return `Слепые пятна клиентских зон · видно ${formatValue(percent, '%')}`;
}

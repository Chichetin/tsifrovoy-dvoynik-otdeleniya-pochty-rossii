/**
 * Colour of a heat value on a `zone-heat` scale. The 2D canvas and the 3D floor
 * both call it, so the same number is the same colour in both views.
 */

/** Линейная смесь двух цветов #RRGGBB: 0 — первый, 1 — второй. */
function mixColors(from: string, to: string, ratio: number): string {
  const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16);
  const blend = (at: number): string => {
    const value = Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * ratio);
    return Math.min(Math.max(value, 0), 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${blend(1)}${blend(3)}${blend(5)}`;
}

/** `max` and above give the last colour; below zero — the first. */
export function heatColor(colors: readonly [string, string], value: number, max: number): string {
  return mixColors(colors[0], colors[1], Math.min(Math.max(value / max, 0), 1));
}

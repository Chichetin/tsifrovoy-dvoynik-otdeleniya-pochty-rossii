/**
 * Numbers as a Russian reader expects them: a decimal comma, thousands split
 * by a non-breaking space, and a unit glued to its number so a narrow column
 * never leaves «м²» alone on the next line.
 *
 * Only for text a person reads. Files, CSV and the SVG export keep their own
 * machine formats, and the assistant's templates keep theirs (`advice`),
 * because their sentences are checked against the calculation.
 */

/** U+00A0: the space that does not let a line break between number and unit. */
export const NBSP = '\u00A0';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${minDigits}:${maxDigits}`;
  let found = formatters.get(key);
  if (found === undefined) {
    found = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
      // «-0,00» after rounding reads as a loss that is not there.
      signDisplay: 'negative',
    });
    formatters.set(key, found);
  }
  return found;
}

/** `132` → `132,00`; the number of decimals is fixed so columns line up. */
export function formatNumber(value: number, fractionDigits = 2): string {
  return formatter(fractionDigits, fractionDigits).format(value);
}

/** No trailing zeros: `100`, `2,5`; one decimal by default. For legends and sizes. */
export function formatShort(value: number, maxDigits = 1): string {
  return formatter(0, maxDigits).format(value);
}

/** `3` and `чел.` → `3 чел.` with a non-breaking space; no unit — just the number. */
export function formatMeasure(value: number, unit: string, fractionDigits = 2): string {
  const text = formatNumber(value, fractionDigits);
  return unit === '' ? text : `${text}${NBSP}${unit}`;
}

/** Areas are shown to a hundredth: the model is in metres, not in pixels. */
export function formatArea(value: number): string {
  return formatMeasure(value, 'м²');
}

export function formatLength(value: number): string {
  return formatMeasure(value, 'м');
}

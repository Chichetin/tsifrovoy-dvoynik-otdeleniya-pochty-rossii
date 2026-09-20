import { describe, expect, test } from 'vitest';
import { loadColumnWidths, resizeColumns } from './resizable-columns';

describe('ширины колонок', () => {
  test('двигает только соседние колонки и не даёт им исчезнуть', () => {
    expect(resizeColumns([50, 25, 25], 0, 8, 10)).toEqual([58, 17, 25]);
    expect(resizeColumns([50, 25, 25], 0, 100, 10)).toEqual([65, 10, 25]);
    expect(resizeColumns([50, 25, 25], 1, -100, 10)).toEqual([50, 10, 40]);
  });

  test('берёт сохранённые ширины, а битые и устаревшие заменяет начальными', () => {
    const defaults = [50, 25, 25];
    const storage = (value: string | null) => ({ getItem: () => value });

    expect(loadColumnWidths(storage('[40,30,30]'), 'zones', defaults, 10)).toEqual([40, 30, 30]);
    expect(loadColumnWidths(storage('[5,45,50]'), 'zones', defaults, 10)).toEqual(defaults);
    expect(loadColumnWidths(storage('[50,50]'), 'zones', defaults, 10)).toEqual(defaults);
    expect(loadColumnWidths(storage('not json'), 'zones', defaults, 10)).toEqual(defaults);
  });
});

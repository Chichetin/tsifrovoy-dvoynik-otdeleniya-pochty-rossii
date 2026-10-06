import { describe, expect, test } from 'vitest';
import { formatArea, formatLength, formatMeasure, formatNumber, findingsWord, formatShort, NBSP } from './number-format';

describe('числа в интерфейсе по-русски', () => {
  test('дробная часть через запятую, два знака по умолчанию', () => {
    expect(formatNumber(132)).toBe('132,00');
    expect(formatNumber(63.005)).toBe('63,01');
    expect(formatNumber(0.5)).toBe('0,50');
  });

  test('число знаков задаётся явно', () => {
    expect(formatNumber(2.345, 1)).toBe('2,3');
    expect(formatNumber(7, 0)).toBe('7');
  });

  test('тысячи отделены неразрывным пробелом, строка не рвётся внутри числа', () => {
    expect(formatNumber(1234.5)).toBe(`1${NBSP}234,50`);
  });

  test('минус остаётся, «минус ноль» после округления не показывается', () => {
    expect(formatNumber(-2)).toBe('-2,00');
    expect(formatNumber(-0.001)).toBe('0,00');
  });

  test('единица стоит через неразрывный пробел', () => {
    expect(formatArea(63)).toBe(`63,00${NBSP}м²`);
    expect(formatLength(10)).toBe(`10,00${NBSP}м`);
    expect(formatMeasure(3, 'чел.', 0)).toBe(`3${NBSP}чел.`);
    expect(formatMeasure(3, '', 0)).toBe('3');
  });

  test('короткая запись: целое без дробной части, иначе один знак', () => {
    expect(formatShort(100)).toBe('100');
    expect(formatShort(2.5)).toBe('2,5');
    expect(formatShort(2.25)).toBe('2,3');
    expect(formatShort(1.25, 2)).toBe('1,25');
    expect(formatShort(0.6, 2)).toBe('0,6');
  });
});

test('«находка» склоняется по числу', () => {
  expect([0, 1, 2, 4, 5, 11, 21, 22, 112].map(findingsWord)).toEqual([
    'находок', 'находка', 'находки', 'находки', 'находок', 'находок', 'находка', 'находки', 'находок',
  ]);
});

import { describe, expect, test } from 'vitest';
import { hideNamedIds } from './agent-fallback';

describe('hideNamedIds (D-321): id остаётся, но не в тексте карточки', () => {
  test('«name» (id) теряет id, кавычки с именем остаются', () => {
    expect(hideNamedIds('Зона «Хранение и посылки» (z_storage) свободна.')).toBe(
      'Зона «Хранение и посылки» свободна.',
    );
  });

  test('несколько вхождений — каждое своё', () => {
    expect(hideNamedIds('«Стеллаж» (eq_7) и «Табло» (eq_8) рядом.')).toBe('«Стеллаж» и «Табло» рядом.');
  });

  test('текст без этой формы не меняется', () => {
    expect(hideNamedIds('Обычный текст без идентификаторов.')).toBe('Обычный текст без идентификаторов.');
    expect(hideNamedIds('Код rule_bench_min без кавычек и скобок.')).toBe('Код rule_bench_min без кавычек и скобок.');
  });

  test('короткая форма без пробела перед скобкой тоже распознаётся', () => {
    expect(hideNamedIds('«Клиентский зал»(z_client)')).toBe('«Клиентский зал»');
  });

  test('скобка без валидного id-токена не трогается: не любые скобки', () => {
    expect(hideNamedIds('«Вариант» (было 3)')).toBe('«Вариант» (было 3)');
  });
});

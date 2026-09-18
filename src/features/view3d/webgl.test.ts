// @vitest-environment jsdom
/**
 * D01: проба WebGL — то, что нельзя увидеть в браузере глазами.
 *
 * Проверяется ровно два обещания: проба отпускает контекст, который взяла, и
 * браузер спрашивается один раз за сессию, а не на каждое переключение в 3D.
 * `vi.resetModules()` перед каждым тестом даёт модулю чистую память.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

type Probe = typeof import('./webgl');

function loadModule(): Promise<Probe> {
  return import('./webgl');
}

/** Поддельный контекст: интересны только `getExtension` и отпускание. */
function fakeContext(loseContext: () => void): { getExtension: ReturnType<typeof vi.fn> } {
  return { getExtension: vi.fn(() => ({ loseContext })) };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('probeWebgl', () => {
  test('контекст есть: ответ «да», и контекст сразу отпущен', async () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeContext(loseContext) as unknown as RenderingContext);

    const { probeWebgl } = await loadModule();
    expect(probeWebgl()).toBe(true);

    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  test('контекста нет — ответ «нет», и никто ничего не отпускает', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    const { probeWebgl } = await loadModule();
    expect(probeWebgl()).toBe(false);
  });

  test('браузер бросил исключение вместо контекста — это просто «нет»', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('WebGL заблокирован политикой');
    });

    const { probeWebgl } = await loadModule();
    expect(probeWebgl()).toBe(false);
  });

  test('расширения WEBGL_lose_context может не быть: ответ всё равно «да»', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: vi.fn(() => null),
    } as unknown as RenderingContext);

    const { probeWebgl } = await loadModule();
    expect(probeWebgl()).toBe(true);
  });
});

describe('hasWebgl', () => {
  test('браузер спрашивается один раз за сессию, сколько бы раз ни переключали вид', async () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeContext(loseContext) as unknown as RenderingContext);

    const { hasWebgl } = await loadModule();
    expect(hasWebgl()).toBe(true);
    expect(hasWebgl()).toBe(true);
    expect(hasWebgl()).toBe(true);

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  test('ответ «нет» тоже запоминается: повторная проба не создаёт canvas заново', async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null);

    const { hasWebgl } = await loadModule();
    expect(hasWebgl()).toBe(false);
    expect(hasWebgl()).toBe(false);

    // Два вызова getContext — это одна проба: сначала webgl2, потом webgl.
    expect(getContext).toHaveBeenCalledTimes(2);
  });
});

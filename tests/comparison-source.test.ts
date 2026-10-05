// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import before from '../demo/before.json';
import after from '../demo/after.json';
import { useComparisonSource } from '../src/features/assistant/use-comparison-source';
import { readPlanFile } from '../src/persistence/format';

afterEach(cleanup);
const file = (name: string, value: unknown) => ({ name, text: async () => JSON.stringify(value) });
function pending() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('отдельный исходный файл сравнения', () => {
  test('неизмеримый контур проходит codec, но не заменяет рабочую базу', async () => {
    const { result } = renderHook(useComparisonSource);
    await act(() => result.current.load(file('before.json', before)));
    const source = result.current.source;
    const invalid = structuredClone(before);
    invalid.room.boundary = [[0, 0], [4, 4], [0, 4], [4, 0]];
    expect(readPlanFile(JSON.stringify(invalid)).ok).toBe(true);
    await act(() => result.current.load(file('crossed.json', invalid)));
    expect(result.current.source).toBe(source);
    expect(result.current.error).toBeTruthy();
    expect(result.current.loading).toBe(false);
  });
  test('настоящий codec загружает источник; неверная замена сохраняет предыдущий', async () => {
    const { result } = renderHook(useComparisonSource);
    await act(() => result.current.load(file('before.json', before)));
    const source = result.current.source;
    expect(source?.fileName).toBe('before.json');
    expect(source?.plan.objects).toHaveLength(53);
    await act(() => result.current.load(file('bad.json', {})));
    expect(result.current.source).toBe(source);
    expect(result.current.error).toContain('Файл не похож');
    expect(result.current.loading).toBe(false);
    await act(() => result.current.load(file('after.json', after)));
    expect(result.current.source?.fileName).toBe('after.json');
    expect(result.current.error).toBeNull();
  });

  test('позднее чтение первого файла не затирает второй', async () => {
    const { result } = renderHook(useComparisonSource);
    const slow = pending();
    let loading!: Promise<void>;
    act(() => { loading = result.current.load({ name: 'slow.json', text: () => slow.promise }); });
    expect(result.current.loading).toBe(true);
    await act(() => result.current.load(file('latest.json', after)));
    await act(async () => { slow.resolve(JSON.stringify(before)); await loading; });
    expect(result.current.source?.fileName).toBe('latest.json');
    expect(result.current.error).toBeNull();
  });

  test('сброс во время чтения не позволяет вернуть старый источник', async () => {
    const { result } = renderHook(useComparisonSource);
    await act(() => result.current.load(file('before.json', before)));
    const slow = pending();
    let loading!: Promise<void>;
    act(() => { loading = result.current.load({ name: 'slow.json', text: () => slow.promise }); });
    act(() => result.current.clear());
    await act(async () => { slow.resolve(JSON.stringify(after)); await loading; });
    expect(result.current.source).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  test('ошибка чтения сохраняет источник, поздняя ошибка не портит новый результат', async () => {
    const { result } = renderHook(useComparisonSource);
    await act(() => result.current.load(file('before.json', before)));
    const source = result.current.source;
    await act(() => result.current.load({ name: 'broken.json', text: async () => { throw new Error('disk'); } }));
    expect(result.current.source).toBe(source);
    expect(result.current.error).toContain('прочитать');
    const slow = pending();
    let loading!: Promise<void>;
    act(() => { loading = result.current.load({ name: 'slow.json', text: () => slow.promise }); });
    await act(() => result.current.load(file('after.json', after)));
    await act(async () => { slow.reject(new Error('late')); await loading; });
    expect(result.current.error).toBeNull();
    expect(result.current.source?.fileName).toBe('after.json');
  });
});

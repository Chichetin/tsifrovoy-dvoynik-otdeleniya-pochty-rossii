import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { readPlanFile } from '../../persistence/format';
import { DEMO_PLANS, readDemoText } from './demo-plan';

describe('демо загружается из файлов сервера через обычный codec', () => {
  test.each(DEMO_PLANS)('$label', async (item) => {
    // The showroom is served by Vite straight from demo/ (`?url` import); the others have a copy in public/.
    const source = readFileSync(item.id === 'showroom' ? 'demo/showroom.json' : `public${item.url}`, 'utf8');
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(source));
    const signal = new AbortController().signal;
    const text = await readDemoText(item.id, { fetch: request, signal });
    expect(request).toHaveBeenCalledWith(item.url, { signal });
    const opened = readPlanFile(text);
    const expected = readPlanFile(readFileSync(`demo/${item.id}.json`, 'utf8'));
    expect(opened.ok).toBe(true);
    expect(opened).toEqual(expected);
  });

  test('HTTP-отказ не читается как план', async () => {
    const response = new Response('not a plan', { status: 503 });
    const text = vi.spyOn(response, 'text');
    await expect(readDemoText('before', { fetch: vi.fn<typeof fetch>().mockResolvedValue(response) })).rejects.toThrow('HTTP 503');
    expect(text).not.toHaveBeenCalled();
  });

  test('повреждённый JSON отвергает обычный codec', async () => {
    const text = await readDemoText('after', { fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{broken')) });
    expect(readPlanFile(text).ok).toBe(false);
  });

  test('сетевая ошибка и отмена доходят до контроллера загрузки', async () => {
    const error = new DOMException('cancelled', 'AbortError');
    await expect(readDemoText('before', { fetch: vi.fn<typeof fetch>().mockRejectedValue(error) })).rejects.toBe(error);
  });
});

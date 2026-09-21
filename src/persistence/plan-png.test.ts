// @vitest-environment jsdom
/**
 * PNG плана (D-255): тот же SVG, что у `renderPlanSvg`, растеризованный через
 * `<canvas>`. jsdom не рисует и не декодирует картинки, поэтому холст и `Image`
 * подменяются: проверяется то, что решает код, — размер холста из SVG, белая
 * подложка, отрисовка того самого SVG и явный отказ на каждом шаге, где
 * браузер может подвести.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import minimal from '../contracts/fixtures/minimal.json';
import type { PlanDocument } from '../contracts/model';
import { parsePlanDocument } from '../contracts/schema';
import { pngFileName, renderPlanPng } from './plan-png';
import { planFileName, renderPlanSvg } from './plan-svg';

const parsed = parsePlanDocument(minimal);
if (!parsed.ok) throw new Error('minimal.json не разобрался');
const plan: PlanDocument = parsed.value;

type ImageOutcome = 'load' | 'error';
let imageOutcome: ImageOutcome = 'load';
let loadedSources: string[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    loadedSources.push(value);
    queueMicrotask(() => {
      if (imageOutcome === 'load') this.onload?.();
      else this.onerror?.();
    });
  }
}

type FakeContext = {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

let context: FakeContext | null;
let blobResult: Blob | null;
let canvases: HTMLCanvasElement[] = [];
let svgBlobs: Blob[] = [];

beforeEach(() => {
  imageOutcome = 'load';
  loadedSources = [];
  canvases = [];
  svgBlobs = [];
  blobResult = new Blob(['png'], { type: 'image/png' });
  context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    svgBlobs.push(blob as Blob);
    return 'blob:svg';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvases.push(this);
    return context as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    expect(type).toBe('image/png');
    callback(blobResult);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function svgSize(svg: string): { width: number; height: number } {
  const width = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1]);
  const height = Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1]);
  return { width, height };
}

describe('renderPlanPng', () => {
  test('растеризует тот же SVG на холст его размера поверх белой подложки', async () => {
    const blob = await renderPlanPng(plan);

    expect(blob).toBe(blobResult);
    const svg = renderPlanSvg(plan);
    expect(svgBlobs).toHaveLength(1);
    expect(await svgBlobs[0]!.text()).toBe(svg);
    expect(svgBlobs[0]!.type).toBe('image/svg+xml');
    expect(loadedSources).toEqual(['blob:svg']);

    const size = svgSize(svg);
    expect(size.width).toBeGreaterThan(0);
    expect(canvases[0]!.width).toBe(Math.round(size.width));
    expect(canvases[0]!.height).toBe(Math.round(size.height));

    expect(context!.fillStyle).toBe('#ffffff');
    expect(context!.fillRect).toHaveBeenCalledWith(0, 0, canvases[0]!.width, canvases[0]!.height);
    expect(context!.drawImage).toHaveBeenCalledTimes(1);
    // Подложка раньше картинки, иначе она закрасит план.
    expect(context!.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      context!.drawImage.mock.invocationCallOrder[0]!,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg');
  });

  test('нет растрового холста — отказ с причиной, а не пустой файл', async () => {
    context = null;
    await expect(renderPlanPng(plan)).rejects.toThrow('Растровый холст недоступен');
    expect(loadedSources).toEqual([]);
  });

  test('браузер не прочитал SVG — отказ с причиной, ссылка освобождена', async () => {
    imageOutcome = 'error';
    await expect(renderPlanPng(plan)).rejects.toThrow('не прочиталась');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg');
    expect(context!.drawImage).not.toHaveBeenCalled();
  });

  test('холст вернул пустой файл — отказ с причиной', async () => {
    blobResult = null;
    await expect(renderPlanPng(plan)).rejects.toThrow('пустой файл');
  });
});

describe('pngFileName', () => {
  test('то же имя, что у файла плана, но .png', () => {
    expect(pngFileName(plan)).toBe(planFileName(plan, 'png'));
    expect(pngFileName(plan).endsWith('.png')).toBe(true);
  });
});

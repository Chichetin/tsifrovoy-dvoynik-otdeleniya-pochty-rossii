import { describe, expect, it } from 'vitest';
import { canvasRecoveryUrl } from './module-recovery';
describe('адрес восстановления 3D', () => {
  it('принимает исходный и собранный canvas только с текущего источника', () => {
    for (const path of ['/src/features/view3d/View3DCanvas.tsx?t=12', '/app/assets/View3DCanvas-Ab_1.js']) {
      const url = 'https://example.test' + path;
      expect(canvasRecoveryUrl(new Error('Failed to fetch dynamically imported module: ' + url), 'https://example.test')).toBe(url);
    }
  });
  it('не превращает чужой адрес или произвольный модуль из ошибки в импорт', () => {
    for (const url of ['https://elsewhere.test/assets/View3DCanvas-Ab_1.js', 'https://example.test/assets/index-Ab_1.js', 'https://example.test/assets/View3DCanvas-Ab_1.js/extra']) {
      expect(canvasRecoveryUrl(new Error(url), 'https://example.test')).toBeNull();
    }
    expect(canvasRecoveryUrl(new Error('Ошибка renderer без адреса'), 'https://example.test')).toBeNull();
  });
});

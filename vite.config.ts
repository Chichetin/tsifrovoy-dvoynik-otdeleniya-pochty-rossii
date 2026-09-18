import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Порт dev-сервера: `DEV_PORT`, по умолчанию 5173 (D-095).
 *
 * Не `PORT` — его читает сервер Fastify (`server/config.ts`), и не `VITE_PORT` —
 * переменные с префиксом `VITE_` Vite подставляет в клиентскую сборку.
 * Мусор в переменной — остановка с понятным текстом: молчаливый откат на 5173
 * возвращает ровно ту беду, ради которой порт и вынесен (два worktree на одном порту).
 */
export function resolveDevPort(raw: string | undefined): number {
  if (raw === undefined) return 5173;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DEV_PORT: ожидается целый порт 1…65535, получено ${JSON.stringify(raw)}`);
  }
  return port;
}

export default defineConfig({
  plugins: [react()],
  // 127.0.0.1, а не localhost: иначе dev-сервер слушает только ::1, и проверка
  // Playwright по http://localhost:5173 не достучится.
  server: {
    host: '127.0.0.1',
    port: resolveDevPort(process.env.DEV_PORT),
    strictPort: true,
    // Ассистент ходит в /api сервера (npm run serve). Без прокси dev-сборка
    // получила бы 404 и ушла в локальный расчёт — работать будет, но без модели.
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } },
  },
});

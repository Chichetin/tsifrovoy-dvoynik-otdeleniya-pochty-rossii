import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 127.0.0.1, а не localhost: иначе dev-сервер слушает только ::1, и проверка
  // Playwright по http://localhost:5173 не достучится.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Ассистент ходит в /api сервера (npm run serve). Без прокси dev-сборка
    // получила бы 404 и ушла в локальный расчёт — работать будет, но без модели.
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } },
  },
});

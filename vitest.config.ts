import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    // DOM нужен семи файлам из сорока одного, а строился он для всех: 83%
    // времени прогона уходило на создание jsdom. Файлы, которым он нужен,
    // помечены докблоком '@vitest-environment jsdom'.
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'tests/**/*.test.{ts,tsx}'],
  },
});

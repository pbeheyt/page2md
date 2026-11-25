import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const srcDir = resolve(import.meta.dirname, 'src');

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
      '~': srcDir,
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://example.com/article',
      },
    },
    include: ['tests/**/*.test.ts'],
  },
});

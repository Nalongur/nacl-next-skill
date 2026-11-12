import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  build: {
    target: 'chrome120',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

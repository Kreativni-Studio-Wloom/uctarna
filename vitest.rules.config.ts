import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Testy firestore.rules proti Firestore emulatoru (vyžaduje Javu): `npm run test:rules`.
// Odděleně od `npm test`, který emulator nepotřebuje.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.spec.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});

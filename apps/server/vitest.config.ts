import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Локальные настройки тестовой БД: apps/server/.env.test (образец — env.test.example).
if (existsSync('.env.test')) process.loadEnvFile('.env.test');

const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/trektren_test',
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
  BCRYPT_ROUNDS: '4',
};
// globalSetup выполняется в главном процессе: переменные нужны и там, и в воркерах.
Object.assign(process.env, testEnv);

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
    env: testEnv,
  },
});

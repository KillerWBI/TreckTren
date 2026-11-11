import { existsSync } from 'node:fs';
import { z } from 'zod';
import { AUTH_MODES } from '@trektren/shared';

// Переменные из окружения важнее .env: так на Railway работают настройки сервиса.
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL не задан'),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET — минимум 32 символа'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  /** demo — без регистрации и входа: все заходят в один тестовый аккаунт. */
  AUTH_MODE: z.enum(AUTH_MODES).default('password'),
  /** Папка со сборкой клиента: если задана, API и клиент отдаются с одного домена. */
  CLIENT_DIST_DIR: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  // Сообщение без значений переменных: в них могут быть секреты.
  console.error(`Некорректные переменные окружения:\n${lines.join('\n')}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

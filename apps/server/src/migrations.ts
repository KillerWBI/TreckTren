import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

/** Папка migrations/ рядом с src/ и dist/ — путь одинаковый в dev и после сборки. */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export async function runMigrations(
  databaseUrl: string,
  direction: 'up' | 'down' = 'up',
  options: { silent?: boolean; ssl?: boolean } = {},
): Promise<Array<{ name: string }>> {
  return runner({
    databaseUrl: {
      connectionString: databaseUrl,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    },
    dir: MIGRATIONS_DIR,
    direction,
    count: direction === 'up' ? Infinity : 1,
    migrationsTable: 'pgmigrations',
    singleTransaction: true,
    checkOrder: true,
    log: options.silent ? () => {} : (msg) => console.log(msg),
  });
}

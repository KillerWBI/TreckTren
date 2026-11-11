import pg from 'pg';
import { runMigrations } from '../src/migrations.js';

/** Перед прогоном: тестовая схема пересоздаётся с нуля и прокатываются все миграции. */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL для тестов не задан');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes('test')) {
    throw new Error(
      `Тесты чистят базу. Имя тестовой базы должно содержать "test", сейчас: ${dbName}`,
    );
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();

  await runMigrations(url, 'up', { silent: true });
}

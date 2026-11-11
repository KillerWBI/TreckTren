import { afterAll, beforeEach } from 'vitest';
import { pool } from '../src/db.js';

beforeEach(async () => {
  // Каскадом чистит все таблицы, ссылающиеся на users.
  await pool.query('TRUNCATE users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

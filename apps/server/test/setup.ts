import { afterAll, beforeEach } from 'vitest';
import { pool } from '../src/db.js';

beforeEach(async () => {
  // ON DELETE CASCADE чистит данные пользователей. TRUNCATE … CASCADE не подходит:
  // он снёс бы и общую базу упражнений, у которой есть ссылка на users.
  await pool.query('DELETE FROM users');
});

afterAll(async () => {
  await pool.end();
});

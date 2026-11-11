import { config } from './config.js';
import { pool } from './db.js';
import { createApp } from './app.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`API: http://localhost:${config.PORT}/api/v1 (${config.NODE_ENV})`);
});

function shutdown(signal: string) {
  console.log(`${signal}: останавливаю сервер`);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

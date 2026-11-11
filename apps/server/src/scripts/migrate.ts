import { config } from '../config.js';
import { runMigrations } from '../migrations.js';

const direction = process.argv[2] === 'down' ? 'down' : 'up';

try {
  const applied = await runMigrations(config.DATABASE_URL, direction, { ssl: config.DATABASE_SSL });
  console.log(
    applied.length === 0
      ? 'Миграции: изменений нет'
      : `Миграции (${direction}): ${applied.map((m) => m.name).join(', ')}`,
  );
  process.exit(0);
} catch (err) {
  console.error('Миграции не применились:', err instanceof Error ? err.message : err);
  process.exit(1);
}

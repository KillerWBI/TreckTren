-- Up Migration

-- Замеры тела: обхваты в сантиметрах и снимок портрета на тот день — для сравнения «было / стало».
CREATE TABLE measurement_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  girths     jsonb NOT NULL,
  weight_kg  numeric(5, 1),
  body       jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- Упражнения, убранные из тренировки: из плана их не стираем, но в разбор они не попадают.
ALTER TABLE workouts ADD COLUMN removed_slugs text[] NOT NULL DEFAULT '{}';

-- Down Migration

ALTER TABLE workouts DROP COLUMN removed_slugs;
DROP TABLE IF EXISTS measurement_logs;

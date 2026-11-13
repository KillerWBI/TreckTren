-- Up Migration

-- Тренировка: когда начал и закончил, разбор после завершения. Одна тренировка на сессию плана.
ALTER TABLE workouts ADD COLUMN started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE workouts ADD COLUMN finished_at timestamptz;
ALTER TABLE workouts ADD COLUMN analysis_json jsonb;
CREATE UNIQUE INDEX workouts_session_uq ON workouts (session_id) WHERE session_id IS NOT NULL;

-- Поправка нормы калорий по тренду веса (принятая человеком рекомендация).
ALTER TABLE profiles ADD COLUMN calorie_adjust integer NOT NULL DEFAULT 0
  CHECK (calorie_adjust BETWEEN -1000 AND 1000);
ALTER TABLE profiles ADD COLUMN calorie_adjust_at date;

-- Кэш разбора еды ИИ: одинаковый текст — один запрос. Данных о человеке тут нет, только текст еды.
CREATE TABLE food_parse_cache (
  text_key   text PRIMARY KEY,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS food_parse_cache;
ALTER TABLE profiles DROP COLUMN calorie_adjust_at;
ALTER TABLE profiles DROP COLUMN calorie_adjust;
DROP INDEX IF EXISTS workouts_session_uq;
ALTER TABLE workouts DROP COLUMN analysis_json;
ALTER TABLE workouts DROP COLUMN finished_at;
ALTER TABLE workouts DROP COLUMN started_at;

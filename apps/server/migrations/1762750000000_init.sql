-- Up Migration

-- Пользователи и доступ ---------------------------------------------------

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  password_hash      text NOT NULL,
  health_consent_at  timestamptz NOT NULL,
  adult_confirmed_at timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Карточка атлета ---------------------------------------------------------

CREATE TABLE profiles (
  user_id          uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  athlete_card     jsonb NOT NULL DEFAULT '{}'::jsonb,
  card_version     integer NOT NULL DEFAULT 0,
  timezone         text NOT NULL DEFAULT 'Europe/Warsaw',
  locale           text NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'pl', 'uk', 'en')),
  calorie_override integer CHECK (calorie_override BETWEEN 1000 AND 8000),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE card_versions (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  version    integer NOT NULL,
  patch      jsonb NOT NULL,
  snapshot   jsonb NOT NULL,
  source     text NOT NULL CHECK (source IN ('onboarding', 'user', 'ai')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);

CREATE TABLE onboarding (
  user_id      uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  step         smallint NOT NULL DEFAULT 0,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_questions jsonb,
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Ежедневные логи ---------------------------------------------------------

CREATE TABLE weight_logs (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date        date NOT NULL,
  time_of_day text NOT NULL CHECK (time_of_day IN ('morning', 'evening')),
  weight_kg   numeric(5, 2) NOT NULL CHECK (weight_kg BETWEEN 30 AND 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date, time_of_day)
);

CREATE TABLE step_logs (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  steps      integer NOT NULL CHECK (steps BETWEEN 0 AND 150000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE wellbeing_logs (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date            date NOT NULL,
  sleep_score     smallint CHECK (sleep_score BETWEEN 1 AND 5),
  sleep_hours     numeric(3, 1) CHECK (sleep_hours BETWEEN 0 AND 24),
  wellbeing_score smallint CHECK (wellbeing_score BETWEEN 1 AND 5),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE body_measurements (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  waist_cm   numeric(5, 1),
  neck_cm    numeric(5, 1),
  chest_cm   numeric(5, 1),
  arm_cm     numeric(5, 1),
  hips_cm    numeric(5, 1),
  thigh_cm   numeric(5, 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- Питание -----------------------------------------------------------------

CREATE TABLE meals (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       date NOT NULL,
  meal_type  text NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  input_type text NOT NULL CHECK (input_type IN ('manual', 'text', 'photo')),
  raw_text   text,
  photo_key  text,
  kcal       numeric(7, 1) NOT NULL DEFAULT 0,
  protein_g  numeric(6, 1) NOT NULL DEFAULT 0,
  fat_g      numeric(6, 1) NOT NULL DEFAULT 0,
  carbs_g    numeric(6, 1) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meals_user_date_idx ON meals (user_id, date);

CREATE TABLE meal_items (
  id            bigserial PRIMARY KEY,
  meal_id       bigint NOT NULL REFERENCES meals (id) ON DELETE CASCADE,
  name          text NOT NULL,
  grams         numeric(7, 1) NOT NULL CHECK (grams >= 0),
  kcal          numeric(7, 1) NOT NULL,
  protein_g     numeric(6, 1) NOT NULL,
  fat_g         numeric(6, 1) NOT NULL,
  carbs_g       numeric(6, 1) NOT NULL,
  ai_confidence numeric(3, 2) CHECK (ai_confidence BETWEEN 0 AND 1)
);
CREATE INDEX meal_items_meal_idx ON meal_items (meal_id);

-- Упражнения --------------------------------------------------------------

CREATE TABLE exercises (
  id                serial PRIMARY KEY,
  slug              text NOT NULL,
  name_ru           text NOT NULL,
  name_pl           text,
  name_uk           text,
  name_en           text NOT NULL,
  pattern           text NOT NULL CHECK (pattern IN (
                      'squat', 'hinge', 'single_leg', 'horizontal_push', 'vertical_push',
                      'horizontal_pull', 'vertical_pull', 'isolation', 'core', 'other')),
  primary_muscles   text[] NOT NULL DEFAULT '{}',
  secondary_muscles text[] NOT NULL DEFAULT '{}',
  equipment         text,
  is_compound       boolean NOT NULL DEFAULT false,
  tier              char(1) NOT NULL DEFAULT 'B' CHECK (tier IN ('S', 'A', 'B')),
  weight_step_kg    numeric(4, 2),
  min_rir           smallint NOT NULL DEFAULT 0 CHECK (min_rir BETWEEN 0 AND 5),
  substitutes       integer[] NOT NULL DEFAULT '{}',
  contraindications text[] NOT NULL DEFAULT '{}',
  is_custom         boolean NOT NULL DEFAULT false,
  user_id           uuid REFERENCES users (id) ON DELETE CASCADE,
  CHECK (is_custom = (user_id IS NOT NULL))
);
CREATE UNIQUE INDEX exercises_global_slug_uq ON exercises (slug) WHERE user_id IS NULL;
CREATE UNIQUE INDEX exercises_custom_slug_uq ON exercises (user_id, slug) WHERE user_id IS NOT NULL;
CREATE INDEX exercises_pattern_idx ON exercises (pattern, tier);

-- Тренировки --------------------------------------------------------------

CREATE TABLE training_blocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  goal_snapshot jsonb NOT NULL,
  start_date    date NOT NULL,
  weeks         smallint NOT NULL CHECK (weeks BETWEEN 1 AND 8),
  deload_week   smallint CHECK (deload_week BETWEEN 1 AND 8),
  plan_json     jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX training_blocks_one_active_uq ON training_blocks (user_id) WHERE status = 'active';

CREATE TABLE scheduled_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  block_id     uuid REFERENCES training_blocks (id) ON DELETE SET NULL,
  date         date NOT NULL,
  planned_json jsonb,
  status       text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'missed', 'moved')),
  moved_to     date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_sessions_user_date_idx ON scheduled_sessions (user_id, date);

CREATE TABLE workouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid REFERENCES scheduled_sessions (id) ON DELETE SET NULL,
  date       date NOT NULL,
  readiness  smallint CHECK (readiness BETWEEN 1 AND 5),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workouts_user_date_idx ON workouts (user_id, date);

CREATE TABLE workout_sets (
  id          bigserial PRIMARY KEY,
  workout_id  uuid NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  exercise_id integer NOT NULL REFERENCES exercises (id),
  set_no      smallint NOT NULL CHECK (set_no >= 1),
  weight_kg   numeric(6, 2) NOT NULL CHECK (weight_kg >= 0),
  reps        smallint NOT NULL CHECK (reps BETWEEN 0 AND 100),
  rir         smallint CHECK (rir BETWEEN 0 AND 10),
  est_1rm     numeric(6, 2),
  is_test     boolean NOT NULL DEFAULT false,
  UNIQUE (workout_id, exercise_id, set_no)
);

CREATE TABLE personal_records (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  exercise_id integer NOT NULL REFERENCES exercises (id),
  weight_kg   numeric(6, 2) NOT NULL,
  reps        smallint NOT NULL,
  est_1rm     numeric(6, 2) NOT NULL,
  date        date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personal_records_user_date_idx ON personal_records (user_id, date);
CREATE INDEX personal_records_user_exercise_idx ON personal_records (user_id, exercise_id);

-- ИИ ----------------------------------------------------------------------

CREATE TABLE diagnostics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trigger     text NOT NULL,
  exercise_id integer REFERENCES exercises (id),
  tests       jsonb NOT NULL DEFAULT '[]'::jsonb,
  results     jsonb,
  conclusion  text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'testing', 'done', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diagnostics_user_idx ON diagnostics (user_id, created_at);

CREATE TABLE ai_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('weekly', 'miss', 'diagnostic', 'forecast')),
  period_start date,
  input_json   jsonb NOT NULL,
  output_json  jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reports_user_kind_idx ON ai_reports (user_id, kind, created_at);

CREATE TABLE ai_usage (
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date     date NOT NULL,
  kind     text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  tokens   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date, kind)
);

-- Down Migration

DROP TABLE IF EXISTS ai_usage;
DROP TABLE IF EXISTS ai_reports;
DROP TABLE IF EXISTS diagnostics;
DROP TABLE IF EXISTS personal_records;
DROP TABLE IF EXISTS workout_sets;
DROP TABLE IF EXISTS workouts;
DROP TABLE IF EXISTS scheduled_sessions;
DROP TABLE IF EXISTS training_blocks;
DROP TABLE IF EXISTS exercises;
DROP TABLE IF EXISTS meal_items;
DROP TABLE IF EXISTS meals;
DROP TABLE IF EXISTS body_measurements;
DROP TABLE IF EXISTS wellbeing_logs;
DROP TABLE IF EXISTS step_logs;
DROP TABLE IF EXISTS weight_logs;
DROP TABLE IF EXISTS onboarding;
DROP TABLE IF EXISTS card_versions;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

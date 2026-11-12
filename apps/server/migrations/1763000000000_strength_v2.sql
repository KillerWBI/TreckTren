-- Up Migration

-- Веса для всех упражнений со свободным весом: максимум упражнения ≈ ref_ratio × максимум
-- опорного движения (присед, становая, жим лёжа, жим стоя, тяга в наклоне).
-- per_hand — вес на одну гантель. stack — блоки и тренажёры: стеки в каждом зале разные,
-- такие веса не считаем, человек подбирает по запасу.

ALTER TABLE exercises ADD COLUMN ref_slug text;
ALTER TABLE exercises ADD COLUMN ref_ratio numeric(4, 3);
ALTER TABLE exercises ADD COLUMN per_hand boolean NOT NULL DEFAULT false;
ALTER TABLE exercises ADD COLUMN stack boolean NOT NULL DEFAULT false;

UPDATE exercises SET stack = true
WHERE user_id IS NULL AND (requires && '{cable,machines,leg_press}'::text[]);

UPDATE exercises AS e SET ref_slug = v.ref, ref_ratio = v.ratio, per_hand = v.per_hand
FROM (VALUES
  ('front-squat',                'barbell-back-squat', 0.82, false),
  ('pause-squat',                'barbell-back-squat', 0.87, false),
  ('smith-squat',                'barbell-back-squat', 0.95, false),
  ('goblet-squat',               'barbell-back-squat', 0.32, false),
  ('bulgarian-split-squat',      'barbell-back-squat', 0.27, true),
  ('dumbbell-lunge',             'barbell-back-squat', 0.27, true),
  ('step-up',                    'barbell-back-squat', 0.22, true),
  ('good-morning',               'barbell-back-squat', 0.45, false),
  ('hip-thrust',                 'barbell-back-squat', 1.10, false),
  ('dumbbell-calf-raise',        'barbell-back-squat', 0.25, true),
  ('romanian-deadlift',          'deadlift',           0.65, false),
  ('dumbbell-romanian-deadlift', 'deadlift',           0.30, true),
  ('deficit-deadlift',           'deadlift',           0.88, false),
  ('kettlebell-swing',           'deadlift',           0.15, false),
  ('dumbbell-shrug',             'deadlift',           0.35, true),
  ('incline-dumbbell-press',     'bench-press',        0.37, true),
  ('close-grip-bench-press',     'bench-press',        0.88, false),
  ('pause-bench-press',          'bench-press',        0.93, false),
  ('dumbbell-bench-press',       'bench-press',        0.40, true),
  ('dumbbell-fly',               'bench-press',        0.18, true),
  ('barbell-curl',               'bench-press',        0.45, false),
  ('incline-dumbbell-curl',      'bench-press',        0.16, true),
  ('hammer-curl',                'bench-press',        0.20, true),
  ('dumbbell-curl',              'bench-press',        0.18, true),
  ('skull-crusher',              'bench-press',        0.38, false),
  ('seated-dumbbell-press',      'overhead-press',     0.40, true),
  ('arnold-press',               'overhead-press',     0.35, true),
  ('dumbbell-lateral-raise',     'overhead-press',     0.20, true),
  ('rear-delt-fly',              'overhead-press',     0.14, true),
  ('one-arm-dumbbell-row',       'barbell-row',        0.45, false),
  ('chest-supported-row',        'barbell-row',        0.35, true)
) AS v(slug, ref, ratio, per_hand)
WHERE e.slug = v.slug AND e.user_id IS NULL;

-- Брусья — собственный вес, добавочный вес по самочувствию.
UPDATE exercises SET bodyweight = true WHERE slug = 'dips' AND user_id IS NULL;

-- Результаты проходки и других проверок по конкретной тренировке.
ALTER TABLE scheduled_sessions ADD COLUMN result_json jsonb;

-- Down Migration

ALTER TABLE scheduled_sessions DROP COLUMN result_json;
UPDATE exercises SET bodyweight = false WHERE slug = 'dips' AND user_id IS NULL;
ALTER TABLE exercises DROP COLUMN stack;
ALTER TABLE exercises DROP COLUMN per_hand;
ALTER TABLE exercises DROP COLUMN ref_ratio;
ALTER TABLE exercises DROP COLUMN ref_slug;

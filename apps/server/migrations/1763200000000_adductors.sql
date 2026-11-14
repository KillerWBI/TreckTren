-- Up Migration

-- Приводящие мышцы бедра (внутренняя поверхность) — своя группа на портрете и в приоритетах.
-- Своё упражнение в тренажёре и копенгагенская планка, плюс приводящие как помощники в
-- приседах и выпадах.

INSERT INTO exercises
  (slug, name_ru, name_en, pattern, primary_muscles, secondary_muscles, requires, is_compound, tier, weight_step_kg, min_rir, contraindications, baseline, bodyweight, stack)
VALUES
  ('hip-adduction', 'Сведение ног в тренажёре', 'Hip adduction machine', 'isolation', '{adductors}', '{}', '{machines}', false, 'A', 5, 0, '{пах}', false, false, true),
  ('copenhagen-plank', 'Копенгагенская планка', 'Copenhagen plank', 'isolation', '{adductors}', '{abs}', '{bench}', false, 'B', NULL, 1, '{пах,колен}', false, true, false);

UPDATE exercises SET secondary_muscles = array_append(secondary_muscles, 'adductors')
WHERE user_id IS NULL
  AND slug IN ('barbell-back-squat', 'pause-squat', 'goblet-squat', 'leg-press',
               'bulgarian-split-squat', 'dumbbell-lunge', 'step-up')
  AND NOT ('adductors' = ANY (secondary_muscles));

-- Down Migration

UPDATE exercises SET secondary_muscles = array_remove(secondary_muscles, 'adductors')
WHERE user_id IS NULL;
DELETE FROM exercises WHERE user_id IS NULL AND slug IN ('hip-adduction', 'copenhagen-plank');

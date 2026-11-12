-- Up Migration

-- Курируемая база упражнений для первого плана. requires — всё оборудование, без которого
-- упражнение не сделать (коды из EQUIPMENT_ITEMS); пустой массив — только вес тела.
-- contraindications — основы слов, по которым упражнение исключается при травмах.
-- baseline — упражнения формы стартовых весов.

ALTER TABLE exercises ADD COLUMN requires text[] NOT NULL DEFAULT '{}';
ALTER TABLE exercises ADD COLUMN baseline boolean NOT NULL DEFAULT false;
ALTER TABLE exercises ADD COLUMN bodyweight boolean NOT NULL DEFAULT false;

INSERT INTO exercises
  (slug, name_ru, name_en, pattern, primary_muscles, secondary_muscles, requires, is_compound, tier, weight_step_kg, min_rir, contraindications, baseline, bodyweight)
VALUES
  -- Присед
  ('barbell-back-squat', 'Присед со штангой', 'Barbell back squat', 'squat', '{quads,glutes}', '{hamstrings,abs}', '{barbell,rack}', true, 'S', 2.5, 1, '{колен,поясниц,спин}', true, false),
  ('front-squat', 'Фронтальный присед', 'Front squat', 'squat', '{quads,glutes}', '{abs,back}', '{barbell,rack}', true, 'S', 2.5, 1, '{колен,запяст}', false, false),
  ('pause-squat', 'Присед с паузой', 'Pause squat', 'squat', '{quads,glutes}', '{hamstrings,abs}', '{barbell,rack}', true, 'A', 2.5, 1, '{колен,поясниц}', false, false),
  ('hack-squat', 'Гакк-присед', 'Hack squat', 'squat', '{quads}', '{glutes}', '{machines}', true, 'A', 5, 1, '{колен}', false, false),
  ('leg-press', 'Жим ногами', 'Leg press', 'squat', '{quads,glutes}', '{hamstrings}', '{leg_press}', true, 'A', 5, 1, '{колен}', false, false),
  ('goblet-squat', 'Гоблет-присед', 'Goblet squat', 'squat', '{quads,glutes}', '{abs}', '{dumbbells}', true, 'A', 2, 1, '{колен}', false, false),
  ('smith-squat', 'Присед в Смите', 'Smith machine squat', 'squat', '{quads,glutes}', '{hamstrings}', '{smith}', true, 'B', 2.5, 1, '{колен}', false, false),

  -- Тазобедренный шарнир
  ('deadlift', 'Становая тяга', 'Deadlift', 'hinge', '{hamstrings,glutes,back}', '{traps,forearms}', '{barbell}', true, 'S', 2.5, 1, '{поясниц,спин,грыж}', true, false),
  ('romanian-deadlift', 'Румынская тяга', 'Romanian deadlift', 'hinge', '{hamstrings,glutes}', '{back}', '{barbell}', true, 'S', 2.5, 1, '{поясниц,спин,грыж}', true, false),
  ('dumbbell-romanian-deadlift', 'Румынская тяга с гантелями', 'Dumbbell Romanian deadlift', 'hinge', '{hamstrings,glutes}', '{back}', '{dumbbells}', true, 'A', 2, 1, '{поясниц,грыж}', false, false),
  ('deficit-deadlift', 'Тяга с дефицита', 'Deficit deadlift', 'hinge', '{hamstrings,glutes,back}', '{quads}', '{barbell}', true, 'A', 2.5, 1, '{поясниц,спин,грыж}', false, false),
  ('good-morning', 'Гудморнинг', 'Good morning', 'hinge', '{hamstrings}', '{glutes,back}', '{barbell,rack}', true, 'A', 2.5, 2, '{поясниц,спин,грыж}', false, false),
  ('hip-thrust', 'Ягодичный мост со штангой', 'Barbell hip thrust', 'hinge', '{glutes}', '{hamstrings}', '{barbell,bench}', true, 'A', 2.5, 1, '{}', false, false),
  ('back-extension', 'Гиперэкстензия', 'Back extension', 'hinge', '{glutes,hamstrings}', '{back}', '{machines}', false, 'A', 2.5, 1, '{грыж}', false, false),
  ('kettlebell-swing', 'Махи гирей', 'Kettlebell swing', 'hinge', '{glutes,hamstrings}', '{back}', '{kettlebells}', true, 'A', 4, 2, '{поясниц,грыж}', false, false),

  -- Одна нога
  ('bulgarian-split-squat', 'Болгарский сплит-присед', 'Bulgarian split squat', 'single_leg', '{quads,glutes}', '{hamstrings}', '{dumbbells,bench}', true, 'S', 2, 1, '{колен}', false, false),
  ('dumbbell-lunge', 'Выпады с гантелями', 'Dumbbell lunge', 'single_leg', '{quads,glutes}', '{hamstrings}', '{dumbbells}', true, 'A', 2, 1, '{колен}', false, false),
  ('step-up', 'Зашагивания на скамью', 'Step-up', 'single_leg', '{quads,glutes}', '{hamstrings}', '{dumbbells,bench}', true, 'A', 2, 1, '{колен}', false, false),
  ('bodyweight-split-squat', 'Сплит-присед с весом тела', 'Bodyweight split squat', 'single_leg', '{quads,glutes}', '{}', '{}', true, 'B', NULL, 1, '{колен}', false, true),

  -- Горизонтальный жим
  ('bench-press', 'Жим лёжа', 'Bench press', 'horizontal_push', '{chest}', '{triceps,shoulders}', '{barbell,bench}', true, 'S', 2.5, 1, '{плеч}', true, false),
  ('incline-dumbbell-press', 'Жим гантелей на наклонной', 'Incline dumbbell press', 'horizontal_push', '{chest,shoulders}', '{triceps}', '{dumbbells,bench}', true, 'S', 2, 1, '{плеч}', true, false),
  ('close-grip-bench-press', 'Жим узким хватом', 'Close-grip bench press', 'horizontal_push', '{triceps,chest}', '{shoulders}', '{barbell,bench}', true, 'A', 2.5, 1, '{локт,запяст}', false, false),
  ('pause-bench-press', 'Жим лёжа с паузой', 'Pause bench press', 'horizontal_push', '{chest}', '{triceps,shoulders}', '{barbell,bench}', true, 'A', 2.5, 1, '{плеч}', false, false),
  ('dumbbell-bench-press', 'Жим гантелей лёжа', 'Dumbbell bench press', 'horizontal_push', '{chest}', '{triceps,shoulders}', '{dumbbells,bench}', true, 'A', 2, 1, '{плеч}', false, false),
  ('dips', 'Отжимания на брусьях', 'Dips', 'horizontal_push', '{chest,triceps}', '{shoulders}', '{dip_bars}', true, 'A', 2.5, 1, '{плеч,локт}', false, true),
  ('machine-chest-press', 'Жим в тренажёре', 'Machine chest press', 'horizontal_push', '{chest}', '{triceps}', '{machines}', true, 'A', 5, 0, '{}', false, false),
  ('push-up', 'Отжимания от пола', 'Push-up', 'horizontal_push', '{chest,triceps}', '{shoulders,abs}', '{}', true, 'B', NULL, 1, '{запяст}', false, true),

  -- Вертикальный жим
  ('overhead-press', 'Жим штанги стоя', 'Overhead press', 'vertical_push', '{shoulders}', '{triceps,abs}', '{barbell}', true, 'S', 2.5, 1, '{плеч,поясниц}', true, false),
  ('seated-dumbbell-press', 'Жим гантелей сидя', 'Seated dumbbell press', 'vertical_push', '{shoulders}', '{triceps}', '{dumbbells,bench}', true, 'A', 2, 1, '{плеч}', false, false),
  ('arnold-press', 'Жим Арнольда', 'Arnold press', 'vertical_push', '{shoulders}', '{triceps}', '{dumbbells}', true, 'A', 2, 1, '{плеч}', false, false),

  -- Вертикальная тяга
  ('pull-up', 'Подтягивания', 'Pull-up', 'vertical_pull', '{back}', '{biceps,forearms}', '{pullup_bar}', true, 'S', NULL, 1, '{плеч,локт}', false, true),
  ('weighted-pull-up', 'Подтягивания с весом', 'Weighted pull-up', 'vertical_pull', '{back}', '{biceps,forearms}', '{pullup_bar}', true, 'S', 2.5, 1, '{плеч,локт}', false, false),
  ('chin-up', 'Подтягивания обратным хватом', 'Chin-up', 'vertical_pull', '{back,biceps}', '{forearms}', '{pullup_bar}', true, 'A', NULL, 1, '{локт}', false, true),
  ('neutral-grip-pull-up', 'Подтягивания нейтральным хватом', 'Neutral-grip pull-up', 'vertical_pull', '{back}', '{biceps}', '{pullup_bar}', true, 'A', NULL, 1, '{}', false, true),
  ('lat-pulldown', 'Тяга верхнего блока', 'Lat pulldown', 'vertical_pull', '{back}', '{biceps}', '{cable}', true, 'A', 5, 0, '{}', false, false),

  -- Горизонтальная тяга
  ('barbell-row', 'Тяга штанги в наклоне', 'Barbell row', 'horizontal_pull', '{back}', '{biceps,traps}', '{barbell}', true, 'S', 2.5, 1, '{поясниц,грыж}', true, false),
  ('one-arm-dumbbell-row', 'Тяга гантели одной рукой', 'One-arm dumbbell row', 'horizontal_pull', '{back}', '{biceps}', '{dumbbells,bench}', true, 'A', 2, 1, '{}', false, false),
  ('chest-supported-row', 'Тяга гантелей с упором грудью', 'Chest-supported row', 'horizontal_pull', '{back}', '{biceps,traps}', '{dumbbells,bench}', true, 'A', 2, 1, '{}', false, false),
  ('seated-cable-row', 'Тяга нижнего блока', 'Seated cable row', 'horizontal_pull', '{back}', '{biceps}', '{cable}', true, 'A', 5, 0, '{}', false, false),

  -- Изоляция ног
  ('seated-leg-curl', 'Сгибание ног сидя', 'Seated leg curl', 'isolation', '{hamstrings}', '{}', '{machines}', false, 'S', 5, 0, '{}', false, false),
  ('leg-extension', 'Разгибание ног', 'Leg extension', 'isolation', '{quads}', '{}', '{machines}', false, 'S', 5, 0, '{колен}', false, false),
  ('lying-leg-curl', 'Сгибание ног лёжа', 'Lying leg curl', 'isolation', '{hamstrings}', '{}', '{machines}', false, 'A', 5, 0, '{}', false, false),
  ('standing-calf-raise', 'Подъёмы на носки стоя', 'Standing calf raise', 'isolation', '{calves}', '{}', '{machines}', false, 'A', 5, 0, '{}', false, false),
  ('seated-calf-raise', 'Подъёмы на носки сидя', 'Seated calf raise', 'isolation', '{calves}', '{}', '{machines}', false, 'A', 5, 0, '{}', false, false),
  ('dumbbell-calf-raise', 'Подъёмы на носки с гантелями', 'Dumbbell calf raise', 'isolation', '{calves}', '{}', '{dumbbells}', false, 'B', 2, 0, '{}', false, false),

  -- Грудь, плечи, трапеции
  ('cable-fly', 'Сведение рук в кроссовере', 'Cable fly', 'isolation', '{chest}', '{shoulders}', '{cable}', false, 'S', 2.5, 0, '{плеч}', false, false),
  ('dumbbell-fly', 'Разведения гантелей лёжа', 'Dumbbell fly', 'isolation', '{chest}', '{shoulders}', '{dumbbells,bench}', false, 'B', 2, 1, '{плеч}', false, false),
  ('dumbbell-lateral-raise', 'Махи гантелями в стороны', 'Dumbbell lateral raise', 'isolation', '{shoulders}', '{traps}', '{dumbbells}', false, 'S', 1, 0, '{}', false, false),
  ('cable-lateral-raise', 'Махи в кроссовере', 'Cable lateral raise', 'isolation', '{shoulders}', '{}', '{cable}', false, 'A', 2.5, 0, '{}', false, false),
  ('rear-delt-fly', 'Разведения в наклоне', 'Rear delt fly', 'isolation', '{shoulders}', '{back,traps}', '{dumbbells}', false, 'A', 1, 0, '{}', false, false),
  ('face-pull', 'Тяга к лицу', 'Face pull', 'isolation', '{shoulders}', '{traps,back}', '{cable}', false, 'A', 2.5, 0, '{}', false, false),
  ('band-pull-apart', 'Разведение резинки', 'Band pull-apart', 'isolation', '{shoulders}', '{traps}', '{bands}', false, 'B', NULL, 0, '{}', false, true),
  ('dumbbell-shrug', 'Шраги с гантелями', 'Dumbbell shrug', 'isolation', '{traps}', '{forearms}', '{dumbbells}', false, 'A', 2, 0, '{ше}', false, false),

  -- Руки
  ('barbell-curl', 'Сгибания со штангой', 'Barbell curl', 'isolation', '{biceps}', '{forearms}', '{barbell}', false, 'S', 2.5, 0, '{локт}', false, false),
  ('overhead-cable-extension', 'Разгибания на блоке из-за головы', 'Overhead cable extension', 'isolation', '{triceps}', '{}', '{cable}', false, 'S', 2.5, 0, '{локт}', false, false),
  ('incline-dumbbell-curl', 'Сгибания на наклонной скамье', 'Incline dumbbell curl', 'isolation', '{biceps}', '{}', '{dumbbells,bench}', false, 'A', 1, 0, '{локт}', false, false),
  ('hammer-curl', 'Молотки', 'Hammer curl', 'isolation', '{biceps,forearms}', '{}', '{dumbbells}', false, 'A', 2, 0, '{}', false, false),
  ('skull-crusher', 'Французский жим', 'Skull crusher', 'isolation', '{triceps}', '{}', '{barbell,bench}', false, 'A', 2.5, 1, '{локт}', false, false),
  ('cable-pushdown', 'Разгибания на блоке', 'Cable pushdown', 'isolation', '{triceps}', '{}', '{cable}', false, 'A', 2.5, 0, '{}', false, false),
  ('dumbbell-curl', 'Сгибания с гантелями', 'Dumbbell curl', 'isolation', '{biceps}', '{forearms}', '{dumbbells}', false, 'B', 1, 0, '{}', false, false),

  -- Кор
  ('hanging-leg-raise', 'Подъём ног в висе', 'Hanging leg raise', 'core', '{abs}', '{forearms}', '{pullup_bar}', false, 'S', NULL, 1, '{поясниц}', false, true),
  ('ab-wheel', 'Ролик для пресса', 'Ab wheel rollout', 'core', '{abs}', '{back}', '{}', false, 'S', NULL, 1, '{поясниц,грыж}', false, true),
  ('plank', 'Планка', 'Plank', 'core', '{abs}', '{shoulders}', '{}', false, 'A', NULL, 1, '{}', false, true),
  ('pallof-press', 'Паллоф-пресс', 'Pallof press', 'core', '{abs}', '{}', '{cable}', false, 'A', 2.5, 1, '{}', false, false),
  ('cable-crunch', 'Скручивания на блоке', 'Cable crunch', 'core', '{abs}', '{}', '{cable}', false, 'A', 2.5, 0, '{}', false, false);

-- Down Migration

DELETE FROM exercises WHERE user_id IS NULL;
ALTER TABLE exercises DROP COLUMN bodyweight;
ALTER TABLE exercises DROP COLUMN baseline;
ALTER TABLE exercises DROP COLUMN requires;

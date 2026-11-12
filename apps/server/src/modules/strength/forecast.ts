import type { AthleteCard, BalanceFinding, BlockTemplate, LiftForecast } from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';
import type { MaxEstimate } from './estimate.js';

/** Что проверяем на проходке: троеборье, если оно есть в блоке, и всё, на что есть цели. */
const TEST_PRIORITY = ['barbell-back-squat', 'bench-press', 'deadlift', 'overhead-press'];
const MAX_TEST_LIFTS = 3;

/** Прирост максимума за 4 недели накопления по стажу. Дальше — медленнее. */
function baseGain(years: number): number {
  if (years < 1) return 0.06;
  if (years < 2) return 0.04;
  if (years < 4) return 0.025;
  return 0.015;
}

const GOAL_FACTOR: Record<string, number> = {
  strength: 1,
  strength_hypertrophy: 0.85,
  recomp: 0.5,
  hypertrophy: 0.5,
  general_fitness: 0.5,
  fat_loss: 0.2,
};

const roundDown = (n: number) => Math.floor(n / 2.5) * 2.5;
const roundUp = (n: number) => Math.ceil(n / 2.5) * 2.5;

function ageOn(birthDate: string | undefined, today: string): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty! - y! - (tm! < m! || (tm === m && td! < d!) ? 1 : 0);
}

/**
 * Прогноз максимумов на конец блока: стаж, цель, возраст, длина блока и отстающие движения.
 * Грубо, но честно: прогноз сверяется на проходке, и следующий блок строится по факту.
 */
export function forecastBlock(input: {
  card: AthleteCard;
  template: BlockTemplate;
  maxes: Map<string, MaxEstimate>;
  exercises: Map<string, Exercise>;
  findings: BalanceFinding[];
  today: string;
}): LiftForecast[] {
  const { card, template, maxes, exercises, findings, today } = input;
  const inBlock = new Set(template.sessions.flatMap((s) => s.exercises.map((x) => x.slug)));
  const targets = card.strength?.targets ?? {};
  const lagging = new Set(findings.map((f) => f.lagging));

  const candidates = [
    ...TEST_PRIORITY.filter((slug) => targets[slug] || inBlock.has(slug)),
    ...Object.keys(targets).filter((slug) => !TEST_PRIORITY.includes(slug)),
  ];
  const slugs = [...new Set(candidates)].filter((slug) => maxes.has(slug)).slice(0, MAX_TEST_LIFTS);

  const years = card.experience?.trainingYears ?? 0;
  const age = ageOn(card.basics?.birthDate, today);
  let gain = baseGain(years) * (GOAL_FACTOR[card.goals?.primary ?? 'general_fitness'] ?? 0.5);
  if (age !== null && age < 23) gain *= 1.15;
  gain *= template.accumulationWeeks / 4;

  return slugs.map((slug) => {
    const max = maxes.get(slug)!;
    const g = gain * (lagging.has(slug) ? 1.25 : 1);
    const startKg = max.oneRmKg;
    const targetKg = Math.max(roundUp(startKg * (1 + g)), roundDown(startKg) + 2.5);
    const goalKg = targets[slug] ?? null;
    let blocksToGoal: number | null = null;
    if (goalKg && goalKg > startKg) {
      // Каждый следующий блок даёт немного меньше: темп падает на 10% за блок.
      let kg = startKg;
      let step = g;
      blocksToGoal = 0;
      while (kg < goalKg && blocksToGoal < 40) {
        kg *= 1 + step;
        step *= 0.9;
        blocksToGoal += 1;
      }
      if (kg < goalKg) blocksToGoal = null;
    }
    return {
      slug,
      name: exercises.get(slug)?.name ?? slug,
      startKg,
      targetKg,
      goalKg,
      blocksToGoal,
      estimated: max.basis !== 'own',
    };
  });
}

/** Подводка к попытке: 50/70/80/90% от веса попытки, округлено до 2,5 кг. */
export function warmupNote(targetKg: number): string {
  const steps = [
    [0.5, 5],
    [0.7, 3],
    [0.8, 2],
    [0.9, 1],
  ] as const;
  const parts = steps.map(
    ([p, reps]) => `${String(roundDown(targetKg * p)).replace('.', ',')}×${reps}`,
  );
  return `Подводка: ${parts.join(', ')}, затем попытка. Пошло легко — +2,5 кг и ещё одна. Отдых 3–5 минут.`;
}

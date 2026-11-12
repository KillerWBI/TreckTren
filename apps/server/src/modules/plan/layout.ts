import type {
  BlockTemplate,
  PlannedExercise,
  PlannedSession,
  SessionTemplate,
} from '@trektren/shared';
import { diffDays, mondayOf } from '../../dates.js';
import type { Exercise } from '../exercises/repo.js';

/** Крупные группы, которым нужно 48+ часов между тяжёлыми тренировками. */
const MAJOR = ['quads', 'hamstrings', 'glutes', 'back', 'chest', 'shoulders'] as const;
const MUSCLE_RU: Record<string, string> = {
  quads: 'квадрицепс',
  hamstrings: 'бицепс бедра',
  glutes: 'ягодицы',
  back: 'спина',
  chest: 'грудь',
  shoulders: 'плечи',
};
/** Подходов на группу за тренировку, после которых она считается нагруженной тяжело. */
const HEAVY_SETS = 3;
const MIN_RECOVERY_DAYS = 2;
const LONG_BREAK_DAYS = 10;
const DELOAD_RIR = 3;

export interface LaidOutSession {
  date: string;
  planned: PlannedSession;
}

/**
 * Раскладывает шаблон блока по выбранным датам.
 * Неделя считается от понедельника первой даты; после блока — разгрузочная неделя.
 * Если между тренировками меньше 2 дней и группы пересекаются — ставим другую тренировку
 * из ротации, а если такой нет — снижаем объём. После перерыва 10+ дней веса −10%.
 */
export function layoutSessions(
  template: BlockTemplate,
  dates: string[],
  exercises: Map<string, Exercise>,
  startDate = dates[0]!,
): LaidOutSession[] {
  const startMonday = mondayOf(startDate);
  const byKey = new Map(template.sessions.map((s) => [s.key, s]));
  const heavy = new Map(template.sessions.map((s) => [s.key, heavyGroups(s, exercises)]));
  const rotation = template.rotation.filter((k) => byKey.has(k));
  const deloadWeek = template.accumulationWeeks + 1;

  const result: LaidOutSession[] = [];
  let pointer = 0;
  let prevDate: string | null = null;
  let prevKey: string | null = null;

  for (const date of dates) {
    const week = Math.floor(diffDays(startMonday, date) / 7) + 1;
    const gapDays = prevDate ? diffDays(prevDate, date) : null;

    if (week > deloadWeek) {
      result.push({
        date,
        planned: {
          week,
          phase: 'after_block',
          templateKey: '',
          title: 'После блока',
          gapDays,
          adjustments: ['Блок к этой дате закончится — построй новый план, чтобы продолжить.'],
          exercises: [],
        },
      });
      prevDate = date;
      continue;
    }

    const adjustments: string[] = [];
    let key = rotation[pointer % rotation.length]!;
    let advance = true;
    let light = false;

    if (gapDays !== null && gapDays < MIN_RECOVERY_DAYS && prevKey) {
      const clash = overlap(heavy.get(prevKey)!, heavy.get(key)!);
      if (clash.length > 0) {
        const alternative = rotation.find(
          (k) => k !== prevKey && overlap(heavy.get(prevKey!)!, heavy.get(k)!).length === 0,
        );
        if (alternative) {
          key = alternative;
          advance = false;
          adjustments.push(
            `Через ${gapDays} д. после прошлой: поставил «${byKey.get(key)!.title}», чтобы не грузить ${ruList(clash)} подряд.`,
          );
        } else {
          light = true;
          adjustments.push(
            `Через ${gapDays} д. после прошлой ${ruList(clash)} не успеют восстановиться: на подход меньше, запас на повтор больше.`,
          );
        }
      }
    }

    let loadFactor = 1;
    if (gapDays !== null && gapDays >= LONG_BREAK_DAYS) {
      loadFactor = 0.9;
      adjustments.push(`Перерыв ${gapDays} дней: рабочие веса −10%.`);
    }

    const session = byKey.get(key)!;
    const phase = week === deloadWeek ? 'deload' : 'accumulation';
    if (phase === 'deload') adjustments.push('Разгрузка: подходов вдвое меньше, веса −10%.');
    const rule = template.weeks[Math.min(week, template.accumulationWeeks) - 1]!;

    const planned: PlannedExercise[] = session.exercises.map((x) => {
      const minRir = exercises.get(x.slug)?.minRir ?? 0;
      let sets = phase === 'deload' ? Math.ceil(x.sets / 2) : x.sets + rule.extraSets;
      let rir = phase === 'deload' ? DELOAD_RIR : Math.max(rule.rir, minRir);
      let factor = loadFactor * (phase === 'deload' ? 0.9 : 1);
      if (light) {
        sets = Math.max(1, sets - 1);
        rir += 1;
      }
      factor = Math.round(factor * 100) / 100;
      return {
        slug: x.slug,
        sets,
        repsMin: x.repsMin,
        repsMax: x.repsMax,
        rir,
        loadFactor: factor,
        ...(x.note ? { note: x.note } : {}),
      };
    });

    result.push({
      date,
      planned: {
        week,
        phase,
        templateKey: key,
        title: session.title,
        gapDays,
        adjustments,
        exercises: planned,
      },
    });
    if (advance) pointer += 1;
    prevDate = date;
    prevKey = key;
  }
  return result;
}

/**
 * Крупные группы, на которые в тренировке приходится 3+ подходов.
 * Главная мышца упражнения (первая в списке) получает подход целиком, остальные основные — половину:
 * становая грузит спину, но не так, как тяга к поясу, и после дня верха её ставить можно.
 */
export function heavyGroups(session: SessionTemplate, exercises: Map<string, Exercise>): string[] {
  const sets = new Map<string, number>();
  for (const x of session.exercises) {
    (exercises.get(x.slug)?.primaryMuscles ?? []).forEach((m, i) => {
      sets.set(m, (sets.get(m) ?? 0) + x.sets * (i === 0 ? 1 : 0.5));
    });
  }
  return MAJOR.filter((m) => (sets.get(m) ?? 0) >= HEAVY_SETS);
}

function overlap(a: string[], b: string[]): string[] {
  return a.filter((m) => b.includes(m));
}

function ruList(groups: string[]): string {
  return groups.map((g) => MUSCLE_RU[g] ?? g).join(', ');
}

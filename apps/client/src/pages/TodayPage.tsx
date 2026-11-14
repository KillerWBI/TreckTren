import { useEffect, useId, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  SLEEP_TEXT,
  WELLBEING_TEXT,
  type DayResponse,
  type Macros,
  type MealType,
  type TimeOfDay,
  type WellbeingView,
} from '@trektren/shared';
import { ApiError } from '../api/http';
import { Ring } from '../components/Ring';
import { Slider } from '../components/Slider';
import { ErrorState } from '../components/States';
import { num, todayIso } from '../format';
import { MEAL_LABELS, MealForm } from '../day/MealForm';
import {
  useDay,
  useDeleteMeal,
  useDeleteWeight,
  usePutSteps,
  usePutWeight,
  usePutWellbeing,
  useSetAdjust,
} from '../day/useDay';
import { WeightChart } from '../day/WeightChart';
import { addDays, fullDay } from '../plan/dates';
import { usePlan, useStartWorkout } from '../plan/usePlan';

export function TodayPage() {
  const today = todayIso();
  const [date, setDate] = useState(today);
  const day = useDay(date);
  const plan = usePlan();

  const title = date === today ? 'Сегодня' : date === addDays(today, -1) ? 'Вчера' : fullDay(date);

  return (
    <main className="page today">
      <div className="day-switch">
        <button
          type="button"
          className="calendar-nav"
          aria-label="Предыдущий день"
          onClick={() => setDate(addDays(date, -1))}
        >
          <ChevronLeft size={26} strokeWidth={2.6} aria-hidden="true" />
        </button>
        <div>
          <h1 className="page-title">{title}</h1>
          {date === today && <p className="workout-date">{fullDay(date)}</p>}
        </div>
        <button
          type="button"
          className="calendar-nav"
          aria-label="Следующий день"
          onClick={() => setDate(addDays(date, 1))}
          disabled={date >= today}
        >
          <ChevronRight size={26} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>

      {day.isPending && <p className="state">Загружаю день…</p>}
      {day.isError && <ErrorState error={day.error} onRetry={() => void day.refetch()} />}
      {day.data && (
        <DayView key={date} date={date} day={day.data} aiEnabled={plan.data?.ai.enabled ?? false} />
      )}
    </main>
  );
}

/**
 * Телефон — одна колонка в порядке дня: тренировка, калории, вес, шаги, сон, еда.
 * ПК — две колонки: слева тренировка, калории и еда, справа вес, шаги и сон.
 */
function DayView({ date, day, aiEnabled }: { date: string; day: DayResponse; aiEnabled: boolean }) {
  return (
    <div className="cols cols-mixed">
      <div className="col">
        <WorkoutToday day={day} />
        <Calories day={day} />
        <Food date={date} day={day} aiEnabled={aiEnabled} />
      </div>
      <div className="col">
        <Weight date={date} day={day} />
        <Steps date={date} day={day} />
        <Wellbeing date={date} day={day} />
      </div>
    </div>
  );
}

/* Тренировка дня ---------------------------------------------------------- */

function WorkoutToday({ day }: { day: DayResponse }) {
  const navigate = useNavigate();
  const start = useStartWorkout();
  if (!day.session && !day.workout) {
    return (
      <p className="today-workout today-rest" style={{ order: 1 }}>
        По плану тренировки нет — день восстановления. <Link to="/plan">Открыть план</Link>
      </p>
    );
  }
  const title = day.session?.title ?? 'Тренировка';
  return (
    <section className="today-workout" aria-label="Тренировка" style={{ order: 1 }}>
      <div>
        <p className="today-workout-kicker">
          {day.workout?.finished ? 'Тренировка сделана' : 'Тренировка дня'}
        </p>
        <p className="today-workout-title">{title}</p>
      </div>
      {day.workout ? (
        <Link to={`/workout/${day.workout.id}`} className="button">
          {day.workout.finished ? 'Разбор тренировки' : 'Продолжить тренировку'}
        </Link>
      ) : (
        <button
          type="button"
          className="button"
          disabled={start.isPending}
          onClick={() =>
            start.mutate(
              { sessionId: day.session!.id },
              { onSuccess: (data) => navigate(`/workout/${data.workout.id}`) },
            )
          }
        >
          {start.isPending ? 'Открываю…' : 'Начать тренировку'}
        </button>
      )}
      {day.session?.status === 'missed' && !day.workout && (
        <p className="form-error">Пропущена. Сделай сейчас — тренер учтёт, что позже по плану.</p>
      )}
    </section>
  );
}

/* Калории и БЖУ ----------------------------------------------------------- */

const MACROS: Array<{ key: keyof Macros; label: string; unit: string }> = [
  { key: 'proteinG', label: 'Белки', unit: 'г' },
  { key: 'fatG', label: 'Жиры', unit: 'г' },
  { key: 'carbsG', label: 'Углеводы', unit: 'г' },
];

function Calories({ day }: { day: DayResponse }) {
  const [open, setOpen] = useState(false);
  const { norm, eaten } = day;
  if (!norm) {
    return (
      <section className="kcal" aria-labelledby="kcal-heading" style={{ order: 2 }}>
        <h2 id="kcal-heading" className="group-title">
          Калории
        </h2>
        <p className="plan-hint">
          Для нормы не хватает: {day.normMissing.join(', ')}.{' '}
          <Link to="/card">Заполнить профиль</Link>
        </p>
      </section>
    );
  }
  const left = Math.round(norm.kcal - eaten.kcal);
  return (
    <section className="kcal" aria-labelledby="kcal-heading" style={{ order: 2 }}>
      <div className="card-head">
        <h2 id="kcal-heading" className="group-title">
          Калории
        </h2>
        <span className="kcal-meta">
          <span className="badge">норма {num(norm.kcal)}</span>
          <span className={norm.trainingDay ? 'badge badge-primary' : 'badge'}>
            {norm.trainingDay ? 'день тренировки' : 'день отдыха'}
          </span>
        </span>
      </div>
      <div className="kcal-top">
        <Ring
          size={136}
          stroke={14}
          share={eaten.kcal / norm.kcal}
          label={`Съедено ${num(Math.round(eaten.kcal))} из ${num(norm.kcal)} ккал`}
        >
          <span className="kcal-ring-number">{num(Math.abs(left))}</span>
          <span className="kcal-ring-caption">
            {left >= 0 ? 'ккал осталось' : 'ккал сверх нормы'}
          </span>
        </Ring>
        <ul className="macros">
          {MACROS.map((m) => {
            const need = norm[m.key];
            const have = eaten[m.key];
            return (
              <li key={m.key} className="macro" data-key={m.key}>
                <span className="macro-label">{m.label}</span>
                <span className="macro-value">
                  {num(Math.round(have))} / {num(need)} {m.unit}
                </span>
                <span className="bar bar-thin" aria-hidden="true">
                  <span
                    style={{ width: `${Math.min(1, have / need) * 100}%` }}
                    data-zero={have === 0 || undefined}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <button
        type="button"
        className="link-button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Скрыть расчёт' : 'Как считается норма'}
      </button>
      {open && (
        <dl className="kcal-parts">
          <div>
            <dt>Обмен в покое (Миффлин-Сан Жеор, {num(norm.weightKg)} кг)</dt>
            <dd>{num(norm.parts.bmr)}</dd>
          </div>
          <div>
            <dt>Быт, × 1,2</dt>
            <dd>{num(norm.parts.base)}</dd>
          </div>
          <div>
            <dt>
              Шаги сверх 3000
              {norm.stepsSource === 'average'
                ? ' (по средним из профиля — впиши свои вечером)'
                : norm.stepsSource === 'none'
                  ? ' (не вписаны)'
                  : ''}
            </dt>
            <dd>+{num(norm.parts.steps)}</dd>
          </div>
          <div>
            <dt>Тренировка</dt>
            <dd>+{num(norm.parts.training)}</dd>
          </div>
          <div>
            <dt>Цель</dt>
            <dd>
              {norm.parts.goal >= 0 ? '+' : '−'}
              {num(Math.abs(norm.parts.goal))}
            </dd>
          </div>
          {norm.parts.adjust !== 0 && (
            <div>
              <dt>Поправка по тренду веса</dt>
              <dd>
                {norm.parts.adjust > 0 ? '+' : '−'}
                {num(Math.abs(norm.parts.adjust))}
              </dd>
            </div>
          )}
          {norm.floorApplied && (
            <p className="plan-hint">Ниже 1800 ккал тренер не опускает — это уже вредно.</p>
          )}
        </dl>
      )}
      {day.suggestions.length > 0 && (
        <div className="protein-tips">
          <p className="field-hint">
            До нормы белка {num(Math.round(norm.proteinG - eaten.proteinG))} г. Добрать:
          </p>
          <ul>
            {day.suggestions.map((s) => (
              <li key={s.name}>
                {s.name}
                {s.name.includes('шт.') ? '' : ` — ${s.grams} г`}: +{s.proteinG} г белка, {s.kcal}{' '}
                ккал
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* Вес -------------------------------------------------------------------- */

function Weight({ date, day }: { date: string; day: DayResponse }) {
  const put = usePutWeight(date);
  const remove = useDeleteWeight(date);
  const adjust = useSetAdjust(date);
  const { trend } = day;
  return (
    <section className="day-block" aria-labelledby="weight-heading" style={{ order: 3 }}>
      <h2 id="weight-heading" className="group-title">
        Вес
      </h2>
      <div className="weight-inputs">
        {(['morning', 'evening'] as TimeOfDay[]).map((t) => (
          <NumberSave
            key={t}
            label={t === 'morning' ? 'Утро, натощак' : 'Вечер'}
            unit="кг"
            value={day.weights[t]}
            min={30}
            max={300}
            pending={put.isPending || remove.isPending}
            queued={put.data?.queued && put.variables?.timeOfDay === t}
            onSave={(v) => put.mutate({ timeOfDay: t, weightKg: v })}
            onClear={() => remove.mutate(t)}
          />
        ))}
      </div>
      <WeightChart points={trend.points} />
      <p className="trend-text" data-verdict={trend.verdict}>
        {trend.avg7 !== null && <strong>Средняя за 7 дней {num(trend.avg7)} кг. </strong>}
        {trend.text}
        {trend.eveningDelta !== null &&
          ` Вечером в среднем ${trend.eveningDelta >= 0 ? '+' : '−'}${num(Math.abs(trend.eveningDelta))} кг к утру — вода и еда, ориентир — утро.`}
      </p>
      {trend.kcalSuggestion !== 0 && (
        <button
          type="button"
          className="button button-small"
          disabled={adjust.isPending}
          onClick={() =>
            adjust.mutate(Math.max(-1000, Math.min(1000, day.calorieAdjust + trend.kcalSuggestion)))
          }
        >
          Принять {trend.kcalSuggestion > 0 ? '+' : '−'}
          {Math.abs(trend.kcalSuggestion)} ккал к норме
        </button>
      )}
    </section>
  );
}

/* Шаги ------------------------------------------------------------------- */

function Steps({ date, day }: { date: string; day: DayResponse }) {
  const put = usePutSteps(date);
  return (
    <section className="day-block" aria-labelledby="steps-heading" style={{ order: 4 }}>
      <h2 id="steps-heading" className="group-title">
        Шаги
      </h2>
      <NumberSave
        label="За день"
        unit="шагов"
        value={day.steps}
        min={0}
        max={150000}
        integer
        pending={put.isPending}
        queued={put.data?.queued}
        onSave={(v) => put.mutate(v)}
      />
      {day.norm && day.norm.parts.steps > 0 && (
        <p className="plan-hint">
          {day.norm.stepsSource === 'average'
            ? `Пока не вписаны — к норме добавлено ${num(day.norm.parts.steps)} ккал по средним шагам из профиля.`
            : `Ходьба добавила к норме ${num(day.norm.parts.steps)} ккал.`}
        </p>
      )}
    </section>
  );
}

interface NumberSaveProps {
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  integer?: boolean;
  pending: boolean;
  /** Записано на телефоне и ждёт сети. */
  queued?: boolean;
  onSave: (value: number) => void;
  onClear?: () => void;
}

/** Поле с кнопкой «Сохранить»: два нажатия — вписал и сохранил. */
function NumberSave({
  label,
  unit,
  value,
  min,
  max,
  integer,
  pending,
  queued,
  onSave,
  onClear,
}: NumberSaveProps) {
  const [draft, setDraft] = useState(value === null ? '' : String(value).replace('.', ','));
  const [error, setError] = useState('');
  const parsed = Number(draft.trim().replace(',', '.').replace(/\s/g, ''));
  const changed = draft.trim() !== '' && parsed !== value;
  const id = useId();

  const save = () => {
    if (!(parsed >= min && parsed <= max) || (integer && !Number.isInteger(parsed))) {
      setError(`От ${num(min)} до ${num(max)}`);
      return;
    }
    setError('');
    onSave(parsed);
  };

  return (
    <div className="number-save">
      <label htmlFor={id} className="set-label">
        {label}
      </label>
      <div className="number-save-row">
        <span className="input-unit">
          <input
            id={id}
            inputMode={integer ? 'numeric' : 'decimal'}
            value={draft}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && changed && save()}
          />
          <span className="unit">{unit}</span>
        </span>
        {changed ? (
          <button type="button" className="button button-small" onClick={save} disabled={pending}>
            Сохранить
          </button>
        ) : value !== null ? (
          <span
            className="saved-mark"
            data-queued={queued || undefined}
            aria-label={queued ? 'Записано на телефоне, отправлю при сети' : 'Сохранено'}
          >
            <Check size={16} strokeWidth={3.4} aria-hidden="true" />
          </span>
        ) : null}
        {!changed && value !== null && onClear && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setDraft('');
              onClear();
            }}
          >
            Убрать
          </button>
        )}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/* Сон и самочувствие ---------------------------------------------------- */

/**
 * Три ползунка: сколько спал, как спал, как себя чувствуешь. Сохраняется, когда
 * отпускаешь ручку. Тренер смотрит на это в недельном разборе и при плохом сне не
 * усложняет тренировку.
 */
function Wellbeing({ date, day }: { date: string; day: DayResponse }) {
  const put = usePutWellbeing(date);
  const [draft, setDraft] = useState<WellbeingView>(day.wellbeing);
  useEffect(() => setDraft(day.wellbeing), [day.wellbeing]);

  const commit = (patch: Partial<WellbeingView>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (JSON.stringify(next) !== JSON.stringify(day.wellbeing)) put.mutate(next);
  };

  return (
    <section className="day-block wellbeing" aria-labelledby="sleep-heading" style={{ order: 5 }}>
      <div className="card-head">
        <h2 id="sleep-heading" className="group-title">
          Сон и самочувствие
        </h2>
        {put.isPending ? (
          <span className="card-sub">Сохраняю…</span>
        ) : put.data?.queued ? (
          <span className="badge badge-yellow">ждёт сети</span>
        ) : put.isSuccess ? (
          <span className="badge badge-green">сохранено</span>
        ) : null}
      </div>
      <Slider
        label="Спал"
        unit="ч"
        value={draft.sleepHours}
        min={3}
        max={12}
        step={0.5}
        placeholder={7.5}
        ends={['3 ч', '12 ч']}
        caption={(v) =>
          v < 6 ? 'Мало: силовые просядут' : v < 7 ? 'Маловато' : v <= 9 ? 'Норма' : 'Много'
        }
        onChange={(v) => setDraft((d) => ({ ...d, sleepHours: v }))}
        onCommit={(v) => commit({ sleepHours: v })}
      />
      <Slider
        label="Как спал"
        value={draft.sleepScore}
        min={1}
        max={5}
        placeholder={3}
        ends={['плохо', 'отлично']}
        caption={(v) => SLEEP_TEXT[v]}
        onChange={(v) => setDraft((d) => ({ ...d, sleepScore: v }))}
        onCommit={(v) => commit({ sleepScore: v })}
      />
      <Slider
        label="Самочувствие"
        value={draft.wellbeingScore}
        min={1}
        max={5}
        placeholder={3}
        ends={['разбит', 'полон сил']}
        caption={(v) => WELLBEING_TEXT[v]}
        onChange={(v) => setDraft((d) => ({ ...d, wellbeingScore: v }))}
        onCommit={(v) => commit({ wellbeingScore: v })}
      />
      {put.isError && (
        <p className="form-error">
          {put.error instanceof ApiError ? put.error.message : 'Не сохранилось. Повтори.'}
        </p>
      )}
    </section>
  );
}

/* Еда -------------------------------------------------------------------- */

function Food({ date, day, aiEnabled }: { date: string; day: DayResponse; aiEnabled: boolean }) {
  const remove = useDeleteMeal(date);
  const byType = (Object.keys(MEAL_LABELS) as MealType[])
    .map((t) => ({ type: t, meals: day.meals.filter((m) => m.mealType === t) }))
    .filter((g) => g.meals.length > 0);
  return (
    <section className="day-block" aria-labelledby="food-heading" style={{ order: 6 }}>
      <h2 id="food-heading" className="group-title">
        Еда
      </h2>
      {byType.length === 0 && <p className="plan-hint">Пока ничего не записано.</p>}
      {byType.map((g) => (
        <div key={g.type} className="meal-group">
          <h3 className="meal-group-title">
            {MEAL_LABELS[g.type]}
            <span>{num(Math.round(g.meals.reduce((n, m) => n + m.totals.kcal, 0)))} ккал</span>
          </h3>
          <ul className="meals">
            {g.meals.map((m) => (
              <li key={m.id} className="meal">
                <span className="meal-title">{m.title}</span>
                <span className="meal-macros">
                  {num(Math.round(m.totals.kcal))} ккал, Б {num(Math.round(m.totals.proteinG))}, Ж{' '}
                  {num(Math.round(m.totals.fatG))}, У {num(Math.round(m.totals.carbsG))}
                </span>
                {m.items.length > 1 && (
                  <span className="meal-items-line">
                    {m.items.map((i) => `${i.name} ${num(i.grams)} г`).join(', ')}
                  </span>
                )}
                <button
                  type="button"
                  className="link-button meal-delete"
                  onClick={() => remove.mutate(m.id)}
                  disabled={remove.isPending}
                  aria-label={`Удалить: ${m.title}`}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {remove.isError && (
        <p className="form-error">
          {remove.error instanceof ApiError ? remove.error.message : 'Не удалилось.'}
        </p>
      )}
      <MealForm date={date} day={day} aiEnabled={aiEnabled} />
    </section>
  );
}

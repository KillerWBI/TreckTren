import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import type { ProgressResponse } from '@trektren/shared';
import { ErrorState, Loading } from '../components/States';
import { useDay } from '../day/useDay';
import { num, plural, todayIso } from '../format';
import { DayBars, shortDate, StrengthChart, WeightTrendChart } from '../progress/charts';
import { useProgress } from '../progress/useProgress';
import { WeeklyReviewCard } from '../progress/WeeklyReviewCard';

const RANGES = [
  { days: 28, label: '4 недели' },
  { days: 90, label: '3 месяца' },
  { days: 180, label: 'Полгода' },
  { days: 365, label: 'Год' },
] as const;

const avgOf = (values: Array<number | null>) => {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function ProgressPage() {
  const [days, setDays] = useState<number>(28);
  const query = useProgress(days);

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">Прогресс</h1>
        <div className="segmented range-switch" role="tablist" aria-label="Период">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="tab"
              aria-selected={days === r.days}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {query.isPending && <Loading text="Собираю прогресс" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && <ProgressView data={query.data} />}
    </main>
  );
}

function ProgressView({ data }: { data: ProgressResponse }) {
  const today = useDay(todayIso());
  const norm = today.data?.norm?.kcal;
  const withAvg = data.days.filter((d) => d.avg7 !== null);
  const first = withAvg[0]?.avg7 ?? null;
  const last = withAvg[withAvg.length - 1]?.avg7 ?? null;
  const change = first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null;
  const avgSteps = avgOf(data.days.map((d) => d.steps));
  const avgKcal = avgOf(data.days.map((d) => d.kcal));
  const avgSleep = avgOf(data.days.map((d) => d.sleepHours));

  return (
    <div className="cols cols-mixed progress-cols">
      <div className="col">
        <div className="progress-stats" style={{ order: 1 }}>
          <span className="stat">
            <span className="stat-value">{last !== null ? num(last) : '—'}</span>
            <span className="stat-label">
              вес, кг
              {change !== null &&
                change !== 0 &&
                `, ${change > 0 ? '+' : '−'}${num(Math.abs(change))} за период`}
            </span>
          </span>
          <span className="stat">
            <span className="stat-value">
              {avgSteps !== null ? Math.round(avgSteps).toLocaleString('ru-RU') : '—'}
            </span>
            <span className="stat-label">шагов в среднем</span>
          </span>
          <span className="stat">
            <span className="stat-value">
              {avgKcal !== null ? Math.round(avgKcal).toLocaleString('ru-RU') : '—'}
            </span>
            <span className="stat-label">ккал в день, где записана еда</span>
          </span>
          <span className="stat">
            <span className="stat-value">{avgSleep !== null ? num(avgSleep) : '—'}</span>
            <span className="stat-label">часов сна</span>
          </span>
        </div>

        <section className="chart-card" aria-labelledby="weight-chart" style={{ order: 3 }}>
          <div className="card-head">
            <h2 id="weight-chart" className="group-title">
              Вес
            </h2>
            <span className="card-sub">средняя за 7 дней убирает скачки воды</span>
          </div>
          <WeightTrendChart days={data.days} />
        </section>

        <Strength data={data} />

        <section className="chart-card" aria-labelledby="kcal-chart" style={{ order: 5 }}>
          <div className="card-head">
            <h2 id="kcal-chart" className="group-title">
              Калории
            </h2>
            {norm && <span className="card-sub">линия — норма на сегодня, {num(norm)} ккал</span>}
          </div>
          <DayBars
            days={data.days}
            field="kcal"
            color="var(--green)"
            unit="Съедено, ккал"
            reference={norm ? { value: norm, label: 'норма' } : undefined}
            empty="Еда пока не записана."
          />
        </section>

        <section className="chart-card" aria-labelledby="steps-chart" style={{ order: 6 }}>
          <h2 id="steps-chart" className="group-title">
            Шаги
          </h2>
          <DayBars
            days={data.days}
            field="steps"
            color="var(--blue)"
            unit="Шаги"
            empty="Шаги пока не вписаны. Впиши вечером на «Сегодня»."
          />
        </section>

        <section className="chart-card" aria-labelledby="sleep-chart" style={{ order: 7 }}>
          <h2 id="sleep-chart" className="group-title">
            Сон
          </h2>
          <DayBars
            days={data.days}
            field="sleepHours"
            color="var(--blue)"
            unit="Сон, ч"
            reference={{ value: 7, label: '7 ч' }}
            empty="Сон пока не отмечен. Ползунки — на «Сегодня»."
          />
        </section>
      </div>

      <div className="col sticky">
        <div className="slot" style={{ order: 2 }}>
          <WeeklyReviewCard />
        </div>
        <div className="slot" style={{ order: 8 }}>
          <Workouts data={data} />
          <Records data={data} />
        </div>
      </div>
    </div>
  );
}

function Strength({ data }: { data: ProgressResponse }) {
  const [slug, setSlug] = useState(data.strength[0]?.slug ?? '');
  const series = data.strength.find((s) => s.slug === slug) ?? data.strength[0];
  return (
    <section className="chart-card" aria-labelledby="strength-chart" style={{ order: 4 }}>
      <div className="card-head">
        <h2 id="strength-chart" className="group-title">
          Силовые
        </h2>
        {series && (
          <span className="card-sub">
            {series.currentKg !== null && `сейчас ${num(series.currentKg)} кг`}
            {series.goalKg !== null && `, цель ${num(series.goalKg)}`}
          </span>
        )}
      </div>
      {!series ? (
        <p className="chart-empty">
          Впиши максимумы в профиле или запиши тренировку — здесь появится рост силы.
        </p>
      ) : (
        <>
          {data.strength.length > 1 && (
            <div className="lift-tabs" role="tablist" aria-label="Упражнение">
              {data.strength.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  role="tab"
                  className="chip"
                  aria-selected={s.slug === series.slug}
                  aria-pressed={s.slug === series.slug}
                  onClick={() => setSlug(s.slug)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <StrengthChart series={series} />
        </>
      )}
    </section>
  );
}

function Workouts({ data }: { data: ProgressResponse }) {
  const { planned, done, missed } = data.workouts;
  return (
    <section className="chart-card" aria-labelledby="workouts-heading">
      <h2 id="workouts-heading" className="group-title">
        Тренировки за период
      </h2>
      {planned === 0 ? (
        <p className="plan-hint">
          По плану тренировок в этом периоде не было. <Link to="/plan">Открыть план</Link>
        </p>
      ) : (
        <>
          <p className="adherence-line">
            <strong>
              {done} из {planned}
            </strong>{' '}
            сделано
            {missed > 0 && `, ${missed} ${plural(missed, ['пропущена', 'пропущены', 'пропущено'])}`}
          </p>
          <span className="bar bar-green" aria-hidden="true">
            <span
              style={{ width: `${(done / planned) * 100}%` }}
              data-zero={done === 0 || undefined}
            />
          </span>
        </>
      )}
    </section>
  );
}

function Records({ data }: { data: ProgressResponse }) {
  const [all, setAll] = useState(false);
  const list = all ? data.records : data.records.slice(0, 6);
  return (
    <section className="records" aria-labelledby="records-heading">
      <div className="card-head">
        <h2 id="records-heading" className="group-title">
          Рекорды
        </h2>
        <Trophy size={22} strokeWidth={2.4} className="records-icon" aria-hidden="true" />
      </div>
      {data.records.length === 0 ? (
        <p className="plan-hint">
          Рекорд записывается, когда подход тяжелее прошлого лучшего хотя бы на 1%.
        </p>
      ) : (
        <ul className="records-list">
          {list.map((r) => (
            <li key={`${r.slug}-${r.date}-${r.e1rm}`} className="record">
              <span className="record-name">{r.name}</span>
              <span className="record-value">≈ {num(r.e1rm)} кг</span>
              <span className="record-meta">
                {num(r.weightKg)} кг × {r.reps}, {shortDate(r.date)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.records.length > 6 && (
        <button type="button" className="link-button" onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Все рекорды (${data.records.length})`}
        </button>
      )}
    </section>
  );
}

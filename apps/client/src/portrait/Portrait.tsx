import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Crosshair, Dumbbell, Star, TriangleAlert } from 'lucide-react';
import type {
  MuscleDetail,
  MuscleGroup,
  MuscleLift,
  MuscleStatus,
  PortraitResponse,
} from '@trektren/shared';
import { api } from '../api/http';
import { MUSCLE_LABELS } from '../card/labels';
import { formatDate, num, plural } from '../format';
import {
  BACK,
  crownY,
  ears,
  flatten,
  FRONT,
  frontDetails,
  GROUND,
  injuryPoint,
  kneecaps,
  muscleGeometry,
  shapeOf,
  skinParts,
  unflatten,
  type MuscleDef,
  type Shape,
} from './anatomy';

export const PORTRAIT_KEY = ['portrait'] as const;

export const usePortrait = () =>
  useQuery({ queryKey: PORTRAIT_KEY, queryFn: () => api<PortraitResponse>('/portrait') });

/** На какой стороне фигуры видна мышца. */
const IN_FRONT = new Set(FRONT.map((d) => d.group).filter(Boolean));
const IN_BACK = new Set(BACK.map((d) => d.group).filter(Boolean));

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const STATUS_TEXT: Record<MuscleStatus, string> = {
  good: 'в норме',
  behind: 'отстаёт',
  weak: 'слабое место',
  unknown: 'нет данных',
};

/** Порядок в списке: сначала то, чем надо заняться. */
const STATUS_ORDER: MuscleStatus[] = ['weak', 'behind', 'unknown', 'good'];

/**
 * Плавный переход формы: поменялся вес, жир или силовые — фигура перетекает,
 * а не прыгает. При первом показе человечек «вырастает».
 */
function useTweenShape(target: Shape): Shape {
  const goal = flatten(target);
  const [value, setValue] = useState<number[]>(() => {
    if (reducedMotion()) return goal;
    const start = [...goal];
    start[3] = Math.max(0.5, goal[3]! - 0.2);
    return start;
  });
  const current = useRef(value);
  const key = goal.map((v) => v.toFixed(3)).join('|');

  useEffect(() => {
    if (reducedMotion()) {
      current.current = goal;
      setValue(goal);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / 900);
      const e = 1 - (1 - k) ** 3;
      const next = from.map((v, i) => v + (goal[i]! - v) * e);
      current.current = next;
      setValue(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- форма сравнивается по значениям
  }, [key]);

  return unflatten(value, target.levels);
}

interface FigureProps {
  view: 'front' | 'back';
  shape: Shape;
  ghost: Shape | null;
  data: PortraitResponse;
  status: Map<MuscleGroup, MuscleStatus>;
  selected: MuscleGroup | null;
  onSelect: (group: MuscleGroup) => void;
  empty: boolean;
}

function Figure({ view, shape, ghost, data, status, selected, onSelect, empty }: FigureProps) {
  const defs: MuscleDef[] = view === 'front' ? FRONT : BACK;
  const skin = skinParts(shape);
  const top = crownY(shape);
  const muscles = defs.flatMap((d) => [
    { def: d, ...muscleGeometry(d, shape, false) },
    { def: d, ...muscleGeometry(d, shape, true) },
  ]);
  // Метка приоритета — одна на мышцу, на самой крупной её части.
  const pins = data.priority.flatMap((group) => {
    const parts = muscles.filter((m) => m.group === group && m.id.endsWith('-r'));
    if (!parts.length) return [];
    return [
      parts.reduce((a, b) => (b.def.bulge * b.def.fibers > a.def.bulge * a.def.fibers ? b : a)),
    ];
  });
  const injuries = data.injuries
    .map((i) => ({ ...i, ...injuryPoint(i.zone, shape) }))
    .filter((i) => i.view === view);

  return (
    <svg className="body-figure" viewBox="-14 -50 228 482" aria-hidden="true">
      <line className="ground" x1="18" x2="182" y1={GROUND + 1.5} y2={GROUND + 1.5} />
      {view === 'front' && (
        <g className="height-mark">
          <line x1="-8" x2="196" y1={top} y2={top} />
          <text x="-8" y={top - 6}>
            {data.body.heightCm} см
          </text>
        </g>
      )}
      <g className="skin-edge">
        {ears(shape).map((e, i) => (
          <ellipse key={i} {...e} />
        ))}
        {skin.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g className="skin-fill">
        {ears(shape).map((e, i) => (
          <ellipse key={i} {...e} />
        ))}
        {skin.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {view === 'front' && (
        <g className="anatomy-lines">
          <path d={frontDetails(shape)} />
          {kneecaps(shape).map((k, i) => (
            <ellipse key={i} {...k} />
          ))}
        </g>
      )}
      {!empty &&
        muscles.map((m) => {
          const st = m.group ? status.get(m.group) : undefined;
          return (
            <g
              key={m.id}
              className="m"
              data-group={m.group ?? undefined}
              data-status={st ?? 'decor'}
              data-selected={(m.group !== null && m.group === selected) || undefined}
              data-dim={(selected !== null && m.group !== selected) || undefined}
              onClick={m.group ? () => onSelect(m.group!) : undefined}
            >
              <path className="m-fill" d={m.outline} />
              <path className="m-fibers" d={m.fibers} />
              {m.group && <title>{`${MUSCLE_LABELS[m.group]}: ${STATUS_TEXT[st!]}`}</title>}
            </g>
          );
        })}
      {ghost && skinParts(ghost).map((d, i) => <path key={`g${i}`} className="ghost" d={d} />)}
      {!empty &&
        pins.map((m) => (
          <g key={`pin-${m.id}`} className="pin" onClick={() => onSelect(m.group!)}>
            <circle cx={m.center[0]} cy={m.center[1]} r="5.2" />
            <path
              d={`M${m.center[0]} ${m.center[1] - 2.6}l0.8 1.7 1.8 0.2-1.4 1.2 0.4 1.8-1.6-0.9-1.6 0.9 0.4-1.8-1.4-1.2 1.8-0.2z`}
            />
          </g>
        ))}
      {injuries.map((i) => (
        <g key={`${i.zone}-${i.area}`} className="injury-mark">
          <circle className="injury-ring" cx={i.at[0]} cy={i.at[1]} r="8" />
          <circle className="injury" cx={i.at[0]} cy={i.at[1]} r="5.6" />
          <path
            className="injury-cross"
            d={`M${i.at[0] - 2.6} ${i.at[1]}h5.2M${i.at[0]} ${i.at[1] - 2.6}v5.2`}
          />
          <title>{`Травма: ${i.area}`}</title>
        </g>
      ))}
    </svg>
  );
}

const WEIGHT_SOURCE: Record<PortraitResponse['weightSource'], string> = {
  average: 'средняя за 7 дней',
  log: 'последнее взвешивание',
  card: 'из профиля',
  default: 'не указан',
};

const NEUTRAL: Shape['levels'] = {
  chest: null,
  back: null,
  shoulders: null,
  biceps: null,
  triceps: null,
  forearms: null,
  traps: null,
  abs: null,
  quads: null,
  hamstrings: null,
  glutes: null,
  calves: null,
};

/**
 * Портрет: анатомическая фигура по росту, весу, жиру и силовым. Пока профиль
 * не заполнен — растёт. Цвет мышцы — её состояние; нажми на мышцу — увидишь,
 * что с ней, до скольки догнать и чем качать.
 */
export function Portrait() {
  const query = usePortrait();
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<MuscleGroup | null>(null);
  // Телефон: одна большая фигура и переключатель — мелкие мышцы так легче нажать.
  const [view, setView] = useState<'front' | 'back'>('front');
  const sideRef = useRef<HTMLDivElement>(null);
  const data = query.data;

  const growth = data ? 0.6 + (0.4 * data.completeness.filled) / data.completeness.total : 0.6;
  const target = data
    ? shapeOf(data.body, growth)
    : shapeOf(
        {
          sex: 'male',
          heightCm: 178,
          weightKg: 75,
          bodyFatPct: 16,
          bodyFatEstimated: true,
          levels: NEUTRAL,
        },
        0.6,
      );
  const shape = useTweenShape(target);

  const select = (group: MuscleGroup | null) => {
    setSelected(group);
    if (group && !(view === 'front' ? IN_FRONT : IN_BACK).has(group)) {
      setView(view === 'front' ? 'back' : 'front');
    }
    // На телефоне карточка мышцы — под фигурой: прокрутить к ней.
    if (group && window.matchMedia('(max-width: 899px)').matches) {
      requestAnimationFrame(() =>
        sideRef.current?.scrollIntoView({
          behavior: reducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        }),
      );
    }
  };

  if (query.isPending) {
    return (
      <section className="portrait-card" aria-label="Портрет">
        <p className="state">Рисую портрет…</p>
      </section>
    );
  }
  if (query.isError || !data) {
    return (
      <section className="portrait-card" aria-label="Портрет">
        <p className="form-error">Портрет не загрузился.</p>
        <button type="button" className="link-button" onClick={() => void query.refetch()}>
          Повторить
        </button>
      </section>
    );
  }

  const { completeness: c, body, start } = data;
  const complete = c.filled >= c.total;
  const empty = c.filled === 0;
  const since = start ? Math.round((Date.now() - new Date(start.date).getTime()) / 86400000) : 0;
  const showStart = start !== null && since >= 7;
  const ghost = compare && showStart && start ? shapeOf(start.body, 1) : null;
  const weightDelta = start ? Math.round((body.weightKg - start.body.weightKg) * 10) / 10 : 0;
  const status = new Map(data.muscles.map((m) => [m.group, m.status]));
  const detail = selected ? data.muscles.find((m) => m.group === selected) : undefined;
  const counts = STATUS_ORDER.map((s) => ({
    s,
    n: data.muscles.filter((m) => m.status === s).length,
  }));

  const summary = [
    `${body.sex === 'female' ? 'Женщина' : 'Мужчина'}, ${body.heightCm} см, ${num(body.weightKg)} кг, жир около ${body.bodyFatPct}%`,
    ...counts.filter((x) => x.n > 0).map((x) => `${STATUS_TEXT[x.s]}: ${x.n}`),
  ].join('; ');

  return (
    <section className="portrait-card" aria-labelledby="portrait-heading">
      <div className="card-head">
        <h2 id="portrait-heading" className="group-title">
          {complete ? 'Твой портрет' : 'Человечек растёт'}
        </h2>
        {data.strengthLabel && (
          <span className="badge badge-primary">сила: {data.strengthLabel}</span>
        )}
      </div>

      <div className="portrait-layout">
        <div className="portrait-main">
          <div className="segmented view-switch" role="tablist" aria-label="Сторона фигуры">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'front'}
              onClick={() => setView('front')}
            >
              Спереди
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'back'}
              onClick={() => setView('back')}
            >
              Сзади
            </button>
          </div>
          <div className="portrait-stage" role="img" aria-label={summary}>
            <figure data-active={view === 'front' || undefined}>
              <Figure
                view="front"
                shape={shape}
                ghost={ghost}
                data={data}
                status={status}
                selected={selected}
                onSelect={select}
                empty={empty}
              />
              <figcaption>спереди</figcaption>
            </figure>
            <figure data-active={view === 'back' || undefined}>
              <Figure
                view="back"
                shape={shape}
                ghost={ghost}
                data={data}
                status={status}
                selected={selected}
                onSelect={select}
                empty={empty}
              />
              <figcaption>сзади</figcaption>
            </figure>
          </div>

          <ul className="portrait-legend" aria-label="Обозначения">
            <li>
              <i className="swatch" data-status="good" aria-hidden="true" />в норме
            </li>
            <li>
              <i className="swatch" data-status="behind" aria-hidden="true" />
              отстаёт
            </li>
            <li>
              <i className="swatch" data-status="weak" aria-hidden="true" />
              слабое место
            </li>
            <li>
              <i className="swatch" data-status="unknown" aria-hidden="true" />
              нет данных
            </li>
            {data.priority.length > 0 && (
              <li>
                <i className="swatch-pin" aria-hidden="true">
                  <Star size={9} strokeWidth={0} fill="currentColor" />
                </i>
                приоритет
              </li>
            )}
            {data.injuries.length > 0 && (
              <li>
                <i className="swatch-injury" aria-hidden="true" />
                травма
              </li>
            )}
          </ul>

          {!complete && (
            <div className="portrait-growth">
              <span className="bar bar-green" aria-hidden="true">
                <span
                  style={{ width: `${(c.filled / c.total) * 100}%` }}
                  data-zero={empty || undefined}
                />
              </span>
              <p>
                Профиль заполнен на {c.filled} из {c.total}. Каждый раздел добавляет человечку
                роста, а силовые — мышц. Заполнишь всё — станет твоим портретом.
              </p>
            </div>
          )}

          <div className="portrait-stats">
            <span className="stat">
              <span className="stat-value">{body.heightCm}</span>
              <span className="stat-label">рост, см</span>
            </span>
            <span className="stat">
              <span className="stat-value">{num(body.weightKg)}</span>
              <span className="stat-label">вес, {WEIGHT_SOURCE[data.weightSource]}</span>
            </span>
            <span className="stat">
              <span className="stat-value">{num(data.bmi)}</span>
              <span className="stat-label">ИМТ</span>
            </span>
            <span className="stat">
              <span className="stat-value">
                {body.bodyFatEstimated ? '≈' : ''}
                {body.bodyFatPct}%
              </span>
              <span className="stat-label">
                жир{body.bodyFatEstimated ? ', оценка по ИМТ и возрасту' : ''}
              </span>
            </span>
          </div>

          {showStart && start && (
            <div className="portrait-compare">
              <button
                type="button"
                className="chip"
                aria-pressed={compare}
                onClick={() => setCompare((v) => !v)}
              >
                Сравнить с началом
              </button>
              <span className="card-sub">
                {formatDate(start.date).replace(' г.', '')}: {num(start.body.weightKg)} кг
                {weightDelta !== 0 &&
                  `, сейчас ${weightDelta > 0 ? '+' : '−'}${num(Math.abs(weightDelta))} кг`}
              </span>
            </div>
          )}
        </div>

        <div className="portrait-side" ref={sideRef}>
          {detail ? (
            <MuscleSheet
              detail={detail}
              median={data.medianLevel}
              onBack={() => setSelected(null)}
            />
          ) : (
            <MuscleOverview muscles={data.muscles} onSelect={select} />
          )}
        </div>
      </div>
    </section>
  );
}

/** Список мышц по состоянию — и подсказка, и доступ с клавиатуры. */
function MuscleOverview({
  muscles,
  onSelect,
}: {
  muscles: MuscleDetail[];
  onSelect: (group: MuscleGroup) => void;
}) {
  const sorted = [...muscles].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
  const lagging = muscles.filter((m) => m.status === 'weak' || m.status === 'behind').length;
  return (
    <div className="muscle-overview">
      <p className="muscle-hint">
        Нажми на мышцу на фигуре или в списке — покажу, что с ней, до скольки догнать и чем качать.
        {lagging > 0 &&
          ` Сейчас ${plural(lagging, ['отстаёт', 'отстают', 'отстают'])} ${lagging} ${plural(lagging, ['мышца', 'мышцы', 'мышц'])}.`}
      </p>
      <ul className="muscle-rows">
        {sorted.map((m) => (
          <li key={m.group}>
            <button type="button" className="muscle-row" onClick={() => onSelect(m.group)}>
              <i className="swatch" data-status={m.status} aria-hidden="true" />
              <span className="muscle-row-text">
                <span className="muscle-row-name">
                  {MUSCLE_LABELS[m.group]}
                  {m.priority && (
                    <Star
                      size={13}
                      strokeWidth={0}
                      fill="currentColor"
                      className="muscle-row-star"
                      aria-label="приоритет"
                    />
                  )}
                </span>
                <span className="muscle-row-status" data-status={m.status}>
                  {STATUS_TEXT[m.status]}
                </span>
              </span>
              <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_TEXT: Record<NonNullable<MuscleLift['source']>, string> = {
  tested: 'проверенный максимум',
  working: 'по рабочему подходу',
  estimated: 'расчёт',
};

/** Карточка мышцы: состояние, движения и цели, упражнения. */
function MuscleSheet({
  detail: d,
  median,
  onBack,
}: {
  detail: MuscleDetail;
  median: number | null;
  onBack: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [d.group]);
  const withData = d.lifts.filter((l) => l.oneRmKg !== null);
  const missing = d.lifts.filter((l) => l.oneRmKg === null);

  return (
    <article className="muscle-sheet" data-status={d.status} aria-labelledby="muscle-heading">
      <button type="button" className="link-button muscle-back" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={2.6} aria-hidden="true" /> Все мышцы
      </button>
      <div className="muscle-sheet-head">
        <h3 id="muscle-heading" className="muscle-title" tabIndex={-1} ref={headingRef}>
          {MUSCLE_LABELS[d.group]}
        </h3>
        <div className="muscle-badges">
          <span className="status-badge" data-status={d.status}>
            {STATUS_TEXT[d.status]}
          </span>
          {d.priority && (
            <span className="badge badge-blue">
              <Star size={12} strokeWidth={0} fill="currentColor" aria-hidden="true" />
              приоритет
            </span>
          )}
          {d.injury && (
            <span className="badge badge-ink">
              <TriangleAlert size={12} strokeWidth={2.6} aria-hidden="true" />
              травма рядом
            </span>
          )}
        </div>
      </div>

      {d.level !== null && (
        <div className="level-meter">
          <div className="level-track" aria-hidden="true">
            <span className="level-fill" style={{ width: `${d.level * 100}%` }} />
            {median !== null && (
              <span className="level-median" style={{ left: `${median * 100}%` }} />
            )}
          </div>
          <div className="level-scale" aria-hidden="true">
            {['начальный', 'любитель', 'средний', 'продвинутый', 'элита'].map((t, i) => (
              <span
                key={t}
                style={{ left: `${i * 25}%` }}
                data-active={t === d.levelWord || undefined}
              >
                {t}
              </span>
            ))}
          </div>
          <p className="level-caption">
            Ступень: <strong>{d.levelWord}</strong>
            {median !== null && '. Чёрная черта — средний уровень твоего тела'}.
          </p>
        </div>
      )}

      <p className="muscle-summary">{d.summary}</p>

      {d.catchUp && (
        <div className="muscle-goal">
          <Crosshair size={20} strokeWidth={2.4} aria-hidden="true" />
          <div>
            <p className="muscle-goal-label">Чтобы закрыть отставание</p>
            <p className="muscle-goal-value">
              {d.catchUp.name}: {num(d.catchUp.kg)} кг
              <span> (+{num(d.catchUp.gapKg)} кг)</span>
            </p>
          </div>
        </div>
      )}

      {withData.length > 0 && (
        <section aria-label="Силовые">
          <h4 className="muscle-sub">Силовые</h4>
          <ul className="muscle-lifts">
            {withData.map((l) => (
              <li key={l.slug}>
                <div className="muscle-lift-head">
                  <span className="muscle-lift-name">{l.name}</span>
                  <span className="muscle-lift-kg">{num(l.oneRmKg!)} кг</span>
                </div>
                <p className="muscle-lift-meta">
                  {num(l.ratio!)} веса тела, ступень «{l.tier}», {SOURCE_TEXT[l.source!]}
                </p>
                {l.next && (
                  <p className="muscle-lift-next">
                    До ступени «{l.next.tier}»: {num(l.next.kg)} кг (+
                    {num(Math.round((l.next.kg - l.oneRmKg!) * 10) / 10)})
                  </p>
                )}
                {l.goalKg && (
                  <p className="muscle-lift-next">
                    Твоя цель: {num(l.goalKg)} кг
                    {l.goalKg > l.oneRmKg! ? ` (+${num(l.goalKg - l.oneRmKg!)})` : ', достигнута'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {missing.length > 0 && d.status !== 'unknown' && (
        <p className="field-hint">
          Нет данных: {missing.map((l) => l.name.toLowerCase()).join(', ')}. Впиши в «Силовых» —
          оценка станет точнее.
        </p>
      )}

      {d.injury && <p className="notice notice-warn">Травма: {d.injury}</p>}

      <section aria-label="Упражнения">
        <h4 className="muscle-sub">Чем качать</h4>
        {d.exercises.length === 0 ? (
          <p className="plan-hint">
            Подходящих упражнений нет: проверь оборудование и ограничения в профиле.
          </p>
        ) : (
          <ul className="muscle-exercises">
            {d.exercises.map((e) => (
              <li key={e.slug}>
                <Dumbbell size={16} strokeWidth={2.4} aria-hidden="true" />
                <span className="muscle-ex-name">
                  {e.name}
                  <span className="muscle-ex-tags">
                    {e.inPlan && <span className="badge badge-green">в плане</span>}
                    {!e.primary && <span className="badge">помогает</span>}
                  </span>
                </span>
                <span className="muscle-ex-load">
                  {e.kind === 'kg' && e.workKg !== null
                    ? `${e.perHand ? 'по ' : ''}${num(e.workKg)} кг`
                    : e.kind === 'bodyweight'
                      ? 'свой вес'
                      : 'подбери'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.blockedByInjury.length > 0 && (
          <p className="muscle-blocked">
            Убраны из-за травмы: {d.blockedByInjury.join(', ').toLowerCase()}. Вернутся в план,
            когда уберёшь травму из профиля.
          </p>
        )}
        <p className="field-hint">
          Вес — рабочий на 8–10 повторов с запасом 2, от твоих максимумов.
        </p>
      </section>
    </article>
  );
}

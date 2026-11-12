import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  isSectionFilled,
  REQUIRED_CARD_SECTIONS,
  type AthleteCard,
  type LoadView,
  type PlanResponse,
  type SessionView,
} from '@trektren/shared';
import { ApiError } from '../api/http';
import { PlateMark } from '../components/Sleeve';
import { ErrorState, Loading } from '../components/States';
import type { PlateId } from '../card/plates';
import { formatDate, num, plural, todayIso } from '../format';
import { Diagnostics } from '../plan/Diagnostics';
import { Forecast } from '../plan/Forecast';
import { StrengthForm } from '../plan/StrengthForm';
import { TestForm } from '../plan/TestForm';
import { Calendar, summarize } from '../plan/Calendar';
import { addDays, isoWeekday, shortDay } from '../plan/dates';
import { useCard, useGeneratePlan, usePlan, useReschedule } from '../plan/usePlan';

const DAYS_AHEAD = 56;
const SECTION_NAMES: Record<string, string> = {
  goals: 'цели',
  basics: 'основное о себе',
  availability: 'время на тренировки',
};
const WEEKDAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

type Mode = 'view' | 'rebuild' | 'reschedule';

export function PlanPage() {
  const plan = usePlan();
  const card = useCard();
  const [mode, setMode] = useState<Mode>('view');

  if (plan.isPending || card.isPending) return <Loading text="Загружаю план" />;
  if (plan.isError) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  if (card.isError) return <ErrorState error={card.error} onRetry={() => void card.refetch()} />;

  const data = plan.data;
  const athlete = card.data.card;

  if (!data.block || mode === 'rebuild') {
    return (
      <Builder
        kind="generate"
        plan={data}
        card={athlete}
        onDone={() => setMode('view')}
        onCancel={data.block ? () => setMode('view') : undefined}
      />
    );
  }
  if (mode === 'reschedule') {
    return (
      <Builder
        kind="reschedule"
        plan={data}
        card={athlete}
        onDone={() => setMode('view')}
        onCancel={() => setMode('view')}
      />
    );
  }
  return (
    <PlanView
      plan={data}
      card={athlete}
      onRebuild={() => setMode('rebuild')}
      onReschedule={() => setMode('reschedule')}
    />
  );
}

/* Выбор дней и построение ---------------------------------------------- */

interface BuilderProps {
  kind: 'generate' | 'reschedule';
  plan: PlanResponse;
  card: AthleteCard;
  onDone: () => void;
  onCancel?: (() => void) | undefined;
}

function Builder({ kind, plan, card, onDone, onCancel }: BuilderProps) {
  const today = todayIso();
  const last = addDays(today, DAYS_AHEAD);
  const future = plan.sessions.filter((s) => s.date >= today).map((s) => s.date);
  const [selected, setSelected] = useState(
    () => new Set(kind === 'reschedule' || plan.block ? future : []),
  );
  // Пожелания из прошлого плана не теряются: при перестройке они уже в поле.
  const [comment, setComment] = useState(kind === 'generate' ? (plan.block?.comment ?? '') : '');
  const [baselineOpen, setBaselineOpen] = useState(false);
  const generate = useGeneratePlan();
  const reschedule = useReschedule();
  const pending = generate.isPending || reschedule.isPending;
  const error = generate.error ?? reschedule.error;

  const missing = REQUIRED_CARD_SECTIONS.filter((s) => !isSectionFilled(card, s));
  const usualDays = card.availability?.usualDays ?? [];
  const dates = useMemo(() => [...selected].sort(), [selected]);
  const summary = summarize(dates);

  const toggle = (date: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const fillUsual = () => {
    const next = new Set<string>();
    // До конца 5-й недели блока: 4 недели нагрузки и разгрузка с проходкой.
    // Неделя блока считается с понедельника, поэтому и конец — воскресенье 5-й недели.
    const last = addDays(today, 35 - isoWeekday(today));
    for (let date = today; date <= last; date = addDays(date, 1)) {
      if (usualDays.includes(isoWeekday(date))) next.add(date);
    }
    setSelected(next);
  };

  const submit = () => {
    if (dates.length === 0) return;
    if (kind === 'reschedule') reschedule.mutate(dates, { onSuccess: onDone });
    else
      generate.mutate(
        { dates, ...(comment.trim() ? { comment: comment.trim() } : {}) },
        { onSuccess: onDone },
      );
  };

  const title =
    kind === 'reschedule' ? 'Дни тренировок' : plan.block ? 'Перестроить план' : 'Первый план';
  const submitText =
    kind === 'reschedule' ? 'Сохранить дни' : plan.block ? 'Перестроить' : 'Построить план';

  return (
    <main className="page">
      <h1 className="page-title">{title}</h1>
      <p className="page-lead">
        {kind === 'reschedule'
          ? 'Отметь новые дни. Упражнения останутся те же, тренер заново разложит их по датам и проверит восстановление.'
          : 'Отметь дни, когда точно сможешь тренироваться. Тренер посмотрит, сколько дней между тренировками, и разложит нагрузку так, чтобы мышцы успевали восстановиться.'}
      </p>

      {missing.length > 0 && kind === 'generate' && (
        <div className="notice notice-stop" role="status">
          <p>
            Без карточки план не построить. Не хватает:{' '}
            {missing.map((s) => SECTION_NAMES[s] ?? s).join(', ')}.
          </p>
          <Link to="/" className="button button-small">
            Заполнить карточку
          </Link>
        </div>
      )}

      <section className="plan-step" aria-labelledby="days-heading">
        <h2 id="days-heading" className="group-title">
          Дни
        </h2>
        {usualDays.length > 0 && (
          <div className="editor-actions">
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={fillUsual}
            >
              Мои дни на 5 недель:{' '}
              {[...usualDays]
                .sort()
                .map((d) => WEEKDAY_SHORT[d])
                .join(', ')}
            </button>
            {selected.size > 0 && (
              <button type="button" className="link-button" onClick={() => setSelected(new Set())}>
                Сбросить
              </button>
            )}
          </div>
        )}
        <Calendar selected={selected} onToggle={toggle} today={today} last={last} />
        <p className="plan-summary" aria-live="polite">
          {summary.count === 0 ? 'Пока ни одного дня. Отметь хотя бы один.' : scheduleText(summary)}
        </p>
      </section>

      {kind === 'generate' && (
        <>
          <section className="plan-step" aria-labelledby="weights-heading">
            <h2 id="weights-heading" className="group-title">
              Максимумы и рабочие веса
            </h2>
            {baselineOpen ? (
              <StrengthForm card={card} onDone={() => setBaselineOpen(false)} />
            ) : (
              <>
                <p className="plan-hint">
                  {Object.keys(card.strength?.lifts ?? {}).length > 0
                    ? `Записано упражнений: ${Object.keys(card.strength?.lifts ?? {}).length}. От них тренер посчитает веса во всех упражнениях со штангой и гантелями.`
                    : 'Впиши максимумы или рабочие подходы в базовых — от них тренер посчитает веса во всех упражнениях. Если цифры есть в анкете, ИИ возьмёт их сам.'}
                </p>
                <button
                  type="button"
                  className="button button-small button-secondary"
                  onClick={() => setBaselineOpen(true)}
                >
                  Открыть
                </button>
              </>
            )}
          </section>

          <section className="plan-step">
            <div className="field">
              <label htmlFor="plan-comment">Пожелания тренеру</label>
              <textarea
                id="plan-comment"
                rows={3}
                maxLength={1000}
                placeholder="Например: больше спины, жим в приоритете, без становой с пола"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <span className="field-hint">
                {plan.ai.enabled
                  ? 'ИИ учтёт, если это не вредит. Если вредит — объяснит, почему нет.'
                  : 'Пожелания учтёт ИИ — сейчас он не подключён.'}
              </span>
            </div>
          </section>
        </>
      )}

      {error && <BuildError error={error} />}
      <p className="visually-hidden" role="status">
        {pending ? 'Тренер строит план' : ''}
      </p>
      <div className="editor-actions plan-submit">
        <button
          type="button"
          className="button"
          onClick={submit}
          disabled={pending || dates.length === 0}
        >
          {pending ? (kind === 'reschedule' ? 'Раскладываю…' : 'Тренер строит план…') : submitText}
        </button>
        {onCancel && (
          <button
            type="button"
            className="button button-secondary"
            onClick={onCancel}
            disabled={pending}
          >
            Отмена
          </button>
        )}
      </div>
      {kind === 'generate' && (
        <p className="plan-hint">
          {plan.ai.enabled
            ? 'План строит ИИ, это занимает до минуты.'
            : 'ИИ пока не подключён: план соберётся по правилам — сплит по числу дней, объём под цель.'}
        </p>
      )}
    </main>
  );
}

function scheduleText(s: ReturnType<typeof summarize>): string {
  const parts = [
    `${s.count} ${plural(s.count, ['тренировка', 'тренировки', 'тренировок'])}` +
      (s.count > 1 ? `, в среднем ${num(s.perWeek)} в неделю` : '') +
      '.',
  ];
  if (s.backToBack > 0) {
    parts.push(
      `Два дня подряд: ${s.backToBack} ${plural(s.backToBack, ['раз', 'раза', 'раз'])} — во второй день тренер даст другие мышцы или облегчит тренировку.`,
    );
  }
  if (s.longestGap >= 10)
    parts.push(`Перерыв ${s.longestGap} дней: после него веса будут на 10% легче.`);
  return parts.join(' ');
}

function BuildError({ error }: { error: Error }) {
  if (error instanceof ApiError && error.code === 'CARD_INCOMPLETE') {
    return (
      <div className="notice notice-stop" role="alert">
        <p>{error.message}</p>
        <Link to="/" className="button button-small">
          Открыть карточку
        </Link>
      </div>
    );
  }
  return (
    <p className="form-error" role="alert">
      {error instanceof ApiError ? error.message : 'Не получилось построить план. Повтори.'}
    </p>
  );
}

/* Готовый план ---------------------------------------------------------- */

interface ViewProps {
  plan: PlanResponse;
  card: AthleteCard;
  onRebuild: () => void;
  onReschedule: () => void;
}

/** Блин недели: нагрузка растёт — блин тяжелеет, разгрузка — лёгкий белый. */
function weekPlate(week: number, phase: SessionView['phase']): PlateId | null {
  if (phase === 'deload') return 'w5';
  if (phase === 'test') return 'r25';
  if (phase === 'after_block') return null;
  return (['g10', 'y15', 'b20', 'r25', 'r25'] as const)[Math.min(week, 5) - 1] ?? 'r25';
}

const PHASE_TEXT: Record<SessionView['phase'], string> = {
  accumulation: 'нагрузка растёт',
  deload: 'разгрузка',
  test: 'проходка',
  after_block: 'блок закончился',
};

function PlanView({ plan, card, onRebuild, onReschedule }: ViewProps) {
  const block = plan.block!;
  const today = todayIso();
  const next = plan.sessions.find((s) => s.date >= today && s.exercises.length > 0);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(next ? [next.id] : []));
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const weeks = new Map<number, SessionView[]>();
  for (const s of plan.sessions) weeks.set(s.week, [...(weeks.get(s.week) ?? []), s]);
  const calibrate = plan.sessions.some((s) => s.exercises.some((x) => x.load.kind === 'calibrate'));

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });

  return (
    <main className="page">
      <h1 className="page-title">План</h1>
      <p className="plan-split">{block.split}</p>
      <p className="page-lead">
        С {formatDate(block.startDate).replace(' г.', '')}: {block.accumulationWeeks}{' '}
        {plural(block.accumulationWeeks, ['неделя', 'недели', 'недель'])} нагрузки, потом неделя
        разгрузки и проходка.{' '}
        {block.source === 'ai'
          ? `Построил ИИ (${block.model ?? 'модель не указана'}).`
          : 'Собран по правилам.'}
      </p>

      {block.staleSections.length > 0 && (
        <div className="notice notice-stop" role="status">
          <p>
            После построения плана ты поменял в карточке:{' '}
            {block.staleSections.map((s) => SECTION_TITLES[s] ?? s).join(', ')}. Перестрой, чтобы
            тренер это учёл. Дни останутся те же.
          </p>
          <button type="button" className="button button-small" onClick={onRebuild}>
            Перестроить
          </button>
        </div>
      )}
      {block.generationNote && (
        <p className="notice notice-warn" role="status">
          {block.generationNote}
        </p>
      )}
      {block.factsNote && <p className="notice">{block.factsNote}</p>}

      <blockquote className="coach-note">
        <p>{block.coachNote}</p>
      </blockquote>

      <div className="plan-actions">
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={onReschedule}
        >
          Изменить дни
        </button>
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() => setBaselineOpen((o) => !o)}
        >
          Максимумы
        </button>
        <button type="button" className="button button-small button-secondary" onClick={onRebuild}>
          Перестроить
        </button>
      </div>

      {baselineOpen && (
        <section className="plan-step" aria-label="Максимумы и рабочие веса">
          <StrengthForm card={card} onDone={() => setBaselineOpen(false)} />
        </section>
      )}

      <Forecast block={block} onReschedule={onReschedule} />
      <Diagnostics />

      <button
        type="button"
        className="link-button plan-why"
        aria-expanded={whyOpen}
        onClick={() => setWhyOpen((o) => !o)}
      >
        {whyOpen ? 'Скрыть, почему так' : 'Почему такой план'}
      </button>
      {whyOpen && (
        <div className="plan-why-text">
          <p>{block.rationale}</p>
          {block.comment && <p>Твой комментарий: «{block.comment}»</p>}
          {block.excluded.length > 0 && (
            <p>
              Не входят в план из-за оборудования, травм и запретов ({block.excluded.length}):{' '}
              {block.excluded.join(', ').toLowerCase()}.
            </p>
          )}
        </div>
      )}

      <dl className="plan-legend">
        <div>
          <dt>Запас</dt>
          <dd>
            Сколько повторов ты ещё смог бы сделать после последнего. Запас 2 — остановился, когда
            оставалось два.
          </dd>
        </div>
        {calibrate && (
          <div>
            <dt>Подбери вес</dt>
            <dd>
              На блоках и тренажёрах стеки в каждом зале разные. Возьми вес, с которым останется
              указанный запас, и запиши подходы — дальше тренер посчитает сам.
            </dd>
          </div>
        )}
      </dl>

      {[...weeks].map(([week, sessions]) => {
        const phase = sessions[0]!.phase;
        const plate = weekPlate(week, phase);
        return (
          <section key={week} className="plan-week" aria-labelledby={`week-${week}`}>
            <h2 id={`week-${week}`} className="plan-week-title">
              {plate && <PlateMark plate={plate} filled />}
              <span>Неделя {week}</span>
              <span className="plan-week-phase">{PHASE_TEXT[phase]}</span>
            </h2>
            <ol className="sessions">
              {sessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  past={s.date < today}
                  today={today}
                  isNext={s.id === next?.id}
                  open={openIds.has(s.id)}
                  onToggle={() => toggle(s.id)}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </main>
  );
}

interface SessionProps {
  session: SessionView;
  past: boolean;
  today: string;
  isNext: boolean;
  open: boolean;
  onToggle: () => void;
}

function SessionItem({ session: s, past, today, isNext, open, onToggle }: SessionProps) {
  const panelId = `session-${s.id}`;
  const empty = s.exercises.length === 0;
  const gap =
    s.gapDays === null
      ? 'первая в блоке'
      : `через ${s.gapDays} ${plural(s.gapDays, ['день', 'дня', 'дней'])}`;

  return (
    <li className="session" data-past={past || undefined} data-next={isNext || undefined}>
      <button
        type="button"
        className="session-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="session-date">{shortDay(s.date)}</span>
        <span className="session-title">
          {s.title}
          {isNext && <span className="session-badge">Ближайшая</span>}
        </span>
        <span className="session-meta">
          {gap}
          {s.phase === 'test'
            ? s.result
              ? ', результат записан'
              : ', проверка прогноза'
            : s.adjustments.length > 0 && !empty
              ? ', есть правки'
              : ''}
        </span>
      </button>
      {open && (
        <div id={panelId} className="session-body">
          {s.adjustments.length > 0 && (
            <ul className="session-adjustments">
              {s.adjustments.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {!empty && (
            <ol className="exercises">
              {s.exercises.map((x) => (
                <li key={x.slug} className="exercise">
                  <span className="exercise-name">{x.name}</span>
                  <span className="exercise-load" data-kind={x.load.kind}>
                    {loadText(x.load)}
                  </span>
                  <span className="exercise-sets">
                    {s.phase === 'test'
                      ? 'попытка на 1 раз'
                      : `${x.sets} × ${x.repsMin === x.repsMax ? x.repsMin : `${x.repsMin}–${x.repsMax}`}, запас ${x.rir}`}
                  </span>
                  {loadHint(x.load) && <span className="exercise-hint">{loadHint(x.load)}</span>}
                  {x.note && <span className="exercise-note">{x.note}</span>}
                </li>
              ))}
            </ol>
          )}
          {s.phase === 'test' && <TestForm session={s} today={today} />}
        </div>
      )}
    </li>
  );
}

const ANCHOR_FROM: Record<string, string> = {
  'barbell-back-squat': 'приседа',
  deadlift: 'становой',
  'bench-press': 'жима лёжа',
  'overhead-press': 'жима стоя',
  'barbell-row': 'тяги в наклоне',
};

function loadText(load: LoadView): string {
  if (load.kind === 'kg') {
    const approx = load.basis === 'ratio' || load.basis === 'bodyweight' ? '≈ ' : '';
    return `${approx}${load.perHand ? 'по ' : ''}${num(load.kg)} кг`;
  }
  if (load.kind === 'bodyweight') return 'свой вес';
  return 'подбери вес';
}

/** Откуда вес — одной строкой под упражнением. */
function loadHint(load: LoadView): string {
  if (load.kind === 'calibrate') {
    return load.reason === 'stack'
      ? 'Блок или тренажёр: стеки везде разные, подбери по запасу'
      : 'Нет данных: подбери по запасу';
  }
  if (load.kind !== 'kg') return '';
  if (load.basis === 'bodyweight')
    return 'Оценка по весу тела: впиши максимумы, и вес станет точным';
  if (load.basis === 'ratio') {
    return `От ${ANCHOR_FROM[load.fromSlug ?? ''] ?? 'базового движения'}${load.perHand ? ', на одну гантель' : ''}`;
  }
  if (load.basis === 'target') return '';
  return load.perHand ? 'На одну гантель' : '';
}

const SECTION_TITLES: Record<string, string> = {
  goals: 'цели',
  basics: 'основное',
  availability: 'время',
  equipment: 'оборудование',
  limitations: 'травмы и ограничения',
  experience: 'опыт',
  activity: 'активность',
  nutrition: 'питание',
  recovery: 'восстановление',
  weakPoints: 'слабые места',
};

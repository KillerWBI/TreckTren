import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { WeeklyReview } from '@trektren/shared';
import { ApiError } from '../api/http';
import { useDay, useSetAdjust } from '../day/useDay';
import { formatDateTime, num, todayIso } from '../format';
import { shortDate } from './charts';
import { useCreateWeeklyReview, useWeeklyReview } from './useProgress';

const VOLUME_TEXT: Record<WeeklyReview['volume'], string> = {
  up: 'Добавить',
  keep: 'Оставить',
  down: 'Убавить',
};

/**
 * Недельный разбор: тренер смотрит неделю целиком и предлагает две правки —
 * калории (не больше ±300) и объём тренировок. Правки применяет человек.
 */
export function WeeklyReviewCard() {
  const query = useWeeklyReview();
  const create = useCreateWeeklyReview();
  const review = query.data?.review ?? null;
  const stale =
    review !== null && Date.now() - new Date(review.createdAt).getTime() > 6 * 24 * 3600 * 1000;

  return (
    <section className="weekly" aria-labelledby="weekly-heading">
      <div className="card-head">
        <h2 id="weekly-heading" className="group-title">
          Разбор недели
        </h2>
        {review && (
          <span className="card-sub">
            {shortDate(review.weekStart)} — {shortDate(review.weekEnd)}
          </span>
        )}
      </div>

      {query.isPending && <p className="state">Загружаю разбор…</p>}
      {!query.isPending && !review && (
        <p className="plan-hint">
          Тренер посмотрит неделю целиком: вес, шаги, еду, сон и силовые — и скажет, что поправить в
          калориях и объёме тренировок.
        </p>
      )}

      {review && <ReviewBody review={review} />}

      {create.isError && (
        <p className="form-error" role="alert">
          {create.error instanceof ApiError ? create.error.message : 'Не получилось. Повтори.'}
        </p>
      )}
      {(!review || stale) && (
        <button
          type="button"
          className="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          <Sparkles size={20} strokeWidth={2.4} aria-hidden="true" />
          {create.isPending ? 'Тренер разбирает неделю…' : 'Разобрать неделю'}
        </button>
      )}
      {review && !stale && (
        <button
          type="button"
          className="link-button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          {create.isPending ? 'Разбираю заново…' : 'Разобрать заново с новыми данными'}
        </button>
      )}
    </section>
  );
}

function ReviewBody({ review }: { review: WeeklyReview }) {
  const navigate = useNavigate();
  const today = todayIso();
  const day = useDay(today);
  const adjust = useSetAdjust(today);
  // Предложение по калориям живое: если его уже приняли на «Сегодня», второй раз не даём.
  const liveDelta = day.data?.trend.kcalSuggestion ?? 0;
  const s = review.stats;

  return (
    <>
      {/* По правилам текст — те же пункты подряд; показываем его только от ИИ. */}
      {review.source === 'ai' && <p className="weekly-text">{review.text}</p>}

      <div className="adherence">
        <span className="stat">
          <span className="stat-value">
            {s.weightChangeKg === null
              ? '—'
              : `${s.weightChangeKg > 0 ? '+' : s.weightChangeKg < 0 ? '−' : ''}${num(Math.abs(s.weightChangeKg))}`}
          </span>
          <span className="stat-label">вес за неделю, кг</span>
        </span>
        <span className="stat">
          <span className="stat-value">
            {s.sessionsPlanned > 0 ? `${s.sessionsDone}/${s.sessionsPlanned}` : '—'}
          </span>
          <span className="stat-label">тренировок</span>
        </span>
        <span className="stat">
          <span className="stat-value">
            {s.avgKcal !== null && s.avgNormKcal
              ? `${Math.round((s.avgKcal / s.avgNormKcal) * 100)}%`
              : '—'}
          </span>
          <span className="stat-label">калорий от нормы</span>
        </span>
      </div>

      <ul className="weekly-points">
        {review.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>

      <div className="weekly-decisions">
        <div className="decision">
          <span className="decision-label">Калории</span>
          <span className="decision-value">
            {review.kcalDelta === 0
              ? 'Без изменений'
              : `${review.kcalDelta > 0 ? '+' : '−'}${Math.abs(review.kcalDelta)} ккал`}
          </span>
          {review.kcalDelta !== 0 &&
            (liveDelta !== 0 && day.data ? (
              <button
                type="button"
                className="button button-small"
                disabled={adjust.isPending}
                onClick={() =>
                  adjust.mutate(Math.max(-1000, Math.min(1000, day.data.calorieAdjust + liveDelta)))
                }
              >
                {adjust.isPending
                  ? 'Применяю…'
                  : `Применить ${liveDelta > 0 ? '+' : '−'}${Math.abs(liveDelta)}`}
              </button>
            ) : (
              <span className="badge badge-green">учтено в норме</span>
            ))}
        </div>
        <div className="decision">
          <span className="decision-label">Объём тренировок</span>
          <span className="decision-value">{VOLUME_TEXT[review.volume]}</span>
          <span className="card-sub">{review.volumeText}</span>
          {review.volume !== 'keep' && (
            <button
              type="button"
              className="button button-small button-secondary"
              onClick={() => navigate('/plan', { state: { rebuildComment: review.volumeText } })}
            >
              Перестроить план
            </button>
          )}
        </div>
      </div>
      <p className="field-hint">
        {review.source === 'ai' ? 'Вывод написал ИИ' : 'Собрано по правилам'}, цифры считает код.{' '}
        {formatDateTime(review.createdAt)}.
      </p>
    </>
  );
}

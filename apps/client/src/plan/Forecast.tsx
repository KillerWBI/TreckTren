import type { BlockView } from '@trektren/shared';
import { num, plural } from '../format';
import { shortDay } from './dates';

/** Прогноз максимумов на конец блока и когда проходка. */
export function Forecast({ block, onReschedule }: { block: BlockView; onReschedule: () => void }) {
  if (block.forecast.length === 0) return null;
  const weeksPerBlock = block.accumulationWeeks + 1;
  return (
    <section className="forecast" aria-labelledby="forecast-heading">
      <div className="forecast-head">
        <h2 id="forecast-heading" className="group-title">
          Прогноз на конец блока
        </h2>
        {block.testDate && <p className="forecast-date">проходка {shortDay(block.testDate)}</p>}
      </div>
      <ul className="forecast-list">
        {block.forecast.map((f) => {
          const months = f.blocksToGoal
            ? Math.max(1, Math.round((f.blocksToGoal * weeksPerBlock) / 4.35))
            : null;
          return (
            <li key={f.slug} className="forecast-row">
              <span className="forecast-name">{f.name}</span>
              <span className="forecast-kg">
                {f.estimated ? '≈ ' : ''}
                {num(f.startKg)} → <strong>{num(f.targetKg)}</strong>
              </span>
              {f.goalKg && (
                <span className="forecast-goal">
                  {f.goalKg <= f.startKg
                    ? `Цель ${num(f.goalKg)} уже взята — поставь новую в «Силовых».`
                    : f.blocksToGoal
                      ? `До ${num(f.goalKg)}: ≈ ${f.blocksToGoal} ${plural(f.blocksToGoal, ['блок', 'блока', 'блоков'])}, около ${months} ${plural(months!, ['месяца', 'месяцев', 'месяцев'])} без пропусков.`
                      : `До ${num(f.goalKg)} больше 40 блоков: цель за пределами натурального темпа, её стоит пересмотреть.`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {block.forecast.some((f) => f.estimated) && (
        <p className="plan-hint">
          ≈ — максимум посчитан, а не введён: впиши свои в «Максимумы», и прогноз станет точнее.
        </p>
      )}
      {!block.testDate && (
        <div className="forecast-missing">
          <p className="plan-hint">
            Проходки в плане нет: выбранные дни заканчиваются раньше разгрузки. Отметь дни с{' '}
            {shortDay(block.testFrom)} — последняя тренировка той недели станет проходкой.
          </p>
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={onReschedule}
          >
            Изменить дни
          </button>
        </div>
      )}
    </section>
  );
}

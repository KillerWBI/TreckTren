import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AthleteCard, CardResponse } from '@trektren/shared';
import { api } from '../api/http';
import { PlateMark, Sleeve } from '../components/Sleeve';
import { ErrorState, Loading } from '../components/States';
import { formatDateTime } from '../format';
import { SectionEditor } from '../card/SectionEditor';
import { isFilled, SECTIONS, type SectionDef, type SectionKey } from '../card/sections';
import { CARD_KEY } from '../card/useSaveCard';
import { WeakPointsEditor } from '../card/WeakPointsEditor';
import { StrengthForm, strengthSummary } from '../plan/StrengthForm';
import { useExercises } from '../plan/usePlan';

export function CardPage() {
  const query = useQuery({ queryKey: CARD_KEY, queryFn: () => api<CardResponse>('/card') });
  const [open, setOpen] = useState<SectionKey | 'strength' | null>(null);
  const [announcement, setAnnouncement] = useState('');

  if (query.isPending) return <Loading text="Загружаю карточку" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { card, version, updatedAt } = query.data;
  const filled = SECTIONS.filter((s) => isFilled(card, s.key));
  const missingRequired = SECTIONS.filter((s) => s.required && !isFilled(card, s.key));
  const slots = SECTIONS.map((s) => ({
    id: s.key,
    plate: s.plate,
    filled: isFilled(card, s.key),
    label: s.title,
  }));

  const close = (def: SectionDef) => (saved: boolean) => {
    setOpen(null);
    if (saved) setAnnouncement(`Раздел «${def.title}» сохранён`);
  };

  const rows = (required: boolean) =>
    SECTIONS.filter((s) => s.required === required).map((def) => (
      <SectionRow
        key={def.key}
        def={def}
        card={card}
        version={version}
        open={open === def.key}
        onToggle={() => setOpen(open === def.key ? null : def.key)}
        onClose={close(def)}
      />
    ));

  return (
    <main className="page">
      <h1 className="page-title">Карточка атлета</h1>
      <Sleeve slots={slots} title={`Заполнено ${filled.length} разделов из ${SECTIONS.length}`} />
      <p className="sleeve-caption">
        <strong>
          Заполнено {filled.length} из {SECTIONS.length}.
        </strong>{' '}
        {missingRequired.length > 0
          ? `Для первого плана не хватает: ${missingRequired.map((s) => s.title.toLowerCase()).join(', ')}.`
          : 'Всё обязательное на месте.'}
      </p>

      <section className="section-group" aria-labelledby="required-heading">
        <h2 id="required-heading" className="group-title">
          Обязательное для первого плана
        </h2>
        {rows(true)}
      </section>
      <StrengthRow
        card={card}
        open={open === 'strength'}
        onToggle={() => setOpen(open === 'strength' ? null : 'strength')}
        onClose={(saved) => {
          setOpen(null);
          if (saved) setAnnouncement('Силовые сохранены');
        }}
      />
      <section className="section-group" aria-labelledby="optional-heading">
        <h2 id="optional-heading" className="group-title">
          Можно заполнить позже
        </h2>
        {rows(false)}
      </section>

      <p className="page-meta">
        {version === 0
          ? 'Карточка ещё не сохранялась.'
          : `Версия ${version}, обновлена ${formatDateTime(updatedAt)}.`}{' '}
        {version > 0 && <Link to="/history">История изменений</Link>}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </main>
  );
}

interface RowProps {
  def: SectionDef;
  card: AthleteCard;
  version: number;
  open: boolean;
  onToggle: () => void;
  onClose: (saved: boolean) => void;
}

function SectionRow({ def, card, version, open, onToggle, onClose }: RowProps) {
  const filled = isFilled(card, def.key);
  const summary = filled ? def.summary(card) : '';
  const panelId = `section-${def.key}`;

  return (
    <div className="section-row" data-open={open}>
      <button
        type="button"
        className="section-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <PlateMark plate={def.plate} filled={filled} />
        <span className="section-text">
          <span className="section-title">{def.title}</span>
          <span className={filled ? 'section-summary' : 'section-summary section-summary-empty'}>
            {summary || def.why}
          </span>
        </span>
        <span className="section-action">
          {open ? 'Свернуть' : filled ? 'Изменить' : 'Заполнить'}
        </span>
      </button>
      {open && (
        <div id={panelId} className="section-panel">
          {def.key === 'weakPoints' ? (
            <WeakPointsEditor card={card} version={version} onClose={onClose} />
          ) : (
            <SectionEditor def={def} card={card} version={version} onClose={onClose} />
          )}
        </div>
      )}
    </div>
  );
}

/** «Силовые» — свой блок: максимумы, рабочие подходы и цели по упражнениям. */
function StrengthRow({
  card,
  open,
  onToggle,
  onClose,
}: {
  card: AthleteCard;
  open: boolean;
  onToggle: () => void;
  onClose: (saved: boolean) => void;
}) {
  const exercises = useExercises();
  const names = new Map((exercises.data ?? []).map((e) => [e.slug, e.name]));
  const summary = strengthSummary(card, names);
  return (
    <section className="section-group" aria-labelledby="strength-heading">
      <h2 id="strength-heading" className="group-title">
        Силовые
      </h2>
      <div className="section-row" data-open={open}>
        <button
          type="button"
          className="section-head section-head-plain"
          aria-expanded={open}
          aria-controls="section-strength"
          onClick={onToggle}
        >
          <span className="section-text">
            <span className="section-title">Максимумы и цели</span>
            <span className={summary ? 'section-summary' : 'section-summary section-summary-empty'}>
              {summary ||
                'От этих цифр считаются веса во всех упражнениях. Впиши максимумы или рабочие подходы в базовых.'}
            </span>
          </span>
          <span className="section-action">
            {open ? 'Свернуть' : summary ? 'Изменить' : 'Заполнить'}
          </span>
        </button>
        {open && (
          <div id="section-strength" className="section-panel section-panel-plain">
            <StrengthForm card={card} onDone={onClose} />
          </div>
        )}
      </div>
    </section>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Dumbbell, Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { AthleteCard, CardResponse } from '@trektren/shared';
import { api } from '../api/http';
import { ErrorState, Loading } from '../components/States';
import { formatDateTime } from '../format';
import { SectionEditor } from '../card/SectionEditor';
import { isFilled, SECTIONS, type SectionDef, type SectionKey } from '../card/sections';
import { CARD_KEY } from '../card/useSaveCard';
import { WeakPointsEditor } from '../card/WeakPointsEditor';
import { StrengthForm, strengthSummary } from '../plan/StrengthForm';
import { useExercises } from '../plan/usePlan';
import { Portrait } from '../portrait/Portrait';

export function CardPage() {
  const query = useQuery({ queryKey: CARD_KEY, queryFn: () => api<CardResponse>('/card') });
  const [open, setOpen] = useState<SectionKey | 'strength' | null>(null);
  const [announcement, setAnnouncement] = useState('');

  if (query.isPending) return <Loading text="Загружаю профиль" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { card, version, updatedAt } = query.data;
  const filled = SECTIONS.filter((s) => isFilled(card, s.key));
  const missingRequired = SECTIONS.filter((s) => s.required && !isFilled(card, s.key));

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
      <div className="page-head">
        <h1 className="page-title">Профиль</h1>
        <Link to="/account" className="button button-small button-secondary mobile-only">
          <Settings size={18} strokeWidth={2.4} aria-hidden="true" />
          Аккаунт
        </Link>
      </div>
      <p className="page-lead">
        {missingRequired.length > 0
          ? `Для первого плана не хватает: ${missingRequired.map((s) => s.title.toLowerCase()).join(', ')}.`
          : `Заполнено ${filled.length + (card.strength?.lifts && Object.keys(card.strength.lifts).length > 0 ? 1 : 0)} из ${SECTIONS.length + 1}. Чем больше тренер знает, тем точнее план и норма.`}
      </p>

      <div className="cols cols-mixed card-cols">
        <div className="col">
          <section
            className="section-group"
            aria-labelledby="required-heading"
            style={{ order: 2 }}
          >
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
          <section
            className="section-group"
            aria-labelledby="optional-heading"
            style={{ order: 4 }}
          >
            <h2 id="optional-heading" className="group-title">
              Можно заполнить позже
            </h2>
            {rows(false)}
          </section>
          <p className="page-meta" style={{ order: 5 }}>
            {version === 0
              ? 'Профиль ещё не сохранялся.'
              : `Версия ${version}, обновлена ${formatDateTime(updatedAt)}.`}{' '}
            {version > 0 && <Link to="/history">История изменений</Link>}
          </p>
        </div>
        <div className="col sticky">
          <div className="slot" style={{ order: 1 }}>
            <Portrait />
          </div>
        </div>
      </div>
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
        <span className="section-icon" data-filled={filled || undefined} aria-hidden="true">
          {filled ? <Check size={20} strokeWidth={3} /> : <def.icon size={20} strokeWidth={2.4} />}
        </span>
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
    <section className="section-group" aria-labelledby="strength-heading" style={{ order: 3 }}>
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
          <span
            className="section-icon"
            data-filled={summary ? true : undefined}
            aria-hidden="true"
          >
            {summary ? (
              <Check size={20} strokeWidth={3} />
            ) : (
              <Dumbbell size={20} strokeWidth={2.4} />
            )}
          </span>
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

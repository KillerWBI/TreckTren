import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardResponse, CardVersionDetail, CardVersionSummary } from '@trektren/shared';
import { api } from '../api/http';
import { ErrorState, Loading } from '../components/States';
import { formatDateTime } from '../format';
import { SOURCE_LABELS } from '../card/labels';
import { isFilled, SECTIONS } from '../card/sections';
import { CARD_KEY, VERSIONS_KEY } from '../card/useSaveCard';

/** Разделы, которые ведут код и ИИ: в истории без блина, только названием. */
const SYSTEM_SECTION_TITLES: Record<string, string> = {
  strength: 'Силовые',
  forecast: 'Прогноз',
  coachNotes: 'Заметки тренера',
};

function sectionTitle(key: string): string {
  return SECTIONS.find((s) => s.key === key)?.title ?? SYSTEM_SECTION_TITLES[key] ?? key;
}

export function HistoryPage() {
  const query = useQuery({
    queryKey: VERSIONS_KEY,
    queryFn: () => api<CardVersionSummary[]>('/card/versions'),
  });
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (query.isPending) return <Loading text="Загружаю историю" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const versions = query.data;
  const latest = versions[0]?.version ?? 0;

  return (
    <main className="page">
      <h1 className="page-title">История профиля</h1>
      <p className="page-lead">
        Каждое сохранение — новая версия. Любую можно вернуть: старые версии при этом не пропадают.
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {versions.length === 0 ? (
        <div className="empty">
          <p>Истории пока нет. Заполни первый раздел профиля — здесь появится версия 1.</p>
          <Link className="button" to="/card">
            Открыть профиль
          </Link>
        </div>
      ) : (
        <ol className="versions">
          {versions.map((v) => (
            <li key={v.version} className="version" data-open={openVersion === v.version}>
              <div className="version-head">
                <span className="version-number">{v.version}</span>
                <div className="version-text">
                  <p className="version-title">
                    {SOURCE_LABELS[v.source]}, {formatDateTime(v.createdAt)}
                  </p>
                  {v.reason && <p className="version-reason">{v.reason}</p>}
                  <ul className="version-sections" aria-label="Изменённые разделы">
                    {v.changedSections.map((key) => (
                      <li key={key}>{sectionTitle(key)}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                type="button"
                className="link-button"
                aria-expanded={openVersion === v.version}
                onClick={() => setOpenVersion(openVersion === v.version ? null : v.version)}
              >
                {openVersion === v.version ? 'Скрыть' : 'Посмотреть профиль в этой версии'}
              </button>
              {openVersion === v.version && (
                <VersionDetail
                  version={v.version}
                  isLatest={v.version === latest}
                  onRestored={(newVersion) => {
                    setOpenVersion(null);
                    setNotice(`Вернул версию ${v.version}. Это теперь версия ${newVersion}.`);
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function VersionDetail({
  version,
  isLatest,
  onRestored,
}: {
  version: number;
  isLatest: boolean;
  onRestored: (newVersion: number) => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['card-version', version],
    queryFn: () => api<CardVersionDetail>(`/card/versions/${version}`),
    staleTime: Infinity,
  });
  const restore = useMutation({
    mutationFn: () =>
      api<CardResponse & { changed: boolean }>(`/card/versions/${version}/restore`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<CardResponse>(CARD_KEY, {
        card: data.card,
        version: data.version,
        updatedAt: data.updatedAt,
      });
      void queryClient.invalidateQueries({ queryKey: VERSIONS_KEY });
      onRestored(data.version);
    },
  });

  if (detail.isPending) return <p className="state">Загружаю версию…</p>;
  if (detail.isError) return <p className="form-error">{(detail.error as Error).message}</p>;

  const snapshot = detail.data.snapshot;
  return (
    <div className="version-detail">
      <dl className="snapshot">
        {SECTIONS.map((def) => (
          <div key={def.key} className="snapshot-row">
            <dt>{def.title}</dt>
            <dd>{isFilled(snapshot, def.key) ? def.summary(snapshot) : 'Не заполнено'}</dd>
          </div>
        ))}
      </dl>
      {!isLatest && (
        <>
          <button
            type="button"
            className="button"
            disabled={restore.isPending}
            onClick={() => restore.mutate()}
          >
            {restore.isPending ? 'Возвращаю…' : 'Вернуть эту версию'}
          </button>
          {restore.isError && <p className="form-error">{(restore.error as Error).message}</p>}
        </>
      )}
    </div>
  );
}

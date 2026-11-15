# TreckTren — заметки для Claude

## Где код и как он попадает на GitHub

- Рабочая копия — папка пользователя `C:\Users\topch\OneDrive\Рабочий стол\TreckTren`.
  Это git-репозиторий, `origin` — https://github.com/KillerWBI/TreckTren, ветка `main`.
- Все правки делаются здесь, в этой папке, коммитятся здесь и уходят в `main` на GitHub.
  Railway собирает и выкладывает сайт сам после каждого push.
- Не работать в отдельной копии в облаке и не оставлять код только там.
- Если push из среды, где работает Claude, заблокирован: закоммитить в этой папке,
  `git bundle create .relay.bundle main`, перенести бандл туда, где push работает,
  `git fetch .relay.bundle main && git push origin HEAD:main`, удалить бандл,
  в этой папке — `git fetch origin`.

## Перед push

```
npx eslint .
npx prettier --check .
npm run typecheck
npm test            # нужен локальный PostgreSQL, см. README
```

## Устройство

- `packages/shared` — общие схемы zod и типы.
- `apps/server` — Express 5 + PostgreSQL, миграции в `apps/server/migrations/*.sql`.
- `apps/client` — React 19 + Vite, PWA; портрет и анатомия — `src/portrait/`.
- Подробности запуска и переменные окружения — в README.

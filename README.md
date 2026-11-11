# TreckTren

ИИ-тренер для зала: PWA, где всё строится вокруг карточки атлета. Сейчас готова неделя 1 по ТЗ: каркас, схема БД, авторизация с согласием и карточка атлета с историей версий.

## Что внутри

| Папка             | Что это                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/shared` | Общие схемы zod: карточка атлета, запросы авторизации, merge patch, коды ошибок, русские сообщения валидации |
| `apps/server`     | API на Express 5 + PostgreSQL, миграции в `migrations/*.sql`                                                 |
| `apps/client`     | React 19 + Vite 8, мобильная вёрстка под 390 px                                                              |

Стек: Node.js 22, TypeScript 6, Express 5, PostgreSQL 16, zod 4, React 19, TanStack Query, Vitest.

## Запуск на Windows

1. Поставь [Node.js 22 LTS](https://nodejs.org/) (нужна 22.12 или новее) и [PostgreSQL 16](https://www.postgresql.org/download/windows/). При установке PostgreSQL запомни пароль пользователя `postgres`.
2. Создай две базы в pgAdmin или в SQL Shell (psql):
   ```sql
   CREATE DATABASE trektren_dev;
   CREATE DATABASE trektren_test;
   ```
3. В корне проекта:
   ```powershell
   npm install
   copy apps\server\.env.example apps\server\.env
   copy apps\server\env.test.example apps\server\.env.test
   ```
4. В `apps/server/.env` впиши пароль от `postgres` в `DATABASE_URL` и сгенерируй секрет для `JWT_ACCESS_SECRET`:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
   В `apps/server/.env.test` поправь пароль в `TEST_DATABASE_URL`.
5. Накати схему и запусти:
   ```powershell
   npm run db:migrate
   npm run dev
   ```
   Клиент: http://localhost:5173, API: http://localhost:3000/api/v1. Vite проксирует `/api` на сервер, поэтому refresh-cookie работает как в проде.

Проект лучше держать вне OneDrive (например, `C:\dev\TreckTren`): `node_modules` — это тысячи файлов, синхронизация их тормозит.

## Команды

| Команда                                  | Что делает                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                            | API и клиент вместе, с перезапуском при изменениях                          |
| `npm test`                               | Тесты shared и сервера; тесты сервера пересоздают схему базы из `.env.test` |
| `npm run typecheck`                      | Проверка типов во всех пакетах                                              |
| `npm run lint`                           | ESLint                                                                      |
| `npm run format`                         | Prettier                                                                    |
| `npm run build`                          | Сборка shared, сервера и клиента                                            |
| `npm start`                              | Запуск собранного сервера                                                   |
| `npm run db:migrate` / `db:migrate:down` | Миграции вверх / откат последней                                            |

Тесты отказываются работать с базой, в имени которой нет `test`: они удаляют всю схему.

## API недели 1

Все пути с префиксом `/api/v1`. Ошибки в формате `{ "error": { "code", "message", "details?" } }`.

| Метод и путь                     | Что делает                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /auth/register`            | Регистрация: email, пароль от 8 символов, `healthConsent: true`, `adultConfirmed: true` |
| `POST /auth/login`               | Вход                                                                                    |
| `POST /auth/refresh`             | Новый access-токен по refresh-cookie, старый refresh отзывается                         |
| `POST /auth/logout`              | Выход, отзыв refresh-токена                                                             |
| `GET /me`                        | Текущий пользователь                                                                    |
| `DELETE /account`                | Удаление аккаунта и всех данных, нужен пароль                                           |
| `GET /card`                      | Карточка атлета и её версия                                                             |
| `PATCH /card`                    | Правка: `{ patch, baseVersion?, reason? }`                                              |
| `GET /card/versions`             | История версий                                                                          |
| `GET /card/versions/:v`          | Снимок карточки в версии `v`                                                            |
| `POST /card/versions/:v/restore` | Откат: снимок версии `v` становится новой версией                                       |

## Решения, которые стоит знать

- **Правки карточки — JSON Merge Patch (RFC 7386).** Объекты сливаются, `null` удаляет поле, массивы заменяются целиком. Каждая правка создаёт версию с патчем и полным снимком, поэтому откат не переписывает историю.
- **Кто что правит.** Человек меняет 10 разделов из `USER_EDITABLE_SECTIONS`. Силовые, прогноз и заметки тренера через `PATCH /card` не меняются (403): их пишут код и ИИ через `applyCardPatch` с нужным `allowedSections`.
- **Конфликты.** Клиент шлёт `baseVersion`. Если карточку уже поменяли на другом устройстве, сервер вернёт 409, и клиент подтянет свежую версию.
- **Схемы строгие.** Неизвестный ключ в карточке — ошибка 422, а не тихое сохранение опечатки.
- **Сессии.** Access-токен живёт 15 минут и хранится только в памяти вкладки. Refresh-токен лежит в httpOnly-cookie с путём `/api/v1/auth`, в базе — только его SHA-256. Каждый refresh меняет токен. Повтор старого токена позже 10 секунд считается кражей и отзывает все сессии пользователя.
- **Приватность.** В логах только метод, путь, статус и время. Тела запросов и query не пишутся. Удаление аккаунта каскадом удаляет все таблицы пользователя.

## Прод

Прод живёт на Railway, проект `trecktren`: https://app-production-0b85540c.up.railway.app. Каждый пуш в `main` деплоится сам.

| Сервис     | Что это                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `app`      | Этот репозиторий, сборщик Railpack, регион sfo. Один сервер отдаёт и API, и собранный клиент, поэтому cookie работает с `SameSite=Strict` |
| `Postgres` | Шаблон Railway PostgreSQL 18 с томом на 5 ГБ                                                                                              |

Настройки `app`:

- Сборка: `npm run build` из корня (Railpack запускает его сам), Node 22 через `RAILPACK_NODE_VERSION=22`.
- Перед запуском: `npm run db:migrate:prod -w @trektren/server` — миграции катятся до старта новой версии; если упали, деплой не переключается.
- Запуск: `npm start`, healthcheck: `/api/v1/health`. `NODE_ENV=production` Railpack ставит сам.
- Переменные: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (внутренняя сеть, без SSL), `JWT_ACCESS_SECRET`, `PORT=8080`, `CLIENT_DIST_DIR=../client/dist`, `TRUST_PROXY=1`, `CORS_ORIGIN` — домен приложения, `COOKIE_SAMESITE=strict`.

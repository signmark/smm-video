# Mavis — production smoke после UI hardening и UTF-8 hotfix

**Дата:** 2026-07-22  
**Production:** `https://smm.omemo.tech`  
**Ожидаемый baseline:** `main` не ниже `2b20936` (`fix(ui): restore UTF-8 topbar copy`)  
**Режим:** тестирование и отчёт; без реальных публикаций и без остановки production-сервисов.

## Цель

Проверить новый production build после UI hardening и hotfix повреждённой
кодировки Topbar. Проверять поведение пользователя, а не внутреннюю реализацию.

## Ограничения безопасности

1. Не создавать и не публиковать посты в реальные соцсети.
2. Не выключать production backend, Directus, scraper или auth-сервис.
3. Не инвалидировать живую сессию владельца и не выполнять logout без
   отдельного разрешения.
4. Не читать и не выводить cookies, localStorage, access/refresh tokens,
   пароли и request headers.
5. Fault-injection выполнять только локально или через безопасный request mock.
6. Не исправлять найденные дефекты в этой задаче. Сначала оформить точное
   воспроизведение и severity; owner/Codex отдельно даст команду на fix.

## P0 — обязательный production smoke

### 1. UTF-8 и Topbar

- Открыть `/analytics`, `/posts`, `/content`, `/publish/scheduled`.
- Убедиться, что в шапке отображаются `Тарифы`, `СММ Админ`, `AI Помощник`,
  `TG Ассистент`, `Свернуть меню`/`Развернуть меню`.
- Открыть tooltip автономного режима и диалог его запуска, но ничего не
  запускать. Проверить читаемость всех заголовков, описаний и кнопок.
- Просканировать видимый DOM на характерные mojibake-маркеры:
  `Ð`, `Ñ` в латинской перекодировке, `Â`, `â€”`, `â†’`, `â€¦`.
- Acceptance: ни одного такого фрагмента в пользовательском тексте.

### 2. Analytics verdict

- Кампания без публикаций: `/analytics` должен показывать `Нет данных`, без
  `Низкая эффективность`.
- Кампания `Чушь`, период `7 дней`: ожидается `Нет данных`.
- Кампания `Чушь`, период `Текущий месяц`: ожидаются ровно 4 поста и 5
  просмотров. Поскольку `views > 0`, допустим rate-based verdict
  `Низкая эффективность`; `Недостаточно просмотров` предназначено для
  `posts > 0 && views = 0`.
- При смене периода не должны одновременно отображаться старые counters и
  новый verdict.

### 3. Campaign switch

- Быстро переключить минимум три кампании, например
  `Чушь → Прикол → OMEMO → Чушь`, на `/analytics`, `/posts` и `/content`.
- Во время загрузки допустим skeleton/пустой loading-контейнер.
- Acceptance: нет белого экрана, React/page errors, данных предыдущей
  кампании после завершения загрузки, открытых stale-dialogs.
- Отдельно проверить, что `/content` имеет заголовок и кнопку создания, а не
  пустой `body`.

### 4. Posts и scheduled

- `/posts`, кампания `Чушь`: июль 2026, ровно четыре VK-поста на 13 июля.
- `/publish/scheduled`: upcoming counter и список должны согласовываться.
- Если в существующих данных есть failed publication, она должна находиться
  в секции ошибок/повторной попытки и не учитываться как опубликованная.
- Если failed fixture отсутствует, отметить `NOT TESTABLE ON PROD DATA`, не
  создавать ошибочную публикацию специально.

### 5. Production routes

- `/settings/instagram-setup` открывается как реальный пользовательский route.
- `/test/auth-bypass`, `/test/telegram`, `/editor-demo`, `/publish/test`
  недоступны в production и уходят в NotFound/безопасный fallback.

## P1 — fault-injection только локально или через mock

### QueryErrorState

1. Открыть analytics с валидной тестовой сессией.
2. Заблокировать/замокать только analytics API как network error/500.
3. Ожидание: `Не удалось загрузить данные` и кнопка `Повторить`; никаких
   counters, verdict или `Нет данных`.
4. Вернуть API и нажать `Повторить`.
5. Ожидание: данные/валидный empty-state восстановились без повторного login.

### Session recovery

1. В локальном/изолированном контексте дать просроченный access token и
   временно недоступный refresh endpoint.
2. Ожидание: спиннер завершается, появляется recovery-card с `Повторить` и
   `Выйти и войти заново`.
3. Проверить отдельно invalid refresh (`401`): переход на `/auth/login`.
4. Не использовать для этого живую production-сессию владельца.

## Быстрый regression gate

```powershell
npx.cmd vitest run client/src/lib/__tests__/topbar-encoding.test.ts client/src/lib/__tests__/analytics-verdict.test.ts client/src/lib/__tests__/query-error-classification.test.ts client/src/lib/__tests__/queryClient-session.test.ts client/src/lib/__tests__/refreshAuth.test.ts client/src/lib/__tests__/scheduled-classification.test.ts client/src/lib/__tests__/published-content.test.ts --maxWorkers=2
npx.cmd tsc -p tsconfig.critical.json
npx.cmd vite build
```

## Формат результата

Создать `docs/prompts/mavis-production-smoke-results-2026-07-22.md`:

- фактически проверенный production build/asset timestamp;
- таблица `Scenario | PASS/FAIL/NOT TESTABLE | Evidence`;
- для каждого FAIL: URL, кампания, период, точные шаги, expected/actual,
  console/page errors, screenshot path;
- отдельно список mojibake-фрагментов, даже если основной сценарий PASS;
- команды и итог regression gate;
- явный verdict: `READY`, `READY WITH FOLLOW-UPS` или `BLOCKED`.

Сделать отдельный docs-only commit с результатом. Не пушить изменения кода и
не деплоить без новой команды owner. В финальном сообщении обязательно указать
hash коммита отчёта и все P0 FAIL.

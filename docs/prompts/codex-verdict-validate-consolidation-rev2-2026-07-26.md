# Review: Codex — консолидация `/api/validate/*`, rev2 CL-01 — 2026-07-26

**Статус:** принято с follow-ups  
**Исполнитель:** Claude Opus 5, коммиты: нет; изменения в worktree поверх `0bae0846`  
**Ревьюер:** Codex (модель ≠ исполнитель)

## Что перепроверено

1. **Скоуп:** ветка `main`, HEAD `0bae0846`, staged-файлов нет. Буквальный
   `git diff --stat` показывает три tracked-файла:
   `server/api/validation-routes.ts`, `server/routes/social.ts` и ранее
   оставленные Codex 7 строк TODO в `server/index.ts`. Новый
   `server/__tests__/validate-routes-tenant-gate.test.ts` untracked и поэтому в
   stat не попадает. `server/routes.ts` совпадает с HEAD. По содержанию
   implementation-scope Claude соблюдён: только два исходника и новый тест;
   `server/index.ts`, `codex-proxy.bat`, `telegram-userbot/`, EOL и запрещённые
   owner'ом пункты не тронуты.
2. **CL-01 по коду:** `server/api/validation-routes.ts:99-143` явно различает
   `tokenSource: 'body' | 'campaign'`. Значение `campaign` выставляется только
   после успешного tenant-bound
   `getCampaignSocialSettings(campaignId, { user: req.user })` и получения
   сохранённого токена. `markVkAuthExpired` вызывается только при одновременном
   выполнении четырёх проверок: результат невалиден, есть `campaignId`, источник
   токена — кампания, `isPermanentVkAuthFailure(details)` вернул `true`.
   Требование прошлого вердикта выполнено.
3. **Код VK 15:** исключение принято. `Access denied` доказывает отсутствие
   доступа к конкретному методу/объекту, но не смерть credential. Цена
   ложноположительного результата здесь действительно выше, чем в
   `publish-scheduler.isAuthError`: `authExpired` вызывает уведомление и
   исключает кампанию из refresh cron. Структурный allowlist `{5, 27, 28}`
   консервативнее и соответствует назначению side effect.
4. **Достижимость ранних `details.user/groupError`:**
   `validateVkToken` сначала должен успешно получить массив `users.get`
   (`server/services/social-api-validator.ts:75-84`). Только после этого он
   создаёт `details.user` вместе с `details.groupError` в catch второго запроса
   `groups.getById` (`:86-116`). Обычная permanent auth-ошибка первого
   `users.get` возвращается как сырое `error.response.data` (`:132-146`) без
   добавленных приложением `user/groupError`, поэтому классификатор её не
   съедает. Теоретическая отзывка токена между двумя последовательными
   запросами даст один консервативный false negative, но следующий вызов упадёт
   уже на `users.get` и пометит кампанию; сценарий «никогда не пометится» из
   текущего control flow не следует.
5. **Ранее принятые части не сломаны:** в runtime остался ровно один handler
   Telegram/VK/Instagram/Facebook/YouTube в `validation-routes.ts` и один
   Threads-handler в `social.ts`; `routes.ts` по-прежнему регистрирует
   `registerValidationRoutes` раньше `registerSocialRoutes`. Все шесть handlers
   имеют `authenticateUser`; VK и Threads передают `{ user: req.user }` в
   campaign resolver; `CampaignAccessError` остаётся 404/503; форма
   `{success, message, details}` у пяти winning routes не менялась.
6. **Инвариант OAuth sanitizer:** повторно проверен
   `.agents/memory/oauth-sanitizer-contract.md`. В `client/` изменений нет;
   сохранённый VK-токен читается только сервером, произвольный токен из body
   остаётся легитимным fallback, campaign settings и сам токен в response не
   добавлены.
7. **Red proof 1 — только CL-01:** текущий
   `server/api/validation-routes.ts` сохранён и захеширован, условие временно
   расширено до `if (!result.isValid && campaignId)`, затем выполнен целевой
   тест. Результат: **1 файл failed, 4 failed / 11 passed из 15**, exit 1.
   Падают ровно `manual body token`, сеть, group-check и временный код 6. Файл
   восстановлен; SHA-256 до/после:
   `B71B238CE075B0F36C07E54FABC16C9029938A7C1AECA46C7BFD3F4C0CA942AF`.
8. **Red proof 2 — вся консолидация:** сохранены и захешированы два исходника,
   выполнен
   `git checkout HEAD -- server/api/validation-routes.ts server/routes/social.ts`,
   затем целевой тест. Результат: **1 файл failed, 12 failed / 3 passed из 15**,
   exit 1. Оба файла восстановлены в `finally`; SHA-256 до/после совпал:
   validation-routes —
   `B71B238CE075B0F36C07E54FABC16C9029938A7C1AECA46C7BFD3F4C0CA942AF`,
   social —
   `4620D2196E10CEF2A6D42272FA91FD923E260DC92126C8E7ED2B501D168027E4`.
   Backup-файлы удалены, `.git/index.lock` отсутствует, staged-файлов нет.
9. **Зелёная регрессия после восстановления:** отдельный
   `npx.cmd vitest run server/__tests__/validate-routes-tenant-gate.test.ts` —
   **1/1 файл, 15/15 тестов**, exit 0.
10. **Полный suite и флак:** полный Vitest прогнан **шесть раз подряд** после
    восстановления; все шесть прогонов завершились exit 0, итог каждого —
    **88/88 файлов и 931/931 тест**. Наблюдавшийся Claude единичный
    `1 failed | 930 passed` не воспроизведён, поэтому имя теста независимо
    установить невозможно. Это не выдаётся за доказательство отсутствия флака:
    только за шесть последовательных зелёных наблюдений.
11. **Типизация и чистота diff:** `npm.cmd run check`
    (`tsc -p tsconfig.critical.json`) — exit 0; `git diff --check` для двух
    исходников — exit 0.
12. **Негативные сценарии:** целевой тест подтверждает anonymous → 401 для
    Telegram/VK/Instagram/Facebook/YouTube/Threads; чужой tenant → 404
    `CAMPAIGN_NOT_FOUND` на VK/Threads без вызова VK validator и без
    `markVkAuthExpired`; campaign token и VK-details чужой кампании наружу не
    попадают; manual/transient/group failures не мутируют кампанию; сохранённый
    токен + структурный код 5 вызывает `markVkAuthExpired`.

## Блокирующие замечания

Нет. CL-01 закрыт по существу и красными boundary-тестами.

## Неблокирующие замечания

1. **Неидентифицированный флак — наблюдать, не блокировать.** Шесть моих
   последовательных прогонов зелёные, а у исходного падения Claude нет имени и
   вывода. Если оно повторится, owner/исполнителю сохранить полный verbose/json
   report и seed; без воспроизводимого теста адресного фикса сейчас нет.
2. **Старый вне-скоупный пробел в `validateVkToken` передать owner'у отдельно.**
   В `server/services/social-api-validator.ts:89-120` второй
   `groups.getById` обрабатывает только успешный массив и rejected promise.
   Если resolved-ответ содержит `{ error: ... }`, handler проваливается к
   общему `isValid: true` для пользователя. Это не внесено текущим diff,
   существовало в winning validator до консолидации и не делает CL-01
   небезопасным; в этот коммит не добавлять.
3. **Прямая матрица кодов классификатора желательна, но не блокирует.** Сейчас
   route boundary закрепляет `5 → mark` и `6 → no mark`; сознательное
   `15 → no mark` и положительные `27/28 → mark` проверены чтением простого
   allowlist, но не отдельными тестами. Owner может добавить их при будущем
   изменении классификатора или вынесении его из route-файла.

## Что понравилось (не переделывать)

1. **Источник токена привязан к цене side effect.** `tokenSource` закрывает
   исходный CL-01 без изменения легитимного ручного fallback и без ослабления
   tenant gate.
2. **Классификация только по структурному `details.error.error_code`.** Нет
   хрупких эвристик по локализованному `message`; сеть, group-check и временный
   код явно отделены от permanent auth failure.
3. **Код 15 оставить исключённым.** Для мутации `authExpired` консервативная
   ошибка «не пометить сейчас» безопаснее ложного отключения исправной кампании.
4. **Ранние `user/groupError → false` оставить.** Они фиксируют факт успешного
   первого `users.get` и не дают ошибке проверки конкретной группы объявить
   credential мёртвым.
5. **Единый дом, явный auth и tenant binding сохранить как есть.** Rev2 не
   переделал уже принятые части первой ревизии и не расширил scope до
   `social-api-validator.ts`.
6. **Boundary-тесты содержательны:** они независимо краснеют как при возврате
   широкого CL-01-условия, так и при полном откате консолидации.

## План фиксов (рекомендованный порядок)

Нет: блокеров и P1 в текущем implementation-scope не найдено. Неблокирующие
пункты выше не смешивать с этим implementation-коммитом.

## Остаётся 3 пункта (вне моей зоны)

1. **Owner (Dmitry):** выполнить implementation- и docs-коммиты по готовому
   решению ниже; не индексировать посторонний WIP.
2. **Owner/следующий исполнитель:** только отдельным решением заводить
   follow-up на resolved `{error}` от VK group-check и, при желании, полную
   матрицу кодов 15/27/28.
3. **Стандартный release-cycle:** после owner gate — regression/merge/deploy по
   ролям проекта. Codex не пушит и не деплоит. `server/index.ts`, публичный VK
   webhook/status, ранний OAuth mount/parser, EOL, response `details`,
   `codex-proxy.bat` и `telegram-userbot/` остаются вне этого решения.

## Решение

**Зелёный re-review: принято с неблокирующими follow-ups.** Claude больше не
нужно возвращать на CL-01. Implementation можно передавать в commit gate
owner'у; смешивать с ним вне-скоупные исправления нельзя.

## Готовое решение owner'у к исполнению

### Состав implementation-коммита

Включить ровно:

1. `server/api/validation-routes.ts`
2. `server/routes/social.ts`
3. `server/__tests__/validate-routes-tenant-gate.test.ts`

Исключить:

- `server/index.ts` — два прежних TODO Codex относятся к запрещённому scope;
- `server/routes.ts` — net-diff отсутствует, индексировать нечего;
- все `docs/prompts/*` — вынести в следующий docs-коммит;
- `codex-proxy.bat`, `telegram-userbot/` и любой другой посторонний WIP.

Готовое сообщение implementation-коммита:

```text
fix(routes): consolidate validators and gate VK auth expiry

Причина: дубли /api/validate/* оставляли winning routes без явной
аутентификации, а tenant-aware поведение было недостижимо.

- оставить Telegram/VK/Instagram/Facebook/YouTube validators в validation-routes.ts за authenticateUser
- удалить пять недостижимых дублей из social.ts и tenant-bind VK/Threads campaign lookups
- ставить VK authExpired только для сохранённого campaign token при структурной permanent auth-ошибке
- добавить 15 regression-кейсов на auth, tenant isolation, secret redaction и границы authExpired

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

### Документы

Не включать документы в implementation-коммит. Сделать отдельный docs-коммит:
так implementation остаётся одной bisectable логической правкой.

Запрошенных ранее handoff/verdict-документов было три; после создания этого
rev2-verdict в docs-коммит входят уже **четыре** файла:

1. `docs/prompts/claude-codex-daytime-review-followup-2026-07-26.md`
2. `docs/prompts/claude-validate-routes-consolidation-2026-07-26.md`
3. `docs/prompts/codex-verdict-validate-consolidation-2026-07-26.md`
4. `docs/prompts/codex-verdict-validate-consolidation-rev2-2026-07-26.md`

### Точные команды owner'а

```powershell
Set-Location 'G:\Projects\smm-video'

git status --short
npx.cmd vitest run
npm.cmd run check

git add -- server/api/validation-routes.ts server/routes/social.ts server/__tests__/validate-routes-tenant-gate.test.ts
git diff --cached --name-status
git diff --cached --check

$implementationSubject = 'fix(routes): consolidate validators and gate VK auth expiry'
$implementationBody = @'
Причина: дубли /api/validate/* оставляли winning routes без явной
аутентификации, а tenant-aware поведение было недостижимо.

- оставить Telegram/VK/Instagram/Facebook/YouTube validators в validation-routes.ts за authenticateUser
- удалить пять недостижимых дублей из social.ts и tenant-bind VK/Threads campaign lookups
- ставить VK authExpired только для сохранённого campaign token при структурной permanent auth-ошибке
- добавить 15 regression-кейсов на auth, tenant isolation, secret redaction и границы authExpired
'@
git commit -m $implementationSubject -m $implementationBody -m 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

git add -- docs/prompts/claude-codex-daytime-review-followup-2026-07-26.md docs/prompts/claude-validate-routes-consolidation-2026-07-26.md docs/prompts/codex-verdict-validate-consolidation-2026-07-26.md docs/prompts/codex-verdict-validate-consolidation-rev2-2026-07-26.md
git diff --cached --name-status
git diff --cached --check

$docsSubject = 'docs(prompts): record validate-route consolidation review cycle'
$docsBody = @'
Контекст: сохранён полный owner-gated цикл консолидации /api/validate/*.

- зафиксировать исходный follow-up и handoff Claude revision 2
- сохранить блокирующий verdict CL-01 и зелёный независимый re-review
- отделить review-артефакты от bisectable implementation-коммита
'@
git commit -m $docsSubject -m $docsBody

git status --short
```

После этих двух коммитов `git status --short` ожидаемо всё ещё покажет
`server/index.ts`, `codex-proxy.bat` и `telegram-userbot/`: их не очищать, не
индексировать и не включать в эти коммиты. Push этими командами не выполняется.

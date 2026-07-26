# Review: Codex — консолидация `/api/validate/*` в worktree — 2026-07-26

**Статус:** **блокировано**  
**Исполнитель:** Claude Opus 5, коммиты: нет; изменения в worktree поверх `0bae0846`  
**Ревьюер:** Codex (модель ≠ исполнитель)

## Что перепроверено

1. **Скоуп:** по буквальному `git diff --stat` только заявленные файлы — **нет**:
   видны `server/api/validation-routes.ts`, `server/routes/social.ts` и ранее
   оставленные Codex 7 строк TODO в `server/index.ts`. Новый тест untracked и
   поэтому в `git diff --stat` не попадает. `server/routes.ts` после снятия
   review-TODO совпадает с HEAD и net-diff не имеет. Также в worktree уже были
   два handoff-документа, `codex-proxy.bat` и `telegram-userbot/`.
   По содержанию diff исполнителя scope соблюдён: логика менялась только в
   `validation-routes.ts`, `social.ts` и новом
   `validate-routes-tenant-gate.test.ts`; `server/index.ts` Claude не трогал.
   Staged-файлов и коммита нет.
2. **Независимый прогон:** `npx.cmd vitest run` — **88/88 файлов,
   927/927 тестов**, exit 0; `npm.cmd run check` — exit 0. Числа совпадают с
   handoff исполнителя. После красной проверки отдельно повторён новый файл:
   1/1 файл, 11/11 тестов, exit 0.
3. **Инварианты подсистемы:** проверены
   `.agents/memory/oauth-sanitizer-contract.md`,
   `.agents/memory/user-token-policy.md` и
   `.agents/memory/subscription-enforcement.md`. Клиент не начал читать
   OAuth-секреты; fallback VK/Threads остаётся серверным; resolver вызывается с
   `{ user: req.user }`; чужой `campaignId` не даёт токен; плейсхолдеров
   `__configured__` нет; EOL не нормализовался. Нарушение найдено в семантике
   `markVkAuthExpired`, см. блокер.
4. **Регрессионный тест падает без фикса:** три исходника побайтово сохранены,
   выполнен ровно
   `git checkout HEAD -- server/api/validation-routes.ts server/routes/social.ts server/routes.ts`,
   затем `npx.cmd vitest run server/__tests__/validate-routes-tenant-gate.test.ts`.
   Результат: **1 файл failed, 9 failed / 2 passed из 11**, exit 1. После
   прогона все три файла восстановлены в `finally`; SHA-256 до/после совпал для
   каждого файла, временная папка удалена, `.git/index.lock` отсутствует.
5. **Негативные сценарии:** собственным зелёным прогоном подтверждено:
   anonymous → 401 для Telegram/VK/Instagram/Facebook/YouTube/Threads; чужой
   tenant → 404 `CAMPAIGN_NOT_FOUND` для VK и Threads; на чужом VK
   `validateVkToken` и `markVkAuthExpired` не вызываются; секрет кампании в
   ответ не попадает; для владельца сохранённый токен достаётся сервером и
   `markVkAuthExpired` достижим.
6. **Дом и форма ответа:** выбор `validation-routes.ts` правильный. Именно эти
   handlers и до фикса отвечали первыми и возвращали `{success, message,
   details}`. Удалённые версии из `social.ts` были недостижимы, поэтому
   фактический контракт не урезан. Клиентские вызовы используют `success` и
   `message`; зависимости от бедной формы удалённых handlers не найдено.
7. **Новые требования auth и вызывающие:** единственные runtime-вызовы пяти
   путей находятся в `SocialMediaSettings.tsx` и идут через Axios-инстанс `api`,
   который добавляет Bearer Authorization. Оба Threads-вызова также задают
   Authorization явно. Серверных или внешних runtime-вызовов без Authorization
   не найдено. Playwright probe Telegram допускает 401.
8. **Всегда авторизовать `campaignId`:** с этим отклонением согласен. Реальный
   ручной VK-flow передаёт произвольный токен вместе с `campaignId` текущей
   кампании; владелец продолжает получать проверку, чужой id справедливо даёт
   404. Это добавляет Directus dependency, но не ломает найденных вызывающих и
   не позволяет будущему side effect работать по чужой кампании. Проблема не в
   authorization, а в том, что side effect ниже не различает источник токена и
   класс ошибки.
9. **Swagger:** утверждение handoff/задачи, что auth не отражён, не подтвердилось.
   `server/swagger-endpoints.ts:1057-1058`, `1078-1079`, `1099-1100`,
   `1120-1121`, `1141-1142` уже с initial commit содержат
   `security: bearerAuth`. Поэтому добавлять auth-маркер не требуется.

## Блокирующие замечания

1. **P1 correctness — произвольная или временная ошибка инвалидирует реальную
   VK-кампанию.**

   - **Файл/строка:** `server/api/validation-routes.ts:57-93`;
     контракт вызываемого сервиса — `server/services/vk-token-refresh.ts:6-10`.
   - **Вход:** владелец проверяет вручную введённый токен через существующий UI:
     `POST /api/validate/vk { token: "ошибочный-новый-токен", groupId,
     campaignId: "<своя кампания>" }`. Либо сохранённый токен проверяется во
     время кратковременной сетевой/VK/group API ошибки.
   - **Фактический выход:** любой `result.isValid === false` при наличии
     `campaignId` вызывает `markVkAuthExpired(campaignId)`. Сервис admin-токеном
     пишет `authExpired=true`, может отправить владельцу уведомление, а refresh
     cron затем пропускает эту кампанию (`vk-token-refresh.ts:227`). Для токена
     из body сохранённый credential кампании вообще не проверялся и может быть
     полностью исправен. `validateVkToken` также возвращает `isValid=false` на
     сетевые и group-check ошибки, а не только на permanent auth failure.
   - **Ожидаемый выход:** проверка произвольного токена не мутирует состояние
     уже сохранённого подключения. `markVkAuthExpired` допустим только когда
     handler действительно валидировал сохранённый токен этой кампании и
     получил подтверждённую постоянную auth-ошибку. Это соответствует
     собственному контракту `markVkAuthExpired`: «вызывается при
     permanentFailure».
   - **Пробел теста:** текущий кейс
     `markVkAuthExpired достижим` проверяет только token-from-campaign и
     абстрактный `{isValid:false}`; он не разделяет manual token, permanent auth
     failure и transient/group failure, поэтому закрепляет слишком широкий
     side effect.

## Неблокирующие замечания

1. **Swagger — оставить auth как есть.** Bearer requirement уже описан. Owner
   может отдельным docs-follow-up добавить к VK схеме `campaignId`/`groupId` и
   ответы 401/404/503; это не блокирует консолидацию.
2. **Добавить положительный Threads-кейс желательно, но не блокирует:** owner
   кампании получает сохранённый Threads token через tenant-bound resolver,
   `threadsService.validateToken` вызывается с ним, сам token не появляется в
   response.
3. **Сборка будущего коммита:** `server/index.ts` не включать в implementation
   commit — его TODO относятся к запрещённому owner'ом scope. Решение, включать
   ли оба handoff-документа вместе с фиксом, остаётся за owner. `codex-proxy.bat`
   и `telegram-userbot/` не трогать.
4. **`details` оставить без изменений**, как потребовал owner. После tenant gate
   чужой VK validator не вызывается; изменение response contract не нужно.

## Что понравилось (не переделывать)

1. **Единый дом в `validation-routes.ts` выбран правильно.** Он сохраняет
   фактическую богатую форму ответа, а удаление пяти недостижимых handlers и их
   импортов из `social.ts` устраняет реальный, а не косметический дубль.
2. **Явный `authenticateUser` на каждом winning route держать как есть.** Теперь
   безопасность validation endpoints не зависит от ошибочного широкого mount
   постороннего Facebook-router.
3. **Tenant binding через `{ user: req.user }` и единый
   `CampaignAccessError → 404/503` сделаны правильно.** Особенно правильно, что
   доступ проверяется до `validateVkToken` и до любой записи по `campaignId`.
4. **Красный regression proof содержательный:** без фикса падают ровно 9/11,
   включая auth, tenant binding и оживление ранее недостижимого поведения.
5. **OAuth sanitizer contract сохранён:** токен кампании используется только на
   сервере и не возвращается клиенту.

## План фиксов (рекомендованный порядок)

1. **CL-01** → `fix(vk): gate authExpired on persisted permanent auth failures`
   - явно зафиксировать источник проверяемого токена (`body` против
     campaign-settings);
   - не вызывать `markVkAuthExpired` для token из body;
   - не вызывать его для transient/network/group-check failure;
   - сохранить обязательную authorization любого переданного `campaignId`;
   - заменить слишком общий positive-тест тремя boundary-кейсами:
     saved token + permanent auth failure → mark; manual body token + invalid →
     no mark; saved token + transient/group failure → no mark;
   - после фикса повторить полный `npx.cmd vitest run`, `npm.cmd run check` и
     красную проверку на HEAD без трёх исходников. Без rebase/force.

## Остаётся 3 пункта (вне моей зоны)

1. **Claude Opus 5:** выполнить CL-01 и обновить свой handoff фактическими
   числами нового прогона.
2. **Codex:** после CL-01 повторно проверить blocker-тесты, полный suite и
   no-fix regression proof.
3. **Owner (Dmitry):** после зелёного re-review решить состав коммита
   (фикс+тест и какие handoff-документы), Swagger docs-follow-up и дальнейший
   merge/deploy gate. Запрещённые пункты `server/index.ts`, VK public
   webhook/status и EOL по-прежнему не трогать.

## Решение

Вернуть Claude на **один блокирующий CL-01**. Текущую консолидацию не коммитить
и не отдавать в merge до того, как `authExpired` будет привязан к сохранённому
токену и подтверждённой permanent auth failure. После этого — повторный
независимый review Codex; при отсутствии новых блокеров — owner merge gate.

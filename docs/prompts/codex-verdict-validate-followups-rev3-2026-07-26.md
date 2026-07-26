# Review: Codex — follow-ups консолидации `/api/validate/*`, rev3 — 2026-07-26

**Статус:** принято
**Исполнитель:** Claude Opus 5, коммиты: нет; изменения в worktree поверх `0bae0846`
**Ревьюер:** Codex (модель ≠ исполнитель)

## Что перепроверено

1. **Скоуп:** ветка `main`, HEAD `0bae0846`, staged-файлов нет. Новые tracked
   правки follow-up ограничены `server/services/social-api-validator.ts` и
   `server/__tests__/auth_flow.test.ts`; дополнены untracked
   `server/__tests__/validate-routes-tenant-gate.test.ts` и добавлен untracked
   `server/__tests__/social-api-validator-vk.test.ts`. Прежние consolidation
   файлы не переоткрыты: SHA-256 `server/api/validation-routes.ts` —
   `B71B238CE075B0F36C07E54FABC16C9029938A7C1AECA46C7BFD3F4C0CA942AF`,
   `server/routes/social.ts` —
   `4620D2196E10CEF2A6D42272FA91FD923E260DC92126C8E7ED2B501D168027E4`,
   ровно как в rev2. `server/index.ts` содержит только прежние 7 TODO-строк
   Codex; запрещённый scope, `client/`, proxy и userbot не тронуты.
2. **Блок 1 — матрица кодов:** в
   `validate-routes-tenant-gate.test.ts:244-284` добавлены ровно три кейса:
   `15 → no mark`, `27 → mark`, `28 → mark`. Runtime-классификатор не менялся:
   `validation-routes.ts:34` по-прежнему содержит allowlist `{5, 27, 28}`, а
   `:47-52` читает только `details.error.error_code`. Целевой прогон —
   **1/1 файл, 18/18 тестов**, exit 0.
3. **Блок 2 — resolved group error:** новая ветка
   `social-api-validator.ts:109-122` выполняется только после успешного
   `users.get`, когда `groups.getById` резолвится без ожидаемого массива.
   Возвращаются `isValid:false`, прежняя форма
   `details:{user, groupError:groupResponse.data}` и сообщение без переданного
   токена. Успешный путь с двумя массивами остался выше этой ветки; rejected
   promise по-прежнему попадает в прежний catch. Новый тестовый файл отдельно
   закрепляет resolved `{error}`, malformed response, success, первичный код 5,
   rejected promise и отсутствие токена: **1/1 файл, 6/6 тестов**, exit 0.
4. **Связка блока 2 с CL-01:** group failure содержит `details.user`, поэтому
   `isPermanentVkAuthFailure` консервативно возвращает false и
   `markVkAuthExpired` не вызывается. Route boundary на group-check остаётся
   зелёным; постоянные первичные коды 5/27/28 по-прежнему достижимы без
   добавленного приложением `user/groupError`.
5. **Блок 3 — сила отрицательных auth-тестов:** дефолтный `fetch`-стаб
   установлен в `beforeEach` (`auth_flow.test.ts:45-69`) и снимается в
   `afterEach` (`:71-73`). Четыре 401-кейса заканчиваются в
   `authenticateUser` до session validation: отсутствующий header и
   некорректный JWT format. Два `/api/auth/system-token` кейса получают 404
   из-за отсутствия route независимо от auth. Для независимого доказательства
   временно добавлены `expect(fetch).not.toHaveBeenCalled()` во все шесть
   кейсов: полный файл остался **10/10**, то есть стаб не является причиной их
   401/404. Инструментирование затем удалено восстановлением; SHA совпал.
6. **Причинный эксперимент флака:** на HEAD-версии `auth_flow.test.ts`
   `createMockToken` временно получил монотонную добавку к `exp`, чтобы каждый
   JWT имел отдельный cache key. Результат: **3 failed / 7 passed из 10** —
   ровно campaign-content GET/POST/PATCH, все с фактическим 503 вместо
   ожидаемых 200/201/200. Та же уникализация поверх исправленной версии дала
   **10/10**. Это подтверждает связку «плавающий JWT → cache miss → unstubbed
   fetch → unavailable», а не межфайловую гонку `uploads/test-images`.
7. **Red proof CL-01:** условие временно расширено обратно до
   `if (!result.isValid && campaignId)`. Целевой route-тест дал
   **5 failed / 13 passed из 18**, exit 1: manual token, сеть, group-check, код
   6 и новый код 15. Файл восстановлен; SHA-256 до/после
   `B71B238CE075B0F36C07E54FABC16C9029938A7C1AECA46C7BFD3F4C0CA942AF`.
8. **Red proof group-validator:** выполнен
   `git checkout HEAD -- server/services/social-api-validator.ts`, затем новый
   тест. Результат: **2 failed / 4 passed из 6**, exit 1 — resolved `{error}` и
   malformed response возвращают старое `isValid:true`. Файл восстановлен;
   SHA-256 до/после
   `14991A4E19471E1B0F9021279097E19CE065A535F1A1F5C652615097DD696295`.
9. **Восстановление proof-состояния:** итоговый SHA-256 `auth_flow.test.ts` —
   `03826CEB4398228ADDBF4D1D6679D3D8C6E2BC08992EF9177E47AC35657AED5A`,
   route test —
   `747165B6942F75AAC451F0FF5397092942A610992D19017F2AFCF85A1C512C1C`,
   validator test —
   `58158059CB156DB210F847995DE3C2EEBC772E4A80A7360F32F370A3DFA445B5`.
   Временных backup-файлов и `.git/index.lock` нет, staged-файлов нет.
10. **Полный suite:** после всех восстановлений выполнено **10
    последовательных** `npx.cmd vitest run`. Каждый прогон завершился
    **89/89 файлов, 940/940 тестов**, exit 0. Ни старый `auth_flow`-флак, ни
    другое падение в моей серии не воспроизвелись.
11. **Типизация:** `npm.cmd run check`
    (`tsc -p tsconfig.critical.json`) — exit 0. Числа совпадают с handoff
    исполнителя: tenant 18/18, validator 6/6, full 89/89 и 940/940, tsc 0.
12. **Whitespace и EOL:** scoped `git diff --check` для двух tracked
    follow-up-файлов — exit 0; оба untracked теста отдельно проверены
    `git diff --no-index --check`/trailing-whitespace scan — дефектов нет.
    Полный `git diff --check` у меня вернул **exit 1**, а не заявленный в
    handoff exit 2; содержательно диагноз совпадает: ровно семь trailing
    whitespace находятся только в запрещённом `server/index.ts:129-131,
    156-159`. EOL не смешаны: validation/social/auth-flow целиком CRLF,
    validator и оба новых теста целиком LF.
13. **Инварианты:** OAuth sanitizer contract сохранён; токен не добавлен в
    клиент, result или лог. Форма route response `details`, tenant/auth
    архитектура и принятая консолидация не менялись. В блоке 3 изменена только
    тестовая инфраструктура, production auth-код не затронут.

## Блокирующие замечания

Нет.

## Неблокирующие замечания

1. **Кодовых follow-ups не требуется.** Все три разрешённых owner'ом пункта
   закрыты и имеют независимо воспроизведённые красные доказательства.
2. **Уточнить только упаковку:** handoff указывает `git diff --check` exit 2,
   мой Git вернул exit 1. Семь диагностик и их единственный источник совпадают,
   поэтому это не влияет на приёмку.
3. **Docs-файлов фактически шесть, а не пять.** К четырём документам из готового
   решения rev2 добавились handoff follow-ups и этот rev3 verdict. Исключение
   исходного `claude-codex-daytime-review-followup-2026-07-26.md` оставило бы
   referenced owner-scope документ untracked, поэтому точные команды ниже
   включают все шесть.
4. **Предложенный subject auth test-fix длиннее конвенции:** строка
   `test(auth): stub session validation per test to remove clock-dependent flake`
   содержит 76 символов при лимите 72. Ниже используется эквивалентный
   67-символьный subject.

## Что понравилось (не переделывать)

1. **Матрица 15/27/28 добавлена только тестами.** Принятая семантика allowlist и
   структурного классификатора не была переоткрыта.
2. **Group-validator исправлен в правильном слое и узкой веткой.** Success и
   rejected promise сохранены, resolved error больше не маскируется как успех,
   а `details.user` удерживает дорогой `authExpired` выключенным.
3. **Флак не «починен по гипотезе».** Исполнитель сначала воспроизвёл его в
   полном и изолированном режимах, затем доказал cache/clock-причину
   принудительно уникальными токенами и тем же экспериментом проверил фикс.
4. **Общий стаб не ослабил отрицательные кейсы.** 401/404 завершаются до fetch;
   независимое временное утверждение нулевых вызовов прошло для всех шести.
5. **`afterEach(vi.unstubAllGlobals)` держать.** Он делает lifecycle глобального
   стаба локальным файлу и не загрязняет соседние suites.
6. **Честная оговорка о других возможных флаках сохранена.** Десять зелёных
   прогонов — сильное наблюдение, но не недоказуемое обещание.

## План фиксов (рекомендованный порядок)

Нет: блокеров и P1 не найдено. Implementation готов к owner commit gate.

## Остаётся 3 пункта (вне моей зоны)

1. **Owner (Dmitry):** выполнить три implementation-коммита и отдельный
   docs-коммит по точным командам ниже.
2. **Стандартный release-cycle:** после owner gate — regression/merge/deploy по
   ролям проекта; Codex не пушит и не деплоит.
3. **Запрещённый/чужой WIP:** `server/index.ts`, публичный VK webhook/status,
   ранний OAuth mount/parser, EOL, response `details`, Swagger,
   `codex-proxy.bat`, `telegram-userbot/` и `client/` не включать и не очищать.

## Решение

**Зелёный rev3: принято.** Три follow-up блока можно передавать owner'у на три
раздельных implementation-коммита. Claude на дополнительную доработку
возвращать не требуется.

## Готовое решение owner'у к исполнению

### Коммит 1 — консолидация validate routes

Включить ровно:

1. `server/api/validation-routes.ts`
2. `server/routes/social.ts`
3. `server/__tests__/validate-routes-tenant-gate.test.ts`

Сообщение:

```text
fix(routes): consolidate validators and gate VK auth expiry

Причина: дубли /api/validate/* оставляли winning routes без явной
аутентификации, а tenant-aware поведение было недостижимо.

- оставить Telegram/VK/Instagram/Facebook/YouTube validators в validation-routes.ts за authenticateUser
- удалить пять недостижимых дублей из social.ts и tenant-bind VK/Threads campaign lookups
- ставить VK authExpired только для сохранённого campaign token при структурной permanent auth-ошибке
- добавить 18 regression-кейсов на auth, tenant isolation, secret redaction и границы authExpired

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

### Коммит 2 — VK group validation

Включить ровно:

1. `server/services/social-api-validator.ts`
2. `server/__tests__/social-api-validator-vk.test.ts`

Сообщение:

```text
fix(vk): reject structured group validation errors

Причина: groups.getById возвращает ошибки метода в resolved HTTP 200 body,
из-за чего прежняя ветка проваливалась к isValid:true.

- возвращать isValid:false для resolved VK error и malformed group response
- сохранять user/groupError и прежнее поведение success/rejected-promise путей
- добавить шесть regression-кейсов validateVkToken без утечки токена

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

### Коммит 3 — устранение clock-dependent test flake

Включить ровно:

1. `server/__tests__/auth_flow.test.ts`

Сообщение:

```text
test(auth): stub each session check to remove clock-dependent flake

Причина: JWT менялся на границе секунды, а session cache был keyed по sha256
токена; тесты без собственного fetch-стаба зависели от cache hit другого теста
и флакали ответом 503.

- устанавливать валидный session/admin fetch-стаб в beforeEach
- сохранять локальное переопределение profile payload и снимать globals в afterEach
- подтвердить причину экспериментом 3/7 до фикса и 10/10 после

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

### Docs-коммит

Фактический полный набор — шесть файлов:

1. `docs/prompts/claude-codex-daytime-review-followup-2026-07-26.md`
2. `docs/prompts/claude-validate-routes-consolidation-2026-07-26.md`
3. `docs/prompts/codex-verdict-validate-consolidation-2026-07-26.md`
4. `docs/prompts/codex-verdict-validate-consolidation-rev2-2026-07-26.md`
5. `docs/prompts/claude-validate-routes-followups-2026-07-26.md`
6. `docs/prompts/codex-verdict-validate-followups-rev3-2026-07-26.md`

Сообщение:

```text
docs(prompts): record validate-route review and follow-ups

Контекст: сохранён полный owner-gated цикл консолидации /api/validate/*.

- зафиксировать исходный scope, handoff consolidation и follow-ups
- сохранить блокирующий verdict, зелёный rev2 и финальный rev3
- отделить review-артефакты от трёх bisectable implementation-коммитов
```

Для docs-коммита ниже используется `--stat`, а не `--check`: три ранее
подготовленных review-документа содержат шесть Markdown hard-break строк с
двумя пробелами в metadata. Implementation-коммиты проверяются `--check`
отдельно и зелёные; механически переписывать уже проверенные документы ради
этого коммита не требуется.

### Точные команды owner'а

```powershell
Set-Location 'G:\Projects\smm-video'

git status --short
npx.cmd vitest run
npm.cmd run check

git add -- server/api/validation-routes.ts server/routes/social.ts server/__tests__/validate-routes-tenant-gate.test.ts
git diff --cached --name-status
git diff --cached --check
$commit1Subject = 'fix(routes): consolidate validators and gate VK auth expiry'
$commit1Body = @'
Причина: дубли /api/validate/* оставляли winning routes без явной
аутентификации, а tenant-aware поведение было недостижимо.

- оставить Telegram/VK/Instagram/Facebook/YouTube validators в validation-routes.ts за authenticateUser
- удалить пять недостижимых дублей из social.ts и tenant-bind VK/Threads campaign lookups
- ставить VK authExpired только для сохранённого campaign token при структурной permanent auth-ошибке
- добавить 18 regression-кейсов на auth, tenant isolation, secret redaction и границы authExpired
'@
git commit -m $commit1Subject -m $commit1Body -m 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

git add -- server/services/social-api-validator.ts server/__tests__/social-api-validator-vk.test.ts
git diff --cached --name-status
git diff --cached --check
$commit2Subject = 'fix(vk): reject structured group validation errors'
$commit2Body = @'
Причина: groups.getById возвращает ошибки метода в resolved HTTP 200 body,
из-за чего прежняя ветка проваливалась к isValid:true.

- возвращать isValid:false для resolved VK error и malformed group response
- сохранять user/groupError и прежнее поведение success/rejected-promise путей
- добавить шесть regression-кейсов validateVkToken без утечки токена
'@
git commit -m $commit2Subject -m $commit2Body -m 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

git add -- server/__tests__/auth_flow.test.ts
git diff --cached --name-status
git diff --cached --check
$commit3Subject = 'test(auth): stub each session check to remove clock-dependent flake'
$commit3Body = @'
Причина: JWT менялся на границе секунды, а session cache был keyed по sha256
токена; тесты без собственного fetch-стаба зависели от cache hit другого теста
и флакали ответом 503.

- устанавливать валидный session/admin fetch-стаб в beforeEach
- сохранять локальное переопределение profile payload и снимать globals в afterEach
- подтвердить причину экспериментом 3/7 до фикса и 10/10 после
'@
git commit -m $commit3Subject -m $commit3Body -m 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

git add -- docs/prompts/claude-codex-daytime-review-followup-2026-07-26.md docs/prompts/claude-validate-routes-consolidation-2026-07-26.md docs/prompts/codex-verdict-validate-consolidation-2026-07-26.md docs/prompts/codex-verdict-validate-consolidation-rev2-2026-07-26.md docs/prompts/claude-validate-routes-followups-2026-07-26.md docs/prompts/codex-verdict-validate-followups-rev3-2026-07-26.md
git diff --cached --name-status
git diff --cached --stat
$docsSubject = 'docs(prompts): record validate-route review and follow-ups'
$docsBody = @'
Контекст: сохранён полный owner-gated цикл консолидации /api/validate/*.

- зафиксировать исходный scope, handoff consolidation и follow-ups
- сохранить блокирующий verdict, зелёный rev2 и финальный rev3
- отделить review-артефакты от трёх bisectable implementation-коммитов
'@
git commit -m $docsSubject -m $docsBody

git status --short
```

После четырёх коммитов `git status --short` ожидаемо всё ещё покажет
`server/index.ts`, `codex-proxy.bat` и `telegram-userbot/`. Их не очищать, не
индексировать и не включать. Push этими командами не выполняется.

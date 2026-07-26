# Handoff: Claude — follow-ups после зелёного rev2 — 2026-07-26

**Не заменяет** `docs/prompts/claude-validate-routes-consolidation-2026-07-26.md` (revision 2, уже проверен и принят). Это отдельный документ по трём follow-up задачам, разрешённым owner'ом после зелёного `codex-verdict-validate-consolidation-rev2-2026-07-26.md`.

## Задача

Три неблокирующих пункта rev2-вердикта: (1) закрепить матрицу VK-кодов тестами, (2) исправить подтверждённый group-check дефект в `validateVkToken`, (3) расследовать неидентифицированный флак. Принятая консолидация, tenant binding, `tokenSource` и классификация по структурному `error_code` **не менялись** — `server/api/validation-routes.ts` в этом цикле не редактировался вовсе (SHA совпадает с зафиксированным в rev2).

## Коммиты

Нет. Ничего не закоммичено и не проиндексировано (`git diff --cached --name-only` → 0 строк).

## Блок 1 — матрица VK-кодов (задача 1)

Файл: `server/__tests__/validate-routes-tenant-gate.test.ts`, +3 кейса в `describe('POST /api/validate/vk — границы authExpired')`.

| Код | Ожидание | Было закреплено раньше |
|---|---|---|
| 5 | помечает | да |
| 6 | не помечает | да |
| **15** | **не помечает** | нет — только чтением allowlist |
| **27** | **помечает** | нет |
| **28** | **помечает** | нет |

Семантика не тронута: allowlist остаётся `{5, 27, 28}`, 15 исключён, классификация только по `details.error.error_code`, свободный текст `message` не используется, manual body token кампанию не мутирует. Изменён только тестовый файл.

Тестов в файле: было 15, стало **18**.

## Блок 2 — group-check дефект (задача 2)

Файл: `server/services/social-api-validator.ts`, функция `validateVkToken`, +15 строк одной ветки.

**Дефект:** VK возвращает ошибки метода в теле с HTTP 200, поэтому axios такой ответ резолвит. Ветка `groups.getById` обрабатывала только успешный массив (`if`) и rejected promise (`catch`). Resolved `{ error: ... }` не попадал ни туда, ни туда — управление проваливалось к общему `return { isValid: true }`, и провал проверки группы выглядел успешной валидацией.

**Правка:** после `if`-ветки успеха добавлен явный возврат
`{ isValid: false, message: 'Токен валиден, но ошибка при проверке группы: …', details: { user: userInfo, groupError: groupResponse.data } }`.
Форма `details` совпадает с существующей веткой `catch`, поэтому `isPermanentVkAuthFailure` по-прежнему видит `details.user` и **не** помечает кампанию: успешный `users.get` выше доказывает, что credential жив. Malformed-ответ без массива попадает в ту же ветку и тоже больше не даёт `isValid: true`.

Проверка до прав публикации не расширена, публичная форма validate-route `{success, message, details}` не менялась, токен в `message`/`details`/логах не появился.

**Новый файл:** `server/__tests__/social-api-validator-vk.test.ts`, 6 кейсов с mock axios — 4 обязательных плюс два добавленных: rejected promise по-прежнему обрабатывается, и токен не утекает в результат. Смешивать с route-тестом не стал: это правка сервиса.

## Блок 3 — флак ВОСПРОИЗВЕДЁН и объяснён (задача 3)

### Наблюдения

10 последовательных полных прогонов, полный вывод каждого сохранён:

| Прогон | Итог |
|---|---|
| 1, 3–8, 10 | 940/940 passed |
| **2** | **3 failed / 937 passed** |
| **9** | **1 failed / 939 passed** |

Все падения — в `server/__tests__/auth_flow.test.ts`, все с одной сигнатурой `AssertionError: expected 503 to be 200`:

- run 2: `GET /api/campaign-content … valid token`; `… creation timestamp when creating content`; `… when updating content`
- run 9: только `… creation timestamp when updating content`

Изолированный прогон файла: **1 падение из 7** (прогон 5). Это опровергает межфайловую гипотезу — гонка cleanup `uploads/test-images` из `setup.ts:184-186` к делу не относится, `speculative fix` там не делался.

### Причина (доказана экспериментом, а не рассуждением)

1. `createMockToken` (`auth_flow.test.ts:38-42`) выводит `exp` из `Math.floor(Date.now() / 1000)`. Два токена с одинаковым payload совпадают побайтово **только внутри одной секунды**.
2. `validateDirectusSession` кэширует результат по `sha256(token)` на 30 с (`server/services/directus-session-validator.ts:13, 55-74`).
3. Стаб `fetch` стоял ровно в одном тесте — «profile 200». Он и наполнял кэш. Остальные session-зависимые тесты своего стаба не имели и жили на попадании в этот кэш.
4. Стоило прогону пересечь границу секунды между тестами, как ключ переставал совпадать → cache miss → реальный `fetch` в Directus → `'unavailable'` → **503** вместо 200.
5. Сколько тестов упадёт, зависит от того, где легла граница: раньше — 3, позже — 1. Ровно это и наблюдалось.

**Экспериментальное доказательство.** Временно пропатчил `createMockToken` так, чтобы каждый вызов давал уникальный `exp` (гарантированное пересечение границы). Результат: **3 failed / 7 passed из 10** — те же самые три теста, что в run 2, воспроизведение 100%. Файл восстановлен, SHA-256 сверен.

### Фикс

Файл: `server/__tests__/auth_flow.test.ts` — только тестовая инфраструктура, исходники не тронуты.

- в общий `beforeEach` добавлен дефолтный стаб `fetch` (валидная сессия, `is_smm_admin: false`);
- добавлен `afterEach` с `vi.unstubAllGlobals()`;
- удалён внутритестовый `vi.unstubAllGlobals()` из теста профиля — он стал избыточен;
- тест профиля по-прежнему переопределяет стаб локально, ему нужен свой payload.

Зависимость от кэша и часов устранена: каждый тест самодостаточен.

**Проверка фикса тем же экспериментом:** уникальные токены повторно наложены уже на исправленный файл → **10/10 passed**. То есть условие, которое ломало детерминированно, больше не ломает. Файл восстановлен, SHA-256 сверен.

## Red proofs

Все с backup + SHA-256 + восстановлением и повторной сверкой.

| Proof | Как | Результат | SHA до/после |
|---|---|---|---|
| CL-01 | временно возвращено широкое `if (!result.isValid && campaignId)` | **5 failed / 13 passed из 18** — manual body, сеть, group-check, код 6 и новый код 15 | `b71b238c…942af` OK |
| Group-validator | `git checkout HEAD -- server/services/social-api-validator.ts` | **2 failed / 4 passed из 6** — resolved `{error}` и malformed, обе `expected true to be false` | `14991a4e…6295` OK |
| Flake (до фикса) | принудительно уникальные токены | 3 failed / 7 passed из 10 | восстановлен, OK |
| Flake (после фикса) | тот же патч на исправленный файл | 10/10 passed | восстановлен, OK |

CL-01 red proof теперь роняет 5 кейсов вместо прежних 4 — добавился код 15 из блока 1.

## Финальная проверка (фактические числа)

- `npx vitest run server/__tests__/validate-routes-tenant-gate.test.ts` → 1/1 файл, **18/18**
- `npx vitest run server/__tests__/social-api-validator-vk.test.ts` → 1/1 файл, **6/6**
- `npx vitest run` → **89/89 файлов, 940/940 тестов**
- `npm run check` → exit 0
- `git diff --check` → **exit 2**, но все семь срабатываний trailing whitespace — в `server/index.ts`, в TODO-блоке Codex из запрещённого scope. Ограниченный моими файлами `git diff --check -- <4 файла>` → **exit 0**
- `git status --short` → 5 modified, 8 untracked (перечень ниже)
- `git diff --stat` → `auth_flow.test.ts +30/-…`, `validation-routes.ts` (без изменений в этом цикле, diff от rev2), `index.ts +7` (не мой), `social.ts` (от rev2), `social-api-validator.ts +15`
- staged-файлов: **0**; `.git/index.lock`: отсутствует; временных backup/log-файлов в репозитории нет (всё в scratchpad вне репо)

### EOL

Проверено точным подсчётом: смешанных окончаний нет ни в одном тронутом файле. `validation-routes.ts`, `social.ts`, `auth_flow.test.ts` — целиком CRLF (как и были); `social-api-validator.ts` и оба новых теста — целиком LF. `core.autocrlf=true`, поэтому `git diff --check` предупреждает про LF→CRLF для `social-api-validator.ts` — это нормализация при коммите, а не churn: diff показывает +15 строк, не перезапись файла.

### SHA-256 итогового состояния

```
b71b238ce075b0f36c07e54fabc16c9029938a7c1aeca46c7bfd3f4c0ca942af  server/api/validation-routes.ts
4620d2196e10cef2a6d42272fa91fd923e260dc92126c8e7ed2b501d168027e4  server/routes/social.ts
14991a4e19471e1b0f9021279097e19ce065a535f1a1f5c652615097dd696295  server/services/social-api-validator.ts
03826ceb4398228addbf4d1d6679d3d8c6e2bc08992ef9177e47ac35657aed5a  server/__tests__/auth_flow.test.ts
747165b6942f75aac451f0ff5397092942a610992d19017f2afcf85a1c512c1c  server/__tests__/validate-routes-tenant-gate.test.ts
58158059cb156db210f847995de3c2eebc772e4a80a7360f32f370a3dfa445b5  server/__tests__/social-api-validator-vk.test.ts
```

Первые два совпадают с зафиксированными в rev2 — принятая консолидация не тронута.

## Рекомендуемые границы коммитов

Флак воспроизведён, поэтому коммитов **три**, а не два.

1. **Консолидация** (без изменений с rev2, состав и сообщение — как в готовом решении rev2, но тестовый файл теперь содержит 18 кейсов):
   `server/api/validation-routes.ts`, `server/routes/social.ts`, `server/__tests__/validate-routes-tenant-gate.test.ts`
   → `fix(routes): consolidate validators and gate VK auth expiry`
   Строку про 15 regression-кейсов в теле сообщения заменить на 18.

2. **Validator-fix:**
   `server/services/social-api-validator.ts`, `server/__tests__/social-api-validator-vk.test.ts`
   → `fix(vk): reject structured group validation errors`

3. **Test-fix (флак):**
   `server/__tests__/auth_flow.test.ts`
   → `test(auth): stub session validation per test to remove clock-dependent flake`
   В теле: причина (совпадение токенов только внутри одной секунды + кэш по sha256 на 30 с), наблюдения 2/10 и 1/7, экспериментальное доказательство.

Не включать: `server/index.ts`, `codex-proxy.bat`, `telegram-userbot/`, все `docs/prompts/*` (отдельный docs-коммит, теперь пять файлов вместе с этим).

## Не удалось / оговорки

- **Не доказано, что флак единственный.** Устранена одна воспроизводимая причина одного файла. Оба наблюдавшихся падения объясняются ею полностью, но 10 прогонов — не доказательство отсутствия других флаков.
- **Оригинальное падение Claude (`1 failed | 930 passed`, revision 2) идентифицировать задним числом невозможно** — вывод не сохранён. Сигнатура run 9 (одно падение в `auth_flow`) совпадает по форме, но это правдоподобие, а не доказательство.
- `git diff --check` не даёт exit 0 на весь worktree из-за чужого `server/index.ts`. Тронуть его нельзя по DO NOT TOUCH — оставлено как есть.

## Следующий шаг (по ролям)

- **Codex — независимый ревьюер:** новый re-review трёх блоков. Прицельно: (а) не изменилась ли семантика классификатора от блока 1 — allowlist должен остаться прежним; (б) не даёт ли новая ветка в `validateVkToken` регрессии для успешного пути и для rejected promise; (в) воспроизвести оба red proof и причинный эксперимент по флаку; (г) оспорить утверждение, что дефолтный стаб `fetch` в `beforeEach` не ослабляет сами auth-тесты — 401/404-кейсы должны падать по-прежнему по своим причинам, а не проходить «за компанию».
- **Owner (Dmitry):** после зелёного re-review — три implementation-коммита и docs-коммит.
- **DO NOT TOUCH подтверждён соблюдённым:** `server/index.ts` и оба TODO, публичный VK webhook/status, ранний OAuth mount/parser, EOL, форма `details`, Swagger, `codex-proxy.bat`, `telegram-userbot/`, `client/`, другие платформенные validators, tenant/auth архитектура.

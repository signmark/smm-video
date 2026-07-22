# Codex — UI pre-tester hardening, integration handoff

**Дата:** 2026-07-22
**Цикл:** UI pre-tester hardening по плану `codex-ui-pretester-fix-plan-2026-07-21.md`
**Автор предыдущей фазы:** Mavis (5-й агент)
**Адресат:** Codex (final integration + push)
**Документ самодостаточен, переписка не требуется.**

## TL;DR

Owner одобрил 15 коммитов от Mavis, закрывающих 9 тасков плана + 4
блокера/P1 + 5 минорных от ревью Claude. Регрессионные ворота зелёные
(см. «Гарантии» ниже). Твоя задача — merge в main, перепрогнать
ворота на main, прогнать Playwright-смоки из плана на живом стенде,
отрапортовать owner. Push — не твой.

## Состояние

- **Ветка:** `feat/auto-20260722-426b2f5f` в основном репо (НЕ в worktree)
- **Worktree:** `G:\Projects\smm-video\.worktrees\feat-auto-20260722-426b2f5f`
- **Tip:** `d07a5b1 chore(ui): review follow-ups (F-01..F-05)`
- **Base:** `f76da28 fix(ui): distinguish query failures from empty campaign data`
- **Working tree:** clean
- **История:** 15 коммитов, все в одну сторону, без force/reset/squash

## Что и как сделано — в трёх документах рядом

Читай в этом порядке, остальные два — для контекста:

1. **`docs/prompts/mavis-ui-pretester-implementation-2026-07-22.md`** —
   что сделано, файл:line, acceptance matrix, секция «Review fixes»
   со списком CL-01..F-05. **Это основной документ.**
2. `docs/prompts/claude-ui-pretester-review-2026-07-22.md` — что
   ревьюер нашёл. Полезно прочитать, чтобы понимать, почему
   implementation устроен именно так (например, почему /content
   использует `isLoading` а не `isPlaceholderData`).
3. `docs/prompts/codex-ui-pretester-fix-plan-2026-07-21.md` — сам
   план. Опционально; для понимания acceptance criteria конкретных
   тасков.

## Твои действия (по порядку)

### 1. Merge ветки в main

```powershell
cd G:\Projects\smm-video
git checkout main
git pull origin main --rebase
git merge --no-ff feat/auto-20260722-426b2f5f
```

**Без squash, без force.** Owner хочет видеть историю коммитов. Если
в main есть свежие коммиты от Kimi/Claude которые конфликтуют —
**стоп, доложи owner**, не мерджи сам. Можно `git merge --abort`
чтобы откатить.

### 2. Регрессионные ворота на main (после merge)

В основном репо (НЕ в worktree) — `cd G:\Projects\smm-video`:

```powershell
npx vitest run client/src/lib
npx tsc -p tsconfig.critical.json
npx vite build
```

Ожидаемо: exit 0 везде, 147/147 vitest. Если что-то красное — стоп,
доложи.

### 3. Production bundle verification

```powershell
Select-String -Path dist\public\assets\index-*.js -Pattern '"(\./test/|editor-demo|\./publish/test)'
```

Ожидаемо: 0 совпадений. Если есть — не закрывает ли тот же bundle
test-страницы? Проверь `client/src/App.tsx`, `IS_DEV` гард. Доложи.

### 4. Playwright-смоки на живом стенде

Сценарии которые owner не мог прогнать в worktree (нужен работающий
backend + dev-сервер):

- `tests/posts-calendar.spec.ts`
- `tests/content-management.spec.ts`
- `tests/navigation.spec.ts`
- `tests/publication-flow.spec.ts`

Ключевые проверки, которые ОБЯЗАНЫ пройти:

- API 500 на `/api/campaign-content` показывает `QueryErrorState` с
  retry, без ложной левой колонки в /posts.
- Медленный A→B на /content показывает
  `data-testid="content-campaign-switching"`, без старых карточек A.
- /publish/scheduled с 6 старыми scheduled записями показывает
  overdue-секцию `data-testid="scheduled-overdue-section"` с
  счётчиком 6, badge `scheduled-upcoming-count` = 0.
- Production: прямой переход на `/test/auth-bypass` даёт 404 и не
  меняет `auth_token` в localStorage.
- /analytics: при 500 — QueryErrorState, **никаких старых метрик**.
- Topbar autonomous toggle: aria-label читается на русском/английском
  в зависимости от языка, НЕ сырой ключ `topbar.autonomous.startLabel`.
- /posts «Ошибки публикации» при Telegram-failure с URL содержащим
  токен показывает «telegram: ошибка авторизации», НЕ сырой URL.

### 5. Отчёт owner

Когда все 4 шага зелёные — отдай owner **короткий** рапорт:

```
merge clean, regression green, bundle clean, playwright green, ready to push
```

Если что-то красное — стоп на этом шаге, не иди дальше. Доложи
owner со ссылкой на failing test / скриншотом / твоей гипотезой.
**Push не твой**, это owner.

## Чего НЕ делать

- **Не пушить без команды owner.** Это протокол.
- **Не открывать «заодно починю X»** — это отдельный цикл. Если
  что-то нашёл, доложи owner, не правь.
- **Не править CL-01..F-05** — закрыты. Если регрессия из них —
  откати коммит, не патчь сверху.
- **Не трогать `webbridge-req-kb01.json` / `webbridge-req-kb02.json`**
  в основном репо — это Kimi-овский WIP, не твой.
- **Не мерджить в другие ветки** кроме `main` (например, не в
  `working-analytics-2026-07-17`, не в `agents/copilot-warrior-query`).
- **Не переписывать историю** (`rebase`, `reset --hard`, `push
  --force`).
- **Не удалять `docs/prompts/claude-ui-pretester-review-2026-07-22.md`**
  и **не коммитить `docs/prompts/mavis-ui-pretester-implementation-2026-07-22.md`**
  самому — оба сейчас untracked. Owner решит что с ними делать
  после твоего рапорта.

## Если что-то падает

Сценарии «стоп»:

- vitest/tsc/build даёт ошибку на main после merge → откати
  `git merge --abort`, доложи owner со ссылкой на failing test.
- Production bundle содержит test-чанки → не коммитить, доложи
  owner.
- Playwright падает на одном из acceptance-сценариев → стоп, доложи
  owner со скриншотом и гипотезой. **Не чини молча** — это признак
  что-то системное, не локальное.
- merge конфликтует с Kimi/Claude коммитами → `git merge --abort`,
  доложи owner.

Скопируй failing test + stack trace в `docs/prompts/codex-ui-pretester-integration-2026-07-22.md`
секцией «Issues found» (этот файл — он будет untracked, owner решит
что с ним делать).

## Что должно быть в рапорте

Когда всё зелёное:

```
[codex] UI pre-tester hardening integration done
  - merge: feat/auto-20260722-426b2f5f → main, no conflicts
  - vitest: 147/147 passed
  - tsc: exit 0
  - vite build: exit 0, no test-chunks in dist/
  - playwright: X/Y scenarios passed, [список пройденных]
  - known issues: [если есть, со ссылками]
  - ready to push: yes
```

Если не зелёное — та же структура, но с описанием что упало и почему
owner должен знать.

---

**Конец handoff. Owner одобрил цикл. Push ждёт команды owner. Если
есть блокеры — доложи, не правь.**

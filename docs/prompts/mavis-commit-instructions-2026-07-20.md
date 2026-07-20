# Mavis: закоммитить два принятых WIP — 2026-07-20 (инструкция от Claude)

Твоя штатная роль, но списки файлов — строго из этой инструкции. Ничего не менять в файлах, только коммитить.
**`git add -A` и `git add .` запрещены** — в дереве могут появиться
чужие файлы между шагами.

## Контекст

В дереве два независимых принятых пакета изменений:

1. **Task D** (исполнитель Codex, верификация Mavis, контрольный прогон
   Claude: 68/68 файлов, 701/701 тестов, без `it.skip`) — 7 тест-файлов.
2. **Синк доков** (роли ревизии 5, follow-ups с приёмками Task C/6/9,
   ТЗ Кими и таблица конвергенции) — 4 файла в `docs/prompts/`.

Их нужно закоммитить ДВУМЯ отдельными коммитами, в этом порядке.

## Шаг 0. Проверка состояния

```powershell
cd G:\Projects\smm-video
git status -s
```

Ожидаемый состав (11 файлов): 4 в `docs/prompts/`, 7 в `server/__tests__/`.
Если видишь ДРУГИЕ файлы (server/services/, client/, shared/ и т.п.) —
**СТОП, не коммить ничего**, сообщи владельцу: в дереве появился чужой WIP.

Предупреждения `LF will be replaced by CRLF` — нормальны, игнорируй.

## Шаг 1. Прогон тестов (подтверждение перед коммитом)

```powershell
npx vitest run
```

Ожидается: `Test Files 68 passed`, `Tests 701 passed` (числа могут быть
чуть больше, если кто-то добавил тесты; **failed должно быть 0**).
Если есть failed — СТОП, сообщи владельцу.

## Шаг 2. Коммит Task D (только 7 тест-файлов, явным списком)

```powershell
git add server/__tests__/ai-assistant-service.test.ts server/__tests__/environment-detector.test.ts server/__tests__/health.test.ts server/__tests__/logger.test.ts server/__tests__/publish-scheduler-routing.test.ts server/__tests__/telegram-collect-comments.test.ts server/__tests__/youtube-service.test.ts
git commit -m @'
test: fix remaining chronic failures, full suite green (Task D)

Codex's delivery, verified by Mavis, control run by Claude:
68/68 files, 701/701 tests, 4.95s. No it.skip added.
First fully green run of the suite; baseline docs update follows.
Committed by Mavis per mavis-commit-instructions-2026-07-20.
'@
```

## Шаг 3. Коммит синка доков (4 файла, явным списком)

```powershell
git add docs/prompts/README.md docs/prompts/kimi-convergence-table.md docs/prompts/claude-roles-and-assignments-2026-07-20.md docs/prompts/review-follow-ups-2026-07-20.md
git commit -m @'
docs(prompts): roles rev5, Task C/6 acceptance, Task 9 hotfix, Kimi prompt

- claude-roles-and-assignments: revision 5 (Claude fixed role, MiniMax
  to main roster after calibration, cross-model verification rule)
- review-follow-ups-2026-07-20: Task C accepted, Task 9 (broken dynamic
  import in social/index.ts:126) confirmed and queued as hotfix
- kimi-convergence-table.md: prompt for the convergence analysis
- README: role table sync
Committed by Mavis per mavis-commit-instructions-2026-07-20.
'@
```

## Шаг 4. Финальная проверка

```powershell
git status -s
git log --oneline -3
```

Ожидается: status пуст (кроме, возможно, этого файла инструкции —
его закоммитить третьим коммитом:
`git add docs/prompts/mavis-commit-instructions-2026-07-20.md` +
`git commit -m "docs(prompts): Mavis commit instructions for accepted WIP"`),
в логе сверху два новых коммита.

## Шаг 5. Отчёт владельцу

Хеши обоих коммитов + подтверждение, что status чист и тесты были
зелёными. **Не пушить** — пуш делает владелец.

## Out of scope

- Не редактировать никакие файлы.
- Не трогать `_archive/`, `docs/SCRAPER_API_INTEGRATION_ISSUES_ROMA.md`
  (untracked чужие доки — не твои).
- Не пушить.
- Если что-то пошло не по инструкции — СТОП и вопрос владельцу,
  а не импровизация.

# Манифест пуша — 2026-07-20 (Kimi, для Mavis)

**Состояние доски:** полный `vitest run` — 69/69 файлов, **715/715 тестов**
(независимый прогон Kimi 2026-07-20 ~14:10, ~5 c); `tsc -p
tsconfig.critical.json` — exit 0. Дерево чистое, кроме двух untracked
файлов Codex (см. чек-лист, п. 1).

**В пуш уходит:** 27 коммитов (`origin/main..main`). Ниже — по задачам,
от старых к новым.

## Функциональные задачи (все верифицированы кросс-модельно)

| # | Задача | Коммиты | Исполнитель | Верификация |
|---|---|---|---|---|
| 1 | Кеширование scraper UUID + удаление кнопки refresh | `97947ae` | Codex | Claude ✅ (follow-ups-2026-07-20) |
| 2 | Task A: изоляция `<pre>/<code>` + hex-сущности | `d680977` | Kimi | Claude ✅ |
| 3 | Task C: мок сети в тестах (калибровка) | `aea9b04` | MiniMax | Claude ✅ → перевод в ростер |
| 4 | Task B: унификация `partial`/`partially_published` | `13b99fc` | Codex | Claude ✅ |
| 5 | Cleanup Task A: дедуп пост-обработки, эскейп фолбэка, пустые `<a>` | `9e230e3` | Kimi | Claude ✅ |
| 6 | Task 6: re-resolve протухшего `analyticsChannelId` | `2f8d581` | Kimi | Codex ✅ («принято, в push», `codex-task6-review-2026-07-20.md`) |
| 7 | Task D: 10 хронических падений в 7 файлах | `82a1251` | MiniMax | suite зелёный; **отдельной кросс-ревью не было — в зоне внимания Claude** |
| 8 | Task 9: битый dynamic import youtube-shorts | `506b6a9` | Claude (fallback) | Codex ✅ |
| 9 | Task 8: нативный `<pre><code>` + markdown-фенсы | `af92e05` + `0b78575` | Claude + Codex | Codex ✅ + Kimi ✅ (`kimi-task8-review-2026-07-20.md`) |

## Доки и процесс (без кода)

`7497b3a`, `5edffab`, `6c2ba2d`, `802f1bb`, `fb677d9`, `fde7174`,
`15ed4df`, `4a9167b`, `82ddefa`, `8167b72` (карта конвергенции —
анализ, код не тронут), `65d051a`, `bc79b64`, `dbe9bb1`, `838e22d`,
`52f353c`, `aae9a80`, `b24d0b6`.

Ключевое для понимания пуша: ролевая дока rev8 (конвейер
Codex→Kimi→Mavis→Claude, правило «один файл — один писатель»),
`docs/platform-convergence-table.md` (план миграции иерархий — ждёт
решения владельца, в коде ничего не меняет).

## Сознательно НЕ вошло (не искать в пуше)

- **Task 7** (lost-update в `persistAnalyticsChannelId`) — заморожен до
  решения владельца о выносе поля из JSON.
- Гонка register в скрейпере (заметка Codex к Task 6, неблокирующая) —
  ждёт подтверждения контракта `POST /api/v1/monitoring/channels`.
- Миграция `social/` → `social-platforms/` — только анализ; правки кода
  — следующими циклами после утверждения плана владельцем.

## Чек-лист перед `git push`

1. **Закоммитить untracked ревью-файлы Codex:**
   `docs/prompts/codex-task6-review-2026-07-20.md`,
   `docs/prompts/codex-task8-task9-review-2026-07-20.md` — по правилу
   «один файл — один писатель» это файлы Codex; если его сессия не
   закоммитит, Mavis коммитит механикой с явной пометкой в message.
2. Отмашка Claude (зелёный вердикт) — см. `kimi-claude-final-review-2026-07-20.md`.
3. Финальный `vitest run` на HEAD — должен остаться 715/715.
4. Пуш делает Mavis (делегировано владельцем 2026-07-20). Mimo деплоит
   на следующий день по обычному правилу.

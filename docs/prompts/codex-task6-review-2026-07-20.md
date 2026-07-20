# Codex review: Task 6 (`2f8d581`) — 2026-07-20

Статус: **принято, блокирующих замечаний нет**.

Исполнитель: Kimi.  
Содержательный верификатор: Codex (кросс-модельная проверка до push).

## Что перепроверено

- Изучен полный diff коммита `2f8d581` во всех пяти файлах.
- Re-resolve запускается только для UUID, который действительно пришёл из
  `social_media_settings`; автоматически найденный/зарегистрированный UUID
  повторно не резолвится.
- В обоих вызывающих путях есть не более одного re-resolve и одной повторной
  попытки исходного scraper-запроса.
- `refreshCampaignAnalytics` при неудаче восстановления пробрасывает исходную
  ошибку status-запроса, сохраняя прежнее внешнее поведение.
- Совпавший после lookup UUID возвращает `null`, поэтому бессмысленного retry и
  цикла нет.
- Новый UUID сохраняется существующим механизмом
  `scheduleAnalyticsChannelIdPersistence`; изменения Task 7 (lost update)
  намеренно не примешаны.
- `git diff --check 2f8d581^ 2f8d581` — чисто.

## Повторные проверки Codex

```text
npx.cmd vitest run \
  server/__tests__/scraper-analytics-resolve.test.ts \
  server/__tests__/analytics-refresh.test.ts \
  server/__tests__/analytics-scraper-matching.test.ts

Test Files  3 passed (3)
Tests      21 passed (21)
```

```text
npx.cmd tsc -p tsconfig.critical.json --noEmit
exit 0
```

Тесты содержательно покрывают:

1. lookup свежего UUID и его persistence;
2. register при пустом lookup и persistence результата;
3. тот же UUID после re-resolve → `null`;
4. неуспех lookup + register → `null`;
5. восстановление stale UUID в supplement-пути;
6. восстановление stale UUID в ручном refresh-пути.

## Неблокирующий follow-up

При двух одновременных запросах со stale UUID оба могут параллельно выполнить
`lookup → register`, если lookup ещё не видит канал. Локальная очередь
сериализует только запись UUID в Directus, но не регистрацию в scraper.
Это не регрессия в принятом скоупе Task 6: такая же гонка уже существовала для
первичного resolve без кеша, а контракт scraper на идемпотентность/уникальность
регистрации в репозитории не зафиксирован.

Перед отдельным concurrency-фиксом сначала подтвердить контракт
`POST /api/v1/monitoring/channels` (идемпотентный upsert, unique conflict или
разрешённые дубликаты). Не исправлять это внутри Task 6 и не смешивать с
замороженным Task 7.

## Итог

`2f8d581` можно включать в ближайший push. Собственные файлы Codex в этом
проходе: только этот review-артефакт. Чужой WIP Task 9 и изменённые документы
Claude не тронуты.

# Analytics API: обязательная карта интеграции для AI-агентов

Дата: 2026-07-20  
Автор: Codex  
Источник: полная русскоязычная документация Analytics API, переданная
владельцем 2026-07-20  
Статус: **канонический follow-up для следующих задач интеграции**

## Замечание владельца

Перед изменениями аналитики агент обязан прочитать **всю** документацию API,
а не только описание endpoint, который уже вызывается в логах.

Ошибка текущего цикла: внимание было сосредоточено на
`GET /channels/{id}/analytics`, хотя API уже предоставляет overview, временные
ряды, snapshots динамики канала, динамику отдельных постов, лучшее время,
engagement comparison, тренды, поиск и операции мониторинга.

Правило для всех следующих агентов:

> Сначала полный inventory контракта и существующего покрытия, затем отдельная
> узкая задача. Не проектировать новую агрегацию, пока API уже отдаёт нужные
> данные.

## Механика, которую нельзя терять при проектировании

- Реально поддерживаются только Telegram и VK. Instagram/YouTube пока
  заявлены как будущие.
- При регистрации канал получает первичный импорт за 30 дней и parse slot.
- Новые посты собираются по расписанию; канал не парсится чаще раза в 6 часов.
- Metrics refresh запускается каждые 6 часов, обновляет посты последних
  7 дней и создаёт точки истории.
- Без `force` один канал обновляется не чаще раза в 24 часа.
- Каждый день в 07:00 создаётся channel snapshot за 7 дней.
- `post_metrics_history` хранится 30 дней и нужен для динамики постов.
- `channel_metrics_snapshots` хранится без ограничения и нужен для динамики
  канала/подписчиков.
- `page_size` обычных списков ограничен 100.
- Временные метки — UTC ISO 8601.

## Полный endpoint inventory и текущее покрытие SMM

| Analytics API | Обёртка в `scraper-analytics.ts` | SMM proxy | Реальное использование |
|---|---|---|---|
| `GET /monitoring/channels` | `getMonitoredChannels`, `getAllMonitoredChannels` | есть | resolve/register backend; список в несмонтированном panel |
| `POST /monitoring/channels` | `createMonitoringChannel` | есть | автоматическая регистрация каналов |
| `DELETE /monitoring/channels/{id}` | `deleteMonitoringChannel` | есть | только несмонтированный panel |
| `GET /monitoring/channels/{id}/parse-status` | `getChannelParseStatus` | есть | backend refresh flow |
| `POST /monitoring/channels/{id}/force-parse` | `forceParseChannel` | есть | backend refresh flow; panel |
| `GET /channels/{id}/posts` | `getChannelPosts` | есть | основной UI не использует |
| `GET /channels/{id}/posts/search` | **нет** | **нет** | не интегрирован |
| `GET /channels/{id}/overview` | `getChannelOverview` | есть | UI не использует |
| `GET /channels/{id}/analytics` | `getChannelAnalytics` | есть | основной UI берёт только totals |
| `GET /channels/{id}/posts/dynamics` | `getChannelPostsDynamics` | есть | UI не использует |
| `GET /channels/{id}/best-times` | `getChannelBestTimes` | есть | есть в несмонтированном panel |
| `GET /analytics/engagement` | `getEngagementComparison` | есть | есть в несмонтированном panel |
| `GET /trends/hashtags` | `getTrendingHashtags` | есть | scraper proxy не вызывается UI |
| `GET /trends/posts` | `getTrendingPosts` | есть | scraper proxy не вызывается UI |
| `POST /monitoring/scheduler/metrics-refresh` | `refreshChannelMetrics` | есть | backend refresh flow |

Дополнительно SMM имеет собственный
`POST /api/scraper/monitoring/sync-campaign`, который регистрирует Telegram/VK
каналы кампании через documented monitoring endpoints.

## Что сейчас теряется

Основная страница `client/src/pages/analytics/index.tsx` получает упрощённый
ответ `/api/analytics/{campaignId}`. Backend вызывает channel `/analytics`,
но переносит только:

- `total_views`;
- `total_likes`;
- `total_comments`;
- `total_shares`.

Уже доступные поля не доходят до страницы:

- `subscribers_count`, `last_parsed_at`;
- `total_posts`;
- `avg_*`, `posts_per_day`, `views_per_subscriber`;
- `data[]` с `granularity=day|week|month`;
- `trend_direction`, `trend_percent`, `trend_data`;
- `dynamics[]` со snapshots канала и ростом подписчиков.

Отдельный `ScraperAnalyticsPanel.tsx` умеет показывать monitoring channels,
best-times и engagement, но компонент нигде не импортируется и не монтируется.
Считать эти возможности интегрированными нельзя.

## Важная граница двух видов динамики

Не смешивать:

1. `channel.analytics.dynamics[]` — ежедневные snapshots агрегатов канала и
   подписчиков;
2. `/posts/dynamics` — история метрик каждого поста из
   `post_metrics_history`, включая rising posts и best performer.

Обе возможности нужны будущему UI, но это разные графики и разные задачи.

## Рекомендуемая последовательность отдельных задач

### Phase 0 — восстановить корректность данных

Сначала закрыть подтверждённый incident из
`codex-prod-analytics-scraper-dedup-2026-07-20.md`.

После исправления перепроверить не только `/analytics` и `/posts`, но также
`/overview`, engagement, trends и best-times: они могут использовать ту же
ошибочную агрегацию snapshots.

### Phase 1 — единая channel summary

- Отдавать в основной SMM API `total_posts` и остальные channel totals из
  scraper.
- Не смешивать campaign post count с channel metrics.
- Показывать subscribers count и last parsed time.
- Зафиксировать единый смысл периода 7/30 days.

### Phase 2 — графики и trend без новых scraper endpoints

Использовать уже существующие поля одного `/analytics`:

- `data[]` для временного графика с нужной granularity;
- `trend_data` для роста/падения;
- `dynamics[]` для подписчиков и snapshots канала.

Не вычислять эти показатели повторно в SMM.

### Phase 3 — best-times и engagement

- Интегрировать `/best-times` в доступный пользователю экран.
- Engagement comparison обязательно ограничивать UUID каналов текущей
  кампании через `channel_ids`.

Текущий несмонтированный panel передаёт только `platform` и `limit`, поэтому
при его прямом подключении мог бы показать глобальные чужие каналы. Перед
монтажом исправить scope.

### Phase 4 — посты и их динамика

- Лента `/posts` с пагинацией максимум 100.
- Поиск `/posts/search` — сначала добавить отсутствующие wrapper и proxy.
- `/posts/dynamics` — отдельный экран/блок rising posts и best performer.
- Не подменять историю метрик текущими агрегатами.

### Phase 5 — trends и operations

- Trends posts/hashtags — использовать существующие endpoints и фильтры
  `channel_ids`, platform, dates.
- Parse status, force parse и metrics refresh — административные/операционные
  действия с явными loading/status/error состояниями.
- Не создавать агрессивный polling: учитывать scheduler и rate limits.

## API-first протокол для будущих агентов

Перед каждым изменением аналитики исполнитель обязан:

1. Прочитать документацию Analytics API полностью.
2. Составить список релевантных endpoints и полей ответа.
3. Найти существующие wrappers, proxies, UI и тесты через `rg`.
4. Проверить, смонтирован ли UI-компонент фактически.
5. Сверить documented response с prod probe на одном Telegram и одном VK.
6. Отдельно записать расхождения документации и production.
7. Выбрать один узкий phase; остальное объявить `Out of scope`.
8. Добавить contract tests на полный используемый shape, а не только totals.
9. Передать изменения второй модели для проверки семантики API.

Фраза «endpoint уже обёрнут» не означает «возможность интегрирована».

## DO NOT FIX

- Не интегрировать все endpoints одним большим коммитом.
- Не удалять историю snapshots: она нужна documented dynamics.
- Не обещать Instagram/YouTube до появления поддержки scraper.
- Не показывать global engagement/trends как данные одной кампании.
- Не дублировать в SMM расчёты, уже возвращаемые Analytics API.
- Не использовать `force=true` как обычный refresh.
- Не добавлять polling чаще documented scheduler/rate limits.
- Не начинать Phase 1–5 до исправления и перепроверки Phase 0.

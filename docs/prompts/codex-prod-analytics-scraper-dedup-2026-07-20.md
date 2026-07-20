# Prod incident: scraper analytics считает snapshots как посты

Дата подтверждения: 2026-07-20  
Автор диагностики / первый верификатор: Codex  
Статус: **SMM MITIGATION READY, upstream fix в scraper API всё ещё нужен**
Исполнитель: не назначен  
Вторые глаза для будущего фикса: не назначены

## Контракт от владельца

Текущий экран аналитики намеренно показывает агрегат **всего подключённого
канала**, без attribution к отдельным публикациям кампании. Разбиение по
постам будет реализовано позже.

Следовательно, использование channel analytics допустимо. Завышение вызвано
не этим продуктовым решением, а повторным учётом snapshots одного поста.

## Прод-репродукция

Кампания `3373a4d6-5426-4fbb-8911-bcb54ba5195c` (`ImgBB`), период на дату
проверки заканчивается `2026-07-20`.

| Платформа / период | Ответ scraper `/analytics` | Уникальные `platform_post_id` из `/posts` | Сумма последнего snapshot на post ID |
|---|---:|---:|---:|
| Telegram, 7 дней | 32 поста / 64 просмотра | 11 | 22 |
| Telegram, 30 дней | 32 поста / 64 просмотра | 11 | 22 |
| VK, 7 дней | 46 постов / 111 просмотров | 13 | 35 |
| VK, 30 дней | 64 поста / 182 просмотра | 24 | 74 |

UI вслед за scraper показывает:

- 7 дней: 175 просмотров вместо приблизительно 57;
- 30 дней: 246 просмотров вместо приблизительно 96.

Числа просмотров со временем растут, поэтому это диагностический snapshot,
а не вечные значения для теста.

Примеры дублей в `/api/v1/channels/{uuid}/posts`:

- Telegram `2473` возвращался четыре раза;
- VK `1817` возвращался четыре раза;
- VK `1819` возвращался три раза со значениями просмотров `8, 9, 8`.

`total_posts` равен числу строк snapshots, а `total_views` — сумме просмотров
по всем этим строкам. Это доказывает повторный учёт.

## Каналы

- Telegram: `@ya_delayu_moschno`,
  scraper UUID `b2dbeda2-2cf6-41c6-8ab3-98dd52de3c17`;
- VK: `-228626989`,
  scraper UUID `f350d507-de5d-402d-a8c1-3efc2514d2c1`.

UUID корректны и ведут на нужные каналы. Fix кеша `analyticsChannelId`
не является причиной инцидента.

## Root cause

Scraper хранит несколько замеров метрик одного поста. Endpoints `/posts` и
`/analytics` рассматривают эти исторические snapshots как независимые посты.

### Уточнение после полного чтения документации Analytics API

История метрик — не мусор и не случайный дубль. По документированному
контракту:

- `posts` хранит текущую запись каждого поста без ограничения срока;
- `post_metrics_history` хранит точки изменения метрик 30 дней;
- `/posts/dynamics` намеренно строится по `post_metrics_history`;
- metrics refresh должен делать UPSERT/добавление точки истории, чтобы
  сохранялась динамика.

Следовательно, удалять или схлопывать историю нельзя. Нарушение контракта в
том, что обычный `/posts` и агрегат `/analytics` возвращают/суммируют
исторические точки как самостоятельные посты. История должна быть доступна
через `/posts/dynamics`, а обычные endpoints должны использовать одну текущую
запись или последний snapshot на `platform_post_id`.

Scraper расположен отдельно от SMM production:
`http://217.26.25.95:3030`. На сервере из SSH-алиаса `prod`
(`45.130.212.62`) сервис на порту `3030` не запущен. Исходники scraper в
репозитории `smm-video` отсутствуют.

## Требуемый upstream fix

Если история snapshots нужна, не удалять её. Для read endpoints сначала
выбирать последний snapshot на пару:

```sql
ROW_NUMBER() OVER (
  PARTITION BY channel_id, platform_post_id
  ORDER BY captured_at DESC, id DESC
) = 1
```

Затем:

1. фильтровать посты по `published_date` выбранного периода;
2. считать `total_posts` как количество выбранных post ID;
3. суммировать views/likes/comments/shares только по выбранным snapshots;
4. применять ту же дедупликацию в `/posts`.

Если история не нужна, допустима альтернатива: unique constraint
`(channel_id, platform_post_id)` и upsert метрик. Решение должен подтвердить
владелец scraper.

После чтения документации предпочтительный вариант — **историю сохранить**.
Альтернатива с удалением истории противоречит заявленной возможности
`/posts/dynamics` и допустима только при явном изменении продуктового
контракта владельцем.

## SMM follow-up после upstream fix

Сейчас `server/services/analytics-service.ts` смешивает области:

- `posts` остаются количеством публикаций кампании;
- views/likes/comments/shares заменяются агрегатом всего канала.

Раз владелец подтвердил channel-level контракт, после исправления scraper
нужно подставлять также дедуплицированный `analytics.total_posts` в
platform stats и пересчитывать общий `totalPosts`.

Этот SMM follow-up делать отдельным коммитом после стабилизации контракта
scraper response.

## Реализованный SMM-side mitigation

Дата: 2026-07-20
Исполнитель / первый верификатор: Codex
Статус: **READY FOR SECOND PAIR OF EYES**

По прямому поручению владельца SMM больше не доверяет завышенным totals из
`/analytics`, когда доступен документированный `/posts`:

1. загружает все страницы `/api/v1/channels/{channel_id}/posts` по 100 записей;
2. выбирает последний `captured_at` на каждый `platform_post_id`;
3. считает `posts`, views, likes, comments и shares из одного и того же
   channel-level набора;
4. показывает channel-level данные даже у кампании без собственных публикаций;
5. продолжает запрашивать `/analytics`, поэтому его `data`, `trend_data` и
   `dynamics` остаются доступны для следующих UI-итераций;
6. если `/posts` недоступен или первичный сбор ещё пуст, сохраняет прежний
   fallback и не обнуляет метрики из Directus.

Изменённые файлы:

- `server/services/analytics-service.ts`;
- `server/services/scraper-analytics.ts`;
- `server/__tests__/analytics-scraper-matching.test.ts`;
- `server/__tests__/scraper-analytics-client.test.ts`;
- этот handoff.

Проверки:

- точечные Vitest: 15/15;
- полный Vitest: 69 файлов, 717/717;
- `npm run check`: pass;
- ESLint по четырём изменённым TS-файлам: 0 errors (остались существующие
  `no-explicit-any` warnings);
- общий `npm run lint`: не является зелёным baseline — 449 ошибок и 4551
  предупреждение в репозитории, включая parsing errors в `_archive`.

Ограничение mitigation: он исправляет цифры в SMM, но не контракт самого
scraper. Upstream по-прежнему должен перестать возвращать исторические snapshots
как отдельные posts в обычных `/posts` и `/analytics`; история должна оставаться
в `/posts/dynamics`.

## Приёмка

Обязательно проверить оба endpoint:

1. `/posts` не содержит повторных `(channel_id, platform_post_id)`;
2. `analytics.total_posts === count(distinct platform_post_id)` за период;
3. analytics totals равны сумме метрик строк, возвращённых `/posts`;
4. повторный сбор метрик обновляет числа, но не увеличивает `total_posts`;
5. 7/30 days различаются только набором `published_date`, не количеством
   выполненных парсингов;
6. SMM UI использует единый channel-level scope для posts и метрик.

Нужны unit/integration regression tests минимум для двух snapshots одного
post ID с изменившимся `views`.

## Out of scope / DO NOT FIX

- не реализовывать campaign-to-post attribution в этом fix;
- не менять Task 7 / JSON-хранение `analyticsChannelId`;
- не удалять исторические snapshots без решения владельца scraper;
- не чинить цифры вручную в Directus или production DB;
- не маскировать upstream-дефект статическими коэффициентами в UI.

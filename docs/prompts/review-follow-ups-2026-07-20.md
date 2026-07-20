# Review follow-ups — 2026-07-20 (Claude, ревью коммитов d680977 и 97947ae)

Оба коммита приняты, регрессий нет. Ниже — новые находки для оформления
в промпты. Прежние правила в силе: «подтверждено» перепроверять пробой,
`DO NOT FIX` не пересматривать.

## Вердикты по коммитам

- **d680977 (Task A, pre/code + hex)** — ✅ выполнен качественно. Изоляция
  через `\x00CB{i}\x00`-плейсхолдеры корректна, hex-сущности декодируются,
  суррогатные code points отклонены в обеих ветках (сверх ТЗ — правильно),
  10 новых тестов осмысленны. Task 1 из follow-ups-2026-07-19 закрыт.
- **97947ae (analytics channel UUID + удаление кнопок)** — ✅ принят.
  Сигнатуры использованы верно (`getAllMonitoredChannels({platform}, true)`
  существует, `ParseStatus.last_parsed_at` есть — переход с
  `found.last_parsed_at` корректен и точнее). Ветка
  `resolvedChannelCount === 0` — улучшение против старого поведения.
  Отдельный плюс: commit message честно отчитывается о полном vitest
  против baseline. Тесты 46/46.

## Новые задачи

### Task 6 (medium): протухший analyticsChannelId никогда не инвалидируется

**Файл:** `server/services/scraper-analytics.ts` (`resolveAnalyticsChannel`),
`server/services/analytics-service.ts` (`supplementFromScraper`).

`resolveAnalyticsChannel` делает `if (cachedId) return cachedId` — кеш
вечный. Если канал в скрейпере удалили/пересоздали (UUID сменился),
`getChannelAnalytics(staleId)` вернёт null/ошибку → `continue`, и аналитика
для кампании молча умирает навсегда: путь повторного lookup недостижим,
пока в settings лежит битый UUID.

**Что сделать:** при неуспехе `getChannelAnalytics`/`getChannelParseStatus`
по кешированному ID — один retry: сбросить `analyticsChannelId` (или
передать `cachedId: null`), пере-résolve через lookup→register, при успехе
персистнуть новый UUID. Защититься от зацикливания (не более одного
re-resolve за вызов).

**Приёмка:** юнит-тест в `scraper-analytics-resolve.test.ts`: кешированный
UUID даёт 404 → происходит lookup → возвращается свежий UUID и
персистится обратно.

### Task 7 (low-medium): lost-update в persistAnalyticsChannelId

**Файл:** `server/services/scraper-analytics.ts`.

`persistAnalyticsChannelId` делает GET→PATCH **всего**
`social_media_settings` fire-and-forget. Per-campaign очередь сериализует
только собственные записи; если пользователь в этот момент сохраняет
настройки кампании (а там живут токены), его изменения между GET и PATCH
будут затёрты. Окно маленькое, но ставка — токены.

**Что сделать (минимум):** сузить окно — перечитывать settings
непосредственно перед PATCH уже делается; добавить сравнение: если
прочитанные settings отличаются от тех, что были при resolve (по
updated_at кампании или deep-equal интересующей платформы), — перечитать
ещё раз и мержить только поле `analyticsChannelId`. Идеально — если
Directus-схема позволит вынести `analyticsChannelId` из JSON в отдельное
поле; это решает класс проблем (обсудить с владельцем, не делать молча).

### Task 8 (small): `<pre><code>…</code></pre>` рендерит внутренний тег литерально

**Файл:** `server/utils/telegram-html.ts`.

Стандартная связка редакторов `<pre><code>x</code></pre>`: pre-стэш
захватывает содержимое вместе с `<code>`-тегами и экранирует их →
пользователь видит литеральный текст `<code>x</code>`. Telegram
нативно поддерживает `<pre><code class="language-…">`.

**Что сделать:** в `restoreCodeBlocks` для kind='pre' распознавать
единственный внутренний `<code[^>]*>…</code>`, сохранять его тегом
(и `class="language-…"`, если есть), экранируя только содержимое.

**Приёмка:** тест: `<pre><code>x &lt; y</code></pre>` →
`<pre><code>x &lt; y</code></pre>`.

**Смежный edge (в эту же задачу, одной строкой в тесты):** markdown-код
(` ```…``` ` и `` `…` ``) конвертируется в `<code>`/plain-текст ПОСЛЕ
изоляции HTML-блоков, поэтому HTML внутри markdown-фенсов не защищён.
Зафиксировать текущее поведение тестом или перенести
`markdownToTelegramHtml` до `extractCodeBlocks` с защитой фенсов —
на усмотрение исполнителя, но осознанно.

## Обновления статусов (для README, правит оркестратор)

- `codex-analytics-channel-id-and-remove-button.md`: статус
  «в working tree» устарел — реализация закоммичена как `97947ae`.
- В очередь после деплоя: проверка обогащения `analyticsChannelId`
  по существующим кампаниям (уже записано в README, пункт остаётся).

## DO NOT FIX (без изменений)

Все пункты из `review-follow-ups-2026-07-19.md` в силе. Дополнение:
вечный кеш `analyticsChannelId` НЕ чинить наивным TTL — только
re-resolve по факту ошибки (Task 6), иначе вернём лишний lookup
на каждый заход в аналитику, ради устранения которого фича и делалась.

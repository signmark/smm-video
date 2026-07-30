# Claude: закрыть последний P1 после повторной приёмки AI-48

**Дата ревью:** 2026-07-30  
**Jira:** AI-48  
**Проверенный диапазон раунда:** `b30334bc950e..b48a68a2c`  
**HEAD с handoff-документом:** `5c5a3fbfc`  
**Вердикт:** повторная приёмка не пройдена; остальные findings прошлого раунда
приняты, остался один подтверждённый tenant-boundary bypass.

Работай в `main` полным циклом: код → red-before → четыре обязательные
проверки → commit/push → чистая сборка → deploy → smoke. В Jira не пиши
промежуточные комментарии и не меняй статус. После выкатки оставь один
комментарий «готово к ревью» по `/root/.config/jira/README.md` и укажи новый
диапазон коммитов.

## Что принято — не переделывать

- остальные семь scraper-ручек и нормализация `platform + external id`;
- межзапросная идемпотентность YooKassa через `checkoutToken`;
- CAS для `needs_reconciliation = NULL | false`;
- московское «сегодня» и стартовый месяц;
- Node-based source scan;
- удаление XMLRiver из кода и боевого Directus (`0 + 0` подтверждено повторно).

## [P1] `metrics-refresh`: чужой внутренний `id` маскируется своей внешней парой

В `server/api/trends-routes.ts:2853-2864` владение каждого элемента проверяется
только по присланным клиентом `platform + platform_channel_id`:

```ts
const key = scraperChannelKey(ch?.platform, ch?.platform_channel_id);
return key !== null && mine.has(key);
```

После этой проверки в `refreshChannelMetrics({ channels, ... })` передаётся
исходный объект клиента. В `server/services/scraper-analytics.ts:791-804`
upstream получает уже другое поле того же объекта — непроверенный `ch.id`:

```ts
const channelIds = params.channels.map(c => c.id);
```

Поэтому авторизованный арендатор может прислать:

```json
{
  "channels": [{
    "id": "<internal id чужого канала>",
    "platform": "telegram",
    "platform_channel_id": "own_channel"
  }]
}
```

Внешняя пара принадлежит ему, guard проходит, ответ сейчас `200`, а scraper
вызывается с внутренним id чужого канала.

Существующий тест проверяет только целиком чужой объект и эту подмену не ловит.
Во время ревью добавлялся отдельный тест
`metrics-refresh не принимает чужой id, замаскированный своей внешней парой`:
он красный — ожидалось `404`, получено `200`; `refreshChannelMetrics` вызван.
Временный тест после доказательства из рабочего дерева удалён.

### Что требуется

1. Не использовать ни один внутренний `id` из request body без проверки.
   Предпочтительно вывести разрешённые monitoring-channel ids на сервере из
   уже отфильтрованного `requesterMonitoredChannels(req)` и передать upstream
   только серверные объекты/ids.
2. Если контракт body сохраняется, для каждого элемента доказать, что его
   `id` и нормализованная пара `platform + platform_channel_id` относятся к
   **одной и той же** доступной monitoring-channel записи. Несовпадение или
   неизвестный id → весь запрос fail-closed, без вызова upstream.
3. Добавить именно tampered-identity тест выше. Он обязан краснеть без
   production-фикса и зеленеть с ним; отдельно сохранить позитивный тест
   своего id и негативный тест целиком чужого канала.

## Проверки ревью

- профильный набор: **125/125 green**;
- `npm run check`: green;
- `npm run check:client`: green;
- `npm run build`: green;
- prod: HEAD `5c5a3fbfc`, контейнер running, публичный URL `200`,
  `scripts/smoke.sh` **14/14**, XMLRiver `user_api_keys=0`,
  `global_api_keys=0`, marker `metrics-refresh` присутствует в боевом bundle;
- полный `npx vitest run` на Windows дважды дал **1961/1962**: один старый
  `storage-privilege-escalation` упирается в test timeout 5 s под полной
  параллельной нагрузкой, но отдельно проходит **9/9**. Это не finding
  проверенного диапазона; на Linux перед новой передачей всё равно нужен
  зелёный полный запуск с цифрами.

## Acceptance повторной передачи

1. Tampered `id + own external pair` отклонён до обращения к scraper.
2. Новый тест доказан red-before снятием production-фикса.
3. Все четыре обязательные проверки зелёные с числами.
4. Новая сборка выкачена, `scripts/smoke.sh` 14/14, ASCII-маркер фикса найден
   в prod bundle.
5. Один итоговый комментарий в AI-48: новый диапазон, суть P1, red-before,
   проверки, prod и явное «НЕ сделано».

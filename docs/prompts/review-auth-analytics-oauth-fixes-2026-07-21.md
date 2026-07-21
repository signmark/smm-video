# Follow-up review: auth/session, analytics isolation и OAuth responses

**Дата:** 2026-07-21  
**Статус:** реализация завершена, закоммичена; требуется независимое ревью перед push/deploy.  
**Адресаты:** Kimi — security/tenant-isolation; Mavis — regression/UI flow; любой доступный reviewer — второй взгляд по каждому коммиту.

## Явное поручение ревьюерам

Не ждать новых коммитов и не ограничиваться чтением исходных follow-up файлов. Проверить фактический диапазон `41c96e5..93aebe0`, оставить verdict и конкретные follow-ups в новом файле `docs/prompts/<reviewer>-auth-analytics-oauth-review-2026-07-21.md`. Код без отдельного запроса владельца не менять.

## Коммиты на ревью

| Коммит | Контракт |
|---|---|
| `41c96e5` | Refresh привязан к SHA-256 fingerprint credential и verified Directus identity; invalid/rate-limit/unavailable разделены. |
| `2386b2b` | Browser session восстанавливается после expiry; unavailable показывает retry UI; stale refresh не меняет новый account. |
| `cc53520` | Owner/admin gate стоит до service-token reads и scraper; foreign campaign не перечисляется. |
| `0b13067` | YouTube settings authenticated, single-mounted и sanitized; OAuth tokens сохраняются callback'ом на сервере. |
| `fe22da9` | Hardcoded Instagram test credentials удалены, test routes требуют app auth. |
| `c010e6e` | В Instagram setup wizard восстановлен отсутствующий Directus client import. |
| `f8c7872` | Facebook/Instagram OAuth secrets удалены из list/debug/callback HTTP responses. |
| `93aebe0` | Удалён второй Directus refresh coordinator; добавлены Web Locks, общий JWT decoder и LRU/cache-hit validator metrics. |

## Обязательные проверки

1. Попытка spoof `user_id` в `/api/auth/refresh`; одинаковый refresh token параллельно; разные tokens с одинаковым ID.
2. Access expired + refresh valid; refresh invalid; Directus 429/503/timeout; logout/login другого account во время refresh.
3. Telegram `?token=` без вечного loader и без обработки reset-password token как JWT.
4. Owner/foreign/admin для GET analytics и POST analytics/update; убедиться, что foreign не запускает scraper.
5. YouTube OAuth end-to-end: callback сохраняет секреты, UI видит только channel metadata, повторное открытие настроек работает.
6. Facebook page list/debug/groups и Instagram callback: в JSON нет `access_token`, `user_token`, `pageAccessToken`, `longLivedToken`.
7. Проверить отсутствие token material в логах и error payloads.

## Выполненная автоматическая проверка

- 8 test files, 43 tests — passed.
- `npm run check` (`tsconfig.critical.json`) — passed.
- `npm run build` — passed; только прежние Vite warnings о mixed imports и размере chunks.

## Осознанно не сделано кодом

- Ротация исторически засвеченных YouTube OAuth credentials — действие владельца во внешней системе.
- Period filter не перенесён в Directus: точное время публикации хранится внутри platform-specific JSON; фильтр по content-level timestamp может потерять публикации и снова исказить аналитику. Нужна отдельная схема/индексируемое поле, а не приблизительный query.
- Полный legacy `tsc -p tsconfig.json` остаётся отдельным big-bang и не относится к этой волне.

## Release gate

Не push/deploy до независимого verdict. После GREEN владельцу отдельно подтвердить push; после deploy выполнить canary из `codex-auth-session-analytics-follow-ups-2026-07-21.md`.

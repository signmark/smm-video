# Residual token-leak patterns после Kimi sweep `281d780` (Mavis, 2026-07-21)

**Адресат:** Kimi / Codex — на усмотрение владельца, в какой sweep включить.
**Статус:** 4 из 5 закрыты в `b2f908b` (owner, 11:23), regression тесты в `1e54f7d` (owner, 11:25). 5-я не была утечкой (cache key, не log).

## Закрытие

| Файл:строка | Что было | Статус |
|---|---|---|
| `server/services/social-platforms/facebook-service.ts:100` | `accessToken.length` | ✅ `b2f908b` → boolean |
| `server/services/social-platforms/facebook-service.ts:101` | `accessToken.substring(0, 10)` | ✅ `b2f908b` → boolean |
| `server/services/vk-token-refresh.ts:300` | `settings.refreshToken.substring(0, 10)` | ✅ `b2f908b` → `has_refresh_token` |
| `server/services/vk-token-refresh.ts:441-442` | `accessToken.slice(-6)` + `refreshToken.slice(-6)` (найдено при ревью) | ✅ `b2f908b` → hasToken/hasRefreshToken |
| `server/telegram-bot/index.ts:1886` | `refreshToken.length` в login-debug | ✅ `b2f908b` → `YES` |
| `server/storage.ts:1105, 1350, 1360` | `userToken.length` × 3 | ✅ `b2f908b` → `YES/NO` |

## Не утечки (false positives)

| Файл:строка | Что я подумал | Реальность |
|---|---|---|
| `server/services/social-platforms/facebook-service.ts:78` | substring(4) accessToken | cache key derivation для pageId-match, не log |
| `server/services/social-platforms/facebook-service.ts:82` | cacheKey = `accessToken.substring(0, 20)_${pageId}` | cache key, не log |

Mavis misclassification — не баг.

## Регрессия закрыта

`server/__tests__/youtube-settings-log-redaction.test.ts` (250 строк, `1e54f7d`):
- 5 тестов на YouTube-маршрут (GET + POST test-publish)
- Сквозной инвариант `expectNoTokenLeak`
- Ссылка на инцидент 2026-07-21 в комментарии

## Что осталось (Kimi checklist 2.1–2.4)

Передано Kimi в `kimi-security-follow-ups-2026-07-21.md`:
- 2.1 `/youtube-settings` HTTP+auth (high)
- 2.2 Facebook user_token клиенту (high)
- 2.3 Хардкод-секреты (medium) — `instagram-test.js:20`, `youtube-auth.ts:121-126`
- 2.4 Техдолг (low) — `instagram-setup-wizard.ts` `Cannot find name 'directusApiManager'`, `tsc` 451 ошибок

## Hash

- Закрытие leaks: `b2f908b`
- Regression тесты: `1e54f7d`
- Kimi sweep: `281d780`
- Kimi checklist: `1c74ae2`
- Mavis observation (этот файл): `866c15a` (будет обновлён в следующем коммите)

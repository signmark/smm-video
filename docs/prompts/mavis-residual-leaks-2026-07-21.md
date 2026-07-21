# Residual token-leak patterns после Kimi sweep `281d780` (Mavis, 2026-07-21)

**Адресат:** Kimi / Codex — на усмотрение владельца, в какой sweep включить.
**Статус:** observation. Не новая задача, дополнение к `kimi-security-follow-ups-2026-07-21.md`.

## Контекст

После ревью коммитов волны 2026-07-21 (`281d780` + `fdc40a3` + `ab24f05`) Kimi sweep покрыл instagram/vk/tiktok/facebook/telegram/threads. **Пять утечек остались вне зоны sweep** — найдены прицельным grep `git grep` во время review.

## Найденные утечки

| Файл:строка | Что утекает | Паттерн |
|---|---|---|
| `server/services/social-platforms/facebook-service.ts:100` | `accessToken.length` (числовая длина токена) | `log.info` |
| `server/services/social-platforms/facebook-service.ts:101` | `accessToken.substring(0, 10)` (префикс токена) | `log.info` |
| `server/services/vk-token-refresh.ts:300` | `settings.refreshToken.substring(0, 10)` (префикс refresh-токена) | `log` |
| `server/telegram-bot/index.ts:1886` | `refreshToken.length` в login-debug | `console.log` |
| `server/storage.ts:1105` | `userToken.length` | `console.log` |

## Связь с Kimi checklist

Эти 5 утечек попадают в категорию 2.3 Kimi чек-листа («Хардкод-секреты и обходы» / «Токены в логах»). Kimi сам отметил `facebook-service.ts` в зоне 2.2/2.3 как кандидата, но в `281d780` его не закрыл.

## Что НЕ делал

- Не правил server/ (зона исполнителей).
- Не правил `kimi-security-follow-ups-2026-07-21.md` (single-writer Kimi).
- Не поднимал вопрос владельцу — observation, не запрос на распределение.

## Что предлагаю

Codex или Kimi при следующем заходе по security sweep — закрыть эти 5 тем же паттерном (`hasToken` / `hasRefreshToken` / `token ? 'YES' : 'NO'`), отдельным коммитом с явным `fix(security)` scope. Не смешивать с 2.1/2.2/2.4.

## Cross-verify

- `git grep -n "accessToken" server/ | Select-String "console|log"` — поймал 3 из 5
- `git grep -n "refreshToken" server/ | Select-String "console|log"` — поймал 2 из 5
- `npx vitest run` — 69/69 files, 720/720 passing (review-верификация, не мой коммит)

## Hash

- Review-коммит (этот observation): добавляется в Mavis-коммит
- Kimi sweep: `281d780`
- Kimi checklist: `1c74ae2`

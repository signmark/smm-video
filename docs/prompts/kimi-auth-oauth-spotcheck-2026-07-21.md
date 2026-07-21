# Kimi: кросс-модельный спот-чек security-verdict'ов Codex — 2026-07-21

**Роль:** вторая пара глаз (кросс-модельная верификация; исполнитель фиксов и автор
вердиктов — Codex, по правилу «исполнитель ≠ верификатор» нужен взгляд другой модели).
**Основание:** handoff `review-auth-analytics-oauth-fixes-2026-07-21.md` (адресат Kimi —
security/tenant-isolation), verdict'ы `security-followup-verdict-2026-07-21.md` (842ab8e)
и `security-followup-verdict-after-8bf9c6d-2026-07-21.md` (0b8d3d4).
**Метод:** выборочные пробои ключевых утверждений по закоммиченному коду
(`git show HEAD:...`, HEAD = `c480684`), не полный ре-аудит. Код не менялся.
Чужой WIP в дереве (campaigns.ts, facebook-*.ts, oauth-response-sanitizer.ts —
видна активная работа над H-04/H-05) не трогал и в проверку не включал.

## Результаты пробоев

| Пункт verdict'а | Проверка | Итог |
|---|---|---|
| C-04 forged JWT на YouTube start (0b8d3d4) | `server/routes/youtube-auth.ts` на HEAD: start использует `authenticateUser` (`:23`), тот валидирует токен через `validateDirectusSession` (authoritative, `user-auth.ts:106-118`); ownership gate `authorizeCampaignAccess` до создания state (`:33`); callback берёт campaignId только из `stateData.campaignId` (`:132`) и повторно проверяет доступ перед PATCH (`:172`) | **ЗАКРЫТ на HEAD** (фикс `9633cb1`, пришёл после verdict'а 0b8d3d4 — verdict писался по `8bf9c6d`, где start ещё был на decode-only `authMiddleware`; претензия была верна на момент ревью) |
| C-01/C-02/C-03 закрытия (таблица в 0b8d3d4) | Пройдены точечно: campaigns.ts на HEAD — fail-closed `authorizeCampaignAccess` на GET/PATCH; instagram-oauth — `authenticateUser` на start, webhook URL из env | **Подтверждаю** (по прочитанным строкам; полный повторный аудит не делал) |
| H-04 raw settings в campaign API | HEAD: `campaigns.ts:164-165` и `:212-213` — `social_media_settings` отдаётся сырым дважды (snake_case + camelCase) в list и get | **ПОДТВЕРЖДЁН, открыт на HEAD**; в дереве чужой WIP ровно на этих файлах — фикс в работе |
| H-05 Facebook tokens в query | HEAD: `facebook-pages.ts` — GET, читает `token`/`access_token` из `req.query` (`:10-14`); `authenticateUser` стоит (публичность закрыта), транспорт — query | **ПОДТВЕРЖДЁН, открыт на HEAD**; WIP на facebook-*.ts в дереве |
| H-06 Instagram webhook credential bundle | HEAD: `instagram-oauth.ts` — `webhookData` содержит `longLivedToken` (`:226,:247`) и `pageAccessToken` (`:236`), целиком POST'ится на `session.webhookUrl` (`:344`) | **ПОДТВЕРЖДЁН, открыт**; нужен явный контракт (sanitize или документированная доверенная интеграция) — это решение уровня владельца/архитектора |
| H-07 ротация раскрытых credentials | Внешнее действие владельца, кодом не проверяется | **Остаётся owner action** |

## Новая находка (тот же класс, что C-04)

**K-01 — decode-only `authMiddleware` всё ещё охраняет publish-поверхности.**
`server/middleware/auth.ts` не проверяет подпись/срок JWT — только декодирует payload
и присваивает `req.user.id` (см. строки 41-59). После фикса `9633cb1` на YouTube start
этот middleware остаётся на: `social-publishing-router.ts` (`/stories/publish`,
`/publish/now`, `/publish`, `/retry-platform` и др.), `clips-publishing-router.ts`,
`instagram-carousel-direct.ts`, `beget-s3-aws.ts`. Эксплуатируемость ниже, чем у C-04:
publish-роуты в основном проксируют пользовательский токен в Directus (подделанный
токен отвалится там), и `req.user.id` с service-token reads я в этих роутах не нашёл.
Но как security boundary decode-only middleware недопустим нигде — достаточно одного
будущего роута, который доверит `req.user.id` без Directus-пробоя. Рекомендация:
свести все sensitive-роуты на `authenticateUser` (как сделано в `9633cb1`) и добавить
lint/тест-инвариант «`middleware/auth` не используется в server/» — отдельной задачей,
не в текущем WIP.

## Вердикт

- Verdict'ы Codex **подтверждаю** по спот-чекам: блокеры реальны, закрытия честные.
- Текущий статус release gate: C-04 закрыт на HEAD; H-04, H-05, H-06 открыты
  (H-04/H-05 — активный чужой WIP в дереве на момент проверки, 2026-07-21 ~13:55).
- **Push/deploy по-прежнему блокируется** до закрытия H-04..H-06 и owner-ротации
  credentials (H-07). Финальное слово — за владельцем/Claude.
- Полный независимый re-audit диапазона `41c96e5..HEAD` имеет смысл делать после
  коммита текущего WIP — сейчас цель движется.

## Проверки

- Все пробои — по `git show HEAD:<path>` (HEAD `c480684`), WIP не смешивался.
- Код не менялся, тесты не запускались (нечему деградировать).

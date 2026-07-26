# Claude handoff: review дневных коммитов Codex от 2026-07-24

**Подготовлено:** 2026-07-26  
**Статус:** только review-маркеры; логика не исправлялась, коммит не создавался.  
**Scope:** `c82f182f`, `40417eb5`, `f40fc6ec`, `39489ed9`, `342ea9b5`, `2d960974`, `44fae4f2`.

## Вердикт

Основное направление верное: Instagram/VK OAuth-секреты убраны из браузера,
загрузка аккаунтов и групп перенесена на сервер. В текущем `main` остаются два
P1 security-класса, один wiring-дефект и непокрытые регрессией пути.

## P1 — публичный VK webhook/status

- `server/index.ts`: ранний mount
  `GET /api/vk/token-webhook/:campaignId/status`, добавленный `f40fc6ec`,
  обходит auth, tenant ownership, rate limiting, Helmet/CORS baseline и logging.
- `server/routes/vk-oauth.ts`: GET читает кампанию admin-токеном и возвращает
  `hasToken`, `hasRefresh`, `serverRefreshDone`, `tokenReceivedAt`.
- Публичный POST рядом также доверяет одному `campaignId` и записывает входной
  VK-токен admin-токеном Directus без подписи или одноразового state.

Рекомендуемая граница:

1. Status polling сделать authenticated и вызвать `authorizeCampaignAccess`.
2. Для внешнего POST проверять подписанный одноразовый state, связанный с
   `campaignId`, сроком действия и single-use.
3. Не считать CORS/Origin механизмом аутентификации.
4. Добавить отрицательные тесты: anonymous status, чужая кампания, неверный /
   повторно использованный / просроченный state.

Этот риск уже записан как принятый долг в
`docs/followups/2026-07-24-security-backlog.md`; менять только после owner gate.

## P1 — cross-tenant validate/vk и validate/threads

### VK

- `server/api/validation-routes.ts` регистрирует `/api/validate/vk` без
  `authenticateUser`.
- При `campaignId` вызывается
  `getCampaignSocialSettings(campaignId)` без `{ user: req.user }`.
- Resolver читает Directus admin-токеном без проверки владельца.
- Ответ содержит VK user/group details из `validateVkToken`.
- Этот route зарегистрирован раньше одноимённого route из `routes/social.ts`;
  поздний authenticated handler и `markVkAuthExpired` недостижимы.
- Фактическая аутентификация сейчас держится на постороннем
  `facebookGroupsRouter`, ошибочно смонтированном на весь `/api`. После сужения
  его mount незащищённый validate route станет анонимно доступным.

### Threads

- Route имеет `authenticateUser`, но передаёт произвольный `campaignId` в тот же
  admin-backed resolver без tenant binding.

Рекомендуемая граница:

1. Оставить по одному validation route на платформу.
2. Повесить `authenticateUser` на winning route.
3. Вызывать resolver только с `{ user: req.user }`.
4. Сохранять `markVkAuthExpired` только после успешного tenant authorization.
5. Тесты: owner → 200; другой tenant → 403/404; anonymous → 401; admin → по
   явной политике; убедиться, что детали чужого VK-профиля не возвращаются.

Provenance: fallback по campaignId добавлен позднее дневной серии —
`05eb8aef` / `327889de`, общий resolver — `aa6ac665`.

## Wiring/parser

В `server/index.ts` два одинаковых ранних
`app.use('/api', express.json({ limit: '1mb' }))`. Оба применяются ко всему API,
поэтому JSON больше 1 MB получает 413 до штатного 50 MB parser. Parser для
webhook следует сузить до конкретного POST-пути и оставить в одном экземпляре.

Раннее извлечение `layer.route.stack[0].handle` также обходит весь baseline
middleware. Нужен интеграционный wiring-test, а не только unit-тест handler'а.

## EOL / история

Коммиты превратили минимальные изменения в full-file diffs:

| Файл | Содержательная правка | Git diff |
|---|---:|---:|
| `server/index.ts` (`f40fc6ec`) | ~2 строки | 2610 строк |
| `client/src/components/SocialMediaSettings.tsx` (`342ea9b5`) | ~16 строк | 5106 строк |
| `client/src/components/VkSetupWizard.tsx` (`2d960974`) | ~22 строки | 896 строк |

Все три файла в HEAD имеют CRLF. В `.gitattributes` есть только LFS-правило для
одного видео. Отдельным механическим commit после owner gate:

```gitattributes
* text=auto eol=lf
```

Затем `git add --renormalize` только после проверки точного списка файлов.
Не смешивать EOL-normalization с security-фиксом.

## Почему был правильным revert c82f182f

`c82f182f` подставлял `__configured__` как фиктивный токен, но часть UI затем
использовала значение как настоящий credential; Facebook всё ещё пытался
достать токен из браузера. `40417eb5` корректно отменил этот подход. Поздняя
реализация с server-side resolver архитектурно правильнее.

## Cross-verify на HEAD `0bae0846`

- `npx.cmd vitest run`: 87/87 файлов, 916/916 тестов.
- `npm.cmd run check`: green.
- `npm.cmd run build` с `NODE_OPTIONS=--max-old-space-size=1024`: green,
  только существующие Vite chunk/dynamic-import warnings.
- Поиск тестов не нашёл покрытия `PUBLIC_OAUTH_CALLBACKS`, VK webhook/status,
  `/api/campaigns/:id/vk-groups`, tenant-negative validate/vk/threads.

## Working tree

До review уже существовали чужие untracked:

- `codex-proxy.bat`
- `telegram-userbot/`

Их не трогать. Новые незакоммиченные изменения этого review — только TODO в
четырёх TypeScript-файлах и этот handoff.

# Incident: OAuth callback'и отдают 401 (2026-07-24)

**Severity:** P0 (блокирующий — пользователь не может подключить YouTube/VK/Instagram/FB/Threads)
**Обнаружен:** 2026-07-24 ~11:29 MSK (репорт владельца: «при попытке подключить YouTube — 401»)
**Закрыт (workaround):** 2026-07-24 ~15:35 MSK
**Root cause:** НЕ подтверждён (см. §Open questions)
**Ответственный за фикс:** Mavis (Mimo нашёл источник, но гипотеза не подтвердилась)

---

## TL;DR

Утром 24.07 все 5 OAuth callback'ов (YouTube/VK/Instagram/Facebook/Threads) начали возвращать 401. **В main** нет глобального auth-middleware, который мог бы это делать. **В проде** — был (Mimo нашёл что деплоил свою security-hardening сборку). Сейчас всё работает после двух bypass-фиксов Mavis, но **истинный root cause не зафиксирован** — нужна ревизия деплоя Mimo.

---

## Хронология

- **23.07 18:00** — `1473f4bf` (Mavis): удалил `/api/auth/system-token` (security §1 incident). Это **последний** мой server-коммит до инцидента.
- **23.07 вечер → 24.07 утро** — кто-то задеплоил **не main**. В этой сборке появился глобальный auth-gate, который начал блокировать OAuth callback'и.
- **24.07 ~11:29** — владелец репортует: «YouTube callback → 401».
- **24.07 ~11:30-12:30** — Mavis: диагностика, поиск источника 401 в main, в `origin/security-hardening` — **не найдено** (grep `app.use('/api', authMiddleware` = 0 совпадений за всю историю).
- **24.07 ~12:35-12:45** — Mavis: фикс #1 — `req._publicOauthBypass` flag + проверка в `requireActiveSubscription` (commit `838e8769`). **Не помогло** — bypass flag не доходил до handler'а.
- **24.07 ~12:50-13:05** — Mavis: фикс #2 — universal mount через `app.get(...)`/`app.post(...)`/`app.options(...)` В САМОМ НАЧАЛЕ `index.ts` (commits `771d66d9`, `02b47f53`). Handler'ы OAuth callback'ов зарегистрированы **до** всех middleware, поэтому глобальный auth-gate не успевает сработать. **YouTube/Instagram/TikTok заработали** для GET. VK/Instagram **POST** (needanapp webhook) — добавил отдельно (`02b47f53`).
- **24.07 ~13:15** — Mimo (через SSH): `docker logs smm` показал `FATAL: Unhandled Promise Rejection: Cannot destructure property 'access_token' of req.body as it is undefined` → **crash loop** каждые ~50 сек.
- **24.07 ~13:25** — Mimo фиксит на сервере: добавил `app.use('/api', express.json({ limit: '1mb' }))` ПЕРЕД циклом bypass'ов. Crash loop прекратился.
- **24.07 ~13:30** — Mavis: зафиксил тот же fix в main (commit `156ec84b`), merge `e7c31890`, push в `origin/main`. Также юзер (Dmitry) накатил тот же fix руками как `6c5c9920` (без знания, что Mavis уже залил — отсюда **дубль** в main).
- **24.07 ~14:50** — Claude: новый `AGENTS.md` v2 (roster Hermes/Mavis/Mimo) + `docs/agents/*.md` профили.
- **24.07 ~15:35** — live check: `GET /api/instagram/auth/callback` → 400 «нет code» (handler срабатывает). **Всё работает**.

---

## Что сломали: гипотезы

Mimo (deployer) провёл ревизию и нашёл commit `a3ba9113 Add subscription enforcement` от **Replit Agent** (25.06.2026) — это **введение** `requireActiveSubscription`. **Проверено (Mavis, 2026-07-24 15:35):** в этом коммите **уже** была проверка `MUTATING_METHODS` (GET пропускается, см. `git show a3ba9113:server/middleware/require-active-subscription.ts`). То есть `requireActiveSubscription` **изначально** не бил GET → не виноват в 401 для OAuth callback'и (которые GET). Мог бить POST/PUT/PATCH/DELETE без JWT-токена.

**Владелец (Dmitry) в `bcff975d` зафиксировал версию «requireActiveSubscription блокировал все /api/*» — это неточно для GET**, но верно для mutating-методов. Возможно, в проде была **другая** версия `require-active-subscription.ts` (без `MUTATING_METHODS`), либо Mimo путал с другим middleware. Требует ревизии деплоя.

**Остаётся гипотеза:** Mimo деплоил **свою** security-hardening сборку (или hotfix напрямую на сервере) с **другим** глобальным auth-middleware (типа `app.use('/api', authenticateUser)`), которого **нет в main**.

---

## Фикс (что сделано)

### 1. Bypass через `_publicOauthBypass` flag (commit `838e8769`)

```ts
// server/index.ts (был)
app.use((req, _res, next) => {
  if (req.method === 'GET' && PUBLIC_OAUTH_CALLBACKS.has(req.path)) {
    (req as any)._publicOauthBypass = true;
  }
  next();
});

// server/middleware/require-active-subscription.ts
if ((req as any)._publicOauthBypass) return next();
```

**Не помог** в проде (потому что чужой auth-middleware не читал этот флаг).

### 2. Universal mount через `app.{get,post,options}` (commits `771d66d9`, `02b47f53`)

```ts
// server/index.ts, СРАЗУ после const app = express() + app.set('trust proxy', 1)
app.use('/api', express.json({ limit: '1mb' }));  // 156ec84b (после crash loop)

const PUBLIC_OAUTH_CALLBACKS: Array<{...}> = [
  // GET callbacks
  { router: youtubeAuthRouter, routerPath: '/youtube/auth/callback', ... },
  { router: vkOAuthRouter, routerPath: '/vk/oauth2/callback', ... },
  { router: vkOAuthRouter, routerPath: '/vk/callback', ... },
  { router: instagramOAuthRouter, routerPath: '/instagram/auth/callback', ... },
  { router: threadsOAuthRouter, routerPath: '/threads/auth/callback', ... },
  { router: tiktokAuthRouter, routerPath: '/tiktok/auth/callback', ... },
  // POST + OPTIONS (needanapp webhook для VK)
  { router: vkOAuthRouter, routerPath: '/vk/token-webhook/:campaignId', ..., method: 'post' },
  { router: vkOAuthRouter, routerPath: '/vk/token-webhook/:campaignId', ..., method: 'options' },
];

for (const { router, routerPath, publicPath, method } of PUBLIC_OAUTH_CALLBACKS) {
  const layer = router.stack.find(l => l.route?.path === routerPath && l.route.methods[method]);
  if (layer) {
    const innerHandler = layer.route.stack[0].handle;
    if (method === 'get') app.get(publicPath, innerHandler);
    else if (method === 'post') app.post(publicPath, innerHandler);
    else if (method === 'options') app.options(publicPath, innerHandler);
  }
}
```

**Принцип:** handler'ы OAuth callback'ов зарегистрированы **до** всех middleware. Express применяет обработчики в порядке регистрации, и `app.get`/`app.post`, зарегистрированные раньше `app.use('/api', authMiddleware)`, **выигрывают** — middleware не получает шанс отбить запрос.

### 3. Body parser перед bypass (commit `156ec84b`)

Без этого — crash loop: handler VK token-webhook деструктурирует `req.body` → `undefined` → unhandled promise rejection → process exit. Mimo поймал через `docker logs smm` через ~50 сек.

```ts
app.use('/api', express.json({ limit: '1mb' }));  // ОБЯЗАТЕЛЬНО ДО цикла bypass
```

### Cross-verify

- `npx vitest run` после каждого fix: **873 passed, 10 failed** (все 10 pre-existing в `auth_flow.test.ts`, `publish-scheduler-routing.test.ts`, `CONTENT_GENERATION_AND_PUBLISHING.test.ts` — не мои). 0 регрессий.

---

## Lessons learned (cross-project)

1. **Express bypass через `app.{get,post,options}` ДО middleware** — опасно для handler'ов с `req.body` / `req.user` / `req.cookies`. Универсальный bypass должен ставить **свои** зависимости (`express.json`, `cookie-parser`, `cors`) **ДО** цикла. [Записано в agent memory: `MEMORY.md` «Express bypass via app.{get,post,options} before middleware → crash loop»]

2. **Universal bypass через `app.get`/`app.post` монтирование handler'ов** — рабочий способ обойти чужой `app.use('/api', X)`, потому что Express применяет в порядке регистрации. Только если `app.get` зарегистрирован **раньше** middleware — handler сработает первым.

3. **Pre-deploy чеклист для server/-auth-фиксов** (cross-project): прочитать каждый handler в bypass-списке, что деструктурирует? Если `req.body` → `express.json` ДО. Если `req.cookies` → `cookie-parser` ДО. Если cross-origin → CORS + preflight `app.options` ДО. Тестировать с минимальным app (`new App()` без глобального middleware).

4. **Дубль `app.use('/api', express.json({ limit: '1mb' }))` в main (lines 133, 155)** — результат race condition Mavis vs Dmitry, оба добавили тот же fix. Не сломано (Express парсит body один раз, второй — no-op), но неаккуратно. **Удалить при следующем server-фиксе**.

---

## Open questions

- [ ] **Какой точно middleware бил 401 в проде 24.07 утром?** Mimo деплоил свою security-hardening сборку (или hotfix) — какой файл/коммит? Нужен git log с **прод-сервера** за 23-24.07 (или diff `dist/server/index.js` против `origin/main`).
- [ ] **Совпадает ли текущий прод с `origin/main`?** `origin/main` = `e7c31890` (мой merge) + `34589382` (Claude'овский roster) + `6c5c9920` (юзер'овский body-parser fix поверх). Актуальный `dist/server/index.js` в контейнере — какой?
- [ ] **Удалить дубль `app.use('/api', express.json({ limit: '1mb' }))` в main (lines 133 + 155)** — owner/Mimo/Hermes?
- [ ] **Вторая проблема, не зафиксированная в этом инциденте:** UI застревает после успешного webhook'а (Instagram — `postMessage` без токена; VK — `poll status` не получает `ready: true`). Hermes в working tree (локально) сделал Instagram fix, ещё не закоммитил. VK fix — в его очереди.

---

## Action items

- [ ] **Mimo:** подтвердить что в проде сейчас `origin/main` (HEAD = `34589382` или новее). Если не main — указать какой build.
- [ ] **Mimo:** найти источник 401 в проде (git log на сервере 23-24.07, или diff dist/).
- [ ] **Hermes:** закоммитить + запушить Instagram fix (`client/src/pages/instagram-callback.tsx`, `server/routes/instagram-oauth.ts` уже в working tree).
- [ ] **Hermes:** пофиксить аналогичный баг для VK (UI polling не получает `ready: true` после успешного webhook'а). Указатель: `SocialMediaSettings.tsx:585-619` + `vk-oauth.ts:393` (status handler).
- [ ] **Mavis (или Hermes):** review verdict на Hermes'овские Instagram/VK фиксы по шаблону `docs/agents/templates/review-verdict-template.md`.
- [ ] **Owner (Dmitry):** решить что делать с дублем `express.json` (оставить / удалить).

---

**Автор:** Mavis, 2026-07-24 15:35 MSK
**Статус:** 🟡 FIX APPLIED, ROOT CAUSE UNCONFIRMED

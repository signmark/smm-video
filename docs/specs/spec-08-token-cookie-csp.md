# Spec §8 — Refresh token в HttpOnly cookie + строгая CSP

**Effort:** high · **Исполнитель:** Hermes · **Ревью:** Mavis (архитектурное). Разбить на 3 подцикла — не делать одним PR!

## Цель

XSS больше не даёт долговременную сессию; CSP включена точечно.

## Факты

- `client/src/lib/api-client.ts:18` и `client/src/lib/api.ts:33` — `localStorage.getItem('auth_token')`; refresh token тоже в localStorage (найти все ключи: grep `localStorage` по client/).
- Сервер уже умеет cookie: `user-auth.ts:50` читает `req.cookies?.directus_session_token`.
- helmet в `server/index.ts` с отключёнными CSP-механизмами (`crossOriginEmbedderPolicy: false` и т.д.).
- Memory: «User token policy» — UI-операции только через user token; «Subscription enforcement» — identity через /users/me.

## Подцикл A — refresh token → HttpOnly cookie

1. Логин/refresh эндпоинты сервера: выставлять `Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth`.
2. Клиент: refresh-flow через `credentials: 'include'`; из localStorage refresh token удалить (ключ найти grep'ом). Access token — ТОЛЬКО в памяти (модуль-синглтон), при F5 — тихий refresh по cookie.
3. CSRF: для `/api/auth/refresh` (cookie-авторизованного) — double-submit token или проверка `Origin` header против allowlist. Выбор зафиксировать.

## Подцикл B — централизованный auth adapter на клиенте

1. Единый модуль `client/src/lib/auth-store.ts`: getToken/setToken/clear + подписка. Все прямые `localStorage.getItem('auth_token')` (найдено минимум в api-client.ts, api.ts — grep даст полный список) заменить на adapter.
2. tokenExpired-флоу (401 sessionExpired) не менять поведенчески — только источник токена.

## Подцикл C — CSP

1. helmet CSP: `default-src 'self'`; `connect-src 'self' https://directus.nplanner.ru <S3-домен> wss:`; `img-src 'self' data: https:` (S3/CDN картинки); `frame-ancestors 'none'`; report-only режим первые N дней (`Content-Security-Policy-Report-Only`) + endpoint `/api/csp-report` с логированием.
2. После недели report-only и разбора отчётов — enforce. Это ДВА деплоя, между ними Mavis собирает отчёты.

## Тесты

- A: refresh cookie выставляется с нужными флагами (supertest, inspect headers); refresh без cookie → 401; CSRF-негатив (чужой Origin → 403)
- B: grep-тест «нет прямых обращений к localStorage с auth-ключами вне auth-store» (простой unit, читающий исходники, — прецедент допустим)
- C: заголовок CSP присутствует в prod-режиме, отсутствует/report-only в dev

## Acceptance

- [ ] localStorage не содержит refresh token (проверка руками в браузере)
- [ ] Логин/логаут/истечение/refresh работают в dev и на стенде
- [ ] CSP report-only не генерирует нарушений на основных страницах до enforce
- [ ] Каждый подцикл — отдельный коммит + отдельное ревью Mavis

## Грабли

- Telegram Login / OAuth-редиректы: cookie SameSite=Lax может резать flow — прогнать VK/YouTube OAuth (есть мастера в client) на стенде.
- Vite dev proxy и cookie: в dev Secure-флаг мешает (http) — флаг ставить условно по NODE_ENV.
- CSP сломает inline-скрипты, если они есть в index.html — проверить первым делом.

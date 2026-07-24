# Spec §15 — Декомпозиция крупных модулей + bundle size

**Effort:** high (нарезано) · **Исполнитель:** Hermes · **Ревью:** Mavis · Последний в очереди — только после §7 (CI) и желательно §9 (типы)

## Цель

`server/index.ts`, `publish-scheduler.ts`, `autonomous-ai.ts`, social publishing — разделены по границам ответственности; фронтовые chunks < 500KB.

## Факты

- Chunks 762KB и 675KB (замер 2026-07-23, пересчитать: `NODE_OPTIONS=--max-old-space-size=1024 npx vite build` и посмотреть отчёт).
- `server/index.ts` — сотни строк: middleware, WS, upload (уже вынесен в §4 — паттерн!), health, robots/sitemap, статика.
- Memory «Video prompt engineering»: cross-cutting гайды — в generateScript() после выбора билдера; при нарезке autonomous-ai не сломать этот инвариант.

## Правила нарезки (важнее плана)

1. **Один PR = один вынос.** Никогда не «переразложил всё».
2. Вынос = перемещение кода БЕЗ изменения поведения. Рефакторинг логики — отдельным PR после.
3. После каждого выноса: полный vitest + build + (для client) ручной smoke страницы.
4. Порядок безопасности: сначала листовые куски (нет обратных зависимостей), потом ядро.

## Server-очередь (по одному PR)

1. index.ts: robots/sitemap → `server/routes/seo.ts`
2. index.ts: WS-блок → `server/ws-server.ts` (гейт §5 уже в utils)
3. index.ts: middleware-стек → `server/app-middleware.ts`
4. publish-scheduler: платформо-специфичные publish-функции → `server/services/publish/<platform>.ts` (по одной платформе на PR; Threads/VK/Telegram уже имеют направленные тесты)
5. autonomous-ai: выделить tool-регистрацию от цикла исполнения (тесты autonomous-ai-tools.test.ts — граница уже видна)

## Client-очередь

1. Замер: `npx vite build` → список chunks. Rollup visualizer (dev-dep) — одноразово, отчёт в handoff.
2. Lazy-load тяжёлых роутов: редактор видео, аналитика — `React.lazy` + Suspense на уровне роутера. По одному роуту на PR.
3. Смешанные static/dynamic imports (vite ругается в билд-логе) — устранить: одна модель импорта на модуль.
4. Bundle budget: `chunkSizeWarningLimit` не повышать; после лечения — зафиксировать фактический максимум как budget в CI (простая проверка размера файлов dist/ скриптом).

## Acceptance (каждый PR)

- [ ] `git diff` показывает перемещение, не переписывание (ревьюер сверяет)
- [ ] Полный vitest + build зелёные; для client — страница открывается на dev
- [ ] Размер главного chunk не вырос

## Грабли

- vite build без NODE_OPTIONS падает молча (memory!) — в скрипты package.json заложить флаг.
- Циклические импорты вскроются при нарезке server/index.ts — лечить введением `bootstrap.ts` (синергия §13), не re-export-хаками.

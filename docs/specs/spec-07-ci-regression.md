# Spec §7 — Security regression suite в CI

**Effort:** medium · **Исполнитель:** Hermes · **Приоритет:** первый (защищает все остальные фиксы)

## Цель

Каждый push/PR автоматически прогоняет security-тесты §1-§5 и полный vitest; секреты сканируются. Без этого фиксы регрессируют при следующем рефакторинге.

## Факты (проверено 2026-07-24)

- `.github/workflows/` **не существует** — CI нет вообще.
- Уже существуют security-тесты: `auth_flow.test.ts` (§1, system-token 404), `scheduler-admin-gate.test.ts` (§2), `upload-image-hardening.test.ts` (§4), `ws-gate.test.ts` (§5).
- Полный прогон: `npx vitest run` ~7 сек (86 файлов), `npx tsc -p tsconfig.critical.json` — exit 0.

## Шаги

1. Создать `.github/workflows/ci.yml`:
   - trigger: `push` (main) + `pull_request`
   - Node 20 (`.nvmrc`), `npm ci`
   - step «Security regression»: `npx vitest run server/__tests__/auth_flow.test.ts server/__tests__/scheduler-admin-gate.test.ts server/__tests__/upload-image-hardening.test.ts server/__tests__/ws-gate.test.ts`
   - step «Full tests»: `npx vitest run`
   - step «Critical type-check»: `npx tsc -p tsconfig.critical.json`
2. Создать `.github/workflows/secret-scan.yml`: gitleaks action (`gitleaks/gitleaks-action@v2`) на push/PR. **Важно:** `.env.example`-утечка уже в истории (§3 deferred) — добавить `.gitleaksignore` для известных исторических находок, иначе job вечно красный; новые находки должны падать.
3. В `AGENTS.md` «Полезные команды» добавить строку про CI; в session-checklist ничего менять не нужно.

## Тесты

Сам workflow — прогнать на ветке: сделать PR с намеренно сломанным security-тестом → CI красный; починить → зелёный.

## Acceptance

- [ ] PR со сломанным `scheduler-admin-gate.test.ts` блокируется CI
- [ ] Обычный push в main запускает оба workflow, оба зелёные
- [ ] gitleaks не красный на текущей истории (ignore-файл), но ловит новый подложенный секрет в PR
- [ ] Время CI < 10 минут

## Грабли

- vitest использует rolldown-биндинги — на ubuntu-runner ставится своя нативная сборка через `npm ci`, НЕ копировать node_modules.
- `npm ci` требует консистентный `package-lock.json` — если падает, лечить lockfile, не заменять на `npm install` (см. spec-11).

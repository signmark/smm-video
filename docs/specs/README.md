# docs/specs — implementation-спеки для исполнителей

**Создано:** 2026-07-24 (Claude). Назначение: перенести проектировочную («умную») часть работы в готовые спеки, чтобы исполнитель любой силы мог закрыть пункт беклога без самостоятельной декомпозиции.

## Правила использования (для Hermes / Mavis / Mimo)

1. Спека — источник истины по scope. Что не в спеке — отдельный follow-up, не «заодно».
2. Перед стартом сверить упомянутые файлы/строки с текущим кодом (`git log` мог уйти вперёд); расхождение — отметить в handoff, не молчать.
3. Каждая спека = один цикл канонического ревью (AGENTS.md). Секция «Acceptance» — это чек-лист ревьюера.
4. Порядок: §7 → §6 → §11 → §10 → §8 → §9 → §12 → §13 → §14 → §15 (§7 первым: CI-сетка защищает всё остальное).

## Индекс

| Спека | Пункт плана | Effort | Статус |
|---|---|---|---|
| `spec-07-ci-regression.md` | §7 CI security regression suite | medium | ready |
| `spec-06-fail-closed.md` | §6 fail-closed mutations | medium | ready |
| `spec-11-docker-build.md` | §11 reproducible Docker build | low | ready |
| `spec-10-health-logging.md` | §10 liveness/readiness + redacted logging | medium | ready |
| `spec-08-token-cookie-csp.md` | §8 refresh token cookie + CSP | high | ready |
| `spec-09-tsc-gate.md` | §9 TypeScript deploy gate | high | ready |
| `spec-12-durable-claim.md` | §12 durable claim + idempotency | high | ready |
| `spec-13-process-split.md` | §13 web/worker/bot split | high | ready, после §12 |
| `spec-14-unified-auth.md` | §14 unified identity/auth | high | ready |
| `spec-15-decomposition.md` | §15 модули + bundle size | high | ready |

Закрытые пункты: §1 (`1473f4bf`), §2 (`e102578d`), §4/§5-low (`34a8ebf4`). §3 — deferred до августа, НЕ ТРОГАТЬ.

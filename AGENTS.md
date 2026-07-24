# smm-video — project memory for AI agents

**Снимок:** 2026-07-24
**Для кого:** любая модель (Codex / Claude / Kimi / Mimo / Mavis), открывшая проект впервые или после паузы.

---

## Что это

SMM Manager — автоматизация публикации и аналитики в соцсетях (Telegram, VK, Instagram, Facebook, YouTube, TikTok, Threads). Серверный Node.js + TypeScript, Directus как CMS, React-фронтенд. Главный бизнес-цикл: **контент → расписание → публикация в N платформ → аналитика → следующий контент**.

## Стек

- Node.js 20+, TypeScript 5, ESM
- Express (HTTP) + Directus (CMS) + PostgreSQL
- React 18 + TanStack Query + Vite
- Vitest, Playwright (smoke)
- Telegram Bot API, VK API, Instagram Graph API, YouTube Data API, FAL AI (image gen), Vertex AI
- Replit → Codex → Claude → Mimo → Mavis (я) — пять разных моделей на проекте с начала

## Текущее состояние

- **Repo:** `G:\Projects\smm-video`, ветка `main`
- **Свежие коммиты:** `dd37dda` (docs followups, security backlog snapshot), `1473f4bf` (fix auth, remove public /api/auth/system-token — **§1 DONE**), `c0ff1d4`/`1a010a94` (Agent OS — AGENTS.md, captain's log), `fde12ed` (chore security, untrack `.env.example`)
- **Working tree:** clean для моих файлов. `?? docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md`, `?? project_snapshot.txt`, `?? webbridge-req-kb*.json`, `?? zoo_analysis.md` — **не мои**, не трогаю.
- **Tests:** 69/69 файлов, ~717 тестов зелёных (см. `docs/session-2026-07-20.md`, актуальный счёт — последний замер был 717, обновлять после security-фиксов).
- **Production:** под управлением Mimo (следующий день после пуша).
- **Текущий приоритетный план:** `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` — 15 пунктов, security-first (incident wave: 1-5, защитный контур: 6-8, engineering gates: 9-11, масштабирование: 12-14, performance: 15). **Снимок прогресса на 2026-07-24:** `docs/followups/2026-07-24-security-backlog.md` (§1 closed, §3 deferred, §2/§4-§15 open). **Это НЕ моя (Mavis) зона** — я не лезу в `server/api/`, `server/__tests__/`, `client/`, `shared/`. Только `docs/`, `AGENTS.md`, коммиты готового WIP, мониторинг.

## Канонический цикл multi-model review

Зафиксирован по результатам 2026-07-22 (`claude-ui-pretester-review-2026-07-22.md` + `codex-ui-pretester-integration-2026-07-22.md`). **Этот цикл — канон, любое отклонение требует явного комментария в handoff:**

1. **Исполнитель** (Codex / Claude / Kimi) готовит результат: код + тесты + `docs/prompts/<имя>-<задача>-<дата>.md` handoff.
2. **Автоматические тесты** — `npx vitest run` (cross-verify, не верь чужому «зелёное»).
3. **Независимый ревьюер** (Claude / Kimi — отдельная модель от исполнителя) даёт verdict в `docs/prompts/<имя>-<verdict>-<дата>.md`. Если критично — блокирующий. Если minor — отдельным follow-up.
4. **Исполнитель** исправляет подтверждённые замечания. Каждый блокер / P1 = отдельный коммит. Минорные followups = 1-2 `chore(ui)` коммита.
5. **Owner (Dmitry)** — gate: решает «фиксим / не фиксим / пушим». Единственная точка решения о merge в main. **Push в `origin/main` — за владельцем**, если в `docs/prompts/*` явно не зафиксировано делегирование (на 2026-07-20 было зафиксировано: «Mavis пушит если в доках указано»).
6. **Codex** — merge в main + регрессия на main + Playwright-смоки на живом стенде.
7. **Mimo** — деплоит в production на следующий день. Владелец делает smoke в prod.

**Single-writer (правило):** для одного участка кода или документа одновременно существует один ответственный исполнитель. Остальные могут ревьюить, но не конкурировать за запись.

## Зоны ответственности (2026-07-23)

| Агент | Зона |
|---|---|
| Codex | server/, client/, shared/, **включая security-фиксы из plan** (пункты 1-8) |
| Claude | архитектурное ревью, UI pre-tester review (как вторая пара глаз) |
| Kimi | аналитический review, конвергенция платформ, fallback executor |
| Mimo | production deploy (на следующий день после push) |
| Mavis (я) | docs/, AGENTS.md, мониторинг, ревью handoff'ов от ревьюеров, cross-verify, **коммиты готового WIP** после cross-verify, captain's log, follow-ups. **НЕ пишет прод-код в server/client/shared.** Push — только если явно делегировано в `docs/prompts/*`. |

## Анти-форензик правила (для sheet-операций)

Зафиксировано в `docs/tester-bugs/README.md`. Дублирую здесь, потому что они критичны:
- **Column A НИКОГДА не красить** — это ID-колонка, AI-паттерн был бы теллей.
- Канонические цвета: Next = R142-G124-B195 purple, Тестировщик = R0-G255-B0 green, WIP = белый.
- «N» в контексте багов = bug_id (например «29» = BUG-029), не sheet row. Сверяться с `docs/tester-bugs/state.json` перед действием.

## Push policy (текущее состояние)

- **Делегирование Mavis'у зафиксировано 2026-07-20** в `docs/prompts/kimi-push-manifest-2026-07-20.md` п.4: «Пуш делает Mavis (делегировано владельцем 2026-07-20)».
- Это **доковая фиксация**, не «общая политика». Перед push всё равно проверить: (1) owner не отозвал; (2) cycle не security-critical (system-token / credentials rotation — пушит только владелец); (3) `git status --short` чист от чужого WIP.
- **docs-only коммиты** — push по умолчанию разрешён (low risk, откатываемо).

## Open questions / known issues

- **Security incident partial closure** (см. `docs/followups/2026-07-24-security-backlog.md`): §1 (public Directus admin token) **CLOSED** в `1473f4bf`. §3 (credentials rotation) **DEFERRED** до августа 2026 owner'ом. Остальное (scheduler, upload, WS, fail-closed, CSP, tsc, etc.) — см. беклог.
- **Captain's Log отсутствует** (до 2026-07-23). Создан в этом цикле (`docs/captains-log/`).
- **Context Engine в zookeeper есть, в smm-video — нет** (до этого цикла). Создан в этом цикле (`docs/context/state.json`).
- **AGENTS.md** — этот файл. Создан 2026-07-23.

## Полезные команды

```powershell
# === Repo ===
cd "G:\Projects\smm-video"
git log --oneline -5
git status --short
npx vitest run                       # 69/69 файлов, ~717 тестов
npm run build

# === Sheet operations (Python с Service Account) ===
# python -c "from google.oauth2 import service_account; ..."

# === Sheet operations (read-only) ===
# curl с API key в query string
```

## Как обновлять этот файл

- При новом коммите в `main` → дополнить «Свежие коммиты».
- При смене push-policy → обновить «Push policy» + создать `docs/prompts/*-push-manifest-*.md` (по конвенции 2026-07-20).
- При изменении зон ответственности → обновить таблицу.
- При добавлении канонической практики → дополнить «Канонический цикл».
- Стиль: кратко, только то, что НЕ выведешь из `git log` или `pm2 ls`. Снимок состояния, не changelog.

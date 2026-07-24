# smm-video — project memory for AI agents

**Снимок:** 2026-07-24 (v2 — смена состава)
**Для кого:** любая модель, открывшая проект впервые или после паузы.
**Активный состав (с 2026-07-24):** Гермес (Hermes), Мавис (Mavis/MiniMax), Мимо (Mimo). Codex, Claude и Kimi выбыли из доступа owner'а. Персональные инструкции — в `docs/agents/<имя>.md`. **Каждый агент обязан прочитать свой профиль перед первой задачей сессии.** Ориентация в коде — `docs/agents/codebase-map.md` (топология, слои роутов, поток публикации, метод диагностики).

---

## Что это

SMM Manager — автоматизация публикации и аналитики в соцсетях (Telegram, VK, Instagram, Facebook, YouTube, TikTok, Threads). Серверный Node.js + TypeScript, Directus как CMS, React-фронтенд. Главный бизнес-цикл: **контент → расписание → публикация в N платформ → аналитика → следующий контент**.

## Стек

- Node.js 20+, TypeScript 5, ESM
- Express (HTTP) + Directus (CMS) + PostgreSQL
- React 18 + TanStack Query + Vite
- Vitest, Playwright (smoke)
- Telegram Bot API, VK API, Instagram Graph API, YouTube Data API, FAL AI (image gen), Vertex AI
- Replit → Codex → Claude → Mimo → Mavis → (2026-07-24) состав сокращён до тройки: Hermes / Mavis / Mimo

## Текущее состояние

- **Repo:** `G:\Projects\smm-video`, ветка `main`
- **Свежие коммиты (2026-07-24):** `33b258c6` (fix vk: блок «Группа для публикации»), `89be723f` (fix fb: подключение через IG-токен из базы), `05eb8aef`/`15b649d8` (**соцсети без токенов в браузере**, задеплоено на prod — контракт: `.agents/memory/oauth-sanitizer-contract.md`), `f217c01c` (спеки §6-§15), `34a8ebf4`/`e102578d` (**§2, §4, §5-low DONE**), `1473f4bf` (**§1 DONE** — remove public /api/auth/system-token)
- **Working tree:** clean для моих файлов. `?? docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md`, `?? project_snapshot.txt`, `?? webbridge-req-kb*.json`, `?? zoo_analysis.md` — **не мои**, не трогаю.
- **Tests:** 69/69 файлов, ~717 тестов зелёных (см. `docs/session-2026-07-20.md`, актуальный счёт — последний замер был 717, обновлять после security-фиксов).
- **Production:** под управлением Mimo (следующий день после пуша).
- **Текущий приоритетный план:** `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` — 15 пунктов, security-first (incident wave: 1-5, защитный контур: 6-8, engineering gates: 9-11, масштабирование: 12-14, performance: 15). **Снимок прогресса на 2026-07-24:** `docs/followups/2026-07-24-security-backlog.md` (§1 closed, §3 deferred, §2/§4-§15 open). **Это НЕ моя (Mavis) зона** — я не лезу в `server/api/`, `server/__tests__/`, `client/`, `shared/`. Только `docs/`, `AGENTS.md`, коммиты готового WIP, мониторинг.

## Канонический цикл multi-model review

Цикл 2026-07-22 (Codex/Claude/Kimi) адаптирован 2026-07-24 под тройку по поручению owner'а (см. `docs/prompts/claude-roster-handoff-2026-07-24.md`). **Этот цикл — канон, любое отклонение требует явного комментария в handoff:**

1. **Исполнитель — Hermes** готовит результат: код + тесты + `docs/prompts/hermes-<задача>-<дата>.md` handoff (шаблон: `docs/agents/templates/handoff-template.md`). Перед началом и перед сдачей проходит `docs/agents/templates/session-checklist.md` — это обязательная часть Definition of Done, не рекомендация.
2. **Автоматические тесты** — `npx vitest run` (cross-verify, не верь чужому «зелёное»).
3. **Независимый ревьюер — Mavis** даёт verdict в `docs/prompts/mavis-<verdict>-<дата>.md` по шаблону `docs/agents/templates/review-verdict-template.md`, с собственным прогоном тестов. Если критично — блокирующий. Если minor — отдельным follow-up. Для изменений в Docker / CI / deploy-скриптах вторым ревьюером подключается **Mimo**.
4. **Исполнитель** исправляет подтверждённые замечания. Каждый блокер / P1 = отдельный коммит. Минорные followups = 1-2 `chore` коммита.
5. **Owner (Dmitry)** — gate: решает «фиксим / не фиксим / пушим». Единственная точка решения о merge в main. **Push в `origin/main` — за владельцем**, если в `docs/prompts/*` явно не зафиксировано делегирование.
6. **Hermes** — merge в main + регрессия на main + Playwright-смоки на живом стенде (ex-зона Codex).
7. **Mimo** — деплоит в production на следующий день (`.mimocode/skills/commit-and-rebuild`). Владелец делает smoke в prod.

**Ротация при недоступности:** если Hermes недоступен, исполнителем становится Mavis (запрет на прод-код снят условно, см. `docs/agents/mavis.md`), ревьюером — Mimo. Правило неизменно: **исполнитель ≠ ревьюер, всегда две разные модели.**

**Single-writer (правило):** для одного участка кода или документа одновременно существует один ответственный исполнитель. Остальные могут ревьюить, но не конкурировать за запись.

## Зоны ответственности (2026-07-24)

| Агент | Зона |
|---|---|
| Hermes | **исполнитель**: server/, client/, shared/, security-план (§2, §4-§15), merge в main, регрессия, Playwright-смоки. SSH к prod — только read-only диагностика; деплой остаётся за Mimo. Профиль: `docs/agents/hermes.md` |
| Mavis | **независимый ревьюер** (ex-зона Claude/Kimi) + docs/, AGENTS.md, мониторинг, cross-verify, коммиты готового WIP, captain's log, follow-ups, context engine. Fallback-исполнитель при недоступности Hermes. Push — только если явно делегировано в `docs/prompts/*`. Профиль: `docs/agents/mavis.md` |
| Mimo | **production deploy** (следующий день после push) + второй ревьюер для Docker/CI/deploy-изменений + prod-мониторинг после деплоя. Профиль: `docs/agents/mimo.md` |

| Выбывшие (2026-07-24) | Бывшая зона → кому перешла |
|---|---|
| Codex | исполнитель, merge, смоки → **Hermes** |
| Claude | архитектурное ревью, UI pre-tester → **Mavis** (по чек-листу `review-verdict-template.md`) |
| Kimi | аналитический review, fallback executor → **Mavis** (review), ротация исполнителя — см. выше |

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
- **AGENTS.md** — этот файл. Создан 2026-07-23, v2 (смена состава) — 2026-07-24.
- **Смена состава 2026-07-24:** Codex/Claude/Kimi недоступны. Роли перераспределены (см. таблицу зон), персональные инструкции в `docs/agents/`, процесс-компенсация слабостей моделей — в `docs/agents/templates/`. Handoff: `docs/prompts/claude-roster-handoff-2026-07-24.md`.

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

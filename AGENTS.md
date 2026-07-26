# smm-video — project memory for AI agents

**Снимок:** 2026-07-26 (v4 — состав приведён в соответствие с реальностью)
**Для кого:** любая модель, открывшая проект впервые или после паузы.

**Активный состав (с 2026-07-26, v4) — двое:**

- **Claude** — пишет код **и сам его деплоит**. Полный цикл: правка → тесты → коммит → push в `origin/main` → пересборка образа → выкатка на прод → проверки на живом.
- **Codex** — ревью.

**Hermes, Mavis, Mimo и Kimi во флоу не участвуют.** До v4 этот файл описывал состав из четырёх агентов с распределением «исполнитель Hermes, ревьюер Mavis, деплой Mimo». Такого состава нет и не было в работе: 2026-07-26 владелец поправил дважды за одну сессию — «Никого Мависа во флоу пока нет, ты пока работаешь один, а Кодекс только ревьюит», «код ты пишешь ты и деплоишь». До этой правки готовый проверенный фикс был отложен «на вердикт Mavis», то есть в никуда. **Не адресуй задачи и вердикты этим именам.** Файлы `docs/agents/hermes.md`, `mavis.md`, `mimo.md` сохранены как исторические.

Ориентация в коде — `docs/agents/codebase-map.md` (топология, слои роутов, поток публикации, метод диагностики). Деплой — `docs/DEPLOYMENT.md`.

---

## Что это

SMM Manager — автоматизация публикации и аналитики в соцсетях (Telegram, VK, Instagram, Facebook, YouTube, TikTok, Threads). Серверный Node.js + TypeScript, Directus как CMS, React-фронтенд. Главный бизнес-цикл: **контент → расписание → публикация в N платформ → аналитика → следующий контент**.

## Стек

- Node.js 20+, TypeScript 5, ESM
- Express (HTTP) + Directus (CMS) + PostgreSQL
- React 18 + TanStack Query + Vite
- Vitest, Playwright (smoke)
- Telegram Bot API, VK API, Instagram Graph API, YouTube Data API, FAL AI (image gen), Vertex AI
- Replit → Codex → Claude → Mimo → Mavis → (2026-07-26) состав сокращён до двоих: Claude (код + деплой) / Codex (ревью)

## Текущее состояние

- **Repo:** `/root/smm` на прод-хосте, ветка `main`. Он же build context для контейнера `smm`.
- **Свежие коммиты (2026-07-26):** `1e1bdf60` (панель публикации не врёт про неподключённые платформы — правила в `client/src/lib/platform-connection.ts`), `78603a70` (**публикация ходит сервисным токеном во всех путях** — `server/services/publishing-token.ts`), `4229b1cd` (инвалидация кеша контента после любого изменения состояния), `cb43908e9` (состояние «токен сохранён» в настройках Telegram), `21ff4590` (тестовое окружение `.env.test`, вычистка записи токенов на диск, разбор параллельных deploy-путей + `docs/DEPLOYMENT.md`).
- **Working tree:** в нём постоянно висит чужой WIP — `.mimocode/.cron-lock` (живой lock крона) и `.mimocode/plans/*`. Не трогать, не коммитить. Из-за него `git pull` падает (`pull.rebase=true`) — обновляться через `git merge --ff-only origin/main`.
- **Tests:** 93/93 файлов, 1001/1001 тестов зелёных (замер 2026-07-26). Окружение тестов — фиктивный `server/__tests__/.env.test`, реальный `.env` в корне репозитория не нужен и не должен появляться.
- **Production:** деплоит Claude, сразу после пуша. Команды — `docs/DEPLOYMENT.md`. Окружение контейнера приходит только из `/root/.env` через `env_file` в `/root/docker-compose.yml`.
- **Текущий приоритетный план:** `docs/PRIORITIZED_IMPROVEMENT_PLAN_2026-07-23.md` — 15 пунктов, security-first. **Снимок прогресса:** `docs/followups/2026-07-24-security-backlog.md` (§1 closed, §3 deferred, §2/§4-§15 open).
- **Известные долги:** семь прямых запросов к `items/user_campaigns` в `publish-scheduler.ts` не переведены на `campaign-token-resolver` (токен теперь единый, но дублирование осталось); `connectedPlatforms` в `EditScheduledPublication.tsx` захардкожен как «все подключены».

## Рабочий цикл (v4)

1. **Claude** делает правку: код + тесты. Для многофайловых и security-критичных задач — сначала `docs/prompts/claude-<задача>-<дата>.md` (шаблон: `docs/agents/templates/handoff-template.md`), потом код.
2. **Проверки перед пушем, все три:** `npx vitest run`, `npm run check` (tsc), `npm run build`. Для правок в `client/` фронт-билд обязателен — `tsconfig.critical.json` клиент не покрывает.
3. **Новый тест должен краснеть без фикса.** Проверять снятием правки (`git stash push -- <файл>`), а не на глаз. Без этого тест ничего не стережёт.
4. **Claude** коммитит, пушит в `origin/main`, пересобирает образ и выкатывает на прод — см. `docs/DEPLOYMENT.md`.
5. **Проверки после выкатки:** контейнер поднялся, Directus health, публичный URL отдаёт 200, и грепом по бандлу — что новый код реально уехал, а не остался в кеше слоёв. Кириллицу грепать бесполезно: esbuild экранирует не-ASCII в `\uXXXX`, ищи ASCII-маркеры.
6. **Codex** — ревью, по желанию владельца. Вердикт не блокирует выкатку: откат делается `git revert` + пересборка.
7. **Owner (Dmitry)** — приоритеты и решения по спорным местам. Деплой руками у него не запрашивается: это зона Claude.

**Single-writer (правило):** для одного участка кода или документа одновременно существует один ответственный исполнитель. Остальные могут ревьюить, но не конкурировать за запись.

## Зоны ответственности (2026-07-26, v4)

| Агент | Зона |
|---|---|
| **Claude** | Всё: `server/`, `client/`, `shared/`, тесты, docs, merge в `main`, push, production deploy, проверки на живом проде. Профиль: `docs/agents/claude.md` |
| **Codex** | Ревью. |

**Исторические профили** (`docs/agents/hermes.md`, `mavis.md`, `mimo.md`) оставлены как артефакты — распределения ролей из них не действуют.

## Анти-форензик правила (для sheet-операций)

Зафиксировано в `docs/tester-bugs/README.md`. Дублирую здесь, потому что они критичны:
- **Column A НИКОГДА не красить** — это ID-колонка, AI-паттерн был бы теллей.
- Канонические цвета: Next = R142-G124-B195 purple, Тестировщик = R0-G255-B0 green, WIP = белый.
- «N» в контексте багов = bug_id (например «29» = BUG-029), не sheet row. Сверяться с `docs/tester-bugs/state.json` перед действием.

## Push policy (текущее состояние)

- **Push в `origin/main` и деплой на прод — зона Claude** (владелец 2026-07-26: «код ты пишешь ты и деплоишь»). Разрешения на каждый заход спрашивать не нужно.
- Перед push всё равно проверить: (1) все три проверки зелёные — vitest, tsc, build; (2) `git status --short` чист от чужого WIP в `.mimocode/`; (3) не коммитить незакоммиченное чужое — docker собирает из рабочего дерева, а не из HEAD, поэтому в образ уедет всё, что лежит в нём.
- Отдельно: **ротация утёкших кредов** (§3 беклога) — по-прежнему решение владельца, самому не инициировать.

## Open questions / known issues

- **Security incident partial closure** (см. `docs/followups/2026-07-24-security-backlog.md`): §1 (public Directus admin token) **CLOSED** в `1473f4bf`. §3 (credentials rotation) **DEFERRED** до августа 2026 owner'ом. Остальное (scheduler, upload, WS, fail-closed, CSP, tsc, etc.) — см. беклог.
- **Captain's Log отсутствует** (до 2026-07-23). Создан в этом цикле (`docs/captains-log/`).
- **Context Engine в zookeeper есть, в smm-video — нет** (до этого цикла). Создан в этом цикле (`docs/context/state.json`).
- **AGENTS.md** — этот файл. Создан 2026-07-23; v2 и v3 (2026-07-24) описывали состав Hermes/Mavis/Mimo/Claude; v4 (2026-07-26) приведён в соответствие с реальным составом из двоих.
- **Урок v4:** описанный в этом файле состав год расходился с фактическим и активно вредил — по нему планировалась работа и откладывались готовые фиксы «на вердикт» несуществующему агенту. Если состав снова изменится, правь **здесь в тот же день**, иначе следующая сессия будет работать по вымыслу.
- **Контракт OAuth-санитайзера** (`.agents/memory/oauth-sanitizer-contract.md`) ломали **трижды**. Любую новую проверку «платформа подключена» писать только в `client/src/lib/platform-connection.ts`.

## Полезные команды

```bash
# === Repo (прод-хост) ===
cd /root/smm
git merge --ff-only origin/main      # не git pull: падает на чужом WIP в .mimocode/
git status --short

# === Проверки перед пушем — все три ===
npx vitest run                       # 93/93 файлов, 1001/1001 тестов
npm run check                        # tsc -p tsconfig.critical.json (клиент НЕ покрывает)
npm run build                        # обязателен, если менялся client/

# === Деплой === (подробности — docs/DEPLOYMENT.md)
docker compose -f /root/docker-compose.yml build smm
docker compose -f /root/docker-compose.yml up -d smm
docker logs smm --since 3m | grep -E "SERVER SUCCESSFULLY|Directus Health"
curl -s -o /dev/null -w "%{http_code}\n" https://smm.omemo.tech/
```

## Как обновлять этот файл

- При смене состава или ролей → править **в тот же день**, см. «Урок v4».
- При новом деплое → дополнить «Свежие коммиты».
- При изменении push-policy или процедуры деплоя → обновить соответствующий раздел (команды деплоя — канон в `docs/DEPLOYMENT.md`, здесь только выжимка).
- Стиль: кратко, только то, что НЕ выведешь из `git log`. Снимок состояния, не changelog.

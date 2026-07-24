# Commit Message Convention — smm-video

**Зачем:** чтобы по `git log --oneline` сразу видеть **что** сделано (не «поправил баги»), а по `git log --format=%h %s%n%b` — **почему** и **какие именно изменения**. Сейчас в репе стиль плавает, единого стандарта нет; цель — короткий, проверяемый гайд.

**Создано:** 2026-07-24 (Mavis, по итогам разбора подхода Claude — см. `docs/agents/claude-approach-analysis-2026-07-24.md` §5).

---

## Структура

### Subject (1 строка, ≤ 72 символов)

Формат: `<тип>(<скоуп>): <результат>`, где:

- **тип** — из списка ниже
- **скоуп** — короткий (файл, подсистема, домен)
- **результат** — **что стало**, не «что делал» и не «поправил»

**Примеры правильно:**
- `fix(vk): load groups server-side, stop leaking token to browser` ✅ (результат: groups теперь server-side, token не утекает)
- `feat(ui): add QueryErrorState and classifier for campaign-scoped queries` ✅
- `chore(security): untrack .env.example from repo` ✅

**Примеры неправильно:**
- `fix bug` ❌ (тип есть, нет скоупа, нет результата)
- `обновил код` ❌ (не результат)
- `fix some stuff in server/api` ❌ (не результат, не конкретно)

### Body (опционально, но обязательно для fix/chore/refactor)

Формат свободный, но **минимум один** из этих элементов:

1. **Почему** — ссылка на контекст инцидента / нарушенный контракт. Начинается с «Причина», «Флоу», «Контекст», или просто ссылки на `MEMORY.md`/issue.
2. **Что** — пункты с дефисами, по одному изменению в пункте. Имена методов/полей/файлов — конкретные.
3. **Bonus-fix** — если попутно починил что-то, **не прятать** в пунктах, упомянуть явно: «чинит старый баг, из-за которого...». Иначе в ретроспективе будет surprise.
4. **Связь с планом** — `§N` из `docs/PRIORITIZED_IMPROVEMENT_PLAN_*.md` или ссылка на issue/PR.

### Trailer (опционально, для co-author)

Если в коммите участвовал другой агент:
```
Co-Authored-By: <Имя> <<email>>
```

Формат **строго** такой, без вариаций. Это нужно для attribution-аналитики (`git log --format=%b | grep Co-Authored-By`).

---

## Типы

| Тип | Когда | Примеры |
|---|---|---|
| `feat` | новая функциональность | `feat(ui): add error/empty state classifier` |
| `fix` | баг-фикс или security-фикс | `fix(auth): use configured flag instead of token reading` |
| `chore` | рутина (deps, конфиг, untrack, rebase) | `chore(security): untrack .env.example` |
| `refactor` | переписывание без изменения поведения | `refactor(services): extract campaign-token-resolver` |
| `docs` | только документация | `docs(agents): Claude Fable 5 в приоритете, v3` |
| `test` | только тесты | `test(auth): add regression for 403 → unavailable` |
| `perf` | оптимизация | `perf(bundle): lazy-load video editor route` |
| `revert` | откат | `revert: "fix(auth): replace token reading with configured flag"` |

---

## Скоупы (общепринятые)

- `auth` — auth-flow, токены, сессии
- `social` — соцсети (VK, IG, FB, Telegram, YouTube, Threads, TikTok)
- `analytics` — аналитика, метрики, дашборды
- `ui` — общие UI компоненты
- `content` — контент-менеджмент
- `publish` — публикация, scheduler
- `security` — security-фиксы, middleware, gates
- `routes` — общая маршрутизация
- `agents` — `docs/agents/`, `AGENTS.md`, профили
- `prompts` — `docs/prompts/`, handoff'и
- `specs` — `docs/specs/`
- `build` — `package.json`, `tsconfig`, build-конфиг
- `docker` — Dockerfile, docker-compose
- `ci` — `.github/workflows`, `scripts/`

---

## Что НЕ делать

1. **Не смешивать типы.** Если это `fix` И попутно `refactor` — это **два коммита**, не один. Прецедент: владелец уже ловил "фикс + переименование" в одном коммите, потеряли bisect.
2. **Не писать process в subject** ("поправил", "обновил", "изменил", "сделал"). Subject = результат, не действие.
3. **Не прятать bonus-fix** в пунктах body. Если попутно починил старый баг — отдельный пункт или абзац с явным указанием.
4. **Не использовать emoji** в subject. В body — можно, если проектная конвенция (сейчас не используется).
5. **Не ставить co-author trailer без явного вклада** второй стороны. Иначе attribution-аналитика ломается.
6. **Не превышать 72 символа** в subject. Если не влезает — скорее всего, subject пытается быть body, разделить.

---

## Шаблон для копирования

```text
<тип>(<скоуп>): <результат в одно предложение>

<опционально: контекст / причина / ссылка на инцидент>

- <изменение 1: файл/метод/поле>
- <изменение 2>
- <изменение 3>

<опционально: bonus-fix явно>
<опционально: §N из плана или issue>

<опционально: trailers>
Co-Authored-By: <Имя> <<email>>
```

---

## Cross-reference

- Шаблон handoff: `docs/agents/templates/handoff-template.md`
- Шаблон verdict: `docs/agents/templates/review-verdict-template.md`
- Анализ подхода Claude: `docs/agents/claude-approach-analysis-2026-07-24.md` §5
- Анти-паттерны: `AGENTS.md` «Канонический цикл multi-model review» (1 commit = 1 logical change)
- Co-Authored-By lesson (Mavis memory): «trailer'ы не видны в `git log --oneline`, смотреть через `git log --format=%b`»

# Task 10 — детальная проверка dead-code кандидатов (Kimi, 2026-07-21)

Источник задачи: `docs/session-2026-07-20.md:61`, `docs/prompts/README.md:126-129`.
Метод: исчерпывающий статический анализ на HEAD `9e14d2b` — импорты (статические/динамические), строковые ссылки, DI/реестры, тесты, скрипты, конфиги, git-история.

## Вердикты

| Кандидат | Вердикт | Действие |
|---|---|---|
| `server/services/social/telegram-proxy-service.ts` (613 строк) | ✅ **DEAD, доказуемо** | Удалять можно. Нужен отдельный промпт на удаление (по плану — после подтверждения владельцем) |
| `server/services/social-platforms/base-service.ts` (27 строк) | ❌ **НЕ МЁРТВЫЙ** | **Снять из Task 10.** Исправить `docs/platform-convergence-table.md:20` — утверждение «импортёров: НИКТО» фактически неверно |

---

## 1. `social/telegram-proxy-service.ts` — DEAD ✅

**Что делает:** класс `TelegramProxyService` + singleton `telegramProxyService` — публикация в Telegram с проксированием медиа из Beget S3 через `mediaProxyService.proxyMedia()` и отправкой multipart FormData в Bot API.

**Доказательства мёртвости:**

1. **Ноль импортов.** Глобальный grep по `telegram-proxy`, `TelegramProxyService`, `telegramProxyService`, именам всех публичных методов — совпадения только внутри самого файла и в docs. Фасад `server/services/social/index.ts` (прочитан целиком) его не импортирует; `social-publishing.ts:9` использует обычный `TelegramService`.
2. **Физически незагружаем.** Строка 11 импортирует типы из `'../../../shared/types'` — этого модуля **не существует** (в `shared/` нет `types.ts`; живые соседи берут типы из `@shared/schema`). Любая попытка загрузки упала бы на резолве.
3. **Не вызывался никогда.** Git-история — единственный коммит `9e94b4f` (Initial commit); `git grep` по дереву initial commit: ссылки только внутри самого файла. Коммита, «убравшего вызовы», не существует — их не было.
4. **Нет динамической загрузки.** `readdirSync`-загрузчиков сервисов нет, DI-контейнеров/реестров/фабрик по строковым ключам не обнаружено, алиасы tsconfig (`@/*`, `@shared/*`) к нему не ведут.
5. **Чисто вне кода.** `package.json`, `deploy/` (5 Dockerfile, 4 compose), `n8n-workflows/`, `scripts/`, `test_scripts/`, `custom_modules/`, `video-app/`, `client/`, `.env.example/.sample` — 0 совпадений. Docs упоминают его только как dead-code кандидата.
6. **Функциональность поглощена.** Живой путь Telegram-публикации: `social/index.ts:143-145` → `telegramService.publishToPlatform` → `telegram-s3-integration.ts` (та же задача «Telegram + Beget S3», docstring строки 1–2). В `telegram-service.ts` нет ни одного упоминания `proxy`.

**Сопутствующие правки при удалении:**
- `server/__tests__/social-facade-imports.test.ts:21` — убрать запись из `KNOWN_DEAD` (тест не сломается и без этого, но для консистентности).
- **Каскадный кандидат:** `server/services/media-proxy-service.ts` (экспорт `mediaProxyService`) используется ТОЛЬКО telegram-proxy-service.ts — после удаления становится следующим кандидатом Task 10, проверить отдельно.
- Обновить статус в `docs/platform-convergence-table.md` и `docs/session-2026-07-20.md`.
- Бонус: `tsc -p tsconfig.json` сейчас флагает его битый импорт — удаление улучшит type-check. Runtime (tsx) и bundle (esbuild) файла не достигают.

## 2. `social-platforms/base-service.ts` — НЕ МЁРТВЫЙ ❌

**Что экспортирует:** интерфейс `TokenValidationResult` (`:3-8`) и абстрактный класс `BaseSocialService` (`:10-27`) — минимальный контракт новой иерархии.

**Живые потребители (6 модулей):**

| Файл | Строка | Использование |
|---|---|---|
| `social-platforms/youtube-service.ts` | `:3` | `class YouTubeService extends BaseSocialService` (`:5`) |
| `social-platforms/tiktok-service.ts` | `:11` | `class TikTokService extends BaseSocialService` (`:57`) |
| `social-platforms/vk-clips-service.ts` | `:12` | `class VKClipsService extends BaseSocialService` (`:43`) |
| `social-platforms/vk-stories-service.ts` | `:12` | тип `TokenValidationResult` в `validateToken` (`:50`) |
| `social-platforms/instagram-reels-service.ts` | `:10` | тип в `validateToken` (`:40`) |
| `social-platforms/facebook-service.ts` | `:9` | тип в `validateToken` (`:23`) |

Наследники живы и уходят в продакшн: `status-validator.ts:2-7`, `clips-publishing-router.ts:12-13`, `social-publishing-router.ts:15`, `facebook-webhook-unified.ts:9`, `routes/stories.ts:6-8`, `social/index.ts:6`, плюс 7+ тестовых файлов.

**Про тест:** `server/__tests__/base-social-service.test.ts:2` импортирует `../services/social/base-service` — это ДРУГОЙ файл (старая иерархия, тоже живая: `social/instagram-service.ts:3,47` и др.). Он не подтверждает и не опровергает мёртвость кандидата; удаление кандидата его не сломает — но сломает сборку в 6 файлах выше.

**Про конвергенцию:** по `docs/prompts/kimi-convergence-table.md:38`, `social-platforms/base-service.ts` — это ЦЕЛЕВАЯ сторона конвергенции (новый контракт), удалять его до/вместо миграции нельзя.

**Требуемая правка docs:** `docs/platform-convergence-table.md:20` — заменить «импортёров: НИКТО / dead code» на фактическое состояние (контракт новой иерархии, 6 потребителей, 3 наследника). Та же правка статуса в `docs/session-2026-07-20.md:61` и `docs/prompts/README.md:126-129`.

---

## Решения, ожидающие владельца

1. **Подтвердить удаление** `telegram-proxy-service.ts` → Kimi готовит отдельный промпт на удаление (по плану README: «после подтверждения — отдельный промпт»), включая правку `KNOWN_DEAD` и проверку `media-proxy-service.ts` как каскадного кандидата.
2. **Согласиться со снятием** `base-service.ts` из кандидатов → Kimi правит три документа (convergence-table, session, README).

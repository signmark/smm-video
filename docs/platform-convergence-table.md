# Конвергенция `services/social/` → `services/social-platforms/` — таблица «кто кого зовёт»

**Дата:** 2026-07-20
**Статус:** черновик анализа — требует ревью владельца перед merge в основную ветку работ; обновлено 2026-07-21 (исход Task 10: telegram-proxy удалён, `social-platforms/base-service.ts` — живой)
**Автор:** Kimi (промпт: `docs/prompts/kimi-convergence-table.md`)
**Метод:** свежий `git grep` на 2026-07-20, сравнение публичных сигнатур (не тел).

## Сводная таблица

| Файл / Сервис | Иерархия | Кто зовёт (роуты/сервисы) | Дубль в другой иерархии | Статус дубли | Рекомендация |
|---|---|---|---|---|---|
| `base-service.ts` (526 строк, `BaseSocialService` — fat helper base) | `social/` | Наследники: `social/telegram-service`, `social/instagram-service`, `social/vk-service`; тест `base-social-service.test.ts` | `social-platforms/base-service.ts` | **Расходящийся API**: старый — хелперы (`updatePublicationStatus`, `uploadImagesToImgur`, `processAdditionalImages`, `getSystemToken`), новый — минимальный абстрактный контракт | Требует ручного merge API; уходит вместе со старой иерархией |
| `facebook.ts` (36 строк, `FacebookSocialService`) | `social/` | `social/index.ts` (фасад) | `social-platforms/facebook-service.ts` | **Шим**: тонкий адаптер над новым сервисом (`publish`, `updatePublicationStatus`) | Удалить дубль после переноса вызова в фасаде на `facebookService` напрямую |
| `instagram-service.ts` (670 строк, `InstagramService`) | `social/` | `social/index.ts` | `social-platforms/instagram-service.ts` | **Расходящийся API**: `publishToInstagram`/`formatTextForInstagram` vs `publishPost`/`sanitizeText`/`waitForContainer`/`proxyImage`. Одинаковое имя инстанса `instagramService` | Удалить дубль после переноса вызовов (маппинг методов) |
| `telegram-proxy-service.ts` (613 строк) | `social/` | **НИКТО** (ни статически, ни динамически; `TelegramProxyService` не встречается вне файла) | нет | ~~Dead code~~ **Удалён 2026-07-21** (Task 10, подтверждено владельцем) | Удалён |
| `telegram-s3-integration.ts` (280 строк) | `social/` | `social/telegram-service.ts` | нет (в новой TG-сервис проксирует медиа через Cloudinary) | Уникален, связан со старым TG | Уходит вместе со старым `telegram-service`; до этого не трогать |
| `telegram-service.ts` (1529 строк, `TelegramService`) | `social/` | `social/index.ts`; `social-publishing.ts` (→ `routes/content.ts`, `routes/social.ts`); `api/test-routes-last-telegram.ts`; `telegram-legacy-format.test.ts` | `social-platforms/telegram-service.ts` | **Расходящийся API**: `publishToTelegram`/`formatTextForTelegram`/`sendImagesToTelegram`/`getChatInfo` vs `publishPost`/`deletePost`/`sanitizeText`. **Оба** форматируют через shared `utils/telegram-html` — мост уже есть. Одинаковое имя инстанса `telegramService` | Требует ручного merge API; удалять после перевода `social-publishing.ts` и фасада |
| `vk-service.ts` (510 строк, `VkService`) | `social/` | `social/index.ts` | `social-platforms/vk-service.ts` | **Расходящийся API**: `publishToVk`/`formatTextForVk` vs `publishPost`/`doWallPost`/`uploadPhoto`/`uploadVideo`/`autoDetectGroupId`; `VK_DEFAULT_APP_ID` только в новом. Одинаковое имя инстанса `vkService` | Удалить дубль после переноса вызовов |
| `index.ts` (256 строк, фасад `socialPublishingService`) | `social/` | `api/clips-publishing-router.ts`, `api/publishing-routes.ts`, `publish-scheduler.ts:1640` (dynamic); моки в 2 тестах | Функционально — `api/social-publishing-router.ts` (новый роут-уровень) | Фасад легаси-пути; **уже частично на новой иерархии** (`threads`, `youtube`, `youtube-video` статически; `instagram-stories` динамически). **Содержит битый dynamic import `./social-platforms/youtube-shorts-service` (:126)** — такого файла нет, нужен `../` | Фасад — мигрировать вызовы на новый роутер/сервисы, затем удалить; битый импорт — см. «Открытые вопросы» |
| `base-service.ts` (27 строк, абстрактный контракт) | `social-platforms/` | **Живой** (проверено 2026-07-21, Task 10): 6 потребителей — 3 наследника `youtube-service` / `tiktok-service` / `vk-clips-service` (`extends BaseSocialService`); `vk-stories` / `instagram-reels` / `facebook` используют `TokenValidationResult` | `social/base-service.ts` | **Расходящийся API**; ~~dead code~~ — контракт новой иерархии, целевая сторона конвергенции (по `kimi-convergence-table.md:38`) | Оставить — снят из dead-code кандидатов 2026-07-21 |
| `facebook-service.ts` (880 строк) | `social-platforms/` | `api/facebook-webhook-unified.ts`, `api/social-publishing-router.ts`, `publish-scheduler.ts`, `status-validator.ts` | `social/facebook.ts` (шим) | Цель конвергенции | Уникален — оставить |
| `instagram-reels-service.ts` | `social-platforms/` | `api/clips-publishing-router.ts`, `publish-scheduler.ts`, `status-validator.ts` | нет | Уникален | Уникален — оставить |
| `instagram-service.ts` (327 строк) | `social-platforms/` | `api/social-publishing-router.ts` (×2), `publish-scheduler.ts` | `social/instagram-service.ts` | Цель конвергенции | Уникален — оставить |
| `instagram-stories-service.ts` | `social-platforms/` | `api/social-publishing-router.ts`, `routes/stories.ts` (×4), `routes/videoProcessing.ts`, `social/index.ts` (dyn) | нет | Уникален | Уникален — оставить |
| `telegram-service.ts` (299 строк) | `social-platforms/` | `api/social-publishing-router.ts` (×2), `publish-scheduler.ts` | `social/telegram-service.ts` | Цель конвергенции; `sanitizeText` → shared `utils/telegram-html` | Уникален — оставить |
| `threads-service.ts` | `social-platforms/` | `api/social-publishing-router.ts` (×3), `routes/social.ts`, `routes/threads-oauth.ts`, `publish-scheduler.ts`, `social/index.ts` | нет | Уникален | Уникален — оставить |
| `tiktok-service.ts` | `social-platforms/` | `routes/tiktok-auth.ts` (×2), `publish-scheduler.ts`, `status-validator.ts` | нет | Уникален | Уникален — оставить |
| `vk-clips-service.ts` | `social-platforms/` | `api/clips-publishing-router.ts`, `routes/stories.ts`, `publish-scheduler.ts`, `status-validator.ts` | нет | Уникален | Уникален — оставить |
| `vk-service.ts` (522 строк) | `social-platforms/` | `api/social-publishing-router.ts` (×2), `publish-scheduler.ts` (×2, вкл. `VK_DEFAULT_APP_ID`) | `social/vk-service.ts` | Цель конвергенции | Уникален — оставить |
| `vk-stories-service.ts` | `social-platforms/` | `api/social-publishing-router.ts`, `routes/stories.ts`, `publish-scheduler.ts`, `status-validator.ts` | нет | Уникален | Уникален — оставить |
| `youtube-service.ts` (119 строк) | `social-platforms/` | `api/publishing-routes.ts` (×3), `routes/stories.ts`, `status-validator.ts`, `social/index.ts` | нет | Уникален | Уникален — оставить |
| `youtube-shorts-service.ts` | `social-platforms/` | `api/clips-publishing-router.ts`, `api/social-publishing-router.ts` (×2), `social/index.ts` (**битый** dyn import) | нет | Уникален | Уникален — оставить |
| `youtube-video-service.ts` | `social-platforms/` | `api/social-publishing-router.ts` (×2), `social/index.ts` | нет | Уникален | Уникален — оставить |

### Сводка «кто зовёт» (prod-код, без тестов)

- **`social/` (старая):** 7 вызывающих файлов — `api/clips-publishing-router.ts`,
  `api/publishing-routes.ts`, `api/test-routes-last-telegram.ts`,
  `services/publish-scheduler.ts`, `services/social-publishing.ts`
  (+ его зовут `routes/content.ts`, `routes/social.ts`). Плюс 4 теста.
- **`social-platforms/` (новая):** 12 вызывающих файлов — `api/clips-publishing-router.ts`,
  `api/facebook-webhook-unified.ts`, `api/publishing-routes.ts`,
  `api/social-publishing-router.ts`, `routes/social.ts`, `routes/stories.ts`,
  `routes/threads-oauth.ts`, `routes/tiktok-auth.ts`, `routes/videoProcessing.ts`,
  `services/publish-scheduler.ts`, `services/status-validator.ts`,
  и сама старая иерархия (`social/index.ts`, `social/facebook.ts`). Плюс 13 тестов.

## Куда идут новые фичи (шаг 3 промпта)

Все фичи «нового типа» живут **только** в `social-platforms/`: stories
(vk, instagram), clips (vk), reels, threads, tiktok, youtube-shorts.
Иерархия назначения де-факто определена: **конвергенция = добить старую
до новой**, не наоборот. При этом багфиксы последнего цикла (Task A,
`6ec4ad4`/`299becb`/`9e230e3`) ушли в *старую* TG-иерархию — живое
подтверждение проблемы двух копий (лечится тем, что форматирование уже
вынесено в shared `utils/telegram-html`, которым пользуются обе).

## Порядок миграции (предложение)

1. **Facebook (первый, минимальный риск).** Старый `social/facebook.ts` —
   чистый шим. Переключить `social/index.ts` на `facebookService`
   напрямую, удалить шим. Один коммит, без feature flag.
2. **Битый dynamic import в `social/index.ts:126`.** Точечный фикс
   `./social-platforms/` → `../social-platforms/` отдельным маленьким
   коммитом (или закрыть переводом youtube-ветки фасада на новый сервис).
   Не ждёт остальные шаги — это прод-баг, см. «Открытые вопросы».
3. **Dead code — закрыто 2026-07-21 (Task 10, подтверждено владельцем).**
   `social/telegram-proxy-service.ts` (613 строк, ноль импортёров) —
   **удалён**. `social-platforms/base-service.ts` (27 строк) — **снят из
   кандидатов: живой** (6 потребителей, 3 наследника), целевая сторона
   конвергенции.
4. **VK + Instagram.** Перевести фасад на новые сервисы через тонкий
   адаптер, сохраняющий наружный контракт фасада (`publishToVk` →
   `publishPost`, `publishToInstagram` → `publishPost`; форматирование
   текста решить на стороне адаптера). Роуты не трогаем. Без feature flag,
   по одному коммиту на платформу.
5. **Telegram (последний, самый раздвоенный: 1529 vs 299 строк).**
   Сначала выяснить живость `routes/content.ts` / `routes/social.ts`
   (зовут `social-publishing.ts` → старый TG). Перевести
   `social-publishing.ts` на новый TG-сервис (форматирование уже
   унифицировано в shared-утилите), затем удалить старый
   `telegram-service` вместе с `telegram-s3-integration`, а когда умрёт
   третий наследник — и старый `base-service`. Потенциально 2–3 коммита.
6. **Вывод фасада `social/index.ts`.** Перевести
   `clips-publishing-router` / `publishing-routes` /
   `publish-scheduler.ts:1640` с фасада на новые сервисы/роутер, удалить
   `social/` целиком. **Единственный шаг под feature flag** (переключение
   прод-публикаций), если владелец захочет страховку; шаги 1–5 флагов не
   требуют — каждый закрывается прогоном vitest.

## Открытые вопросы

1. **`social/index.ts:126` — битый dynamic import**
   `await import('./social-platforms/youtube-shorts-service')`: файла по
   этому пути нет (нужен `../`). Если youtube-ветка фасада реально
   вызывается, публикация shorts через старый фасад падает в рантайме.
   Чинить точечно сейчас или закроется миграцией (шаг 2)? Вынесено
   владельцу отдельным сообщением.
2. `routes/content.ts` и `routes/social.ts`, зовущие `socialPublishingService`
   (`services/social-publishing.ts` → старый TG), — живые прод-роуты или
   легаси-заготовки? От ответа зависит объём шага 5.
3. `api/test-routes-last-telegram.ts` — тестовый роут, зовёт старый TG
   напрямую. Нужен ли в проде?
4. ~~`social/telegram-proxy-service.ts` — dead по всем grep'ам. Подтвердить
   удаление владельцем (613 строк).~~ **Закрыто 2026-07-21:** удалён
   (Task 10, подтверждено владельцем).
5. Хелперы старого `base-service` (`updatePublicationStatus`,
   `uploadImagesToImgur`, `getSystemToken`) используются тремя старыми
   сервисами; при удалении старой иерархии убедиться, что эквиваленты есть
   у новых сервисов (у нового `facebook-service` `updatePublicationStatus`
   есть; у остальных новых поимённо не сверял — сверить на шагах 4–5).
6. Одинаковые имена инстансов (`telegramService`, `vkService`,
   `instagramService`) в обеих иерархиях: при миграции импортов легко
   оставить смешанные ссылки. Лечится grep'ом по полным путям, но держать
   в уме на каждом шаге.

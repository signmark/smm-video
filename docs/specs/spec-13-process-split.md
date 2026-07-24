# Spec §13 — Разделение процессов: web / worker / bot

**Effort:** high · **Исполнитель:** Hermes · **Ревью:** Mavis + Mimo (deploy-топология) · **После §12!**

## Цель

Web (HTTP/SPA/WS), worker (scheduler/AI/media jobs), bot (Telegram) — три процесса с отдельными readiness, shutdown и ресурсами.

## Предусловие

§12 задеплоен и стабилен: без durable claim два процесса = дубли публикаций.

## Шаги

1. **Инвентаризация точек входа.** В `server/index.ts` найти инициализацию: scheduler start, Telegram bot, WS, HTTP. Составить карту «что стартует где» — в handoff.
2. **Entry-модули:** `server/entry-web.ts`, `server/entry-worker.ts`, `server/entry-bot.ts`; общий bootstrap (env, Directus, logger) — `server/bootstrap.ts`. `index.ts` временно остаётся «всё в одном» (`ROLE=all`) для обратной совместимости dev.
3. Управление ролью: env `PROCESS_ROLE=web|worker|bot|all` (default `all`). Внутри index.ts — условная инициализация по роли. Это минимально-инвазивный вариант: НЕ рвать файл на части в этом цикле (декомпозиция — §15).
4. Readiness по ролям: web — Directus; worker — Directus + storage; bot — Telegram API getMe (использовать /ready из §10).
5. Graceful shutdown: SIGTERM → worker дозавершает текущий job (claim释 через §12 lease и так истечёт, но чистое завершение лучше), bot — stopPolling, web — server.close.
6. Deploy (с Mimo): docker-compose / три контейнера из одного образа с разными PROCESS_ROLE; prod-переключение поэтапно — сначала `all` как сейчас, потом вынос worker, потом bot.

## Тесты

- `PROCESS_ROLE=web` — scheduler НЕ стартует, bot НЕ стартует (unit на условную инициализацию)
- `PROCESS_ROLE=worker` — HTTP-порт не слушается (или слушается только /live,/ready — выбрать и зафиксировать)
- `all` — поведение идентично текущему (полный vitest)

## Acceptance

- [ ] Один образ, роль через env; `all` остаётся дефолтом до решения Mimo
- [ ] Пошаговый rollout-план в handoff, согласован с Mimo
- [ ] Полный vitest зелёный в режиме `all`

## Грабли

- Модули с side-effect при импорте (стартуют что-то на import) — главный враг; выявить на шаге 1.
- WS-broadcast из worker'а (публикация завершена → уведомление) потребует канал worker→web: в этом цикле —простой вариант: worker пишет в Directus, web поллит/подписан. Реалтайм-шину не строить.

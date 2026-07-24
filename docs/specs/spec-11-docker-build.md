# Spec §11 — Воспроизводимый Docker build

**Effort:** low · **Исполнитель:** Hermes · **Ревью:** Mavis + **Mimo (обязательно — infra)**

## Цель

Билд детерминирован lockfile'ом, без «двух пакетов поверх production tree».

## Факты (Dockerfile, проверено 2026-07-24)

- `:2` `FROM node:22-alpine AS builder`; `:23` `RUN npm install --registry ...` (builder)
- `:61-62` runtime: `npm install --omit=dev` + **отдельный** `npm install @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe --omit=dev` — та самая повторная установка поверх production tree
- `.node-version`/`.nvmrc` = Node 20, а образ — node:22. Расхождение!

## Шаги

1. `package.json`: перенести `@ffmpeg-installer/ffmpeg` и `@ffprobe-installer/ffprobe` в regular `dependencies` (проверить, не в devDependencies ли они сейчас и почему ставились отдельно — вероятно, из-за platform-specific binaries на alpine).
2. Dockerfile: `npm install` → `npm ci` (builder), `npm ci --omit=dev` (runtime); убрать строку 62.
3. Решить версию Node: либо образ → `node:20-alpine` (совпадает с .nvmrc/dev), либо обновить .nvmrc до 22 и прогнать тесты на 22. Зафиксировать выбор в handoff. Рекомендация: выровнять на 20 (меньше неизвестных).
4. BuildKit cache mount для npm: `RUN --mount=type=cache,target=/root/.npm npm ci ...`.
5. `npm audit --omit=dev --audit-level=high` как build step (пока warning, не fail — фиксация базы).
6. (опция, если быстро) SBOM: `docker sbom` или syft в CI из spec-07.

## Тесты

- `docker build .` дважды подряд → второй раз слои dependencies из кэша
- Контейнер стартует, `/health` отвечает, ffmpeg доступен: `docker exec smm node -e "console.log(require('@ffmpeg-installer/ffmpeg').path)"`
- Видео-пайплайн smoke (генерация тестового клипа) — ffmpeg-путь критичен

## Acceptance

- [ ] Никаких `npm install` в Dockerfile — только `npm ci`
- [ ] Версия Node в образе == .nvmrc
- [ ] Mimo подтвердил: его `smm-rebuild` (обычный и no-cache) работает без изменений или обновлён
- [ ] ffmpeg/ffprobe работают в собранном образе (alpine binaries!)

## Грабли

- alpine + ffmpeg-installer: пакет качает platform-binaries при install; `npm ci` в builder на другой платформе, чем runtime — если билд многостадийный и node_modules копируются, binaries могут не совпасть. Проверить, откуда runtime берёт node_modules.
- Правки Dockerfile деплоить только через no-cache rebuild (правило Mimo).

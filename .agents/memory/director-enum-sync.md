---
name: Video-app director enum sync
description: The AI-режиссёр planner must keep its allowlists in sync across three places.
---

# AI-режиссёр (director) — enum синхронизация

`video-app/server/services/director.ts` (`planVideo`) предлагает настройки видео и **нормализует** их под допустимые значения. Эти allowlists продублированы в трёх местах и должны совпадать:

- `director.ts` — нормализация плана (FORMATS, ALL_MODELS, VOICES, SUBTITLE_STYLES, MUSIC_STYLES, CLIP_DURATION_MODELS).
- `routes.ts` POST `/videos` — серверная валидация (ALL_MODELS, VALID_VOICES, VALID_SUBTITLE_STYLES). Невалидная модель молча падает в `wan`.
- `Create.tsx` — UI-дропдауны (I2V_MODELS/T2V_MODELS, VOICES, SUBTITLE_STYLES, MUSIC_STYLES).

**Why:** если director вернёт значение, валидное на сервере, но отсутствующее в UI-дропдауне (был случай с голосом `ballad`), форма не сможет показать/перевыбрать его — план «заполняет форму», но поле висит вне списка опций. И наоборот: модель не из серверного ALL_MODELS тихо станет `wan`.

**How to apply:** при добавлении/удалении модели, голоса, стиля субтитров или музыки — править все три места разом. `pipelineMode` всегда выводить из модели (T2V_MODELS), не доверять отдельному полю, чтобы режим и модель не рассинхронизировались (так сделано и на сервере, и в `applyPlan`).

## Длина клипа при добавлении модели
Каждая FAL-модель выдаёт клип фиксированной длины. При добавлении модели нужно ещё:
- `script-generator.ts getModelClipDuration()` — задать реальную длину (kling=10, luma=9, **veo3=8**, остальные=5). От неё считаются число сцен, слова озвучки и сборка.
- Если длина модели **не выбирается пользователем** (как Veo 3.1 = 8с) — добавить её в `routes.ts FIXED_DURATION_MODELS`, иначе director всегда шлёт `clipDuration:10` (для не-CLIP_DURATION_MODELS), и это перебьёт реальную длину в `getSceneLayout` (берёт `clipDuration ?? getModelClipDuration`) и в сборке (`project.clipDuration ?? scene.duration`) → рассинхрон тайминга.

**Why:** Veo был «наполовину подключён» — код в fal-animator/db/UI был, но `veo3` отсутствовал в серверных ALL_MODELS → молча падал в `wan`. После включения всплыл скрытый баг с clipDuration:10 поверх 8с.

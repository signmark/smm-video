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

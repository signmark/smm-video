# Video App — Техническое задание

> Документ описывает **фактически реализованную** систему по состоянию на май 2026 г.  
> Подпроект `video-app/` внутри монорепозитория SMM Manager.

---

## 1. Назначение

Сервис генерации коротких AI-видео для публикации в Shorts / Reels / TikTok / YouTube.  
Пользователь задаёт тему и параметры — система автоматически создаёт сценарий, изображения, анимирует их в видеоклипы, озвучивает и собирает итоговый MP4 с субтитрами.

---

## 2. Архитектура

```
Основное приложение (порт 5000)
  └─ /video-app/* → proxy → Video App (порт 3001)

video-app/
  ├── client/          React + Vite (base: /video-app/)
  ├── server/
  │   ├── index.ts     Express точка входа
  │   ├── routes.ts    REST API
  │   ├── db.ts        Слой хранения данных
  │   ├── load-keys.ts Загрузка API-ключей из Directus
  │   └── services/
  │       ├── script-generator.ts   Генерация сценария (AI)
  │       ├── image-generator.ts    Генерация изображений (AI)
  │       ├── fal-animator.ts       Анимация клипов (FAL.AI)
  │       ├── tts-generator.ts      Озвучка (OpenAI TTS)
  │       └── video-assembler.ts    Сборка MP4 (ffmpeg)
  └── data/
      ├── images/{projectId}/      Изображения сцен
      └── videos/{projectId}.mp4   Готовые видео
```

### 2.1 Прокси

Основной сервер (порт 5000) форвардит все запросы `/video-app/*` на порт 3001, сохраняя префикс пути. Фронтенд собирается с `base: '/video-app/'` — критично для корректных URL ассетов.

### 2.2 Запуск

| Среда | Команда |
|-------|---------|
| Dev (Replit) | `cd video-app && npx tsx server/index.ts` |
| Prod (Docker) | `docker-compose up -d --build video-app` |

После изменений только в server — перезапустить воркфлоу.  
После изменений в client — сначала `cd video-app && npx vite build`, затем перезапустить.

---

## 3. Хранение данных

### 3.1 Приоритетная цепочка бэкендов

1. **Directus** (`video_projects` коллекция) — основной бэкенд
2. **PostgreSQL** (`video_projects` таблица, создаётся автоматически) — fallback
3. **JSON-файл** (`data/projects.json`) — последний fallback без внешних зависимостей

Бэкенд определяется автоматически при старте через probe-запрос к Directus.

### 3.2 Модель `VideoProject`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | string (UUID) | Первичный ключ |
| `title` | string | Название проекта |
| `topic` | string | Тема (промпт для AI) |
| `customScenario` | string? | Готовый сценарий пользователя (альтернатива теме) |
| `format` | `9:16` \| `16:9` \| `1:1` | Соотношение сторон |
| `duration` | number | Целевая длина видео в секундах |
| `language` | `ru` \| `en` | Язык озвучки и субтитров |
| `animationModel` | AnimationModel | Выбранная модель анимации |
| `subtitleStyle` | SubtitleStyle | Стиль субтитров |
| `status` | VideoStatus | Текущий статус пайплайна |
| `progress` | number (0–100) | Прогресс в процентах |
| `progressMessage` | string | Читаемый статус для UI |
| `script` | Script? | Сгенерированный сценарий (JSON) |
| `videoPath` | string? | Абсолютный путь к MP4 на диске |
| `videoUrl` | string? | URL для стриминга/скачивания |
| `error` | string? | Текст ошибки при сбое |

### 3.3 Модель `Script`

```typescript
interface Script {
  title: string;
  consistencyBlock?: string;  // только для T2V: якорь визуального стиля
  scenes: Scene[];
}

interface Scene {
  id: string;
  text: string;           // короткий субтитр на экране (макс. 8 слов)
  narration?: string;     // полный текст озвучки (рассчитан на длительность сцены)
  imagePrompt: string;    // промпт для генерации изображения (всегда на английском)
  t2vPrompt?: string;     // промпт для T2V-модели (только для T2V)
  imagePath?: string;     // путь к сохранённому изображению
  duration: number;       // длительность сцены в секундах
}
```

### 3.4 Статусы (`VideoStatus`)

```
idle → generating_script → script_ready → generating_images → animating → assembling → done
                                                                                      ↓
                                                                                    error
```

После `script_ready` пользователь может просмотреть и отредактировать сценарий перед запуском генерации видео.

---

## 4. REST API

Базовый путь: `/api` (через прокси `/video-app/api`)

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/health` | Проверка работоспособности |
| `GET` | `/videos` | Список всех проектов |
| `POST` | `/videos` | Создать проект |
| `GET` | `/videos/:id` | Получить проект |
| `DELETE` | `/videos/:id` | Удалить проект |
| `POST` | `/videos/:id/generate-script` | Запустить генерацию сценария (шаг 1) |
| `POST` | `/videos/:id/generate` | Запустить генерацию видео (шаг 2) |
| `PATCH` | `/videos/:id/scenes/:sceneId` | Редактировать текст сцены |
| `POST` | `/videos/:id/reset` | Сбросить к `script_ready` (при потере файла) |
| `GET` | `/videos/:id/download` | Скачать MP4 |

### Создание проекта (`POST /videos`)

```json
{
  "topic": "Как работает квантовый компьютер",
  "format": "9:16",
  "duration": 30,
  "language": "ru",
  "animationModel": "wan",
  "subtitleStyle": "karaoke",
  "customScenario": "..."  // опционально — заменяет topic
}
```

Все запросы генерации возвращают ответ немедленно (fire-and-forget), прогресс отслеживается через поллинг `GET /videos/:id`.

---

## 5. Пайплайн генерации

### 5.1 Шаг 1: Генерация сценария (только)

Запускается через `POST /videos/:id/generate-script`.  
После успеха статус = `script_ready` — пользователь проверяет и опционально редактирует текст сцен.

### 5.2 Шаг 2: Полный пайплайн видео

Запускается через `POST /videos/:id/generate`. Этапы:

**Для I2V-моделей (Image-to-Video):**
```
Сценарий (если нет) → Генерация изображений (параллельно) 
  → Анимация клипов FAL.AI (параллельно, Promise.all) 
  → TTS озвучка (параллельно) 
  → Мукс аудио на клипы → Concat клипов → Запись субтитров → MP4
```

**Для T2V-моделей (Text-to-Video):**
```
Сценарий (если нет) → Анимация клипов FAL.AI по t2vPrompt (параллельно) 
  → Извлечение последнего кадра (для overlap) → TTS озвучка 
  → Мукс → Concat → Субтитры → MP4
```

**Fallback при ошибке анимации:** если FAL.AI не отвечает или возвращает ошибку — автоматический переход на статичное слайд-шоу из изображений.

---

## 6. Сервис генерации сценария

**Файл:** `server/services/script-generator.ts`

### 6.1 Расчёт сцен

Количество и длительность сцен определяются выбранной моделью анимации:

| Модели | Длительность клипа |
|--------|--------------------|
| `kling`, `kling-pro`, `kling-t2v`, `kling-pro-t2v` | 10 сек |
| `luma` | 9 сек |
| `wan`, `wan-t2v`, `minimax`, `seedance` | 5 сек |

Количество сцен: `max(2, min(round(duration / clipDuration), 8))`

Темп речи: русский — 1.8 слов/сек, английский — 2.3 слов/сек.

### 6.2 Режимы промпта

| Режим | Условие | Структура JSON |
|-------|---------|----------------|
| I2V стандарт | нет customScenario, нет T2V | `title`, `scenes[].{text, narration, imagePrompt, duration}` |
| T2V стандарт | нет customScenario, есть T2V | + `consistency_block`, `scenes[].t2vPrompt` |
| I2V кастом | есть customScenario, нет T2V | парсит готовый сценарий в I2V-структуру |
| T2V кастом | есть customScenario, есть T2V | парсит готовый сценарий в T2V-структуру |

**T2V `consistency_block`** — якорь для визуальной согласованности: описание стиля, цветовой палитры и внешности персонажа (если есть), копируется в начало каждого `t2vPrompt`.

### 6.3 Цепочка AI-провайдеров

```
Gemini 2.0 Flash (через прокси если GEMINI_PROXY_URL)
  → OpenAI GPT-4o-mini
    → Anthropic Claude 3.5 Haiku
```

При ошибке каждого провайдера — переход к следующему. Если все упали — исключение с объединённым сообщением.

---

## 7. Сервис генерации изображений

**Файл:** `server/services/image-generator.ts`

### 7.1 Целевые разрешения

| Формат | Итоговый размер |
|--------|-----------------|
| `9:16` | 1080 × 1920 px |
| `16:9` | 1920 × 1080 px |
| `1:1` | 1080 × 1080 px |

### 7.2 Цепочка провайдеров

| Приоритет | Провайдер | Модель | Ключ |
|-----------|-----------|--------|------|
| 1 (primary) | Gemini Flash | `gemini-2.0-flash-preview-image-generation` | `GEMINI_API_KEY` |
| 2 | Google Imagen 4 | `imagen-4.0-generate-001` | `GEMINI_API_KEY` |
| 3 | HuggingFace | FLUX.1-schnell | `HUGGINGFACE_API_KEY` |
| 4 | FAL.AI | FLUX schnell | `FAL_AI_API_KEY` |
| 5 (last resort) | Placeholder | SVG → JPEG | — |

После получения изображения применяется `sharp.resize(w, h, fit: 'cover')` и сохраняется в JPEG 92%.

Все запросы идут через `getGeminiBase()` — если установлен `GEMINI_PROXY_URL`, хост берётся из него.

---

## 8. Сервис анимации (FAL.AI)

**Файл:** `server/services/fal-animator.ts`

### 8.1 I2V-модели (Image-to-Video)

| Ключ модели | FAL endpoint | Параметры |
|-------------|-------------|-----------|
| `wan` | `fal-ai/wan/v2.7/image-to-video` | `width`, `height`, `num_frames: 81` |
| `kling` | `fal-ai/kling-video/v1.6/standard/image-to-video` | `duration: "5"\|"10"`, `aspect_ratio` |
| `kling-pro` | `fal-ai/kling-video/v1.6/pro/image-to-video` | `duration: "5"\|"10"`, `aspect_ratio` |
| `minimax` | `fal-ai/minimax/video-01-live/image-to-video` | только `prompt` |
| `seedance` | `fal-ai/bytedance/seedance/v1/lite/image-to-video` | `duration`, `resolution: "720p"`, `aspect_ratio` |

### 8.2 T2V-модели (Text-to-Video)

| Ключ модели | FAL endpoint | Параметры |
|-------------|-------------|-----------|
| `wan-t2v` | `fal-ai/wan/t2v-1.3b` | `width`, `height`, `num_frames: 81` |
| `kling-t2v` | `fal-ai/kling-video/v2/standard/text-to-video` | `duration`, `aspect_ratio` |
| `kling-pro-t2v` | `fal-ai/kling-video/v2/pro/text-to-video` | `duration`, `aspect_ratio` |
| `luma` | `fal-ai/luma-dream-machine/ray-2-flash` | `duration: "5s"\|"9s"`, `aspect_ratio` |

### 8.3 Механизм поллинга

FAL.AI использует асинхронную очередь:
1. `POST /queue/{model}` → возвращает `{ request_id, status_url, response_url }`
2. Поллинг `status_url` каждые 5 сек до статуса `COMPLETED` или `FAILED`
3. Результат: из `output` в ответе статуса (новые модели) или из `response_url` (старые)
4. Таймаут: 300 сек для большинства моделей, 360–420 сек для Kling Pro

Изображение передаётся как `data:image/jpeg;base64,...` inline в payload (не как URL).

### 8.4 Fallback-цепочки

**I2V:** при ошибке основной модели → Wan 2.7 → Seedance → LTX-Video  
**T2V:** при ошибке → Wan T2V 1.3B → Luma (пропуская упавшую модель)

### 8.5 Параллельность

Все сцены анимируются одновременно через `Promise.all`.

### 8.6 Размерность

| Формат | width × height |
|--------|---------------|
| `9:16` | 480 × 832 |
| `16:9` | 832 × 480 |
| `1:1` | 576 × 576 |

---

## 9. Сервис озвучки (TTS)

**Файл:** `server/services/tts-generator.ts`

**Провайдер:** OpenAI TTS API  
**Основная модель:** `gpt-4o-mini-tts`  
**Fallback:** `tts-1` (при HTTP 404/400)  
**Голос:** `alloy` для всех языков  
**Ключ:** `OPENAI_API_KEY`

### 9.1 Синхронизация с длиной клипа

После генерации аудио применяется ffmpeg `atempo` для подгонки под `targetDuration`:

| Ситуация | Действие |
|----------|----------|
| Аудио длиннее клипа на >8% и ratio ≤ 4.0 | Ускорение через `atempo` |
| Аудио короче клипа | Добавление тишины в конец |
| ratio > 4.0 | Оставляем как есть, логируем предупреждение |

Для `atempo` ratio > 2.0: цепочка фильтров `atempo=2.0,atempo=X`.

---

## 10. Сборка видео (ffmpeg)

**Файл:** `server/services/video-assembler.ts`

**ffmpeg:** сначала ищет системный (Alpine Docker), fallback — `@ffmpeg-installer/ffmpeg`

### 10.1 I2V-сборка (`assembleVideo`)

Для каждой сцены:
- `makeClip`: изображение × TTS-аудио → клип (с `apad` для выравнивания длин)
- `makeClipWithSilence`: изображение × тишина (для сцен без аудио в микс-режиме)
- Параметры: `libx264`, `ultrafast`, `crf 26`, `25fps`, `yuv420p`

Финальный concat: `ffmpeg -f concat -c:v copy`.

### 10.2 T2V-сборка (`assembleFromClips`)

Готовые клипы с FAL.AI мукс с TTS через `ffmpeg`:
- Клип + аудио → мукс с `c:v copy`, `apad`, `-shortest`
- Финальный concat аналогично I2V

### 10.3 Субтитры (`burnSubtitles`)

Субтитры генерируются в формате ASS и записываются поверх готового видео через `ass=` фильтр ffmpeg. Стиль выбирается пользователем:

| Стиль | Описание |
|-------|----------|
| `none` | Без субтитров |
| `fade` | Полное предложение с плавным появлением/затуханием (350ms fade) |
| `karaoke` | Побуквенная/пословная подсветка (`\kf` тег ASS) |
| `tiktok` | Одно слово крупным шрифтом (70% ширины кадра) |
| `word-by-word` | Слова накапливаются на экране, текущее слово — жёлтым |

Шрифт: DejaVu Sans. Позиция: нижняя часть экрана (7% от края).

---

## 11. Загрузка API-ключей

**Файл:** `server/load-keys.ts`

Ключи хранятся в Directus (`global_api_keys`, поле `service_name`) и загружаются при старте.

### 11.1 Ключи (`service_name` в Directus)

| service_name | env var | Назначение |
|-------------|---------|-----------|
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | Gemini / Imagen |
| `GEMINI_PROXY_URL` | `GEMINI_PROXY_URL` | Прокси для Gemini (обход геоблока) |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` | GPT + TTS |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | Claude |
| `fal_ai` | `FAL_AI_API_KEY` | FAL.AI анимация |
| `HUGGINGFACE_API_KEY` | `HUGGINGFACE_API_KEY` | FLUX fallback |

### 11.2 Retry при старте

При 502/таймауте от Directus (контейнер ещё не поднялся):

```
Попытка 1 (сразу) → Попытка 2 (+5с) → Попытка 3 (+10с) → Попытка 4 (+20с)
```

При успехе на любом шаге — выход. При провале всех — работа без Directus-ключей (ключи из env vars).

### 11.3 Lazy reload (`ensureKeysLoaded`)

Перед каждой генерацией (сценарий и полный пайплайн) вызывается проверка: если `GEMINI_PROXY_URL` и `GEMINI_API_KEY` оба пусты — немедленная повторная загрузка без ретраев.

### 11.4 Dev vs Prod

| Среда | Directus | Токен |
|-------|---------|-------|
| Dev (Replit `REPL_ID` без `REPLIT_DEPLOYMENT`) | `https://directus.roboflow.space` | `DIRECTUS_DEV_TOKEN` |
| Prod | `DIRECTUS_URL` env var | `DIRECTUS_PROD_TOKEN` |

---

## 12. Форматы и ограничения

| Параметр | Допустимые значения |
|----------|---------------------|
| `format` | `9:16`, `16:9`, `1:1` |
| `duration` | любое число (сек); реальная длина = кол-во сцен × длина клипа |
| `language` | `ru`, `en` |
| `animationModel` | `wan`, `kling`, `kling-pro`, `minimax`, `seedance`, `wan-t2v`, `kling-t2v`, `kling-pro-t2v`, `luma` |
| `subtitleStyle` | `none`, `fade`, `karaoke`, `tiktok`, `word-by-word` |
| Макс. сцен | 8 |
| Мин. сцен | 2 |

---

## 13. Инфраструктура

### Dev (Replit)
- Порт 3001, воркфлоу `Video App`: `cd video-app && npx tsx server/index.ts`
- БД: Directus `https://directus.roboflow.space`
- Файлы: `video-app/data/` внутри контейнера Replit

### Prod (Docker)
- `docker-compose up -d --build video-app`
- `DATABASE_URL`: `postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres`
- Volume: `./video_data:/app/video-app/data`
- БД: Directus `https://directus.nplanner.ru`

### Переменные окружения (Docker)

```yaml
environment:
  DATABASE_URL: ...
  DIRECTUS_URL: https://directus.nplanner.ru
  DIRECTUS_PROD_TOKEN: ...
  # AI ключи подтягиваются из Directus при старте
```

---

## 14. Известные особенности

- **Wan 2.7 I2V** принимает `width`/`height` + `num_frames: 81`. Не принимает `aspect_ratio`, `resolution`, `num_frames > 81`.
- **Kling** длительность только `"5"` или `"10"` (строка, не число).
- **Luma** длительность только `"5s"` или `"9s"`.
- **MiniMax** не принимает размерные параметры — только `prompt`.
- **FAL polling**: `status_url` и `response_url` берутся из ответа submit-запроса. Конструировать URL вручную нельзя.
- **Kling v2.1 / Luma** возвращают результат прямо в ответе статуса (`data.output`), а не через отдельный `response_url`.
- **Gemini геоблок**: в продакшне `GEMINI_PROXY_URL` обязателен — прямые запросы из ряда регионов возвращают "User location not supported".
- **Directus 401 в dev**: ожидаемо если токен не настроен — сервис автоматически падает на PostgreSQL/JSON.
- **`dev` сборка фронтенда**: при изменениях в `client/` обязательно запускать `npx vite build` перед перезапуском сервера — в dev-режиме раздаётся статическая сборка, а не Vite dev server.

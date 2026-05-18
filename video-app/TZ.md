# Video App — Техническое задание

> Документ описывает **фактически реализованную** систему по состоянию на май 2026 г.  
> Подпроект `video-app/` внутри монорепозитория SMM Manager.

---

## 1. Назначение

Сервис генерации коротких AI-видео для публикации в Shorts / Reels / TikTok / YouTube.  
Пользователь задаёт тему и параметры — система автоматически создаёт сценарий, проверяет наличие стоковых клипов, генерирует AI-изображения для сцен без стока, анимирует клипы, озвучивает, накладывает фоновую музыку и собирает итоговый MP4 с субтитрами.

---

## 2. Архитектура

```
Основное приложение (порт 5000)
  └─ /video-app/* → proxy → Video App (порт 3001)

video-app/
  ├── client/          React + Vite (base: /video-app/)
  ├── server/
  │   ├── index.ts     Express точка входа
  │   ├── routes.ts    REST API + runStockPrecheck + runScriptOnly
  │   ├── db.ts        Слой хранения данных
  │   ├── load-keys.ts Загрузка API-ключей из Directus
  │   └── services/
  │       ├── script-generator.ts   Генерация сценария (AI)
  │       ├── image-generator.ts    Генерация изображений (AI)
  │       ├── fal-animator.ts       Анимация клипов (FAL.AI)
  │       ├── stock-searcher.ts     Поиск и скачивание стока (Pexels)
  │       ├── tts-generator.ts      Озвучка (OpenAI → HuggingFace)
  │       ├── music-generator.ts    Фоновая музыка (HuggingFace MusicGen)
  │       └── video-assembler.ts    Сборка MP4 (ffmpeg)
  └── data/
      ├── images/{projectId}/
      │   ├── variants/    AI-варианты кадров (scene_N_vM.jpg)
      │   ├── clips/       Стоковые и анимированные клипы (clip_N.mp4)
      │   └── audio/       TTS-аудио сцен (scene_N.mp3)
      └── videos/{projectId}.mp4   Готовые видео
```

### 2.1 Прокси

Основной сервер (порт 5000) форвардит все запросы `/video-app/*` на порт 3001, сохраняя префикс пути. Фронтенд собирается с `base: '/video-app/'` — критично для корректных URL ассетов.

### 2.2 Запуск

| Среда | Команда |
|-------|---------|
| Dev (Replit) | `cd video-app && npx vite build && npx tsx server/index.ts` |
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
| `voice` | string? | Голос TTS (shimmer, alloy, nova и др.) |
| `clipDuration` | 5 \| 10 | Длительность одного клипа в секундах |
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
  stockPrechecked?: boolean;  // true после завершения runStockPrecheck
  scenes: Scene[];
}

interface Scene {
  id: string;
  text: string;               // короткий субтитр на экране (макс. 8 слов)
  narration?: string;         // полный текст озвучки
  imagePrompt: string;        // промпт для генерации изображения (всегда EN)
  backgroundPrompt?: string;  // промпт фона для layered-генерации
  subjectPrompt?: string;     // промпт объекта для layered-генерации
  t2vPrompt?: string;         // промпт для T2V-модели
  motionPrompt?: string;      // промпт движения для анимации
  stockQuery?: string;        // поисковый запрос для Pexels (EN)
  imagePath?: string;         // путь к сохранённому изображению
  selectedVariant?: number;   // выбранный вариант (0-2 = AI, 3 = кастомный кадр)
  videoSource?: 'ai' | 'stock'; // источник видеоклипа
  stockAvailable?: boolean;   // true если клип найден в Pexels
  duration: number;           // длительность сцены в секундах
}
```

### 3.4 Статусы (`VideoStatus`)

```
idle → generating_script → script_ready → generating_images → animating → assembling → done
                                                                                      ↓
                                                                                    error
```

После `script_ready` автоматически запускаются два фоновых процесса (не блокируют UI):
- **Stock precheck** — проверка всех сцен в Pexels
- **TTS preview** — предпрослушка озвучки каждой сцены

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
| `PATCH` | `/videos/:id/scenes/:sceneId` | Редактировать поля сцены |
| `POST` | `/videos/:id/reset` | Сбросить к `script_ready` |
| `GET` | `/videos/:id/download` | Скачать MP4 |
| `GET` | `/videos/:id/audio/:sceneIndex` | Превью TTS для сцены |
| `GET` | `/videos/:id/images/:sceneIndex/:variant` | Кадр варианта (0-2, 3=кастом) |
| `GET` | `/videos/:id/clips/:sceneIndex` | Стоковый клип сцены (MP4 для превью) |
| `POST` | `/videos/:id/scenes/:sceneIndex/generate-variants` | Сгенерировать 3 AI-варианта картинок |
| `POST` | `/videos/:id/scenes/:sceneIndex/stock-retry` | Повторный поиск стока для сцены |
| `POST` | `/videos/:id/scenes/:sceneIndex/upload-frame` | Загрузить свой кадр (вариант 3) |

Все запросы генерации возвращают ответ немедленно (fire-and-forget), прогресс отслеживается через поллинг `GET /videos/:id`.

---

## 5. Пайплайн генерации

### 5.1 Шаг 1: Генерация сценария

Запускается через `POST /videos/:id/generate-script`.  
После успеха статус = `script_ready`.

Сразу после этого фоново и параллельно:
- **`runStockPrecheck`** — проверяет все сцены в Pexels, скачивает найденные клипы, для ненайденных автоматически генерирует 3 AI-варианта картинок
- **TTS preview** — генерирует озвучку для предпрослушки каждой сцены

UI поллит каждые 3 секунды. Поллинг останавливается только когда `script.stockPrechecked === true` — это гарантирует, что UI увидит актуальные `videoSource` (stock/ai) без перезагрузки страницы.

### 5.2 Шаг 2: Полный пайплайн видео

Запускается через `POST /videos/:id/generate`. Этапы:

**Для I2V-моделей (Image-to-Video):**
```
Phase 0: сток-сцены — клипы уже скачаны в precheck, берём напрямую
Phase 1: AI-сцены — генерация изображения (selectedVariant или новое) → FAL.AI I2V
TTS: озвучка всех сцен параллельно (30с таймаут)
Мукс аудио → Concat клипов → Субтитры → Музыка → MP4
```

**Для T2V-моделей (Text-to-Video):**
```
Phase 1: FAL.AI T2V по t2vPrompt (параллельно)
TTS → Мукс → Concat → Субтитры → Музыка → MP4
```

**Fallback при ошибке анимации:** автоматический переход на статичное слайд-шоу из изображений.

### 5.3 Фоновый stock precheck (`runStockPrecheck`)

```
Для каждой сцены параллельно:
  → Поиск в Pexels по stockQuery (или imagePrompt)
  → Найдено: скачать клип → clip_{i}.mp4, videoSource='stock', stockAvailable=true
  → Не найдено: videoSource='ai', stockAvailable=false
      → Автоматически генерировать 3 варианта AI-картинок (параллельно)
→ Записать все изменения в БД одним запросом
→ Установить script.stockPrechecked = true
```

---

## 6. Сервис генерации сценария

**Файл:** `server/services/script-generator.ts`

### 6.1 Расчёт сцен

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
| I2V стандарт | нет customScenario, нет T2V | `title`, `scenes[].{text, narration, imagePrompt, stockQuery, duration}` |
| T2V стандарт | нет customScenario, есть T2V | + `consistency_block`, `scenes[].t2vPrompt` |
| I2V кастом | есть customScenario, нет T2V | парсит готовый сценарий в I2V-структуру |
| T2V кастом | есть customScenario, есть T2V | парсит готовый сценарий в T2V-структуру |

Поле `stockQuery` — поисковая фраза для Pexels на английском, описывает конкретное действие/объект для стокового видео.

### 6.3 Цепочка AI-провайдеров

```
Gemini 2.0 Flash (через прокси если GEMINI_PROXY_URL)
  → OpenAI GPT-4o-mini
    → Anthropic Claude 3.5 Haiku
```

---

## 7. Сервис поиска стока (Pexels)

**Файл:** `server/services/stock-searcher.ts`  
**Ключ:** `PEXELS_API_KEY` (service_name в Directus: `PEXELS_API_KEY`)

### 7.1 Логика поиска

1. Поиск видео в Pexels по `stockQuery` (или `imagePrompt` как фолбэк)
2. Фильтр: ориентация под формат видео (portrait для 9:16, landscape для 16:9)
3. Выбор файла: HD 1080p нужной ориентации, минимальная длительность ≥ `clipDuration`
4. Скачивание в `data/images/{id}/clips/clip_{i}.mp4`
5. Кэширование: если файл уже существует — пропустить скачивание

### 7.2 UI индикация

| Состояние | Вид кнопки Stock | Описание |
|-----------|-----------------|----------|
| Проверяется | ⏳ Stock (серая) | precheck ещё не завершён |
| Найдено | ✅ Stock (синяя, активна) | клип скачан, сцена переключена на stock |
| Не найдено | ❌ Stock (красная) | сцена остаётся на AI, варианты сгенерированы |
| Не проверялось | 📹 Stock | precheck не запускался |

Для каждой stock-сцены в карточке отображается **видеоплеер** (`<video controls>`) с превью скачанного клипа через `GET /api/videos/:id/clips/:sceneIndex`.

---

## 8. Сервис генерации изображений

**Файл:** `server/services/image-generator.ts`

### 8.1 Целевые разрешения

| Формат | Итоговый размер |
|--------|-----------------|
| `9:16` | 1080 × 1920 px |
| `16:9` | 1920 × 1080 px |
| `1:1` | 1080 × 1080 px |

### 8.2 Цепочка провайдеров

| Приоритет | Провайдер | Модель | Ключ |
|-----------|-----------|--------|------|
| 1 | GPT-Image-2 (OpenAI) | `gpt-image-2` | `OPENAI_API_KEY` |
| 2 | Gemini Flash | `gemini-2.0-flash-preview-image-generation` | `GEMINI_API_KEY` |
| 3 | Google Imagen 4 | `imagen-4.0-generate-001` | `GEMINI_API_KEY` |
| 4 | HuggingFace | FLUX.1-schnell | `HUGGINGFACE_API_KEY` |
| 5 | FAL.AI | FLUX schnell | `FAL_AI_API_KEY` |
| 6 (last resort) | Placeholder | SVG → JPEG | — |

### 8.3 Варианты (3 штуки на сцену)

Для AI-сцен генерируются 3 варианта (`scene_N_v0.jpg`, `scene_N_v1.jpg`, `scene_N_v2.jpg`).  
Пользователь выбирает нужный в UI (`selectedVariant: 0|1|2`).  
Вариант 3 (`scene_N_v3.jpg`) — кастомный кадр, загруженный пользователем вручную.

Если у сцены есть `backgroundPrompt` + `subjectPrompt` — используется layered-генерация (фон + объект склеиваются через `sharp`).

---

## 9. Сервис анимации (FAL.AI)

**Файл:** `server/services/fal-animator.ts`

### 9.1 I2V-модели (Image-to-Video)

| Ключ модели | FAL endpoint | Параметры |
|-------------|-------------|-----------|
| `wan` | `fal-ai/wan/v2.7/image-to-video` | `width`, `height`, `num_frames: 81` |
| `kling` | `fal-ai/kling-video/v1.6/standard/image-to-video` | `duration: "5"\|"10"`, `aspect_ratio` |
| `kling-pro` | `fal-ai/kling-video/v1.6/pro/image-to-video` | `duration: "5"\|"10"`, `aspect_ratio` |
| `minimax` | `fal-ai/minimax/video-01-live/image-to-video` | только `prompt` |
| `seedance` | `fal-ai/bytedance/seedance/v1/lite/image-to-video` | `duration`, `resolution: "720p"`, `aspect_ratio` |

### 9.2 T2V-модели (Text-to-Video)

| Ключ модели | FAL endpoint | Параметры |
|-------------|-------------|-----------|
| `wan-t2v` | `fal-ai/wan/t2v-1.3b` | `width`, `height`, `num_frames: 81` |
| `kling-t2v` | `fal-ai/kling-video/v2/standard/text-to-video` | `duration`, `aspect_ratio` |
| `kling-pro-t2v` | `fal-ai/kling-video/v2/pro/text-to-video` | `duration`, `aspect_ratio` |
| `luma` | `fal-ai/luma-dream-machine/ray-2-flash` | `duration: "5s"\|"9s"`, `aspect_ratio` |

### 9.3 Механизм поллинга

FAL.AI использует асинхронную очередь:
1. `POST /queue/{model}` → возвращает `{ request_id, status_url, response_url }`
2. Поллинг `status_url` каждые 5 сек до статуса `COMPLETED` или `FAILED`
3. Результат: из `output` в ответе статуса (новые модели) или из `response_url` (старые)
4. Таймаут: 300 сек для большинства моделей, 360–420 сек для Kling Pro

Изображение передаётся как `data:image/jpeg;base64,...` inline (не как URL).

### 9.4 Fallback-цепочки

**I2V:** при ошибке основной модели → Wan 2.7 → Seedance → LTX-Video  
**T2V:** при ошибке → Wan T2V 1.3B → Luma

### 9.5 Размерность клипов

| Формат | width × height |
|--------|---------------|
| `9:16` | 480 × 832 |
| `16:9` | 832 × 480 |
| `1:1` | 576 × 576 |

---

## 10. Сервис озвучки (TTS)

**Файл:** `server/services/tts-generator.ts`

### 10.1 Провайдеры (приоритет)

| Приоритет | Провайдер | Модель | Ключ |
|-----------|-----------|--------|------|
| 1 (primary) | OpenAI | `tts-1`, голос: `shimmer` | `OPENAI_API_KEY` |
| 2 (fallback) | HuggingFace | `facebook/mms-tts-rus` (ru) / `facebook/mms-tts-eng` (en) | `HUGGINGFACE_API_KEY` |

При 429 от OpenAI (превышение квоты) — автоматический переход на HuggingFace.  
HuggingFace возвращает WAV → конвертируется в MP3 через ffmpeg.  
Endpoint: `https://router.huggingface.co/hf-inference/models/{model}` (новый роутер, **не** `api-inference.huggingface.co`).

### 10.2 Синхронизация с длиной клипа

| Ситуация | Действие |
|----------|----------|
| Аудио длиннее клипа на >8% и ratio ≤ 4.0 | Ускорение через ffmpeg `atempo` |
| Аудио короче клипа | Добавление тишины в конец |
| ratio > 4.0 | Оставляем как есть, логируем предупреждение |

---

## 11. Фоновая музыка

**Файл:** `server/services/music-generator.ts`  
**Провайдер:** HuggingFace MusicGen  
**Модель:** `facebook/musicgen-small`  
**Endpoint:** `https://router.huggingface.co/hf-inference/models/facebook/musicgen-small`  
**Ключ:** `HUGGINGFACE_API_KEY`

### 11.1 Логика

- Промпт строится автоматически по теме проекта через `buildMusicPrompt()`
- Запрос: `{ inputs: prompt, parameters: { max_new_tokens: 512 } }`
- Ответ: WAV → сохраняется в `data/images/{id}/music.wav`
- Вмикшируется в финальное видео через `mixBackgroundMusic()` в video-assembler
- Громкость музыки: **0.18** (голос преобладает)

### 11.2 Поведение при ошибке

Если ключ не задан или запрос упал — музыка тихо пропускается, видео собирается без неё. Не является блокирующей ошибкой.

---

## 12. Сборка видео (ffmpeg)

**Файл:** `server/services/video-assembler.ts`  
**ffmpeg:** сначала ищет системный (Alpine Docker), fallback — `@ffmpeg-installer/ffmpeg`

### 12.1 I2V-сборка (`assembleVideo`)

Для каждой сцены:
- `makeClip`: изображение × TTS-аудио → клип (с `apad` для выравнивания длин)
- Параметры: `libx264`, `ultrafast`, `crf 26`, `25fps`, `yuv420p`

Финальный concat: `ffmpeg -f concat -c:v copy`.

### 12.2 T2V-сборка (`assembleFromClips`)

Готовые клипы с FAL.AI мукс с TTS:
- Клип + аудио → мукс с `c:v copy`, `apad`, `-shortest`
- Финальный concat аналогично I2V

### 12.3 Субтитры (`burnSubtitles`)

Субтитры генерируются в формате ASS и записываются через `ass=` фильтр ffmpeg.

| Стиль | Описание |
|-------|----------|
| `none` | Без субтитров |
| `fade` | Полное предложение с плавным появлением/затуханием (350ms) |
| `karaoke` | Побуквенная/пословная подсветка (`\kf` тег ASS) |
| `tiktok` | Одно слово крупным шрифтом (70% ширины кадра) |
| `word-by-word` | Слова накапливаются на экране, текущее слово — жёлтым |

Шрифт: DejaVu Sans. Позиция: нижняя часть экрана (7% от края).

### 12.4 Микширование музыки (`mixBackgroundMusic`)

```
ffmpeg -i video.mp4 -i music.wav
  -filter_complex "[1:a]volume=0.18[music]; [0:a][music]amix=inputs=2:duration=first[aout]"
  -map 0:v -map [aout] -c:v copy -c:a aac
  → output_with_music.mp4
```

---

## 13. Загрузка API-ключей

**Файл:** `server/load-keys.ts`

### 13.1 Ключи (`service_name` в Directus)

| service_name | env var | Назначение |
|-------------|---------|-----------|
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | Gemini / Imagen |
| `GEMINI_PROXY_URL` | `GEMINI_PROXY_URL` | Прокси для Gemini (обход геоблока) |
| `OPENAI_API_KEY` | `OPENAI_API_KEY` | GPT + TTS + GPT-Image-2 |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | Claude |
| `fal_ai` | `FAL_AI_API_KEY` | FAL.AI анимация |
| `HUGGINGFACE_API_KEY` | `HUGGINGFACE_API_KEY` | TTS fallback + MusicGen + FLUX |
| `PEXELS_API_KEY` | `PEXELS_API_KEY` | Поиск стоковых видео |

### 13.2 Retry при старте

```
Попытка 1 (сразу) → Попытка 2 (+5с) → Попытка 3 (+10с) → Попытка 4 (+20с)
```

### 13.3 Dev vs Prod

| Среда | Directus | Токен |
|-------|---------|-------|
| Dev (Replit `REPL_ID` без `REPLIT_DEPLOYMENT`) | `https://directus.roboflow.space` | `DIRECTUS_DEV_TOKEN` |
| Prod | `DIRECTUS_URL` env var | `DIRECTUS_PROD_TOKEN` |

---

## 14. Форматы и ограничения

| Параметр | Допустимые значения |
|----------|---------------------|
| `format` | `9:16`, `16:9`, `1:1` |
| `duration` | любое число (сек); реальная длина = кол-во сцен × длина клипа |
| `language` | `ru`, `en` |
| `animationModel` | `wan`, `kling`, `kling-pro`, `minimax`, `seedance`, `wan-t2v`, `kling-t2v`, `kling-pro-t2v`, `luma` |
| `subtitleStyle` | `none`, `fade`, `karaoke`, `tiktok`, `word-by-word` |
| Макс. сцен | 8 |
| Мин. сцен | 2 |
| Варианты кадров | 0–2 (AI), 3 (пользовательский) |

---

## 15. Инфраструктура

### Dev (Replit)
- Порт 3001, воркфлоу `Video App`: `cd video-app && npx vite build && npx tsx server/index.ts`
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

## 16. Известные особенности и грабли

- **Wan 2.7 I2V**: принимает `width`/`height` + `num_frames: 81`. Не принимает `aspect_ratio`, `resolution`, `num_frames > 81`.
- **Kling**: длительность только `"5"` или `"10"` (строка, не число).
- **Luma**: длительность только `"5s"` или `"9s"`.
- **MiniMax**: не принимает размерные параметры — только `prompt`.
- **FAL polling**: `status_url` и `response_url` берутся из ответа submit-запроса. Конструировать URL вручную нельзя.
- **HuggingFace endpoint**: использовать `https://router.huggingface.co/hf-inference/models/...` — старый `api-inference.huggingface.co` устарел и возвращает 404.
- **OpenAI TTS квота**: при 429 сервис автоматически переключается на HuggingFace MMS-TTS. Если и он недоступен — сцена собирается без озвучки.
- **UI поллинг**: не останавливается на `script_ready` пока `script.stockPrechecked !== true` — иначе UI не увидит обновления от stock precheck.
- **Stock precheck пишет videoSource**: пречек всегда перезаписывает `videoSource` (found→stock, not found→ai), не сохраняет предыдущее значение — первый запуск после генерации сценария всегда авторитетен.
- **Gemini геоблок**: в продакшне `GEMINI_PROXY_URL` обязателен — прямые запросы из ряда регионов возвращают "User location not supported".
- **Сборка фронтенда**: при изменениях в `client/` обязательно запускать `cd video-app && npx vite build` перед перезапуском — раздаётся статическая сборка, не Vite dev server.
- **pg пакет**: должен быть в `video-app/package.json` — не полагаться на родительский `node_modules`.

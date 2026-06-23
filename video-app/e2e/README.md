# E2E тесты — Video Generator

Тесты используют **Node.js 20 built-in `node:test`** + **tsx** (уже в devDependencies).  
Никаких дополнительных пакетов устанавливать не нужно.

## Быстрый старт

```bash
# 1. Скопируй конфиг
cp video-app/e2e/.env.example video-app/e2e/.env

# 2. Заполни .env
VIDEO_E2E_URL=https://smm.omemo.tech/video-app/api
VIDEO_E2E_EMAIL=lbrspb@gmail.com
VIDEO_E2E_PASSWORD=<пароль из DIRECTUS_ADMIN_PASSWORD>

# 3. Запускай (из корня проекта или из video-app/)
npm run test:e2e:video:fast     # быстрые тесты ~30с (без генерации)
npm run test:e2e:video          # flow-тесты (генерация скрипта ~3 мин)
npm run test:quality:video      # проверка качества видео (~15 мин)
```

---

## Два набора тестов

### 1. `video-generator.e2e.ts` — Flow-тесты

Проверяют корректность работы API: создание, CRUD, валидация, генерация скрипта, polling.

```bash
cd video-app

# Только быстрые (auth, CRUD, TTS preview, валидация — ~30с)
SKIP_SLOW=1 npx tsx --test e2e/video-generator.e2e.ts

# С генерацией скрипта + stock precheck (~3-4 мин)
npx tsx --test e2e/video-generator.e2e.ts

# С полной генерацией видео (~15 мин, дорого по API)
npx tsx --test e2e/video-generator.e2e.ts
```

### 2. `video-quality.e2e.ts` — Тесты качества финального видео

Генерирует (или берёт готовый) проект и проверяет **финальный MP4**:

| Проверка | Что делает |
|----------|-----------|
| **Magic bytes** | MP4 начинается с `ftyp`/`moov` |
| **ffprobe: видеодорожка** | H.264 кодек, FPS ≥ 24 |
| **ffprobe: аудиодорожка** | TTS был добавлен в видео |
| **Длительность ±40%** | 30с → допустимо 18–42с |
| **Разрешение / формат** | 9:16 → портретное, 16:9 → альбомное, 1:1 → квадрат |
| **Битрейт > 500 kbps** | нет артефактов сжатия |
| **Скрипт: кол-во сцен** | соответствует длительности (1 сцена / 8-15с) |
| **Скрипт: текст ≠ пустой** | каждая сцена имеет текст > 10 символов |
| **Скрипт: ключевые слова** | ≥30% слов из темы встречается в тексте сцен |
| **Нет дублей сцен** | все тексты уникальные |
| **videoSource** | каждая сцена: `stock` / `ai` / `stock-animated` |
| **TTS аудио каждой сцены** | файл существует, длительность 0.5–60с |
| **Стоковые клипы** | валидный MP4, есть видеодорожка |

```bash
cd video-app

# Полный цикл: создать + сгенерировать + проверить
npx tsx --test e2e/video-quality.e2e.ts

# Проверить уже готовый проект (без повторной генерации, быстро):
VIDEO_PROJECT_ID=<id> npx tsx --test e2e/video-quality.e2e.ts
```

---

## Переменные окружения

| Переменная           | Умолчание                                        | Описание                                   |
|----------------------|--------------------------------------------------|--------------------------------------------|
| `VIDEO_E2E_URL`      | `https://smm.omemo.tech/video-app/api`           | Base URL API                               |
| `VIDEO_E2E_EMAIL`    | —                                                | Email для auth                             |
| `VIDEO_E2E_PASSWORD` | —                                                | Пароль                                     |
| `SKIP_SLOW`          | `0`                                              | `1` — пропустить генерацию                 |
| `SKIP_GENERATE`      | `0`                                              | `1` — пропустить полное видео              |
| `VIDEO_PROJECT_ID`   | —                                                | ID готового проекта (только для quality)   |

---

## Примеры вывода

**Быстрые тесты (SKIP_SLOW=1) — ~30с:**
```
▶ Health
  ✔ GET /health → 200 { status: ok } (243ms)
▶ Auth
  ✔ POST /auth/login без данных → 400 (189ms)
  ✔ POST /auth/login с неверным паролем → 401 (312ms)
  ✔ POST /auth/login с верными данными → token (445ms)
▶ POST /videos — валидация
  ✔ Без format и duration → 400 (154ms)
  ...
▶ TTS Preview
  ✔ /tts-preview/nova → audio/mpeg, >1 KB (4.2s)
  ✔ /tts-preview/shimmer → audio/mpeg, >1 KB (3.8s)
  ...
```

**Quality report в конце quality-теста:**
```
─── Quality Report ──────────────────────
Project ID  : abc123
Topic       : Польза утренней пробежки
Format      : 9:16
Duration    : 30s (requested)
Status      : done
Progress    : 100%
Scenes      : 4
Stock scenes: 2
AI scenes   : 2
Video URL   : https://...
─────────────────────────────────────────
```

## Cleanup

Все созданные тестом проекты (`[E2E Test] *`, `[E2E Quality] *`) **удаляются автоматически** в `after()`.  
При `VIDEO_PROJECT_ID` — проект **не удаляется** (он ваш).

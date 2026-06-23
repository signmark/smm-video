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
npm run test:e2e:video          # все тесты (генерация скрипта ~2мин)
```

Или напрямую из `video-app/`:
```bash
cd video-app

# Только быстрые (auth, CRUD, TTS preview, валидация)
SKIP_SLOW=1 npx tsx --test e2e/video-generator.e2e.ts

# С генерацией скрипта + stock precheck (~3-4 мин)
npx tsx --test e2e/video-generator.e2e.ts

# С полной генерацией видео (~10-15 мин, дорого)
npx tsx --test e2e/video-generator.e2e.ts
```

## Переменные окружения

| Переменная           | По умолчанию                                     | Описание                          |
|----------------------|--------------------------------------------------|-----------------------------------|
| `VIDEO_E2E_URL`      | `https://smm.omemo.tech/video-app/api`           | Base URL API                      |
| `VIDEO_E2E_EMAIL`    | —                                                | Email для auth                    |
| `VIDEO_E2E_PASSWORD` | —                                                | Пароль                            |
| `SKIP_SLOW`          | `0`                                              | `1` — пропустить генерацию        |
| `SKIP_GENERATE`      | `0`                                              | `1` — пропустить полное видео     |

## Структура тестов

| Сьют | Время | Описание |
|------|-------|----------|
| **Health** | ~1с | GET /health → 200 |
| **Auth** | ~3с | login валидация + токен |
| **POST /videos — валидация** | ~5с | 400 на плохие данные |
| **CRUD проекта** | ~10с | create/get/list/delete |
| **PATCH scenes** | ~3с | 404 на несуществующую сцену |
| **TTS Preview** | ~30с | 6 голосов × audio/mpeg |
| **Reset** | ~3с | POST /reset |
| **Генерация скрипта** ⏱ | ~2-3 мин | `SKIP_SLOW=1` пропускает |
| **Generate-variants** ⏱ | ~2 мин | зависит от предыдущего |
| **Полная генерация** ⏱⏱ | ~10-15 мин | `SKIP_GENERATE=1` пропускает |

⏱ — медленный тест, пропускается при `SKIP_SLOW=1`

## Cleanup

Все созданные тестом проекты (`[E2E Test] *`) **удаляются автоматически** в `after()` хуке.  
Если тест упал до cleanup — можно удалить вручную через UI или `DELETE /api/videos/:id`.

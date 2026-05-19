# Включение Instagram Stories на продакшене

## Как включить Stories

### Способ 1: Через переменную окружения (рекомендуется)

1. На продакшн сервере добавьте в `.env` файл:
```bash
ENABLE_INSTAGRAM_STORIES=true
```

2. Перезапустите приложение:
```bash
docker-compose restart
# или
npm run start
```

### Способ 2: На Replit

1. Перейдите в **Secrets** (замок слева)
2. Добавьте новый secret:
   - Key: `ENABLE_INSTAGRAM_STORIES`
   - Value: `true`
3. Перезапустите workflow

## Проверка готовности

Перед включением убедитесь:

- ✅ **Instagram Business API** настроен и работает
- ✅ **N8N webhook** для Stories протестирован (`/webhook/instagram-stories`)
- ✅ **S3 хранилище** доступно для видео
- ✅ **FFmpeg** установлен на сервере (проверка: `ffmpeg -version`)
- ✅ **Directus** работает и доступен

## Технические детали

### Что делает флаг

Переменная `ENABLE_INSTAGRAM_STORIES=true` включает:
- Редактор Stories в интерфейсе
- Конвертацию видео в формат Instagram (1080x1920, H.264, 30fps)
- Публикацию через N8N webhook
- Хостинг видео на S3

### Формат видео

Stories автоматически конвертируются в:
- **Разрешение**: 1080x1920 (вертикальное)
- **Кодек**: H.264 Main profile
- **FPS**: 30
- **Pixel format**: yuv420p
- **Bitrate**: 5000k

### API Endpoints

После включения доступны:
- `POST /api/stories/generate-preview` - Генерация превью
- `POST /api/stories/:id/convert` - Конвертация для Instagram
- `GET /api/stories/:id` - Получение Stories

## Отключение Stories

Для отключения просто установите:
```bash
ENABLE_INSTAGRAM_STORIES=false
```

Или удалите переменную из `.env`

## Мониторинг

Проверка статуса через API:
```bash
curl https://smm.omemo.tech/api/feature-flags
```

Должно вернуть:
```json
{
  "instagramStories": true,
  ...
}
```

## Troubleshooting

### Stories не появляются в интерфейсе
1. Проверьте переменную окружения: `echo $ENABLE_INSTAGRAM_STORIES`
2. Перезапустите сервер
3. Очистите кэш браузера (Stories кэшируются на 5 минут)

### Видео не конвертируется
1. Проверьте FFmpeg: `ffmpeg -version`
2. Проверьте логи: `docker logs root-smm-1`
3. Убедитесь что S3 доступен

### Stories не публикуются
1. Проверьте N8N webhook работает
2. Проверьте Instagram Business API credentials
3. Проверьте логи N8N workflow

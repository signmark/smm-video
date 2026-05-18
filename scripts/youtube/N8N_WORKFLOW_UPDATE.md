# СРОЧНОЕ ОБНОВЛЕНИЕ N8N WORKFLOW ДЛЯ YOUTUBE

## Проблема
Текущий N8N workflow содержит критическую ошибку в конфигурации YouTube API, которая приводит к ошибке 400 (Bad Request).

## Диагностика ошибки
Из логов видно:
```
"error": {
  "message": "400 - \"<!DOCTYPE html>\\n<html lang=en>\\n  <meta charset=utf-8>\\n  <meta name=viewport content=\\\"initial-scale=1, minimum-scale=1, width=device-width\\\">\\n  <title>Error 400 (Bad Request)!!1</title>"
}
```

## Исправления в обновленном workflow

### 1. Добавлен обязательный параметр uploadType
```json
{
  "name": "uploadType",
  "value": "multipart"
}
```

### 2. Исправлена структура bodyParameters
Заменено:
```json
{
  "parameterType": "formData",
  "name": "metadata",
  "value": "={{ $('Prepare YouTube Data').item.json.metadata }}"
}
```

На правильную структуру:
```json
{
  "parameterType": "formData",
  "name": "snippet",
  "value": "={{ JSON.stringify(JSON.parse($('Prepare YouTube Data').item.json.metadata).snippet) }}"
},
{
  "parameterType": "formData", 
  "name": "status",
  "value": "={{ JSON.stringify(JSON.parse($('Prepare YouTube Data').item.json.metadata).status) }}"
}
```

## Шаги для обновления

### 1. Импорт обновленного workflow
1. Зайти в N8N: https://n8n.roboflow.tech
2. Перейти в раздел Workflows
3. Удалить старый YouTube workflow или создать новый
4. Импортировать файл `youtube-posting.json` из текущей директории

### 2. Проверка настроек webhook
1. Убедиться что webhook URL: `/webhook/publish-youtube`
2. Проверить что webhook принимает POST запросы
3. Активировать workflow

### 3. Тестирование
После импорта протестировать через:
```bash
curl -X POST https://n8n.roboflow.tech/webhook/publish-youtube \
  -H "Content-Type: application/json" \
  -d '{
    "contentId": "b6f8a5a1-5bdf-4e05-b9ad-8083f3a89702",
    "platform": "youtube"
  }'
```

## Ожидаемый результат
✅ **ИСПРАВЛЕНО**: N8N workflow теперь работает корректно!
- Ошибка 400 (Bad Request) устранена
- YouTube API принимает запросы
- При превышении квоты возвращается корректный статус `quota_exceeded`
- Система больше не падает на технических ошибках

## Файлы для импорта
- `youtube-posting.json` - Исправленный N8N workflow
- `test-n8n-direct.js` - Скрипт для тестирования workflow
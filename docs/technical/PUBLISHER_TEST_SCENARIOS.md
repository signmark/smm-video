# Сценарии тестирования планировщика публикаций

После внедрения изменений в планировщик публикаций необходимо проверить следующие сценарии для подтверждения корректности работы.

## Сценарий 1: Все платформы успешно опубликованы

**Исходное состояние:**
```json
{
    "id": "25689034-6154-4dca-baf4-8330a0735865",
    "title": "Идеальный высокобелковый завтрак",
    "status": "scheduled",
    "socialPlatforms": {
        "vk": {
            "postId": 801,
            "status": "published",
            "postUrl": "https://vk.com/wall-228626989_801",
            "platform": "vk",
            "publishedAt": "2025-04-30T15:40:25.459Z",
            "selected": true
        },
        "telegram": {
            "postId": "12345",
            "status": "published",
            "postUrl": "https://t.me/channel/12345",
            "platform": "telegram",
            "publishedAt": "2025-04-30T15:40:26.123Z",
            "selected": true
        },
        "instagram": {
            "postId": "67890",
            "status": "published",
            "postUrl": "https://instagram.com/p/67890",
            "platform": "instagram",
            "publishedAt": "2025-04-30T15:40:28.789Z",
            "selected": true
        }
    }
}
```

**Ожидаемый результат:**
- Статус контента меняется на "published"
- В логах: "Контент 25689034-6154-4dca-baf4-8330a0735865: все платформы опубликованы (3/3)"
- В логах: "Обновление основного статуса контента 25689034-6154-4dca-baf4-8330a0735865 на "published", так как все выбранные платформы опубликованы"

## Сценарий 2: Есть платформа с ошибкой публикации

**Исходное состояние:**
```json
{
    "id": "7a982561-dafb-4e6a-8482-4aaf66239448",
    "title": "Подборка ПП обедов для здорового питания",
    "status": "scheduled",
    "socialPlatforms": {
        "vk": {
            "postId": 802,
            "status": "published",
            "postUrl": "https://vk.com/wall-228626989_802",
            "platform": "vk",
            "publishedAt": "2025-04-30T15:41:25.459Z",
            "selected": true
        },
        "telegram": {
            "postId": "12346",
            "status": "published",
            "postUrl": "https://t.me/channel/12346",
            "platform": "telegram",
            "publishedAt": "2025-04-30T15:41:26.123Z",
            "selected": true
        },
        "facebook": {
            "error": "API error: Invalid token",
            "status": "failed",
            "platform": "facebook",
            "selected": true
        }
    }
}
```

**Ожидаемый результат:**
- Статус контента **остаётся** "scheduled"
- В логах: "Контент 7a982561-dafb-4e6a-8482-4aaf66239448: обнаружены платформы с ошибками (1 платформ: facebook)"
- В логах: "Статус контента 7a982561-dafb-4e6a-8482-4aaf66239448 НЕ будет изменен из-за наличия ошибок публикации"

## Сценарий 3: Есть платформа со статусом "scheduled"

**Исходное состояние:**
```json
{
    "id": "d79562d5-e276-4fd8-a398-de42c1f49f13",
    "title": "ПП",
    "status": "scheduled",
    "socialPlatforms": {
        "vk": {
            "postId": 803,
            "status": "published",
            "postUrl": "https://vk.com/wall-228626989_803",
            "platform": "vk",
            "publishedAt": "2025-04-30T15:42:25.459Z",
            "selected": true
        },
        "facebook": {
            "status": "scheduled",
            "scheduledAt": "2025-05-01T10:00:00.000Z",
            "platform": "facebook",
            "selected": true
        }
    }
}
```

**Ожидаемый результат:**
- Планировщик обнаруживает платформу "facebook" со статусом "scheduled"
- Система пытается опубликовать в Facebook
- Статус контента **остаётся** "scheduled" до завершения публикации во все платформы
- В логах: "facebook: статус scheduled - ГОТОВ К ЗАПЛАНИРОВАННОЙ ПУБЛИКАЦИИ"
- В логах: "НАЙДЕНЫ ПЛАТФОРМЫ В СТАТУСЕ PENDING ИЛИ SCHEDULED - обрабатываем немедленно"

## Сценарий 4: Все платформы не выбраны или все в статусе "published"

**Исходное состояние:**
```json
{
    "id": "e8a7c492-f3d1-4b2c-9e5a-7c0d9f8e4b2a",
    "title": "Тестовый пост без выбранных платформ",
    "status": "scheduled",
    "socialPlatforms": {
        "vk": {
            "status": "pending",
            "platform": "vk",
            "selected": false
        },
        "telegram": {
            "status": "pending",
            "platform": "telegram",
            "selected": false
        }
    }
}
```

**Ожидаемый результат:**
- Планировщик не обнаруживает выбранных платформ для публикации
- Статус контента **остаётся** "scheduled"
- В логах не должно быть сообщений о попытках публикации

## Сценарий 5: Смешанные статусы платформ

**Исходное состояние:**
```json
{
    "id": "f1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "title": "Пост со смешанными статусами платформ",
    "status": "scheduled",
    "socialPlatforms": {
        "vk": {
            "postId": 804,
            "status": "published",
            "postUrl": "https://vk.com/wall-228626989_804",
            "platform": "vk",
            "publishedAt": "2025-04-30T15:43:25.459Z",
            "selected": true
        },
        "telegram": {
            "status": "pending",
            "platform": "telegram",
            "selected": true
        },
        "instagram": {
            "status": "scheduled",
            "scheduledAt": "2025-05-01T12:00:00.000Z",
            "platform": "instagram",
            "selected": true
        }
    }
}
```

**Ожидаемый результат:**
- Планировщик обнаруживает платформы "telegram" (pending) и "instagram" (scheduled)
- Система пытается опубликовать в Telegram и Instagram
- Статус контента **остаётся** "scheduled" до завершения публикации во все платформы
- В логах: "telegram: статус pending - ГОТОВ К НЕМЕДЛЕННОЙ ПУБЛИКАЦИИ"
- В логах: "instagram: статус scheduled - ГОТОВ К ЗАПЛАНИРОВАННОЙ ПУБЛИКАЦИИ"
- В логах: "НАЙДЕНЫ ПЛАТФОРМЫ В СТАТУСЕ PENDING ИЛИ SCHEDULED - обрабатываем немедленно"

## Важные аспекты тестирования

1. **Проверка логирования**: убедитесь, что все действия системы корректно логируются
2. **Обработка ошибок**: проверьте, что система корректно обрабатывает ошибки публикации
3. **Повторные попытки**: убедитесь, что система не "застревает" на платформах с ошибками
4. **Производительность**: проверьте, что изменения не привели к снижению производительности
5. **Долгосрочное поведение**: проследите за поведением системы в течение нескольких часов работы
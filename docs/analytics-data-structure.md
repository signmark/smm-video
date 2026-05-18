# Структура данных аналитики SMM Manager

## Обзор
В SMM Manager аналитика публикаций хранится в коллекции `campaign_content` в поле `social_platforms`. Каждая запись контента может содержать публикации на нескольких платформах.

## Структура данных

### Campaign Content
- **campaign_content** - основная коллекция с контентом для постов
- **social_platforms** - JSON поле, содержащее информацию о публикациях на разных платформах

### Пример структуры social_platforms

#### Публикация с аналитикой
```json
{
    "vk": {
        "postId": "944",
        "status": "published",
        "postUrl": "https://vk.com/wall-228626989_944",
        "platform": "vk",
        "analytics": {
            "likes": 0,
            "views": 1,
            "shares": 0,
            "comments": 0,
            "lastUpdated": "2025-05-23T07:18:02.617Z"
        },
        "publishedAt": "2025-05-20T14:45:09.057Z"
    },
    "telegram": {
        "postId": "1967",
        "status": "published",
        "postUrl": "https://t.me/c/2302366310/1967",
        "platform": "telegram",
        "analytics": {
            "likes": 0,
            "views": 2,
            "shares": 0,
            "comments": 0,
            "lastUpdated": "2025-05-23T07:18:00.834Z"
        },
        "publishedAt": "2025-05-20T14:40:48.993Z"
    }
}
```

#### Публикация без аналитики
```json
{
    "vk": {
        "postId": 955,
        "status": "published",
        "postUrl": "https://vk.com/wall-228626989_955",
        "platform": "vk",
        "publishedAt": "2025-05-22T15:49:32.367Z"
    },
    "facebook": {
        "status": "published",
        "postUrl": "https://facebook.com/2120362494678794_1005659338388027",
        "selected": true,
        "publishedAt": "2025-05-22T15:49:36.064Z"
    },
    "telegram": {
        "status": "published",
        "postUrl": "https://t.me/c/2302366310/1981",
        "platform": "telegram",
        "publishedAt": "2025-05-22T15:49:31.256Z"
    }
}
```

## Подсчет постов для аналитики

### Правила подсчета
1. **Общее количество постов** = сумма всех опубликованных постов на всех платформах
2. Пост считается если `status: "published"`
3. Каждая платформа в `social_platforms` считается отдельным постом
4. Аналитика может отсутствовать, но пост все равно считается

### Пример подсчета
Для контента с social_platforms:
```json
{
    "vk": { "status": "published" },
    "telegram": { "status": "published" },
    "facebook": { "status": "published" }
}
```
**Количество постов для этого контента = 3**

### Статусы постов
- **published** - опубликован (учитывается в подсчете)
- **draft** - черновик (не учитывается)
- **scheduled** - запланирован (не учитывается)
- **failed** - ошибка публикации (не учитывается)

## API аналитики

### Endpoint: GET /api/analytics
Возвращает агрегированную аналитику по кампании:

```json
{
    "success": true,
    "data": {
        "totalPosts": 25,
        "totalViews": 1234,
        "totalLikes": 56,
        "totalShares": 12,
        "totalComments": 8,
        "platforms": [
            {
                "name": "Telegram",
                "posts": 10,
                "views": 500,
                "likes": 20,
                "shares": 5,
                "comments": 3
            },
            {
                "name": "VK",
                "posts": 8,
                "views": 400,
                "likes": 15,
                "shares": 4,
                "comments": 2
            }
        ]
    }
}
```

## Поддерживаемые платформы
- **telegram** - Telegram
- **vk** - ВКонтакте
- **instagram** - Instagram
- **facebook** - Facebook

## Метрики аналитики
- **views** - просмотры
- **likes** - лайки
- **shares** - репосты/пересылки
- **comments** - комментарии
- **engagementRate** - коэффициент вовлеченности (только для Instagram)
- **clicks** - клики (только для Instagram)
/**
 * Swagger/OpenAPI документация для всех endpoints SMM Manager
 * Основано на реальной структуре server/routes.ts
 */

/**
 * @swagger
 * /api/debug-fal-ai:
 *   get:
 *     summary: Debug информация FAL AI сервиса
 *     tags: [Debug & Testing]
 *     responses:
 *       200:
 *         description: Debug информация
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/APIResponse'
 */

/**
 * @swagger
 * /api/test-fal-ai-formats-v2:
 *   get:
 *     summary: Тестирование форматов FAL AI v2
 *     tags: [Debug & Testing]
 *     responses:
 *       200:
 *         description: Результаты тестирования форматов
 */

/**
 * @swagger
 * /api/v1/image-gen:
 *   post:
 *     summary: Генерация изображений через FAL AI v1
 *     tags: [AI Generation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               prompt: { type: string, description: 'Промпт для генерации' }
 *               model: { type: string, description: 'Модель FAL AI' }
 *               width: { type: number, default: 512 }
 *               height: { type: number, default: 512 }
 *     responses:
 *       200:
 *         description: Сгенерированное изображение
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/APIResponse'
 */

/**
 * @swagger
 * /api/test/api-keys/priority:
 *   get:
 *     summary: Тестирование приоритета API ключей
 *     tags: [Debug & Testing]
 *     responses:
 *       200:
 *         description: Информация о приоритетах API ключей
 */

/**
 * @swagger
 * /api/settings/fal_ai:
 *   get:
 *     summary: Получение настроек FAL AI
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Настройки FAL AI
 */

/**
 * @swagger
 * /api/fal-ai-proxy:
 *   post:
 *     summary: Proxy для FAL AI запросов
 *     tags: [AI Generation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               model: { type: string }
 *               prompt: { type: string }
 *               parameters: { type: object }
 *     responses:
 *       200:
 *         description: Результат proxy запроса
 */

/**
 * @swagger
 * /api/translate-to-english:
 *   post:
 *     summary: Перевод текста на английский
 *     tags: [AI Generation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string, description: 'Текст для перевода' }
 *     responses:
 *       200:
 *         description: Переведенный текст
 */

/**
 * @swagger
 * /api/campaigns/{campaignId}/instagram-settings:
 *   get:
 *     summary: Получение настроек Instagram для кампании
 *     tags: [Social Media]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Настройки Instagram
 */

/**
 * @swagger
 * /api/campaigns/{campaignId}/fetch-instagram-business-id:
 *   post:
 *     summary: Получение Instagram Business ID для кампании
 *     tags: [Social Media]
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Instagram Business ID
 */

/**
 * @swagger
 * /api/generate-content:
 *   post:
 *     summary: Генерация контента с помощью AI
 *     tags: [AI Generation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AIGenerationRequest'
 *     responses:
 *       200:
 *         description: Сгенерированный контент
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/APIResponse'
 */

/**
 * @swagger
 * /api/generate-image:
 *   post:
 *     summary: Генерация изображений через AI
 *     tags: [AI Generation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               prompt: { type: string }
 *               model: { type: string }
 *               width: { type: number }
 *               height: { type: number }
 *               steps: { type: number }
 *     responses:
 *       200:
 *         description: Сгенерированное изображение
 */

/**
 * @swagger
 * /api/keywords/search:
 *   post:
 *     summary: Поиск ключевых слов
 *     tags: [Website Analysis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query: { type: string }
 *               limit: { type: number }
 *     responses:
 *       200:
 *         description: Найденные ключевые слова
 */

/**
 * @swagger
 * /api/generate-image-prompt:
 *   post:
 *     summary: Генерация промпта для изображения
 *     tags: [AI Generation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description: { type: string }
 *               style: { type: string }
 *     responses:
 *       200:
 *         description: Сгенерированный промпт
 */

/**
 * @swagger
 * /api/proxy-image:
 *   get:
 *     summary: Proxy для изображений
 *     tags: [File Management]
 *     parameters:
 *       - name: url
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *     responses:
 *       200:
 *         description: Проксированное изображение
 */

/**
 * @swagger
 * /api/video-thumbnail:
 *   get:
 *     summary: Получение миниатюры видео
 *     tags: [File Management]
 *     parameters:
 *       - name: url
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *     responses:
 *       200:
 *         description: Миниатюра видео
 */

/**
 * @swagger
 * /api/vk-video-info:
 *   get:
 *     summary: Получение информации о VK видео
 *     tags: [Social Media]
 *     parameters:
 *       - name: url
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *     responses:
 *       200:
 *         description: Информация о VK видео
 */

/**
 * @swagger
 * /api/instagram-video-info:
 *   get:
 *     summary: Получение информации об Instagram видео
 *     tags: [Social Media]
 *     parameters:
 *       - name: url
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *     responses:
 *       200:
 *         description: Информация об Instagram видео
 */

/**
 * @swagger
 * /api/analyze-site:
 *   get:
 *     summary: Анализ веб-сайта
 *     tags: [Website Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: url
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *     responses:
 *       200:
 *         description: Результат анализа сайта
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebsiteAnalysis'
 */

/**
 * @swagger
 * /api/admin/sources/remove-duplicates:
 *   delete:
 *     summary: Удаление дубликатов источников (админ)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Результат удаления дубликатов
 */

/**
 * @swagger
 * /api/wordstat/{keyword}:
 *   get:
 *     summary: Статистика по ключевому слову
 *     tags: [Website Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: keyword
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Статистика ключевого слова
 */

/**
 * @swagger
 * /api/sources:
 *   post:
 *     summary: Создание нового источника
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               url: { type: string, format: uri }
 *               campaign_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Созданный источник
 *   get:
 *     summary: Получение списка источников
 *     tags: [Trends Analysis]
 *     parameters:
 *       - name: campaign_id
 *         in: query
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Список источников
 */

/**
 * @swagger
 * /api/trends:
 *   get:
 *     summary: Получение списка трендов
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaign_id
 *         in: query
 *         schema:
 *           type: string
 *           format: uuid
 *       - name: limit
 *         in: query
 *         schema:
 *           type: number
 *       - name: offset
 *         in: query
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Список трендов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: 
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CampaignTrend'
 */

/**
 * @swagger
 * /api/campaign-trend-topics:
 *   get:
 *     summary: Получение топиков трендов кампании
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список топиков трендов
 */

/**
 * @swagger
 * /api/campaign-trend-topics/{campaignId}/collect:
 *   post:
 *     summary: Сбор топиков трендов для кампании
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Результат сбора топиков
 */

/**
 * @swagger
 * /api/source-posts:
 *   get:
 *     summary: Получение постов источников
 *     tags: [Trends Analysis]
 *     responses:
 *       200:
 *         description: Список постов источников
 */

/**
 * @swagger
 * /api/trends/collect:
 *   post:
 *     summary: Сбор трендов
 *     tags: [Trends Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campaign_id: { type: string, format: uuid }
 *               keywords: 
 *                 type: array
 *                 items: { type: string }
 *               platforms:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Результат сбора трендов
 */

/**
 * @swagger
 * /api/trends/collect-comments-single:
 *   post:
 *     summary: Сбор комментариев для одного тренда
 *     tags: [Trends Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trend_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Собранные комментарии
 */

/**
 * @swagger
 * /api/trends/collect-comments:
 *   post:
 *     summary: Сбор комментариев для трендов
 *     tags: [Trends Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trend_ids:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Собранные комментарии
 */

/**
 * @swagger
 * /api/sources/collect:
 *   post:
 *     summary: Сбор источников
 *     tags: [Trends Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campaign_id: { type: string, format: uuid }
 *               keywords:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Результат сбора источников
 */

/**
 * @swagger
 * /api/sources/search-by-campaign:
 *   post:
 *     summary: Поиск источников по кампании
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campaign_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Найденные источники
 */

/**
 * @swagger
 * /api/sources/{sourceId}/analyze:
 *   post:
 *     summary: AI анализ источника
 *     tags: [Trends Analysis]
 *     parameters:
 *       - name: sourceId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Результат AI анализа
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/CampaignContentSource'
 */

/**
 * @swagger
 * /api/sources/{sourceId}:
 *   patch:
 *     summary: Обновление источника
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: sourceId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Обновленный источник
 */

/**
 * @swagger
 * /api/campaigns:
 *   get:
 *     summary: Получение списка кампаний
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список кампаний пользователя
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Campaign'
 *   post:
 *     summary: Создание новой кампании
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               keywords:
 *                 type: array
 *                 items: { type: string }
 *               platforms:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       201:
 *         description: Созданная кампания
 */

/**
 * @swagger
 * /api/campaigns/{id}:
 *   get:
 *     summary: Получение кампании по ID
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Данные кампании
 *   patch:
 *     summary: Обновление кампании
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               settings: { type: object }
 *     responses:
 *       200:
 *         description: Обновленная кампания
 *   delete:
 *     summary: Удаление кампании
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Кампания удалена
 */

/**
 * @swagger
 * /api/campaign-trends:
 *   get:
 *     summary: Получение трендов кампании с комментариями
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaign_id
 *         in: query
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Тренды с метаданными комментариев
 */

/**
 * @swagger
 * /api/trend-comments/{trendId}:
 *   get:
 *     summary: Получение комментариев к тренду
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: trendId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Комментарии к тренду
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PostComment'
 */

/**
 * @swagger
 * /api/analyze-comments:
 *   post:
 *     summary: AI анализ комментариев
 *     tags: [Trends Analysis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               comments:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Результат анализа комментариев
 */

/**
 * @swagger
 * /api/keywords/{campaignId}:
 *   get:
 *     summary: Получение ключевых слов кампании
 *     tags: [Campaigns]
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Ключевые слова кампании
 */

/**
 * @swagger
 * /api/keywords:
 *   get:
 *     summary: Получение всех ключевых слов
 *     tags: [Website Analysis]
 *     responses:
 *       200:
 *         description: Список всех ключевых слов
 */

/**
 * @swagger
 * /api/keywords/{keywordId}:
 *   delete:
 *     summary: Удаление ключевого слова
 *     tags: [Website Analysis]
 *     parameters:
 *       - name: keywordId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ключевое слово удалено
 */

/**
 * @swagger
 * /api/campaign-content:
 *   get:
 *     summary: Получение контента кампании
 *     tags: [Content Management]
 *     parameters:
 *       - name: campaign_id
 *         in: query
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Список контента кампании
 *   post:
 *     summary: Создание нового контента
 *     tags: [Content Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *               campaign_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Созданный контент
 */

/**
 * @swagger
 * /api/campaign-content/{id}:
 *   get:
 *     summary: Получение контента по ID
 *     tags: [Content Management]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Данные контента
 *   patch:
 *     summary: Обновление контента
 *     tags: [Content Management]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               content: { type: string }
 *     responses:
 *       200:
 *         description: Обновленный контент
 *   delete:
 *     summary: Удаление контента
 *     tags: [Content Management]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Контент удален
 */

/**
 * @swagger
 * /api/content/{id}/adapt:
 *   post:
 *     summary: Адаптация контента для платформ
 *     tags: [Content Management]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platforms:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Адаптированный контент
 */

/**
 * @swagger
 * /api/content/{id}/publish:
 *   post:
 *     summary: Публикация контента
 *     tags: [Publications]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platforms:
 *                 type: array
 *                 items: { type: string }
 *               scheduled_at: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Результат публикации
 */

/**
 * @swagger
 * /api/content/{id}/publish-social:
 *   post:
 *     summary: Публикация в социальные сети
 *     tags: [Publications]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Результат публикации в социальные сети
 */

/**
 * @swagger
 * /api/youtube/refresh-token:
 *   post:
 *     summary: Обновление YouTube токена
 *     tags: [Social Media]
 *     responses:
 *       200:
 *         description: Обновленный токен
 */

/**
 * @swagger
 * /api/validate/telegram:
 *   post:
 *     summary: Валидация Telegram токена
 *     tags: [Social Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Результат валидации
 */

/**
 * @swagger
 * /api/validate/vk:
 *   post:
 *     summary: Валидация VK токена
 *     tags: [Social Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Результат валидации VK токена
 */

/**
 * @swagger
 * /api/validate/instagram:
 *   post:
 *     summary: Валидация Instagram токена
 *     tags: [Social Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Результат валидации Instagram токена
 */

/**
 * @swagger
 * /api/validate/facebook:
 *   post:
 *     summary: Валидация Facebook токена
 *     tags: [Social Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Результат валидации Facebook токена
 */

/**
 * @swagger
 * /api/validate/youtube:
 *   post:
 *     summary: Валидация YouTube API ключа
 *     tags: [Social Media]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               api_key: { type: string }
 *     responses:
 *       200:
 *         description: Результат валидации YouTube API ключа
 */

/**
 * @swagger
 * /api/stories/generate-preview:
 *   post:
 *     summary: Генерация превью для Stories
 *     tags: [Stories]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               story_data: { type: object }
 *     responses:
 *       200:
 *         description: Превью Stories
 */

/**
 * @swagger
 * /api/publish/scheduled:
 *   get:
 *     summary: Получение запланированных публикаций
 *     tags: [Publications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список запланированных публикаций
 */

/**
 * @swagger
 * /api/content/{id}/publish-status:
 *   get:
 *     summary: Проверка статуса публикации
 *     tags: [Publications]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Статус публикации
 */

/**
 * @swagger
 * /api/campaigns/{campaignId}/questionnaire:
 *   get:
 *     summary: Получение бизнес-анкеты кампании
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Бизнес-анкета кампании
 *   post:
 *     summary: Создание бизнес-анкеты для кампании
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               business_name: { type: string }
 *               industry: { type: string }
 *               target_audience: { type: string }
 *               key_services: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Созданная бизнес-анкета
 *   patch:
 *     summary: Обновление бизнес-анкеты
 *     tags: [Campaigns]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Обновленная бизнес-анкета
 */

/**
 * @swagger
 * /api/analyze-website-for-questionnaire:
 *   post:
 *     summary: Анализ сайта для автозаполнения анкеты
 *     tags: [Website Analysis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, format: uri }
 *     responses:
 *       200:
 *         description: Данные для автозаполнения анкеты
 */

/**
 * @swagger
 * /api/website-analysis:
 *   post:
 *     summary: Комплексный анализ веб-сайта
 *     tags: [Website Analysis]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, format: uri }
 *               analysis_type: { type: string, enum: ['full', 'keywords', 'business'] }
 *     responses:
 *       200:
 *         description: Результат анализа сайта
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebsiteAnalysis'
 */

/**
 * @swagger
 * /api/keywords/analyze-website:
 *   post:
 *     summary: AI анализ ключевых слов сайта
 *     tags: [Website Analysis]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url: { type: string, format: uri }
 *               max_keywords: { type: number, default: 20 }
 *     responses:
 *       200:
 *         description: Извлеченные ключевые слова с AI анализом
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/WebsiteAnalysis' }
 */

/**
 * @swagger
 * /api/content/generate-plan:
 *   post:
 *     summary: Генерация контент-плана
 *     tags: [Content Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               campaign_id: { type: string, format: uuid }
 *               duration_days: { type: number, default: 30 }
 *               posts_per_week: { type: number, default: 7 }
 *     responses:
 *       200:
 *         description: Сгенерированный контент-план
 */

/**
 * @swagger
 * /api/content/save-plan:
 *   post:
 *     summary: Сохранение контент-плана
 *     tags: [Content Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               plan_data: { type: object }
 *               campaign_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Сохраненный контент-план
 */

/**
 * @swagger
 * /api/trends/sentiment/{campaignId}:
 *   get:
 *     summary: Анализ настроений трендов кампании
 *     tags: [Trends Analysis]
 *     parameters:
 *       - name: campaignId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Анализ настроений трендов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     overall_sentiment: { type: string }
 *                     positive_percentage: { type: number }
 *                     negative_percentage: { type: number }
 *                     neutral_percentage: { type: number }
 *                     trends_analyzed: { type: number }
 */

/**
 * @swagger
 * /api/admin/create-smm-role:
 *   post:
 *     summary: Создание SMM роли (админ)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: SMM роль создана
 */

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Получение списка пользователей (админ)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список пользователей
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 */

/**
 * @swagger
 * /api/admin/users/{userId}:
 *   patch:
 *     summary: Обновление пользователя (админ)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string }
 *               role: { type: string }
 *     responses:
 *       200:
 *         description: Пользователь обновлен
 */

/**
 * @swagger
 * /api/vertex-ai/improve-text:
 *   post:
 *     summary: Улучшение текста через Vertex AI
 *     tags: [AI Generation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text: { type: string }
 *               improvement_type: { type: string, enum: ['grammar', 'style', 'clarity'] }
 *     responses:
 *       200:
 *         description: Улучшенный текст
 */
import swaggerJSDoc from 'swagger-jsdoc';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SMM Manager API',
      version: '1.0.0',
      description: 'AI-powered Social Media Content Management Platform API. Поддерживает мульти-платформенную публикацию, AI-генерацию контента, анализ трендов и источников.',
      contact: {
        name: 'SMM Manager Support',
        email: 'support@nplanner.ru',
      },
      license: {
        name: 'Proprietary',
        url: 'https://smm.omemo.tech/terms',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
      {
        url: 'https://smm.omemo.tech',
        description: 'Production server',
      },
      {
        url: 'https://staging.nplanner.ru',
        description: 'Staging server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /api/auth/login'
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'auth_token',
          description: 'Authentication cookie (httpOnly)'
        },
      },
      schemas: {
        // Базовые ответы API
        APIResponse: {
          type: 'object',
          properties: {
            success: { 
              type: 'boolean',
              description: 'Статус успешности операции'
            },
            data: { 
              type: 'object',
              description: 'Данные ответа (структура зависит от endpoint)'
            },
            error: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Сообщение об ошибке' },
                code: { 
                  type: 'string', 
                  enum: ['AUTH_REQUIRED', 'INSUFFICIENT_PERMISSIONS', 'VALIDATION_ERROR', 'EXTERNAL_API_ERROR', 'RATE_LIMIT_EXCEEDED'],
                  description: 'Код ошибки'
                },
                details: { type: 'object', description: 'Детали ошибки' },
              },
            },
            meta: {
              type: 'object',
              properties: {
                pagination: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    page: { type: 'number' },
                    limit: { type: 'number' },
                  },
                },
                timestamp: { 
                  type: 'string', 
                  format: 'date-time',
                  description: 'Время обработки запроса'
                },
              },
            },
          },
        },

        // Схемы данных Directus
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'UUID пользователя' },
            email: { type: 'string', format: 'email', description: 'Email пользователя' },
            first_name: { type: 'string', description: 'Имя' },
            last_name: { type: 'string', description: 'Фамилия' },
            role: { type: 'string', format: 'uuid', description: 'UUID роли' },
            is_smm_admin: { type: 'boolean', description: 'Флаг SMM администратора' },
            is_smm_super: { type: 'boolean', description: 'Флаг SMM супер-пользователя' },
            status: { 
              type: 'string', 
              enum: ['active', 'invited', 'draft', 'suspended'],
              description: 'Статус пользователя'
            },
            date_created: { type: 'string', format: 'date-time' },
            date_updated: { type: 'string', format: 'date-time' },
          },
        },

        Campaign: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'UUID кампании' },
            name: { type: 'string', description: 'Название кампании' },
            description: { type: 'string', description: 'Описание кампании' },
            keywords: { 
              type: 'array',
              items: { type: 'string' },
              description: 'Ключевые слова кампании'
            },
            platforms: {
              type: 'array',
              items: { 
                type: 'string',
                enum: ['vk', 'facebook', 'instagram', 'telegram', 'youtube']
              },
              description: 'Платформы для публикации'
            },
            settings: {
              type: 'object',
              description: 'JSON настройки кампании',
              properties: {
                collectionDays: { 
                  type: 'number', 
                  minimum: 1, 
                  maximum: 30,
                  description: 'Количество дней для сбора трендов'
                },
                autoPublish: { type: 'boolean' },
                schedulingEnabled: { type: 'boolean' },
              },
            },
            status: { 
              type: 'string',
              enum: ['active', 'paused', 'completed', 'draft'],
              description: 'Статус кампании'
            },
            user_created: { type: 'string', format: 'uuid' },
            date_created: { type: 'string', format: 'date-time' },
            date_updated: { type: 'string', format: 'date-time' },
          },
        },

        CampaignTrend: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'UUID тренда' },
            campaign_id: { type: 'string', format: 'uuid', description: 'UUID кампании' },
            title: { type: 'string', description: 'Заголовок тренда' },
            content: { type: 'string', description: 'Содержание тренда' },
            post_url: { type: 'string', format: 'uri', description: 'URL исходного поста' },
            platform: {
              type: 'string',
              enum: ['vk', 'facebook', 'instagram', 'telegram', 'youtube'],
              description: 'Платформа источника'
            },
            metrics: {
              type: 'object',
              properties: {
                likes: { type: 'number' },
                comments: { type: 'number' },
                shares: { type: 'number' },
                views: { type: 'number' },
              },
              description: 'Метрики поста'
            },
            collected_at: { type: 'string', format: 'date-time' },
            date_created: { type: 'string', format: 'date-time' },
          },
        },

        CampaignContentSource: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'UUID источника' },
            campaign_id: { type: 'string', format: 'uuid', description: 'UUID кампании' },
            name: { type: 'string', description: 'Название источника' },
            description: { type: 'string', description: 'Описание источника' },
            source_url: { type: 'string', format: 'uri', description: 'URL источника' },
            analysis_result: {
              type: 'object',
              properties: {
                sentiment: {
                  type: 'string',
                  enum: ['positive', 'negative', 'neutral'],
                  description: 'Общее настроение'
                },
                score: { 
                  type: 'number', 
                  minimum: 1, 
                  maximum: 10,
                  description: 'Оценка от 1 до 10'
                },
                confidence: { 
                  type: 'number', 
                  minimum: 0, 
                  maximum: 1,
                  description: 'Уверенность анализа'
                },
                commentsCount: { type: 'number', description: 'Количество комментариев' },
                commentsAnalyzed: { type: 'number', description: 'Проанализировано комментариев' },
                analysisMethod: {
                  type: 'string',
                  enum: ['AI', 'keywords', 'basic'],
                  description: 'Метод анализа'
                },
                summary: { type: 'string', description: 'Краткая сводка' },
                detailed_summary: { type: 'string', description: 'Подробный анализ аудитории' },
                ai_summary: { type: 'string', description: 'AI-анализ (если доступен)' },
                positive_percentage: { type: 'number', minimum: 0, maximum: 100 },
                negative_percentage: { type: 'number', minimum: 0, maximum: 100 },
                neutral_percentage: { type: 'number', minimum: 0, maximum: 100 },
              },
              description: 'Результат AI анализа источника'
            },
            date_created: { type: 'string', format: 'date-time' },
            date_updated: { type: 'string', format: 'date-time' },
          },
        },

        PostComment: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'ID комментария' },
            trent_post_id: { type: 'string', format: 'uuid', description: 'UUID связанного тренда' },
            text: { type: 'string', description: 'Текст комментария' },
            author: { type: 'string', description: 'ID автора комментария' },
            date: { type: 'string', format: 'date-time', description: 'Дата комментария' },
            comment_id: { type: 'string', description: 'ID комментария на платформе' },
            platform: {
              type: 'string',
              enum: ['vk', 'facebook', 'instagram', 'telegram', 'youtube'],
              description: 'Платформа комментария'
            },
          },
        },

        // AI модели и запросы
        AIModels: {
          type: 'string',
          enum: [
            'gemini-2.5-flash',
            'gemini-1.5-flash',
            'deepseek-v3',
            'claude-3.5-sonnet',
            'fal-ai/flux-pro',
            'fal-ai/flux-dev'
          ],
          description: 'Доступные AI модели'
        },

        AIGenerationRequest: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { 
              type: 'string', 
              description: 'Промпт для генерации',
              example: 'Создай пост о здоровом питании для Instagram'
            },
            model: { 
              $ref: '#/components/schemas/AIModels',
              description: 'AI модель для генерации'
            },
            temperature: { 
              type: 'number', 
              minimum: 0, 
              maximum: 2,
              default: 0.7,
              description: 'Креативность модели'
            },
            maxTokens: { 
              type: 'number', 
              minimum: 1, 
              maximum: 8000,
              default: 3000,
              description: 'Максимальное количество токенов'
            },
            context: {
              type: 'object',
              properties: {
                campaignId: { type: 'string', format: 'uuid' },
                platform: { type: 'string' },
                targetAudience: { type: 'string' },
              },
              description: 'Контекст для генерации'
            },
          },
        },

        // Stories
        Story: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'UUID истории' },
            title: { type: 'string', description: 'Название истории' },
            content: {
              type: 'object',
              description: 'Структура слайдов истории',
              properties: {
                slides: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      elements: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            type: {
                              type: 'string',
                              enum: ['text', 'image', 'video', 'poll', 'question']
                            },
                            position: {
                              type: 'object',
                              properties: {
                                x: { type: 'number' },
                                y: { type: 'number' },
                              },
                            },
                            styling: { type: 'object' },
                            timing: {
                              type: 'object',
                              properties: {
                                start: { type: 'number' },
                                end: { type: 'number' },
                              },
                            },
                          },
                        },
                      },
                      duration: { type: 'number', description: 'Длительность слайда в секундах' },
                    },
                  },
                },
              },
            },
            campaign_id: { type: 'string', format: 'uuid' },
            platforms: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['instagram', 'facebook', 'vk', 'telegram']
              }
            },
            status: {
              type: 'string',
              enum: ['draft', 'published', 'scheduled', 'failed']
            },
            date_created: { type: 'string', format: 'date-time' },
            date_updated: { type: 'string', format: 'date-time' },
          },
        },

        // Публикации
        Publication: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', description: 'UUID публикации' },
            campaign_id: { type: 'string', format: 'uuid', description: 'UUID кампании' },
            content: { type: 'string', description: 'Содержание публикации' },
            platforms: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['vk', 'facebook', 'instagram', 'telegram', 'youtube']
              },
              description: 'Платформы для публикации'
            },
            scheduled_at: { 
              type: 'string', 
              format: 'date-time',
              description: 'Время запланированной публикации'
            },
            status: {
              type: 'string',
              enum: ['draft', 'scheduled', 'publishing', 'published', 'failed'],
              description: 'Статус публикации'
            },
            media_urls: {
              type: 'array',
              items: { type: 'string', format: 'uri' },
              description: 'URLs медиафайлов'
            },
            publication_results: {
              type: 'object',
              description: 'Результаты публикации по платформам',
              additionalProperties: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  post_id: { type: 'string' },
                  url: { type: 'string', format: 'uri' },
                  error: { type: 'string' },
                },
              },
            },
            date_created: { type: 'string', format: 'date-time' },
            date_updated: { type: 'string', format: 'date-time' },
          },
        },

        // Анализ веб-сайтов
        WebsiteAnalysis: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', description: 'Анализируемый URL' },
            keywords: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  keyword: { type: 'string', description: 'Ключевое слово' },
                  relevance: { type: 'number', minimum: 0, maximum: 1, description: 'Релевантность' },
                  category: { type: 'string', description: 'Категория' },
                  competition: {
                    type: 'string',
                    enum: ['low', 'medium', 'high'],
                    description: 'Уровень конкуренции'
                  },
                },
              },
            },
            business_info: {
              type: 'object',
              properties: {
                industry: { type: 'string', description: 'Отрасль' },
                target_audience: { type: 'string', description: 'Целевая аудитория' },
                key_services: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Основные услуги/продукты'
                },
                tone: { type: 'string', description: 'Тон коммуникации' },
              },
            },
            analysis_method: {
              type: 'string',
              enum: ['AI', 'content-based', 'fallback'],
              description: 'Метод анализа'
            },
            analyzed_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    tags: [
      {
        name: 'Authentication',
        description: 'Endpoints для аутентификации и авторизации'
      },
      {
        name: 'Campaigns',
        description: 'Управление SMM кампаниями'
      },
      {
        name: 'AI Generation',
        description: 'AI-генерация контента и изображений'
      },
      {
        name: 'Trends Analysis',
        description: 'Анализ трендов и источников'
      },
      {
        name: 'Publications',
        description: 'Управление публикациями'
      },
      {
        name: 'Stories',
        description: 'Создание и управление Stories'
      },
      {
        name: 'Website Analysis',
        description: 'Анализ веб-сайтов и извлечение ключевых слов'
      },
      {
        name: 'File Management',
        description: 'Загрузка и управление файлами'
      },
      {
        name: 'Social Media',
        description: 'Интеграция с социальными платформами'
      },
    ],
  },
  apis: [
    './server/swagger-endpoints.ts',
    './server/routes.ts',
    './server/api/*.ts',
    './server/routes/*.ts',
  ],
};

const specs = swaggerJSDoc(options);
export default specs;
# Документация проекта SMM Manager

Эта папка содержит всю документацию проекта, разделенную по категориям для удобства навигации.

## Структура

- [api/](./api/) - Документация по API архитектуре и интеграциям
- [ai/](./ai/) - Интеграция с AI моделями
- [auth/](./auth/) - Авторизация и Directus
- [social_media/](./social_media/) - Интеграции с социальными сетями
- [storage/](./storage/) - Хранение данных и S3 интеграции
- [deployment/](./deployment/) - Инструкции по развертыванию
- [technical/](./technical/) - Технические документы и архитектурные решения
- [project/](./project/) - Проектные документы
- [testing/](./testing/) - Тестирование компонентов

## Для агентов — с чего начать

Ключевые документы при первом входе в проект:

| Документ | Зачем читать |
|----------|--------------|
| [../replit_agent/architecture.md](../replit_agent/architecture.md) | Общая архитектура: React, Express, Directus, PostgreSQL, S3 |
| [../replit.md](../replit.md) | Стек, команды запуска, architecture decisions |
| [AUTH_ARCHITECTURE_FINDINGS.md](./AUTH_ARCHITECTURE_FINDINGS.md) | **Auth и feature flags:** 3 механизма токенов, откуда брать email, типичные ловушки |
| [auth/directus-auth-overview.md](./auth/directus-auth-overview.md) | Как устроена авторизация через Directus |
| [autonomous-agents-roadmap.md](./autonomous-agents-roadmap.md) | Автономные ИИ-агенты SMM: текущее состояние и roadmap |
| [ai/WEB_CRAWLER_AI_INTEGRATION_GUIDE.md](./ai/WEB_CRAWLER_AI_INTEGRATION_GUIDE.md) | Веб-краулер и AI-агент для анализа сайтов |
| [../.agents/memory/MEMORY.md](../.agents/memory/MEMORY.md) | Память Cursor-агента: накопленные знания по проекту |

## Документация по реализациям

Детальная документация по реализации компонентов находится в [implementation_docs/](../implementation_docs/)

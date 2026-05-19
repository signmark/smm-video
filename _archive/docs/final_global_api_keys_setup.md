# Финальная настройка всех основных таблиц системы

## Шаг 1: Выполните SQL
Выполните SQL из файла `create_essential_tables.sql` в PostgreSQL админке.

Этот файл создает все основные таблицы:
1. **user_campaigns** - кампании пользователей
2. **global_api_keys** - глобальные API ключи со всеми реальными ключами
3. **campaign_content** - контент кампаний  
4. **user_api_keys** - персональные API ключи пользователей
5. **campaign_trend_topics** - трендовые темы кампаний
6. **campaign_keywords** - ключевые слова кампаний

## Шаг 2: Обновите схему Directus
```bash
node refresh_directus_schema.js
```

## Результат
В Directus админке появятся все таблицы с только нужными полями, без лишних полей.

Global API Keys будет содержать все реальные ключи:
- Claude
- FAL AI
- XMLRiver
- Qwen
- DeepSeek
- Gemini
- Perplexity
- Apify

Система готова к работе с полным набором таблиц и данных.
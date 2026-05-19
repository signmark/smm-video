# Финальные шаги настройки

## 1. Упростить таблицу Global API Keys
Выполни SQL из файла `simplify_global_api_keys.sql`:
```sql
-- Создаст новую таблицу только с нужными полями:
-- id, service_name, api_key, is_active, description
```

## 2. Обновить схему Directus
После выполнения SQL запусти:
```bash
node refresh_directus_schema.js
```

## 3. Проверить результат
В Directus админке таблица Global API Keys будет содержать только 5 полей:
- ID
- Сервис 
- API Ключ
- Активен
- Описание

## 4. Готово
Таблица станет чистой и удобной для использования без лишних полей.
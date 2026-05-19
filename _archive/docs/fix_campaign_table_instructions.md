# Инструкции по исправлению таблицы user_campaigns

## Проблема
База данных ожидает поле `title`, но по скриншоту должно быть поле `name`.

## Шаги исправления:

### 1. Удалить старую таблицу
В Directus админке или через SQL:
```sql
DROP TABLE IF EXISTS user_campaigns CASCADE;
```

### 2. Создать новую таблицу с правильной структурой
Выполни SQL из файла `recreate_user_campaigns_table.sql`:
```sql
CREATE TABLE user_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(255),  -- Это поле вместо title!
    link TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    trend_analysis_settings JSONB DEFAULT '{}',
    social_media_settings JSONB DEFAULT '{}'
);
```

### 3. Обновить коллекцию в Directus
- Зайди в Directus админку
- Обнови схему данных (может потребоваться перезапуск Directus)
- Проверь что в коллекции user_campaigns есть поле `name`

### 4. Протестировать
После пересоздания таблицы запусти:
```bash
node test_campaign_creation.js
```

## Файлы уже обновлены:
- ✅ `shared/schema.ts` - схема использует поле `name`
- ✅ `test_campaign_creation.js` - тест отправляет поле `name`
- ✅ `recreate_user_campaigns_table.sql` - SQL для правильной структуры

## После исправления таблицы все должно работать!
# ЭКСТРЕННЫЙ ПЛАН ДЕЙСТВИЙ - ОСТАНОВКА МАССОВЫХ ПУБЛИКАЦИЙ

## КРИТИЧЕСКАЯ СИТУАЦИЯ
**Production сервер directus.nplanner.ru создает бесконечный цикл дублирующихся публикаций**

### Выявленная проблема:
1. Планировщик публикует контент в Facebook без postUrl
2. Система автоматически "исправляет" статус published → pending 
3. Планировщик снова публикует тот же контент
4. Цикл повторяется каждые 20 секунд

### НЕМЕДЛЕННЫЕ ДЕЙСТВИЯ ТРЕБУЮТСЯ:

## 1. ЭКСТРЕННАЯ ОСТАНОВКА PRODUCTION СЕРВЕРА
```bash
# Подключиться к production серверу и выполнить:
docker-compose down
# или
sudo systemctl stop smm-service
```

## 2. ДОСТУП К PRODUCTION БАЗЕ ДАННЫХ
Выполнить SQL-запросы для остановки публикаций:

```sql
-- Остановить все запланированные публикации
UPDATE campaign_content 
SET status = 'draft' 
WHERE status = 'scheduled';

-- Исправить проблемные Facebook записи без postUrl
UPDATE campaign_content 
SET social_platforms = jsonb_set(
    social_platforms,
    '{facebook,status}',
    '"not_selected"'
)
WHERE social_platforms::text LIKE '%"facebook"%'
  AND social_platforms::text LIKE '%"status":"published"%' 
  AND (social_platforms::text NOT LIKE '%"postUrl"%' 
       OR social_platforms::text LIKE '%"postUrl":null%'
       OR social_platforms::text LIKE '%"postUrl":""%');

-- Сбросить все pending статусы
UPDATE campaign_content 
SET social_platforms = REPLACE(
    social_platforms::text, 
    '"status":"pending"', 
    '"status":"not_selected"'
)::jsonb
WHERE social_platforms::text LIKE '%"status":"pending"%';
```

## 3. ИСПРАВЛЕНИЕ КОДА ПЕРЕД ПЕРЕЗАПУСКОМ

### Проблема в логике "исправления статусов"
Файл: `server/services/publish-scheduler.ts`

Найти код:
```typescript
[scheduled] ИСПРАВЛЕНИЕ: платформа facebook имела статус 'published' без postUrl - сброшено на 'pending'
```

И изменить логику на:
```typescript
// Вместо сброса на 'pending', устанавливать 'failed' или 'not_selected'
if (platformData?.status === 'published' && (!platformData?.postUrl || platformData?.postUrl.trim() === '')) {
  // НЕ СБРАСЫВАТЬ НА PENDING - это создает бесконечный цикл
  platformData.status = 'failed';
  platformData.error = 'Published without postUrl - marking as failed';
}
```

## 4. КОРНЕВАЯ ПРИЧИНА

### Facebook API не возвращает postUrl
- Webhook n8n возвращает пустой ответ: `""`
- Система считает публикацию успешной
- Но postUrl отсутствует
- Логика "исправления" создает цикл

### Исправление webhook Facebook:
1. n8n workflow должен возвращать postUrl
2. Или система должна получать postUrl после публикации
3. Или помечать как 'failed' при отсутствии postUrl

## 5. ПРОВЕРКА ЛОГОВ ПОСЛЕ ИСПРАВЛЕНИЯ

После перезапуска искать в логах:
```
✅ НЕ ДОЛЖНО БЫТЬ:
- "ИСПРАВЛЕНИЕ: платформа facebook имела статус 'published' без postUrl - сброшено на 'pending'"
- Повторных публикаций одного контента

✅ ДОЛЖНО БЫТЬ:
- "Контент успешно опубликован"
- "Статус обновлен на published"
- Уникальные публикации без дубликатов
```

## 6. МОНИТОРИНГ ВОССТАНОВЛЕНИЯ

После исправления кода:
1. Запустить production сервер
2. Следить за логами в течение 5 минут
3. Убедиться в отсутствии дублирующихся публикаций
4. Проверить корректность postUrl в успешных публикациях

## КОНТАКТЫ ДЛЯ ЭКСТРЕННОЙ СВЯЗИ
- Сервер: directus.nplanner.ru
- База данных: PostgreSQL через Directus
- Логи: docker logs smm-1

---
**ПРИОРИТЕТ: КРИТИЧЕСКИЙ**
**ВРЕМЯ ВЫПОЛНЕНИЯ: НЕМЕДЛЕННО**
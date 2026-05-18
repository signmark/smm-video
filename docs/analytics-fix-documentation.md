# Документация по исправлению системы аналитики

## Проблема
Система аналитики показывала статические данные и не реагировала на переключение кампаний.

## Решение

### 1. Исправление импорта campaignStore
Проблема: Неправильный путь импорта в `client/src/pages/analytics/index.tsx`

**Было:**
```typescript
import { useCampaignStore } from '@/lib/stores/campaignStore';
```

**Стало:**
```typescript
import { useCampaignStore } from '@/lib/campaignStore';
```

### 2. Подключение реактивности кампаний

**Было:**
```typescript
const [selectedCampaign, setSelectedCampaign] = useState<string>('46868c44-c6a4-4bed-accf-9ad07bba790e');
```

**Стало:**
```typescript
const { activeCampaign, campaigns } = useCampaignStore();
const [selectedCampaign, setSelectedCampaign] = useState<string>(activeCampaign?.id || '46868c44-c6a4-4bed-accf-9ad07bba790e');

// Обновляем выбранную кампанию при изменении активной кампании
useEffect(() => {
  if (activeCampaign?.id && activeCampaign.id !== selectedCampaign) {
    setSelectedCampaign(activeCampaign.id);
    console.log('🔄 Переключение на активную кампанию:', activeCampaign.name, activeCampaign.id);
  }
}, [activeCampaign?.id]);
```

### 3. Система работы с данными

#### Ключевые моменты:
- Данные загружаются из Directus API напрямую из frontend
- Используется токен текущего пользователя из localStorage
- Query key включает selectedCampaign для автоматического обновления при смене кампании:
  ```typescript
  queryKey: ['analytics', selectedCampaign, selectedPeriod]
  ```

#### Логика подсчета постов:
- Каждая запись в social_networks считается отдельным постом
- Пост опубликованный на 3 платформы = 3 поста
- Фильтрация по статусу 'published' и дате публикации

### 4. Структура данных

#### Запрос к Directus:
```
https://directus.nplanner.ru/items/campaign_content?filter[campaign_id][_eq]=ID&filter[status][_eq]=published&filter[published_at][_gte]=$NOW(-7 days)
```

#### Обработка social_platforms:
```typescript
// Подсчет постов по платформам
if (item.social_platforms && typeof item.social_platforms === 'object') {
  Object.entries(item.social_platforms).forEach(([platform, platformData]: [string, any]) => {
    if (platformData.status === 'published' && platformData.publishedAt) {
      // Увеличиваем счетчик постов для платформы
      if (!platformStats[platform]) {
        platformStats[platform] = { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 };
      }
      platformStats[platform].posts += 1;
      
      // Добавляем метрики из analytics
      if (platformData.analytics) {
        platformStats[platform].views += platformData.analytics.views || 0;
        platformStats[platform].likes += platformData.analytics.likes || 0;
        platformStats[platform].comments += platformData.analytics.comments || 0;
        platformStats[platform].shares += platformData.analytics.shares || 0;
      }
    }
  });
}
```

## Статус выполнения

✅ **Выполнено:**
- Исправлен импорт campaignStore
- Добавлена реактивность к переключению кампаний
- Подключен useEffect для автоматического обновления
- Система получает реальные данные из Directus

🔄 **В процессе:**
- Перезапуск сервера для применения изменений
- Тестирование переключения между кампаниями

## Технические детали

### Файлы изменены:
- `client/src/pages/analytics/index.tsx` - основная логика аналитики
- Создан этот документ для воспроизведения функциональности

### Зависимости:
- `useCampaignStore` - для работы с активной кампанией
- `useQuery` - для загрузки данных с реактивностью
- Directus API - источник данных
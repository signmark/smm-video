# 🚀 Инструкция по деплою базы Telegram каналов на PROD

## 📋 Обзор системы

**Компоненты:**
- База данных: 24,000+ Telegram каналов (12 категорий × 2000 каналов)
- Автоматический граббер с TGStat.ru (Puppeteer)
- AI-умный поиск и фильтрация
- Интеграция с Directus CMS

---

## 🗄️ Шаг 1: Создание таблиц в Directus (Production)

### 1.1 Подключитесь к продакшн базе данных Directus

```bash
# Через pgAdmin или psql подключитесь к продакшн PostgreSQL:
psql -h <PROD_DB_HOST> -U <PROD_DB_USER> -d <PROD_DB_NAME>
```

### 1.2 Выполните SQL для создания таблиц

Скопируйте и выполните содержимое файла `directus_telegram_channels.sql`:

```sql
-- 1. Таблица категорий Telegram-каналов
CREATE TABLE IF NOT EXISTS telegram_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    name_ru VARCHAR(255) NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_es VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_created UUID REFERENCES directus_users(id),
    user_updated UUID REFERENCES directus_users(id)
);

-- 2. Таблица Telegram-каналов
CREATE TABLE IF NOT EXISTS telegram_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES telegram_categories(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    username VARCHAR(255) NOT NULL,
    link TEXT NOT NULL,
    subscribers INTEGER DEFAULT 0,
    description TEXT,
    language VARCHAR(10) DEFAULT 'ru',
    is_verified BOOLEAN DEFAULT false,
    avg_post_reach INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2) DEFAULT 0.00,
    content_type VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_created UUID REFERENCES directus_users(id),
    user_updated UUID REFERENCES directus_users(id)
);

-- 3. Индексы для быстрого поиска
CREATE INDEX idx_telegram_channels_category ON telegram_channels(category_id);
CREATE INDEX idx_telegram_channels_subscribers ON telegram_channels(subscribers DESC);
CREATE INDEX idx_telegram_channels_username ON telegram_channels(username);
CREATE INDEX idx_telegram_channels_language ON telegram_channels(language);
CREATE INDEX idx_telegram_channels_active ON telegram_channels(is_active);

-- 4. Начальные категории
INSERT INTO telegram_categories (name, name_ru, name_en, name_es, description, icon) VALUES
('tech', 'Технологии', 'Technology', 'Tecnología', 'IT, гаджеты, новости технологий', 'laptop'),
('business', 'Бизнес', 'Business', 'Negocios', 'Предпринимательство, стартапы, бизнес-новости', 'briefcase'),
('marketing', 'Маркетинг', 'Marketing', 'Marketing', 'SMM, реклама, продвижение', 'megaphone'),
('food', 'Еда и кулинария', 'Food & Cooking', 'Comida y Cocina', 'Рецепты, рестораны, кулинария', 'utensils'),
('travel', 'Путешествия', 'Travel', 'Viajes', 'Туризм, путешествия, советы', 'plane'),
('fashion', 'Мода и красота', 'Fashion & Beauty', 'Moda y Belleza', 'Стиль, красота, мода', 'shirt'),
('health', 'Здоровье и фитнес', 'Health & Fitness', 'Salud y Fitness', 'ЗОЖ, спорт, здоровье', 'heart'),
('finance', 'Финансы', 'Finance', 'Finanzas', 'Инвестиции, криптовалюты, финансы', 'dollar-sign'),
('education', 'Образование', 'Education', 'Educación', 'Обучение, курсы, развитие', 'book'),
('entertainment', 'Развлечения', 'Entertainment', 'Entretenimiento', 'Юмор, развлечения, мемы', 'smile'),
('news', 'Новости', 'News', 'Noticias', 'Новостные каналы', 'newspaper'),
('crypto', 'Криптовалюты', 'Cryptocurrency', 'Criptomonedas', 'Крипто, блокчейн, NFT', 'bitcoin')
ON CONFLICT (name) DO NOTHING;
```

### 1.3 Проверьте создание таблиц

```sql
-- Проверка категорий
SELECT COUNT(*) FROM telegram_categories;
-- Должно быть 12 категорий

-- Проверка структуры таблицы каналов
\d telegram_channels
```

---

## 📥 Шаг 2: Настройка Directus коллекций

### 2.1 Войдите в Directus Admin Panel (Production)

Откройте: `https://directus.roboflow.space/admin`

### 2.2 Добавьте коллекции в Directus

1. **Settings** → **Data Model**
2. Найдите созданные таблицы:
   - `telegram_categories`
   - `telegram_channels`
3. Настройте отображение полей:
   - **Display Template** для `telegram_categories`: `{{name_ru}}`
   - **Display Template** для `telegram_channels`: `{{title}} (@{{username}})`

### 2.3 Настройте права доступа (Permissions)

1. **Settings** → **Roles & Permissions**
2. Для роли **Public**:
   - `telegram_categories`: READ доступ ✅
   - `telegram_channels`: READ доступ ✅
3. Для роли **Administrator**:
   - Все операции (CRUD) ✅

---

## 🤖 Шаг 3: Парсинг каналов с TGStat.ru

### 3.1 Получите cookies для авторизации на TGStat

1. Откройте https://tgstat.ru в браузере
2. Авторизуйтесь на сайте
3. Откройте DevTools (F12) → Application → Cookies
4. Скопируйте значения:
   - `tgstat_sirk`
   - `_tgstat_csrk`

### 3.2 Настройте переменные окружения

Создайте `.env` файл (или добавьте в Replit Secrets):

```bash
DIRECTUS_URL=https://directus.roboflow.space
DIRECTUS_TOKEN=<ваш_admin_токен_directus>
TGSTAT_COOKIE_SINK=<значение_tgstat_sirk>
TGSTAT_CSRF_TOKEN=<значение_tgstat_csrk>
```

### 3.3 Запустите парсер для ОДНОЙ категории (тест)

```bash
# Парсинг 100 каналов из категории "tech" для теста
npx tsx scripts/parse-tgstat-puppeteer.ts tech 100 1
```

**Параметры:**
- `tech` - категория
- `100` - лимит каналов
- `1` - номер прокси (опционально)

### 3.4 Запустите парсер для ВСЕХ категорий (полный сбор)

```bash
# Автоматический парсинг ВСЕХ категорий с задержками
npx tsx scripts/parse-all-categories.ts
```

**Что делает:**
- Парсит 12 категорий по 2000 каналов каждую
- Задержка 3-7 минут между категориями (защита от бана)
- Автоматическая загрузка в Directus
- Общее время: ~2-3 часа

**Категории:**
```
tech, business, marketing, food, travel, fashion, 
health, finance, education, news, crypto, sport
```

### 3.5 Проверка результатов

```sql
-- Количество каналов по категориям
SELECT 
    tc.name_ru,
    COUNT(ch.id) as channels_count,
    SUM(ch.subscribers) as total_subscribers
FROM telegram_categories tc
LEFT JOIN telegram_channels ch ON tc.id = ch.category_id
GROUP BY tc.id, tc.name_ru
ORDER BY channels_count DESC;
```

---

## 🌐 Шаг 4: Деплой лендинга

### 4.1 Обновите лендинг на продакшн

Файл уже обновлен: `smmniap_static/index.html`

Скопируйте на продакшн-сервер:

```bash
# Если используется SSH
scp smmniap_static/index.html user@prod-server:/path/to/website/

# Или через FTP/панель хостинга
# Загрузите файл index.html в корень сайта
```

### 4.2 Проверьте обновление

Откройте лендинг и найдите секцию:

```
✅ База Telegram каналов и анализ
  - 24,000+ Telegram каналов в базе
  - Автоматический граббер TGStat.ru
  - AI-умный поиск и фильтрация
```

---

## 🔄 Шаг 5: Обновление базы (регулярно)

### 5.1 Удаление устаревших каналов

```sql
-- Удалить неактивные каналы старше 6 месяцев
DELETE FROM telegram_channels 
WHERE is_active = false 
AND date_updated < NOW() - INTERVAL '6 months';
```

### 5.2 Повторный парсинг (обновление данных)

```bash
# Парсинг одной категории для обновления
npx tsx scripts/parse-tgstat-puppeteer.ts tech 2000 1

# Или всех категорий
npx tsx scripts/parse-all-categories.ts
```

---

## 📊 Шаг 6: Мониторинг и статистика

### 6.1 Общая статистика

```sql
-- Общее количество каналов
SELECT COUNT(*) FROM telegram_channels WHERE is_active = true;

-- Топ-10 каналов по подписчикам
SELECT title, username, subscribers, category_id 
FROM telegram_channels 
ORDER BY subscribers DESC 
LIMIT 10;

-- Средний ER по категориям
SELECT 
    tc.name_ru,
    AVG(ch.engagement_rate) as avg_er,
    COUNT(ch.id) as channels
FROM telegram_categories tc
JOIN telegram_channels ch ON tc.id = ch.category_id
GROUP BY tc.name_ru
ORDER BY avg_er DESC;
```

---

## ⚠️ Важные замечания

### Безопасность
- ✅ Не коммитить cookies в Git
- ✅ Использовать Replit Secrets для токенов
- ✅ Ротация cookies каждые 1-2 недели

### Производительность
- ⏱️ Парсинг 1 категории: ~10-15 минут
- ⏱️ Полный парсинг (12 категорий): ~2-3 часа
- 💾 Размер базы: ~5-10 MB для 24,000 каналов

### Ограничения TGStat
- 🚫 Не более 1 запроса в 5 секунд
- 🚫 Максимум 3-4 категории в день (рекомендация)
- 🔄 Использовать прокси при больших объемах

---

## 🛠️ Troubleshooting

### Проблема: "401 Unauthorized" при парсинге

**Решение:**
```bash
# Обновите cookies в .env
TGSTAT_COOKIE_SINK=<новое_значение>
TGSTAT_CSRF_TOKEN=<новое_значение>
```

### Проблема: Дубликаты в базе

**Решение:**
```sql
-- Удалить дубликаты по username
DELETE FROM telegram_channels a USING telegram_channels b
WHERE a.id < b.id AND a.username = b.username;
```

### Проблема: Медленный поиск

**Решение:**
```sql
-- Пересоздать индексы
REINDEX TABLE telegram_channels;
```

---

## 📝 Чеклист деплоя

- [ ] Создать таблицы в продакшн БД (SQL)
- [ ] Настроить коллекции в Directus
- [ ] Настроить права доступа
- [ ] Получить cookies TGStat
- [ ] Настроить переменные окружения
- [ ] Запустить тестовый парсинг (1 категория)
- [ ] Запустить полный парсинг (12 категорий)
- [ ] Проверить данные в Directus
- [ ] Обновить лендинг на проде
- [ ] Проверить работу AI-поиска
- [ ] Настроить регулярное обновление

---

## 🎯 Готово!

База Telegram каналов успешно задеплоена и готова к использованию! 🚀

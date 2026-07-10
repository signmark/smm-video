# План верификации Facebook/Instagram приложения

## 📋 Что нужно сделать для верификации в Facebook Developer Console

### 1. **Создание и настройка приложения**

#### Создание приложения:
- Зайти в https://developers.facebook.com/apps/
- "Создать приложение" → "Потребитель" или "Бизнес"
- Название: "SMM Manager"
- Email контакта: your-email@domain.com

#### Добавление продуктов:
- ✅ **Facebook Login** - для авторизации пользователей
- ✅ **Instagram Basic Display** - для получения базовой информации профиля
- ✅ **Instagram API** - для публикации контента (требует бизнес-верификации)
- ✅ **Graph API** - для работы с Facebook страницами

### 2. **Настройка OAuth и URL**

#### Valid OAuth Redirect URIs:
```
Продакшн:
- https://smm.omemo.tech/auth/facebook/callback
- https://smm.omemo.tech/auth/instagram/callback
- https://smm.omemo.tech/oauth/success

Разработка:
- http://localhost:5000/auth/facebook/callback
- http://localhost:5000/auth/instagram/callback
```

#### Информация о приложении:
- **Website URL:** https://smm.omemo.tech
- **Privacy Policy URL:** https://smm.omemo.tech/privacy.html
- **Terms of Service URL:** https://smm.omemo.tech/terms.html
- **Cookie Policy URL:** https://smm.omemo.tech/cookies.html
- **App Icon:** 1024x1024 логотип SMM Manager
- **Category:** Business Tools

### 3. **Запрашиваемые разрешения (Permissions)**

#### Facebook Login:
- `email` - получение email пользователя
- `public_profile` - базовая информация профиля

#### Instagram Basic Display:
- `instagram_basic` - базовый доступ к профилю Instagram
- `user_profile` - информация о профиле пользователя
- `user_media` - доступ к медиа файлам пользователя

#### Instagram API (требует верификации):
- `instagram_content_publish` - публикация контента
- `pages_read_engagement` - чтение аналитики
- `pages_show_list` - список страниц пользователя
- `instagram_manage_insights` - доступ к аналитике

### 4. **Описание использования данных**

#### Для каждого разрешения указать:
**instagram_content_publish:**
- "Приложение позволяет пользователям создавать и публиковать контент в их Instagram аккаунтах по расписанию"
- "Используется для автоматизации публикации постов с текстом и изображениями"

**pages_read_engagement:**
- "Получение статистики публикаций для аналитических отчетов"
- "Отображение метрик вовлеченности (лайки, комментарии, охват) в интерфейсе пользователя"

**instagram_manage_insights:**
- "Предоставление пользователям детальной аналитики их Instagram публикаций"
- "Создание отчетов по эффективности контента"

### 5. **Тестовые пользователи**

#### Добавить тестовых пользователей:
- **Основной тест-аккаунт:** test@smmniap.pw
- **Дополнительные тест-аккаунты:** 
  - demo1@smmniap.pw
  - demo2@smmniap.pw
- **Instagram тест-аккаунт:** @smmmanager_test

#### Права тестовых пользователей:
- Полный доступ ко всем функциям приложения
- Возможность тестирования OAuth flow
- Доступ к публикации в тестовом режиме

### 6. **Демо-видео для верификации**

#### Обязательные элементы:
- **Длительность:** 2-3 минуты
- **Формат:** MP4, разрешение минимум 720p
- **Звук:** можно без голоса, только демонстрация

#### Сценарий демо-видео:
1. **Открытие SMM Manager** (0:00-0:15)
   - Показать главную страницу https://smmniap.pw
   - Логин в систему

2. **Подключение Instagram** (0:15-0:45)
   - Клик "Подключить Instagram"
   - OAuth авторизация через Facebook
   - Выбор Instagram аккаунта
   - Успешное подключение

3. **Создание поста** (0:45-1:30)
   - Создание нового поста
   - Добавление текста
   - Загрузка изображения
   - Выбор Instagram для публикации

4. **Планирование публикации** (1:30-2:00)
   - Установка времени публикации
   - Сохранение в планировщик
   - Показать список запланированных постов

5. **Просмотр аналитики** (2:00-2:30)
   - Открыть раздел аналитики
   - Показать статистику опубликованных постов
   - Демонстрация метрик (лайки, комментарии, охват)

### 7. **Бизнес-верификация**

#### Документы для подтверждения бизнеса:
- Регистрационные документы компании
- Подтверждение права на домен smmniap.pw
- Описание бизнес-модели
- Контактная информация

#### Описание бизнеса:
"SMM Manager - это SaaS платформа для автоматизации управления социальными сетями. Мы помогаем бизнесам и контент-мейкерам создавать, планировать и публиковать контент в Instagram и Facebook с использованием технологий искусственного интеллекта."

### 8. **Безопасность и соответствие**

#### App Review Submission:
- Подробное описание каждой функции
- Скриншоты интерфейса
- Демо-видео
- Ответы на вопросы безопасности

#### Data Use Checkup:
- Как хранятся пользовательские данные
- Кто имеет доступ к данным
- Как долго хранятся данные
- Процедуры удаления данных

---

## 🚀 Что нужно реализовать в приложении

### 1. **OAuth Integration**

#### Facebook OAuth Controller:
```javascript
// /auth/facebook
// /auth/facebook/callback
// /auth/instagram
// /auth/instagram/callback
```

#### Необходимые роуты:
- `GET /auth/facebook` - инициация OAuth
- `GET /auth/facebook/callback` - обработка callback
- `GET /auth/instagram` - Instagram OAuth
- `GET /auth/instagram/callback` - Instagram callback
- `POST /auth/disconnect` - отключение аккаунта

### 2. **Instagram API Integration**

#### Функции для реализации:
- **Получение профиля:** User info, follower count
- **Публикация контента:** Upload media, create post
- **Планирование постов:** Schedule API calls
- **Получение аналитики:** Post insights, engagement metrics

#### API Endpoints для создания:
- `POST /api/instagram/connect` - подключение аккаунта
- `POST /api/instagram/publish` - публикация поста
- `GET /api/instagram/insights` - получение аналитики
- `GET /api/instagram/profile` - информация о профиле

### 3. **Database Schema Updates**

#### Таблица социальных аккаунтов:
```sql
CREATE TABLE social_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  platform VARCHAR(20), -- 'instagram', 'facebook'
  platform_id VARCHAR(100), -- ID аккаунта в соцсети
  access_token TEXT, -- OAuth токен
  refresh_token TEXT, -- Refresh токен
  expires_at TIMESTAMP,
  profile_data JSONB, -- username, follower_count, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Обновление таблицы контента:
```sql
ALTER TABLE campaign_content 
ADD COLUMN instagram_post_id VARCHAR(100),
ADD COLUMN facebook_post_id VARCHAR(100);
```

### 4. **Frontend Components**

#### Компоненты для создания:
- `SocialAccountConnect.tsx` - подключение аккаунтов
- `InstagramPublisher.tsx` - интерфейс публикации
- `SocialAnalytics.tsx` - отображение аналитики
- `AccountManager.tsx` - управление подключенными аккаунтами

### 5. **Environment Variables**

#### Переменные для добавления в .env:
```env
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
INSTAGRAM_CLIENT_ID=your_client_id
INSTAGRAM_CLIENT_SECRET=your_client_secret
REDIRECT_URL=https://smmniap.pw/auth/facebook/callback
```

---

## ✅ Чек-лист перед подачей на верификацию

### Документы и настройки:
- [ ] Лендинг размещен на https://smmniap.pw
- [ ] Политики конфиденциальности, условия и cookies доступны
- [ ] Приложение создано в Facebook Developer Console
- [ ] OAuth URLs настроены
- [ ] Тестовые пользователи добавлены
- [ ] App Icon загружен
- [ ] Описание приложения заполнено

### Функциональность:
- [ ] OAuth авторизация работает
- [ ] Публикация в Instagram функционирует
- [ ] Аналитика отображается корректно
- [ ] Планировщик постов работает
- [ ] Интерфейс стабилен и user-friendly

### Демо-материалы:
- [ ] Демо-видео записано и загружено
- [ ] Скриншоты интерфейса подготовлены
- [ ] Описания использования permissions написаны
- [ ] Тестовые данные подготовлены

### Безопасность:
- [ ] HTTPS сертификат настроен
- [ ] Токены безопасно хранятся
- [ ] Данные пользователей защищены
- [ ] Error handling реализован

---

## 📞 Контакты и поддержка

- **Техподдержка Facebook:** https://developers.facebook.com/support/
- **Документация Instagram API:** https://developers.facebook.com/docs/instagram-api/
- **App Review Guidelines:** https://developers.facebook.com/docs/app-review/

**Примерное время верификации:** 7-14 рабочих дней после подачи заявки.
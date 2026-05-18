# Руководство по интеграции OAuth для Facebook и Instagram

Данное руководство описывает процесс настройки OAuth авторизации для вашего приложения, чтобы пользователи могли публиковать контент через ваше приложение в Facebook и Instagram.

## Часть 1: Создание и настройка приложения Facebook

### Шаг 1: Создание приложения в Facebook для разработчиков

1. Перейдите на [Facebook Developer Portal](https://developers.facebook.com/)
2. Нажмите на «Мои приложения» и выберите «Создать приложение»
3. Выберите тип приложения: «Бизнес»
4. Введите название приложения (например, «SMM Manager»)
5. Укажите контактный email и, при необходимости, бизнес-аккаунт
6. Нажмите «Создать приложение»

### Шаг 2: Настройка основных параметров приложения

1. В панели управления приложением перейдите в «Настройки» → «Основные»
2. Заполните следующие обязательные поля:
   - Домены приложения: укажите домен вашего приложения (например, `your-app-domain.com`)
   - Политика конфиденциальности URL: ссылка на вашу политику конфиденциальности
   - Условия использования URL: ссылка на ваши условия использования
   - Иконка приложения: загрузите логотип размером 1024x1024 пикселей
3. Сохраните изменения
4. Запишите `App ID` и `App Secret` - они понадобятся для OAuth авторизации

### Шаг 3: Добавление продуктов в ваше приложение

1. В левом меню нажмите на «Добавить продукты»
2. Добавьте следующие продукты:
   - **Facebook Login**: нажмите «Настроить»
   - **Instagram Basic Display**: нажмите «Настроить»
   - **Instagram Graph API**: нажмите «Настроить»
   - **Pages API**: нажмите «Настроить»

### Шаг 4: Настройка Facebook Login

1. В левом меню перейдите в «Facebook Login» → «Настройки»
2. В поле «Действительные URI для OAuth перенаправления» добавьте URL перенаправления:
   ```
   https://your-app-domain.com/auth/facebook/callback
   ```
3. Включите «Вход через веб-браузер OAuth» и выберите режим «Yes»
4. В «Параметры авторизации» выберите «Автоматическая авторизация»
5. Сохраните изменения

### Шаг 5: Настройка запрашиваемых разрешений

1. В левом меню перейдите в «Facebook Login» → «Параметры»
2. В разделе «Разрешения по умолчанию» добавьте следующие разрешения:
   - **Для FB страниц:**
     - `pages_show_list` (просмотр списка страниц пользователя)
     - `pages_read_engagement` (чтение взаимодействий)
     - `pages_manage_posts` (управление постами)
     - `pages_read_user_content` (чтение контента)
     - `public_profile` (базовый профиль)
     - `email` (email пользователя)
   - **Для Instagram:**
     - `instagram_basic` (доступ к базовой информации профиля Instagram)
     - `instagram_content_publish` (публикация контента в Instagram)
     - `instagram_manage_comments` (управление комментариями)
     - `instagram_manage_insights` (доступ к аналитике)
3. Сохраните изменения

### Шаг 6: Настройка авторизации для тестирования

Для тестирования OAuth авторизации нам нужно настроить действительные URL в настройках приложения:

1. В левом меню перейдите в «Настройки» → «Основные»
2. В разделе «Домены приложения» добавьте следующие домены:
   - Основной домен приложения: `your-app-domain.com`
   - Для локальной разработки: `localhost`
3. В разделе «Website» добавьте:
   - Домен сайта: `https://your-app-domain.com`
   - Для локальной разработки: `http://localhost:5000`
4. Сохраните изменения

## Часть 2: Реализация OAuth авторизации на серверной стороне

### Шаг 1: Установка необходимых пакетов

```bash
npm install passport passport-facebook express-session
```

### Шаг 2: Настройка сессий и Passport.js

Создайте файл `server/auth/passport-config.ts`:

```typescript
import passport from 'passport';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { db } from '../database';
import log from '../utils/logger';

export function configurePassport() {
  // Сериализация и десериализация пользователя
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
      done(null, result.rows[0] || null);
    } catch (error) {
      log.error(`[Passport] Deserialize error: ${error.message}`);
      done(error, null);
    }
  });

  // Настройка Facebook Strategy
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${process.env.APP_URL}/auth/facebook/callback`,
        profileFields: ['id', 'displayName', 'email', 'photos'],
        enableProof: true,
        // Запрашиваем все необходимые разрешения
        scope: [
          'public_profile',
          'email',
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'pages_read_user_content',
          'instagram_basic',
          'instagram_content_publish',
          'instagram_manage_comments',
          'instagram_manage_insights'
        ]
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          log.info(`[Passport] Facebook auth success for user ${profile.id}`);
          
          // Проверяем, существует ли пользователь
          const result = await db.query(
            'SELECT * FROM users WHERE facebook_id = $1',
            [profile.id]
          );
          
          let user;
          
          if (result.rows.length === 0) {
            // Создаем нового пользователя
            const newUserResult = await db.query(
              `INSERT INTO users 
               (facebook_id, name, email, avatar_url, facebook_token, facebook_token_expiry) 
               VALUES ($1, $2, $3, $4, $5, $6) 
               RETURNING *`,
              [
                profile.id,
                profile.displayName,
                profile.emails?.[0]?.value || null,
                profile.photos?.[0]?.value || null,
                accessToken,
                // Примерно 60 дней (Facebook токены длительные)
                new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
              ]
            );
            
            user = newUserResult.rows[0];
            log.info(`[Passport] Created new user with ID ${user.id}`);
          } else {
            // Обновляем существующего пользователя
            user = result.rows[0];
            
            await db.query(
              `UPDATE users 
               SET name = $1, email = $2, avatar_url = $3, 
                   facebook_token = $4, facebook_token_expiry = $5,
                   updated_at = NOW()
               WHERE id = $6`,
              [
                profile.displayName,
                profile.emails?.[0]?.value || user.email,
                profile.photos?.[0]?.value || user.avatar_url,
                accessToken,
                new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                user.id
              ]
            );
            
            log.info(`[Passport] Updated user with ID ${user.id}`);
          }
          
          // После аутентификации, получаем и сохраняем информацию о страницах пользователя
          await fetchAndSaveUserPages(user.id, accessToken);
          
          done(null, user);
        } catch (error) {
          log.error(`[Passport] Facebook auth error: ${error.message}`);
          done(error, null);
        }
      }
    )
  );
}

// Функция для получения и сохранения страниц пользователя
async function fetchAndSaveUserPages(userId: string, accessToken: string) {
  try {
    // Запрос к Facebook API для получения страниц пользователя
    const axios = require('axios');
    const response = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: accessToken }
    });
    
    if (response.data && response.data.data) {
      const pages = response.data.data;
      
      log.info(`[Passport] Found ${pages.length} Facebook pages for user ${userId}`);
      
      // Сохраняем информацию о каждой странице
      for (const page of pages) {
        // Проверяем, существует ли страница
        const pageResult = await db.query(
          'SELECT * FROM facebook_pages WHERE page_id = $1 AND user_id = $2',
          [page.id, userId]
        );
        
        if (pageResult.rows.length === 0) {
          // Создаем новую запись о странице
          await db.query(
            `INSERT INTO facebook_pages 
             (user_id, page_id, name, access_token, category) 
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, page.id, page.name, page.access_token, page.category]
          );
          
          log.info(`[Passport] Saved new Facebook page ${page.name} (${page.id})`);
        } else {
          // Обновляем существующую запись
          await db.query(
            `UPDATE facebook_pages 
             SET name = $1, access_token = $2, category = $3, updated_at = NOW() 
             WHERE page_id = $4 AND user_id = $5`,
            [page.name, page.access_token, page.category, page.id, userId]
          );
          
          log.info(`[Passport] Updated Facebook page ${page.name} (${page.id})`);
        }
        
        // Получаем и сохраняем Instagram бизнес-аккаунт, связанный со страницей
        await fetchAndSaveInstagramAccount(userId, page.id, page.access_token);
      }
    }
  } catch (error) {
    log.error(`[Passport] Error fetching user pages: ${error.message}`);
    throw error;
  }
}

// Функция для получения и сохранения Instagram аккаунта, связанного со страницей Facebook
async function fetchAndSaveInstagramAccount(userId: string, pageId: string, pageAccessToken: string) {
  try {
    const axios = require('axios');
    
    // Запрос к Graph API для получения бизнес-аккаунта Instagram, связанного со страницей
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${pageId}`,
      {
        params: {
          fields: 'instagram_business_account',
          access_token: pageAccessToken
        }
      }
    );
    
    // Если есть связанный Instagram аккаунт
    if (response.data && response.data.instagram_business_account) {
      const instagramAccountId = response.data.instagram_business_account.id;
      
      log.info(`[Passport] Found Instagram business account ${instagramAccountId} for page ${pageId}`);
      
      // Получаем дополнительную информацию об Instagram аккаунте
      const instagramResponse = await axios.get(
        `https://graph.facebook.com/v19.0/${instagramAccountId}`,
        {
          params: {
            fields: 'name,username,profile_picture_url',
            access_token: pageAccessToken
          }
        }
      );
      
      const instagram = instagramResponse.data;
      
      // Проверяем, существует ли запись об Instagram аккаунте
      const instagramResult = await db.query(
        'SELECT * FROM instagram_accounts WHERE instagram_id = $1 AND user_id = $2',
        [instagramAccountId, userId]
      );
      
      if (instagramResult.rows.length === 0) {
        // Создаем новую запись
        await db.query(
          `INSERT INTO instagram_accounts 
           (user_id, instagram_id, facebook_page_id, username, name, profile_picture_url, access_token) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            instagramAccountId,
            pageId,
            instagram.username,
            instagram.name,
            instagram.profile_picture_url,
            pageAccessToken // Для Instagram используется токен родительской Facebook страницы
          ]
        );
        
        log.info(`[Passport] Saved new Instagram account ${instagram.username} (${instagramAccountId})`);
      } else {
        // Обновляем существующую запись
        await db.query(
          `UPDATE instagram_accounts 
           SET username = $1, name = $2, profile_picture_url = $3, access_token = $4, updated_at = NOW() 
           WHERE instagram_id = $5 AND user_id = $6`,
          [
            instagram.username,
            instagram.name,
            instagram.profile_picture_url,
            pageAccessToken,
            instagramAccountId,
            userId
          ]
        );
        
        log.info(`[Passport] Updated Instagram account ${instagram.username} (${instagramAccountId})`);
      }
    }
  } catch (error) {
    log.error(`[Passport] Error fetching Instagram account: ${error.message}`);
    // Не выбрасываем ошибку, чтобы продолжить процесс аутентификации
  }
}
```

### Шаг 3: Создание схемы базы данных для хранения токенов

Создайте файл `server/models/auth-schema.sql`:

```sql
-- Таблица для хранения информации о Facebook страницах
CREATE TABLE IF NOT EXISTS facebook_pages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  page_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  category VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, page_id)
);

-- Таблица для хранения информации об Instagram аккаунтах
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  instagram_id VARCHAR(255) NOT NULL,
  facebook_page_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  profile_picture_url TEXT,
  access_token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, instagram_id)
);

-- Добавление полей для хранения данных Facebook в таблицу пользователей
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_token_expiry TIMESTAMP;

-- Индексы для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_facebook_pages_user_id ON facebook_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_user_id ON instagram_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_users_facebook_id ON users(facebook_id);
```

### Шаг 4: Настройка маршрутов авторизации

Создайте файл `server/api/auth-routes.ts`:

```typescript
import { Router } from 'express';
import passport from 'passport';
import log from '../utils/logger';

const router = Router();

// Маршрут для инициирования аутентификации Facebook
router.get('/facebook', passport.authenticate('facebook', {
  // Запрашиваемые разрешения
  scope: [
    'public_profile',
    'email',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_read_user_content',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights'
  ]
}));

// Маршрут обратного вызова после аутентификации
router.get(
  '/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/login' }),
  (req, res) => {
    log.info(`[Auth] Facebook callback success for user ${req.user.id}`);
    // Перенаправляем на главную страницу после успешной аутентификации
    res.redirect('/');
  }
);

// Маршрут для выхода из системы
router.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

// Маршрут для получения информации о текущем пользователе
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    // Отправляем информацию о пользователе без конфиденциальных данных
    const user = { ...req.user };
    delete user.facebook_token;
    delete user.password;
    
    res.json({
      isAuthenticated: true,
      user
    });
  } else {
    res.json({
      isAuthenticated: false,
      user: null
    });
  }
});

// Проверка аутентификации для API
export function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

export const authRoutes = router;
```

### Шаг 5: Добавление сервисов для работы с Facebook и Instagram API

Создайте файл `server/services/facebook/facebook-pages-service.ts`:

```typescript
import { db } from '../../database';
import log from '../../utils/logger';
import axios from 'axios';

export class FacebookPagesService {
  /**
   * Получает список Facebook страниц пользователя
   * @param userId ID пользователя
   * @returns Список Facebook страниц
   */
  async getUserPages(userId: string) {
    try {
      const result = await db.query(
        'SELECT * FROM facebook_pages WHERE user_id = $1 ORDER BY name',
        [userId]
      );
      
      return result.rows;
    } catch (error) {
      log.error(`[FacebookPages] Error getting user pages: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Получает токен доступа для конкретной страницы
   * @param userId ID пользователя
   * @param pageId ID страницы Facebook
   * @returns Токен доступа к странице
   */
  async getPageAccessToken(userId: string, pageId: string) {
    try {
      const result = await db.query(
        'SELECT access_token FROM facebook_pages WHERE user_id = $1 AND page_id = $2',
        [userId, pageId]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`Page ${pageId} not found for user ${userId}`);
      }
      
      return result.rows[0].access_token;
    } catch (error) {
      log.error(`[FacebookPages] Error getting page token: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Публикует контент на странице Facebook
   * @param userId ID пользователя
   * @param pageId ID страницы Facebook
   * @param message Текст публикации
   * @param imageUrl URL изображения (опционально)
   * @returns Результат публикации
   */
  async publishPost(userId: string, pageId: string, message: string, imageUrl?: string) {
    try {
      const accessToken = await this.getPageAccessToken(userId, pageId);
      
      // Для публикации с изображением
      if (imageUrl) {
        // Создаем публикацию с изображением через Graph API
        const response = await axios.post(
          `https://graph.facebook.com/v19.0/${pageId}/photos`,
          {
            url: imageUrl,
            caption: message,
            access_token: accessToken
          }
        );
        
        if (response.data && response.data.id) {
          // Получаем permalink для опубликованного контента
          const postInfo = await axios.get(
            `https://graph.facebook.com/v19.0/${response.data.id}`,
            {
              params: {
                fields: 'permalink_url',
                access_token: accessToken
              }
            }
          );
          
          return {
            success: true,
            postId: response.data.id,
            url: postInfo.data.permalink_url
          };
        }
      } else {
        // Публикация только с текстом
        const response = await axios.post(
          `https://graph.facebook.com/v19.0/${pageId}/feed`,
          {
            message,
            access_token: accessToken
          }
        );
        
        if (response.data && response.data.id) {
          // Получаем permalink для опубликованного контента
          const postInfo = await axios.get(
            `https://graph.facebook.com/v19.0/${response.data.id}`,
            {
              params: {
                fields: 'permalink_url',
                access_token: accessToken
              }
            }
          );
          
          return {
            success: true,
            postId: response.data.id,
            url: postInfo.data.permalink_url
          };
        }
      }
      
      throw new Error('Failed to publish post');
    } catch (error) {
      log.error(`[FacebookPages] Error publishing post: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const facebookPagesService = new FacebookPagesService();
```

Создайте файл `server/services/facebook/instagram-accounts-service.ts`:

```typescript
import { db } from '../../database';
import log from '../../utils/logger';
import axios from 'axios';

export class InstagramAccountsService {
  /**
   * Получает список Instagram аккаунтов пользователя
   * @param userId ID пользователя
   * @returns Список Instagram аккаунтов
   */
  async getUserAccounts(userId: string) {
    try {
      const result = await db.query(
        'SELECT * FROM instagram_accounts WHERE user_id = $1 ORDER BY username',
        [userId]
      );
      
      return result.rows;
    } catch (error) {
      log.error(`[InstagramAccounts] Error getting user accounts: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Получает токен доступа для конкретного аккаунта Instagram
   * @param userId ID пользователя
   * @param instagramId ID аккаунта Instagram
   * @returns Токен доступа к аккаунту (через родительскую Facebook страницу)
   */
  async getAccountAccessToken(userId: string, instagramId: string) {
    try {
      const result = await db.query(
        'SELECT access_token FROM instagram_accounts WHERE user_id = $1 AND instagram_id = $2',
        [userId, instagramId]
      );
      
      if (result.rows.length === 0) {
        throw new Error(`Instagram account ${instagramId} not found for user ${userId}`);
      }
      
      return result.rows[0].access_token;
    } catch (error) {
      log.error(`[InstagramAccounts] Error getting account token: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Публикует изображение в Instagram через Graph API
   * @param userId ID пользователя
   * @param instagramId ID аккаунта Instagram
   * @param imageUrl URL изображения
   * @param caption Подпись к изображению
   * @returns Результат публикации
   */
  async publishImage(userId: string, instagramId: string, imageUrl: string, caption: string) {
    try {
      const accessToken = await this.getAccountAccessToken(userId, instagramId);
      
      // Шаг 1: Создание контейнера для медиа
      const containerResponse = await axios.post(
        `https://graph.facebook.com/v19.0/${instagramId}/media`,
        {
          image_url: imageUrl,
          caption,
          access_token: accessToken
        }
      );
      
      if (!containerResponse.data || !containerResponse.data.id) {
        throw new Error('Failed to create media container');
      }
      
      const containerId = containerResponse.data.id;
      log.info(`[InstagramAccounts] Created media container: ${containerId}`);
      
      // Шаг 2: Публикация контейнера
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v19.0/${instagramId}/media_publish`,
        {
          creation_id: containerId,
          access_token: accessToken
        }
      );
      
      if (!publishResponse.data || !publishResponse.data.id) {
        throw new Error('Failed to publish media');
      }
      
      const mediaId = publishResponse.data.id;
      log.info(`[InstagramAccounts] Published media: ${mediaId}`);
      
      // Шаг 3: Получение информации о публикации
      const mediaInfoResponse = await axios.get(
        `https://graph.facebook.com/v19.0/${mediaId}`,
        {
          params: {
            fields: 'id,permalink',
            access_token: accessToken
          }
        }
      );
      
      return {
        success: true,
        mediaId,
        permalink: mediaInfoResponse.data.permalink || null
      };
    } catch (error) {
      log.error(`[InstagramAccounts] Error publishing image: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Публикует карусель в Instagram через Graph API
   * @param userId ID пользователя
   * @param instagramId ID аккаунта Instagram
   * @param imageUrls Массив URL изображений
   * @param caption Подпись к карусели
   * @returns Результат публикации
   */
  async publishCarousel(userId: string, instagramId: string, imageUrls: string[], caption: string) {
    try {
      const accessToken = await this.getAccountAccessToken(userId, instagramId);
      
      // Шаг 1: Создание контейнеров для каждого изображения
      const containerIds = [];
      
      for (const imageUrl of imageUrls) {
        const containerResponse = await axios.post(
          `https://graph.facebook.com/v19.0/${instagramId}/media`,
          {
            image_url: imageUrl,
            is_carousel_item: true,
            access_token: accessToken
          }
        );
        
        if (!containerResponse.data || !containerResponse.data.id) {
          throw new Error('Failed to create media container');
        }
        
        containerIds.push(containerResponse.data.id);
        log.info(`[InstagramAccounts] Created carousel item container: ${containerResponse.data.id}`);
      }
      
      // Шаг 2: Создание контейнера для карусели
      const carouselResponse = await axios.post(
        `https://graph.facebook.com/v19.0/${instagramId}/media`,
        {
          media_type: 'CAROUSEL',
          children: containerIds,
          caption,
          access_token: accessToken
        }
      );
      
      if (!carouselResponse.data || !carouselResponse.data.id) {
        throw new Error('Failed to create carousel container');
      }
      
      const carouselId = carouselResponse.data.id;
      log.info(`[InstagramAccounts] Created carousel container: ${carouselId}`);
      
      // Шаг 3: Публикация карусели
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v19.0/${instagramId}/media_publish`,
        {
          creation_id: carouselId,
          access_token: accessToken
        }
      );
      
      if (!publishResponse.data || !publishResponse.data.id) {
        throw new Error('Failed to publish carousel');
      }
      
      const mediaId = publishResponse.data.id;
      log.info(`[InstagramAccounts] Published carousel: ${mediaId}`);
      
      // Шаг 4: Получение информации о публикации
      const mediaInfoResponse = await axios.get(
        `https://graph.facebook.com/v19.0/${mediaId}`,
        {
          params: {
            fields: 'id,permalink',
            access_token: accessToken
          }
        }
      );
      
      return {
        success: true,
        mediaId,
        permalink: mediaInfoResponse.data.permalink || null
      };
    } catch (error) {
      log.error(`[InstagramAccounts] Error publishing carousel: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const instagramAccountsService = new InstagramAccountsService();
```

### Шаг 6: Добавление API эндпоинтов для публикации контента

Создайте файл `server/api/facebook-api-routes.ts`:

```typescript
import { Router } from 'express';
import { facebookPagesService } from '../services/facebook/facebook-pages-service';
import { ensureAuthenticated } from './auth-routes';
import log from '../utils/logger';

const router = Router();

// Middleware для проверки аутентификации
router.use(ensureAuthenticated);

// Получение списка страниц пользователя
router.get('/pages', async (req, res) => {
  try {
    const pages = await facebookPagesService.getUserPages(req.user.id);
    res.json({ success: true, pages });
  } catch (error) {
    log.error(`[API] Error getting Facebook pages: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Публикация контента на странице
router.post('/pages/:pageId/publish', async (req, res) => {
  const { pageId } = req.params;
  const { message, imageUrl } = req.body;
  
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }
  
  try {
    const result = await facebookPagesService.publishPost(
      req.user.id,
      pageId,
      message,
      imageUrl
    );
    
    res.json(result);
  } catch (error) {
    log.error(`[API] Error publishing to Facebook: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export const facebookApiRoutes = router;
```

Создайте файл `server/api/instagram-api-routes.ts`:

```typescript
import { Router } from 'express';
import { instagramAccountsService } from '../services/facebook/instagram-accounts-service';
import { ensureAuthenticated } from './auth-routes';
import log from '../utils/logger';

const router = Router();

// Middleware для проверки аутентификации
router.use(ensureAuthenticated);

// Получение списка аккаунтов пользователя
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await instagramAccountsService.getUserAccounts(req.user.id);
    res.json({ success: true, accounts });
  } catch (error) {
    log.error(`[API] Error getting Instagram accounts: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Публикация изображения
router.post('/accounts/:accountId/publish', async (req, res) => {
  const { accountId } = req.params;
  const { imageUrl, caption } = req.body;
  
  if (!imageUrl) {
    return res.status(400).json({ success: false, error: 'Image URL is required' });
  }
  
  try {
    const result = await instagramAccountsService.publishImage(
      req.user.id,
      accountId,
      imageUrl,
      caption || ''
    );
    
    res.json(result);
  } catch (error) {
    log.error(`[API] Error publishing to Instagram: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Публикация карусели
router.post('/accounts/:accountId/carousel', async (req, res) => {
  const { accountId } = req.params;
  const { imageUrls, caption } = req.body;
  
  if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
    return res.status(400).json({ success: false, error: 'Image URLs array is required' });
  }
  
  try {
    const result = await instagramAccountsService.publishCarousel(
      req.user.id,
      accountId,
      imageUrls,
      caption || ''
    );
    
    res.json(result);
  } catch (error) {
    log.error(`[API] Error publishing carousel to Instagram: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

export const instagramApiRoutes = router;
```

### Шаг 7: Интеграция OAuth в основное приложение

Обновите ваш файл `server/index.ts` или аналогичный:

```typescript
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { configurePassport } from './auth/passport-config';
import { authRoutes } from './api/auth-routes';
import { facebookApiRoutes } from './api/facebook-api-routes';
import { instagramApiRoutes } from './api/instagram-api-routes';
import log from './utils/logger';

const app = express();

// Настройка сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 дней
  }
}));

// Инициализация Passport
app.use(passport.initialize());
app.use(passport.session());

// Настройка Passport
configurePassport();

// Парсинг JSON
app.use(express.json());

// Регистрация маршрутов
app.use('/auth', authRoutes);
app.use('/api/facebook', facebookApiRoutes);
app.use('/api/instagram', instagramApiRoutes);

// Остальные маршруты приложения
// ...

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  log.info(`Server running on port ${PORT}`);
});
```

### Шаг 8: Создание компонентов пользовательского интерфейса (React)

Создайте файл `client/src/components/FacebookLoginButton.jsx`:

```jsx
import React from 'react';
import { Button } from 'your-ui-lib';

export function FacebookLoginButton({ className }) {
  const handleLogin = () => {
    // Перенаправляем на маршрут аутентификации Facebook
    window.location.href = '/auth/facebook';
  };
  
  return (
    <Button
      className={className}
      onClick={handleLogin}
      icon="facebook"
      type="primary"
      style={{ backgroundColor: '#1877F2', borderColor: '#1877F2' }}
    >
      Войти через Facebook
    </Button>
  );
}
```

Создайте файл `client/src/components/FacebookPagesList.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import { List, Avatar, Button, Spin, Alert, message } from 'your-ui-lib';
import { fetchFacebookPages } from '../api/facebook-api';

export function FacebookPagesList({ onSelectPage }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    loadPages();
  }, []);
  
  const loadPages = async () => {
    setLoading(true);
    try {
      const response = await fetchFacebookPages();
      if (response.success) {
        setPages(response.pages);
      } else {
        setError(response.error || 'Failed to load Facebook pages');
      }
    } catch (error) {
      setError(error.message);
      message.error('Ошибка загрузки страниц Facebook');
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return <Spin tip="Загрузка страниц Facebook..." />;
  }
  
  if (error) {
    return (
      <Alert
        type="error"
        message="Ошибка загрузки"
        description={error}
        action={
          <Button type="primary" size="small" onClick={loadPages}>
            Повторить
          </Button>
        }
      />
    );
  }
  
  if (pages.length === 0) {
    return (
      <Alert
        type="info"
        message="Нет доступных страниц"
        description="У вас нет страниц Facebook, связанных с вашим аккаунтом, или ваш аккаунт не имеет достаточных прав."
      />
    );
  }
  
  return (
    <List
      itemLayout="horizontal"
      dataSource={pages}
      renderItem={(page) => (
        <List.Item
          actions={[
            <Button
              type="primary"
              onClick={() => onSelectPage(page)}
            >
              Выбрать
            </Button>
          ]}
        >
          <List.Item.Meta
            avatar={<Avatar src={page.picture || 'https://via.placeholder.com/40'} />}
            title={page.name}
            description={page.category || 'Facebook Page'}
          />
        </List.Item>
      )}
    />
  );
}
```

Создайте файл `client/src/components/InstagramAccountsList.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import { List, Avatar, Button, Spin, Alert, message } from 'your-ui-lib';
import { fetchInstagramAccounts } from '../api/instagram-api';

export function InstagramAccountsList({ onSelectAccount }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    loadAccounts();
  }, []);
  
  const loadAccounts = async () => {
    setLoading(true);
    try {
      const response = await fetchInstagramAccounts();
      if (response.success) {
        setAccounts(response.accounts);
      } else {
        setError(response.error || 'Failed to load Instagram accounts');
      }
    } catch (error) {
      setError(error.message);
      message.error('Ошибка загрузки аккаунтов Instagram');
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return <Spin tip="Загрузка аккаунтов Instagram..." />;
  }
  
  if (error) {
    return (
      <Alert
        type="error"
        message="Ошибка загрузки"
        description={error}
        action={
          <Button type="primary" size="small" onClick={loadAccounts}>
            Повторить
          </Button>
        }
      />
    );
  }
  
  if (accounts.length === 0) {
    return (
      <Alert
        type="info"
        message="Нет доступных аккаунтов"
        description="У вас нет бизнес-аккаунтов Instagram, связанных с вашими страницами Facebook, или ваш аккаунт не имеет достаточных прав."
      />
    );
  }
  
  return (
    <List
      itemLayout="horizontal"
      dataSource={accounts}
      renderItem={(account) => (
        <List.Item
          actions={[
            <Button
              type="primary"
              onClick={() => onSelectAccount(account)}
            >
              Выбрать
            </Button>
          ]}
        >
          <List.Item.Meta
            avatar={<Avatar src={account.profile_picture_url || 'https://via.placeholder.com/40'} />}
            title={`@${account.username}`}
            description={account.name || 'Instagram Business Account'}
          />
        </List.Item>
      )}
    />
  );
}
```

## Часть 3: Получение и хранение долгосрочных токенов

### Шаг 1: Создание сервиса для обновления токенов

Создайте файл `server/services/facebook/token-refresh-service.ts`:

```typescript
import axios from 'axios';
import { db } from '../../database';
import log from '../../utils/logger';

export class TokenRefreshService {
  /**
   * Обновляет токен доступа пользователя Facebook
   * @param userId ID пользователя
   * @returns Результат обновления токена
   */
  async refreshUserToken(userId: string) {
    try {
      // Получаем текущий токен пользователя
      const userResult = await db.query(
        'SELECT facebook_token, facebook_token_expiry FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        throw new Error(`User ${userId} not found`);
      }
      
      const user = userResult.rows[0];
      
      // Проверяем, нужно ли обновлять токен (если до истечения меньше 7 дней)
      const expiryDate = new Date(user.facebook_token_expiry);
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      if (expiryDate > sevenDaysFromNow) {
        log.info(`[TokenRefresh] Token for user ${userId} is still valid, no refresh needed`);
        return { success: true, tokenValid: true };
      }
      
      // Обмениваем краткосрочный токен на долгосрочный
      const response = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          fb_exchange_token: user.facebook_token
        }
      });
      
      if (response.data && response.data.access_token) {
        const newToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 5184000; // По умолчанию 60 дней
        
        // Сохраняем новый токен и дату истечения
        await db.query(
          `UPDATE users 
           SET facebook_token = $1, facebook_token_expiry = $2 
           WHERE id = $3`,
          [
            newToken,
            new Date(Date.now() + expiresIn * 1000),
            userId
          ]
        );
        
        log.info(`[TokenRefresh] Successfully refreshed token for user ${userId}`);
        
        // После обновления токена пользователя, обновляем токены страниц и Instagram аккаунтов
        await this.refreshPagesAndInstagramTokens(userId, newToken);
        
        return { success: true, tokenRefreshed: true };
      } else {
        throw new Error('Failed to exchange token');
      }
    } catch (error) {
      log.error(`[TokenRefresh] Error refreshing token: ${error.message}`);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Обновляет токены страниц и Instagram аккаунтов пользователя
   * @param userId ID пользователя
   * @param userToken Новый токен пользователя
   */
  private async refreshPagesAndInstagramTokens(userId: string, userToken: string) {
    try {
      // Получаем обновленный список страниц пользователя
      const pagesResponse = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
        params: { access_token: userToken }
      });
      
      if (pagesResponse.data && pagesResponse.data.data) {
        const pages = pagesResponse.data.data;
        
        log.info(`[TokenRefresh] Refreshing tokens for ${pages.length} Facebook pages`);
        
        // Обновляем токены для каждой страницы
        for (const page of pages) {
          await db.query(
            `UPDATE facebook_pages 
             SET access_token = $1, updated_at = NOW() 
             WHERE user_id = $2 AND page_id = $3`,
            [page.access_token, userId, page.id]
          );
          
          log.info(`[TokenRefresh] Updated token for page ${page.name} (${page.id})`);
          
          // Обновляем токены для Instagram аккаунтов, связанных с этой страницей
          await db.query(
            `UPDATE instagram_accounts 
             SET access_token = $1, updated_at = NOW() 
             WHERE user_id = $2 AND facebook_page_id = $3`,
            [page.access_token, userId, page.id]
          );
          
          log.info(`[TokenRefresh] Updated tokens for Instagram accounts linked to page ${page.id}`);
        }
      }
    } catch (error) {
      log.error(`[TokenRefresh] Error refreshing page tokens: ${error.message}`);
      throw error;
    }
  }
}

export const tokenRefreshService = new TokenRefreshService();
```

### Шаг 2: Создание планировщика обновления токенов

Создайте файл `server/services/facebook/token-refresh-scheduler.ts`:

```typescript
import { tokenRefreshService } from './token-refresh-service';
import { db } from '../../database';
import log from '../../utils/logger';

export class TokenRefreshScheduler {
  private intervalId: NodeJS.Timeout;
  
  /**
   * Запускает планировщик обновления токенов
   * @param intervalMs Интервал проверки в миллисекундах (по умолчанию 24 часа)
   */
  start(intervalMs: number = 24 * 60 * 60 * 1000) {
    log.info(`[TokenRefreshScheduler] Starting token refresh scheduler with interval ${intervalMs}ms`);
    
    // Немедленно запускаем первую проверку
    this.checkAndRefreshTokens();
    
    // Настраиваем регулярную проверку
    this.intervalId = setInterval(() => {
      this.checkAndRefreshTokens();
    }, intervalMs);
  }
  
  /**
   * Останавливает планировщик
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      log.info('[TokenRefreshScheduler] Token refresh scheduler stopped');
    }
  }
  
  /**
   * Проверяет и обновляет токены пользователей, срок действия которых скоро истечет
   */
  private async checkAndRefreshTokens() {
    try {
      log.info('[TokenRefreshScheduler] Checking for tokens to refresh');
      
      // Получаем пользователей, чьи токены истекают в ближайшие 7 дней
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      const result = await db.query(
        `SELECT id FROM users 
         WHERE facebook_token IS NOT NULL 
         AND facebook_token_expiry < $1`,
        [sevenDaysFromNow]
      );
      
      const usersToRefresh = result.rows;
      log.info(`[TokenRefreshScheduler] Found ${usersToRefresh.length} users with tokens to refresh`);
      
      // Обновляем токены для каждого пользователя
      for (const user of usersToRefresh) {
        try {
          await tokenRefreshService.refreshUserToken(user.id);
          log.info(`[TokenRefreshScheduler] Successfully refreshed token for user ${user.id}`);
        } catch (error) {
          log.error(`[TokenRefreshScheduler] Error refreshing token for user ${user.id}: ${error.message}`);
        }
      }
      
      log.info('[TokenRefreshScheduler] Token refresh check completed');
    } catch (error) {
      log.error(`[TokenRefreshScheduler] Error checking tokens: ${error.message}`);
    }
  }
}

export const tokenRefreshScheduler = new TokenRefreshScheduler();
```

### Шаг 3: Интеграция планировщика обновления токенов

Обновите ваш файл `server/index.ts` или аналогичный:

```typescript
// ... существующий код ...

import { tokenRefreshScheduler } from './services/facebook/token-refresh-scheduler';

// ... существующий код ...

// Запуск планировщика обновления токенов
tokenRefreshScheduler.start();

// При завершении работы приложения
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down');
  
  // Останавливаем планировщик
  tokenRefreshScheduler.stop();
  
  // ... другие задачи при завершении ...
  
  process.exit(0);
});
```

## Часть 4: Примеры использования OAuth в интерфейсе пользователя

### Пример 1: Страница входа через Facebook

```jsx
// client/src/pages/LoginPage.jsx
import React from 'react';
import { Card, Typography, Divider } from 'your-ui-lib';
import { FacebookLoginButton } from '../components/FacebookLoginButton';

export function LoginPage() {
  return (
    <div className="login-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Card style={{ width: 400 }}>
        <Typography.Title level={2} style={{ textAlign: 'center' }}>
          SMM Manager
        </Typography.Title>
        
        <Typography.Paragraph style={{ textAlign: 'center' }}>
          Войдите, чтобы получить доступ к управлению публикациями в социальных сетях.
        </Typography.Paragraph>
        
        <Divider />
        
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <FacebookLoginButton />
        </div>
        
        <div style={{ marginTop: 20, fontSize: 12, color: '#888', textAlign: 'center' }}>
          Входя в систему, вы соглашаетесь с нашими условиями использования и политикой конфиденциальности.
        </div>
      </Card>
    </div>
  );
}
```

### Пример 2: Компонент выбора страницы Facebook

```jsx
// client/src/components/PublishToFacebook.jsx
import React, { useState } from 'react';
import { Card, Form, Input, Button, Upload, message, Spin, Alert } from 'your-ui-lib';
import { FacebookPagesList } from './FacebookPagesList';
import { publishToFacebook } from '../api/facebook-api';

export function PublishToFacebook() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedPage, setSelectedPage] = useState(null);
  
  // Обработчик отправки формы
  const handleSubmit = async (values) => {
    if (!selectedPage) {
      message.error('Пожалуйста, выберите страницу Facebook');
      return;
    }
    
    setLoading(true);
    try {
      const result = await publishToFacebook(
        selectedPage.page_id,
        values.message,
        imageUrl
      );
      
      if (result.success) {
        message.success('Публикация успешно создана!');
        form.resetFields();
        setImageUrl('');
      } else {
        message.error(`Ошибка публикации: ${result.error}`);
      }
    } catch (error) {
      message.error(`Произошла ошибка: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Обработчик загрузки изображения
  const handleImageUpload = (info) => {
    if (info.file.status === 'uploading') {
      setUploading(true);
      return;
    }
    
    if (info.file.status === 'done') {
      setUploading(false);
      setImageUrl(info.file.response.url);
      message.success('Изображение успешно загружено');
    } else if (info.file.status === 'error') {
      setUploading(false);
      message.error('Ошибка загрузки изображения');
    }
  };
  
  if (!selectedPage) {
    return (
      <Card title="Публикация в Facebook">
        <h3>Выберите страницу Facebook:</h3>
        <FacebookPagesList onSelectPage={setSelectedPage} />
      </Card>
    );
  }
  
  return (
    <Card 
      title="Публикация в Facebook"
      extra={
        <Button type="link" onClick={() => setSelectedPage(null)}>
          Изменить страницу
        </Button>
      }
    >
      <div style={{ marginBottom: 20 }}>
        <Alert
          message={`Выбрана страница: ${selectedPage.name}`}
          type="info"
          showIcon
        />
      </div>
      
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="message"
          label="Текст публикации"
          rules={[{ required: true, message: 'Пожалуйста, введите текст публикации' }]}
        >
          <Input.TextArea rows={4} placeholder="Введите текст публикации..." />
        </Form.Item>
        
        <Form.Item label="Изображение">
          <Upload
            name="file"
            listType="picture-card"
            showUploadList={true}
            action="/api/upload"
            onChange={handleImageUpload}
          >
            {imageUrl ? null : (
              <div>
                {uploading ? <Spin /> : <div>+ Загрузить</div>}
              </div>
            )}
          </Upload>
        </Form.Item>
        
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Опубликовать
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
```

### Пример 3: Компонент выбора аккаунта Instagram

```jsx
// client/src/components/PublishToInstagram.jsx
import React, { useState } from 'react';
import { Card, Form, Input, Button, Upload, message, Spin, Alert } from 'your-ui-lib';
import { InstagramAccountsList } from './InstagramAccountsList';
import { publishToInstagram, publishCarouselToInstagram } from '../api/instagram-api';

export function PublishToInstagram() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  
  // Обработчик отправки формы
  const handleSubmit = async (values) => {
    if (!selectedAccount) {
      message.error('Пожалуйста, выберите аккаунт Instagram');
      return;
    }
    
    if (imageUrls.length === 0) {
      message.error('Пожалуйста, загрузите хотя бы одно изображение');
      return;
    }
    
    setLoading(true);
    try {
      let result;
      
      if (imageUrls.length === 1) {
        // Публикация одиночного изображения
        result = await publishToInstagram(
          selectedAccount.instagram_id,
          imageUrls[0],
          values.caption
        );
      } else {
        // Публикация карусели
        result = await publishCarouselToInstagram(
          selectedAccount.instagram_id,
          imageUrls,
          values.caption
        );
      }
      
      if (result.success) {
        message.success('Публикация успешно создана!');
        form.resetFields();
        setImageUrls([]);
      } else {
        message.error(`Ошибка публикации: ${result.error}`);
      }
    } catch (error) {
      message.error(`Произошла ошибка: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Обработчик загрузки изображения
  const handleImageUpload = (info) => {
    if (info.file.status === 'uploading') {
      setUploading(true);
      return;
    }
    
    if (info.file.status === 'done') {
      setUploading(false);
      setImageUrls([...imageUrls, info.file.response.url]);
      message.success('Изображение успешно загружено');
    } else if (info.file.status === 'error') {
      setUploading(false);
      message.error('Ошибка загрузки изображения');
    }
  };
  
  if (!selectedAccount) {
    return (
      <Card title="Публикация в Instagram">
        <h3>Выберите аккаунт Instagram:</h3>
        <InstagramAccountsList onSelectAccount={setSelectedAccount} />
      </Card>
    );
  }
  
  return (
    <Card 
      title="Публикация в Instagram"
      extra={
        <Button type="link" onClick={() => setSelectedAccount(null)}>
          Изменить аккаунт
        </Button>
      }
    >
      <div style={{ marginBottom: 20 }}>
        <Alert
          message={`Выбран аккаунт: @${selectedAccount.username}`}
          type="info"
          showIcon
        />
      </div>
      
      <Form form={form} onFinish={handleSubmit} layout="vertical">
        <Form.Item
          name="caption"
          label="Подпись"
          rules={[{ required: true, message: 'Пожалуйста, введите подпись' }]}
        >
          <Input.TextArea rows={4} placeholder="Введите подпись к публикации..." />
        </Form.Item>
        
        <Form.Item label="Изображения">
          <Upload
            name="file"
            listType="picture-card"
            showUploadList={true}
            action="/api/upload"
            onChange={handleImageUpload}
          >
            {imageUrls.length >= 10 ? null : (
              <div>
                {uploading ? <Spin /> : <div>+ Загрузить</div>}
              </div>
            )}
          </Upload>
          
          {imageUrls.length > 1 && (
            <Alert
              message="Будет опубликована карусель"
              description="Вы загрузили несколько изображений. Они будут опубликованы в виде карусели."
              type="info"
              showIcon
              style={{ marginTop: 10 }}
            />
          )}
        </Form.Item>
        
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Опубликовать
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
```

## Часть 5: Требуемые разрешения Facebook для публикации

Ниже приведен список необходимых разрешений для публикации в Facebook и Instagram через Graph API:

### Обязательные разрешения для Facebook:

1. `pages_show_list` - Позволяет получить список страниц Facebook, которыми управляет пользователь
2. `pages_read_engagement` - Позволяет читать взаимодействия с публикациями страницы
3. `pages_manage_posts` - Позволяет создавать, редактировать и удалять публикации от имени страницы
4. `public_profile` - Базовый доступ к профилю пользователя (имя, фото и т.д.)
5. `email` - Доступ к email пользователя (необходим для идентификации)

### Обязательные разрешения для Instagram:

1. `instagram_basic` - Базовый доступ к бизнес-аккаунту Instagram
2. `instagram_content_publish` - Позволяет публиковать контент в Instagram
3. `instagram_manage_comments` - Позволяет управлять комментариями к публикациям
4. `instagram_manage_insights` - Позволяет получать аналитику по публикациям

### Опциональные разрешения (для расширенного функционала):

1. `pages_messaging` - Для работы с сообщениями страницы Facebook
2. `instagram_manage_messages` - Для работы с сообщениями в Instagram Direct
3. `ads_management` - Если вы планируете интеграцию с рекламными кампаниями
4. `business_management` - Для работы с бизнес-аккаунтами

## Часть 6: Прохождение проверки приложения (App Review)

Для использования всех разрешений в производственном режиме, ваше приложение должно пройти проверку Facebook (App Review). Вот основные шаги:

1. Подготовьте видеодемонстрации использования каждого разрешения
2. Оформите подробную заявку, объясняющую, как и зачем вы используете каждое разрешение
3. Подготовьте детальные инструкции для тестирования вашего приложения
4. Подайте заявку на проверку в разделе "App Review" в панели управления приложением
5. Ожидайте ответа команды проверки Facebook (обычно занимает от нескольких дней до недель)

### Для тестирования (без App Review):
- До прохождения проверки все разрешения будут работать только для администраторов и тестировщиков приложения
- Добавьте всех разработчиков и тестировщиков в раздел "Роли" -> "Тестировщики" в панели управления приложением

### После прохождения App Review:
1. Обновите настройки приложения, установив статус "Live" в "Настройки" -> "Основные"
2. Проверьте, что разрешения активированы в настройках приложения
3. Протестируйте приложение с обычными пользователями для подтверждения работоспособности

## Важные примечания:

1. **Безопасность токенов:**
   - Всегда храните токены в безопасном месте
   - Никогда не отправляйте токены на клиентскую сторону
   - Используйте HTTPS для всех запросов
   - Соблюдайте принцип минимальных необходимых привилегий

2. **Ограничения API:**
   - Facebook и Instagram имеют лимиты на количество запросов (rate limits)
   - Размеры и форматы изображений имеют определенные ограничения (особенно для Instagram)
   - Некоторые операции требуют бизнес-аккаунт Instagram

3. **Обработка ошибок:**
   - Создайте надежную систему обработки ошибок API
   - Реализуйте механизм автоматического обновления токенов
   - Уведомляйте пользователей о необходимости переавторизации при проблемах с токенами
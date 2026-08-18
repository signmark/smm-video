/**
 * Единый сервис для работы с Facebook API
 * Объединяет все существующие реализации публикации в Facebook
 */

import axios from 'axios';
import log from '../../utils/logger';
import { CampaignContent, SocialPlatform, SocialPublication } from '@shared/schema';
import { TokenValidationResult } from './base-service';

class FacebookService {
  private apiVersion = 'v19.0';

  // Кэш для токенов страниц (на основе токена пользователя и ID страницы)
  private pageTokenCache = new Map<string, { token: string, timestamp: number }>();

  // Время жизни кэша (1 час по умолчанию)
  private tokenCacheExpirationMs = 3600 * 1000;

  /**
   * Проверяет валидность токена Facebook
   */
  async validateToken(settings: any): Promise<TokenValidationResult> {
    const { token, pageId } = settings;
    if (!token) return { isValid: false, error: 'Токен отсутствует' };

    try {
      // 1. Проверяем сам токен через debug_token или просто /me
      const response = await axios.get(`https://graph.facebook.com/${this.apiVersion}/debug_token`, {
        params: {
          input_token: token,
          access_token: token // Для проверки токена нужен сам токен или app token
        }
      });

      const data = response.data.data;
      if (!data.is_valid) {
        return { isValid: false, error: 'Токен недействителен' };
      }

      // 2. Если есть pageId, проверяем доступ к странице
      if (pageId) {
        const pagesRes = await axios.get(`https://graph.facebook.com/${this.apiVersion}/me/accounts`, {
          params: { access_token: token }
        });
        const hasPage = pagesRes.data.data.some((p: any) => p.id === pageId);
        if (!hasPage) {
          return { isValid: false, error: `Нет доступа к странице ${pageId}` };
        }
      }

      return {
        isValid: true,
        expiresAt: data.expires_at ? new Date(data.expires_at * 1000) : null,
        details: { scopes: data.scopes }
      };
    } catch (error: any) {
      const msg = error.response?.data?.error?.message || error.message;
      return { isValid: false, error: msg };
    }
  }

  /**
   * Получает токен страницы на основе токена пользователя
   * @param userAccessToken Токен доступа пользователя
   * @param pageId ID страницы Facebook
   * @returns Токен доступа страницы
   */
  async getPageAccessToken(userAccessToken: string, pageId: string): Promise<string> {
    // Создаем уникальный ID операции для отслеживания в логах
    const operationId = `fb_token_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
      // Проверяем, имеет ли userAccessToken префикс "Key "
      let accessToken = userAccessToken;
      if (accessToken.startsWith('Key ')) {
        log.info(`[${operationId}] [Facebook] Удаление префикса 'Key ' из токена пользователя`);
        accessToken = accessToken.substring(4);
      }

      // Создаем ключ для кэша из усеченного токена и pageId
      const cacheKey = `${accessToken.substring(0, 20)}_${pageId}`;

      // Проверяем кэш
      const now = Date.now();
      const cachedData = this.pageTokenCache.get(cacheKey);

      if (cachedData && (now - cachedData.timestamp) < this.tokenCacheExpirationMs) {
        log.info(`[${operationId}] [Facebook] Используем кэшированный токен для страницы ${pageId}`);
        return cachedData.token;
      }

      log.info(`[${operationId}] [Facebook] Получение нового токена страницы для ${pageId}`);

      // Проверка на пустой токен
      if (!accessToken || accessToken.trim() === '') {
        throw new Error('Пустой токен доступа пользователя');
      }

      log.info(`[${operationId}] [Facebook] Токен пользователя получен: ${accessToken ? 'YES' : 'NO'}`);

      // Получаем список страниц пользователя
      const pagesUrl = `https://graph.facebook.com/${this.apiVersion}/me/accounts`;

      let pagesResponse;
      try {
        pagesResponse = await axios.get(pagesUrl, {
          params: { access_token: accessToken }
        });
      } catch (axiosError: any) {
        log.error(`[${operationId}] [Facebook] Ошибка Axios: ${axiosError.message}`);

        if (axiosError.response?.data) {
          log.error(`[${operationId}] [Facebook] Детали ошибки API: ${JSON.stringify(axiosError.response.data)}`);

          // Анализ ошибок Facebook API
          if (axiosError.response.data.error) {
            const fbError = axiosError.response.data.error;

            if (fbError.code === 190) {
              throw new Error(`Недействительный токен Facebook: ${fbError.message}`);
            }
          }
        }

        // В случае неуспешного запроса возвращаем токен пользователя
        log.warn(`[${operationId}] [Facebook] Не удалось получить список страниц, используем токен пользователя по умолчанию`);
        return accessToken;
      }

      if (!pagesResponse.data?.data) {
        log.warn(`[${operationId}] [Facebook] Ответ API не содержит данных о страницах, используем токен пользователя`);
        return accessToken;
      }

      // Ищем нужную страницу и получаем ее токен
      const pages = pagesResponse.data.data;
      log.info(`[${operationId}] [Facebook] Получено ${pages.length} страниц`);

      // Логируем список ID страниц
      if (pages.length > 0) {
        const pageIds = pages.map((p: any) => p.id).join(', ');
        log.info(`[${operationId}] [Facebook] ID доступных страниц: ${pageIds}`);
      }

      let pageAccessToken = accessToken; // По умолчанию используем токен пользователя
      let foundPage = false;

      for (const page of pages) {
        if (page.id === pageId) {
          pageAccessToken = page.access_token;
          log.info(`[${operationId}] [Facebook] Найден токен для страницы ${pageId} (${page.name})`);
          foundPage = true;
          break;
        }
      }

      if (!foundPage) {
        log.warn(`[${operationId}] [Facebook] Страница ${pageId} не найдена в списке доступных страниц, используем токен пользователя`);
      }

      // Сохраняем токен в кэше
      this.pageTokenCache.set(cacheKey, { token: pageAccessToken, timestamp: now });
      log.info(`[${operationId}] [Facebook] Токен страницы сохранен в кэше`);

      return pageAccessToken;
    } catch (error: any) {
      log.error(`[${operationId}] [Facebook] Ошибка получения токена страницы: ${error.message}`);
      throw error;
    }
  }

  /**
   * Публикует текст без изображения на странице Facebook
   * @param pageId ID страницы Facebook
   * @param token Токен доступа страницы
   * @param text Текст публикации
   * @returns Результат публикации с ID и URL поста
   */
  async publishTextOnly(pageId: string, token: string, text: string): Promise<{ id: string, permalink: string }> {
    // Создаем уникальный ID операции для отслеживания в логах
    const operationId = `fb_text_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
      log.info(`[${operationId}] [Facebook] Публикация текста на странице ${pageId}`);
      log.info(`[${operationId}] [Facebook] Длина текста: ${text ? text.length : 0} символов`);

      // Попробуем разные варианты отправки запроса
      try {
        // Метод 1: Через URLSearchParams (формат form-data)
        log.info(`[${operationId}] [Facebook] Попытка публикации текста через URLSearchParams`);

        // Создаем POST запрос для публикации текста
        const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${pageId}/feed`;

        const formData = new URLSearchParams();
        formData.append('message', text);
        formData.append('access_token', token);

        log.info(`[${operationId}] [Facebook] Отправка запроса на ${apiUrl}`);

        const response = await axios.post(apiUrl, formData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        if (!response.data?.id) {
          throw new Error('Нет ID в ответе API (URLSearchParams)');
        }

        // Получаем permalink поста на основе ID
        const postId = response.data.id;
        log.info(`[${operationId}] [Facebook] Публикация создана, ID: ${postId}`);

        const postUrl = await this.getPostPermalink(pageId, postId, token);

        log.info(`[${operationId}] [Facebook] Публикация успешно создана: ${postUrl}`);

        return {
          id: postId,
          permalink: postUrl
        };
      } catch (method1Error: any) {
        log.error(`[${operationId}] [Facebook] Ошибка метода 1 (URLSearchParams): ${method1Error.message}`);

        if (method1Error.response?.data) {
          log.error(`[${operationId}] [Facebook] Детали ошибки API (метод 1): ${JSON.stringify(method1Error.response.data)}`);
        }

        // Метод 2: Через params в axios (запрос как query string)
        log.info(`[${operationId}] [Facebook] Попытка публикации через axios params`);

        const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${pageId}/feed`;

        const response = await axios.post(apiUrl, null, {
          params: {
            message: text,
            access_token: token
          }
        });

        if (!response.data?.id) {
          throw new Error('Нет ID в ответе API (axios params)');
        }

        // Получаем permalink поста на основе ID
        const postId = response.data.id;
        log.info(`[${operationId}] [Facebook] Публикация создана, ID: ${postId}`);

        const postUrl = await this.getPostPermalink(pageId, postId, token);

        log.info(`[${operationId}] [Facebook] Публикация успешно создана: ${postUrl}`);

        return {
          id: postId,
          permalink: postUrl
        };
      }
    } catch (error: any) {
      log.error(`[${operationId}] [Facebook] Ошибка публикации текста: ${error.message}`);

      if (error.response?.data) {
        log.error(`[${operationId}] [Facebook] Детали ошибки API: ${JSON.stringify(error.response.data)}`);

        // Анализируем конкретные ошибки Facebook API для лучшей диагностики
        if (error.response.data.error) {
          const fbError = error.response.data.error;
          log.error(`[${operationId}] [Facebook] Код ошибки API: ${fbError.code}, тип: ${fbError.type}, сообщение: ${fbError.message}`);

          // Проверяем конкретные коды ошибок
          if (fbError.code === 190) {
            log.error(`[${operationId}] [Facebook] Ошибка токена! Токен недействителен или срок его действия истек.`);
          }
        }
      }

      // Повторно выбрасываем исключение
      throw error;
    }
  }

  /**
   * Публикует текст с изображением на странице Facebook
   * @param pageId ID страницы Facebook
   * @param token Токен доступа страницы
   * @param imageUrl URL изображения
   * @param text Текст публикации
   * @returns Результат публикации с ID и URL поста
   */
  async publishImageWithText(pageId: string, token: string, imageUrl: string, text: string): Promise<{ id: string, permalink: string }> {
    // Создаем уникальный ID операции для отслеживания в логах
    const operationId = `fb_post_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
      log.info(`[${operationId}] [Facebook] Публикация изображения с текстом на странице ${pageId}`);
      log.info(`[${operationId}] [Facebook] URL изображения: ${imageUrl && imageUrl.substring(0, 50)}...`);
      log.info(`[${operationId}] [Facebook] Длина текста: ${text ? text.length : 0} символов`);

      // Проверяем формат URL изображения
      if (!imageUrl || !imageUrl.startsWith('http')) {
        throw new Error(`Некорректный URL изображения: ${imageUrl}`);
      }

      // Попробуем разные варианты отправки запроса
      try {
        // Метод 1: Через URLSearchParams (формат form-data)
        log.info(`[${operationId}] [Facebook] Попытка публикации через URLSearchParams`);

        // Создаем POST запрос для публикации фото с текстом
        const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${pageId}/photos`;

        const formData = new URLSearchParams();
        formData.append('url', imageUrl);
        formData.append('caption', text);
        formData.append('access_token', token);
        formData.append('published', 'true');

        log.info(`[${operationId}] [Facebook] Отправка запроса на ${apiUrl}`);

        const response = await axios.post(apiUrl, formData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        if (!response.data?.id) {
          throw new Error('Нет ID в ответе API (URLSearchParams)');
        }

        // Получаем permalink поста на основе ID
        const postId = response.data.id;
        log.info(`[${operationId}] [Facebook] Публикация создана, ID: ${postId}`);

        const postUrl = await this.getPostPermalink(pageId, postId, token);

        log.info(`[${operationId}] [Facebook] Публикация успешно создана: ${postUrl}`);

        return {
          id: postId,
          permalink: postUrl
        };
      } catch (method1Error: any) {
        log.error(`[${operationId}] [Facebook] Ошибка метода 1 (URLSearchParams): ${method1Error.message}`);

        if (method1Error.response?.data) {
          log.error(`[${operationId}] [Facebook] Детали ошибки API (метод 1): ${JSON.stringify(method1Error.response.data)}`);
        }

        // Метод 2: Через params в axios (запрос как query string)
        log.info(`[${operationId}] [Facebook] Попытка публикации через axios params`);

        const apiUrl = `https://graph.facebook.com/${this.apiVersion}/${pageId}/photos`;

        const response = await axios.post(apiUrl, null, {
          params: {
            url: imageUrl,
            caption: text,
            access_token: token,
            published: true
          }
        });

        if (!response.data?.id) {
          throw new Error('Нет ID в ответе API (axios params)');
        }

        // Получаем permalink поста на основе ID
        const postId = response.data.id;
        log.info(`[${operationId}] [Facebook] Публикация создана, ID: ${postId}`);

        const postUrl = await this.getPostPermalink(pageId, postId, token);

        log.info(`[${operationId}] [Facebook] Публикация успешно создана: ${postUrl}`);

        return {
          id: postId,
          permalink: postUrl
        };
      }
    } catch (error: any) {
      log.error(`[${operationId}] [Facebook] Ошибка публикации: ${error.message}`);

      if (error.response?.data) {
        log.error(`[${operationId}] [Facebook] Детали ошибки API: ${JSON.stringify(error.response.data)}`);

        // Анализируем конкретные ошибки Facebook API для лучшей диагностики
        if (error.response.data.error) {
          const fbError = error.response.data.error;
          log.error(`[${operationId}] [Facebook] Код ошибки API: ${fbError.code}, тип: ${fbError.type}, сообщение: ${fbError.message}`);

          // Проверяем конкретные коды ошибок
          if (fbError.code === 190) {
            log.error(`[${operationId}] [Facebook] Ошибка токена! Токен недействителен или срок его действия истек.`);
          } else if (fbError.code === 100) {
            log.error(`[${operationId}] [Facebook] Ошибка параметров в запросе! Проверьте URL изображения.`);
          }
        }
      }

      // Повторно выбрасываем исключение
      throw error;
    }
  }

  /**
   * Получает постоянную ссылку (permalink) на пост
   * @param pageId ID страницы
   * @param postId ID поста
   * @param token Токен доступа
   * @returns URL поста
   */
  async getPostPermalink(pageId: string, postId: string, token: string): Promise<string> {
    try {
      // Конвертируем ID, удаляя префикс (если требуется)
      const cleanPostId = postId.includes('_') ? postId : `${pageId}_${postId}`;

      const response = await axios.get(`https://graph.facebook.com/${this.apiVersion}/${cleanPostId}`, {
        params: {
          fields: 'permalink_url',
          access_token: token
        }
      });

      if (response.data && response.data.permalink_url) {
        return response.data.permalink_url;
      } else {
        // Если не удалось получить permalink, формируем стандартный URL
        return `https://facebook.com/${pageId}/posts/${cleanPostId}`;
      }
    } catch (error: any) {
      log.warn(`[Facebook] Не удалось получить permalink: ${error.message}`);
      // Возвращаем стандартный URL в случае ошибки
      return `https://facebook.com/${pageId}/posts/${postId}`;
    }
  }

  /**
   * Удаляет пост/фото со страницы Facebook
   * @param postId ID поста (формат: pageId_postId или просто postId)
   * @param token Токен доступа страницы
   */
  async deletePost(postId: string, token: string): Promise<boolean> {
    try {
      const res = await axios.delete(`https://graph.facebook.com/${this.apiVersion}/${postId}`, {
        params: { access_token: token }
      });
      return res.data?.success === true;
    } catch {
      return false;
    }
  }

  /**
   * Публикует контент в Facebook
   * @param content Контент для публикации
   * @param settings Настройки Facebook (токен и pageId)
   * @returns Результат публикации
   */
  async publishToFacebook(content: CampaignContent, settings: any): Promise<SocialPublication> {
    // Создаем уникальный ID операции для отслеживания в логах
    const operationId = `fb_pub_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const startTime = Date.now();

    try {
      log.info(`[${operationId}] [Facebook] Начало публикации контента ${content.id} в Facebook`);
      log.info(`[${operationId}] [Facebook] Анализ настроек: ${JSON.stringify({
        hasToken: !!settings.token,
        hasPageId: !!settings.pageId,
        pageIdMask: settings.pageId ? `${settings.pageId.substring(0, 5)}...` : 'нет',
        cacheSize: this.pageTokenCache.size
      })}`);

      const { token, pageId } = settings;

      if (!token || !pageId) {
        throw new Error('Не указаны обязательные параметры (token, pageId) для публикации в Facebook');
      }

      // Получаем URL изображения и текст
      const imageUrl = content.imageUrl;
      const text = content.content || '';

      log.info(`[${operationId}] [Facebook] Данные поста: ${JSON.stringify({
        hasImage: !!imageUrl,
        imageUrlPrefix: imageUrl ? imageUrl.substring(0, 30) + '...' : 'нет',
        textLength: text ? text.length : 0,
        textPrefix: text ? text.substring(0, 30) + '...' : 'нет'
      })}`);

      // В обновленной версии не требуем обязательное наличие изображения
      // Фейсбук поддерживает текстовые посты без изображений
      if (!imageUrl && !text) {
        throw new Error('Необходимо указать либо изображение, либо текст для публикации в Facebook');
      }

      // Получаем токен страницы на основе токена пользователя
      log.info(`[${operationId}] [Facebook] Получение токена страницы ${pageId}`);
      const pageAccessToken = await this.getPageAccessToken(token, pageId);

      if (!pageAccessToken) {
        throw new Error('Не удалось получить токен доступа страницы');
      }

      log.info(`[${operationId}] [Facebook] Токен страницы получен: ${pageAccessToken ? 'YES' : 'NO'}`);

      // Выбираем метод публикации в зависимости от наличия изображения
      log.info(`[${operationId}] [Facebook] Публикация на странице ${pageId}`);

      let id, permalink;

      if (imageUrl && imageUrl.startsWith('http')) {
        // Если есть изображение, публикуем фото с текстом
        log.info(`[${operationId}] [Facebook] Публикация изображения с текстом`);
        ({ id, permalink } = await this.publishImageWithText(
          pageId,
          pageAccessToken,
          imageUrl,
          text
        ));
      } else {
        // Если изображения нет, публикуем только текст
        log.info(`[${operationId}] [Facebook] Публикация только текста (без изображения)`);
        ({ id, permalink } = await this.publishTextOnly(
          pageId,
          pageAccessToken,
          text
        ));
      }

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      log.info(`[${operationId}] [Facebook] Публикация успешно создана: ${permalink}`);
      log.info(`[${operationId}] [Facebook] Время выполнения публикации: ${executionTime}ms, размер кэша токенов: ${this.pageTokenCache.size}`);

      // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Проверяем наличие postUrl перед установкой статуса published
      if (!permalink || permalink.trim() === '') {
        log.error(`[${operationId}] [Facebook] ОШИБКА: Публикация создана, но permalink пустой - помечаем как failed`);
        return {
          platform: 'facebook',
          status: 'failed',
          publishedAt: null,
          error: 'Публикация создана, но не получен permalink - возможна проблема с Facebook API'
        };
      }

      // Возвращаем результат публикации только если есть postUrl
      return {
        platform: 'facebook',
        status: 'published',
        publishedAt: new Date(),
        postUrl: permalink,
        postId: id
      };
    } catch (error: any) {
      const endTime = Date.now();
      const executionTime = endTime - startTime;

      log.error(`[${operationId}] [Facebook] Ошибка публикации: ${error.message}`);
      log.error(`[${operationId}] [Facebook] Время до ошибки: ${executionTime}ms, размер кэша токенов: ${this.pageTokenCache.size}`);

      // Проверяем, есть ли вложенные ошибки от API
      if (error.response?.data) {
        log.error(`[${operationId}] [Facebook] Ответ API: ${JSON.stringify(error.response.data)}`);

        if (error.response.data.error) {
          const fbError = error.response.data.error;
          log.error(`[${operationId}] [Facebook] Код ошибки API: ${fbError.code}, тип: ${fbError.type}, сообщение: ${fbError.message}`);

          // Возвращаем более детализированное сообщение об ошибке
          return {
            platform: 'facebook',
            status: 'failed',
            publishedAt: null,
            error: `Ошибка API Facebook: [${fbError.code}] ${fbError.message}`
          };
        }
      }

      return {
        platform: 'facebook',
        status: 'failed',
        publishedAt: null,
        error: `Ошибка публикации в Facebook: ${error.message}`
      };
    }
  }

  /**
   * Зачищает HTML-теги, Markdown-разметку и HTML-сущности из текста.
   * Facebook не поддерживает форматирование — оставляем только текст, пробелы и переносы строк.
   */
  private sanitizeFacebookText(raw: string): string {
    let text = raw
      // --- HTML: блочные элементы → переносы строк ---
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // --- Убираем оставшиеся HTML-теги ---
      .replace(/<[^>]*>/g, '')
      // --- HTML-сущности ---
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      // --- Markdown: изображения (убираем полностью) ---
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // --- Markdown: ссылки [текст](url) → текст ---
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // --- Markdown: заголовки # / ## / ### → текст без # ---
      .replace(/^#{1,6}\s+/gm, '')
      // --- Markdown: жирный ***текст*** / **текст** / __текст__ ---
      .replace(/\*{3}([^*]+)\*{3}/g, '$1')
      .replace(/\*{2}([^*]+)\*{2}/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // --- Markdown: курсив *текст* / _текст_ ---
      .replace(/\*([^*\n]+)\*/g, '$1')
      .replace(/_([^_\n]+)_/g, '$1')
      // --- Markdown: зачёркнутый ~~текст~~ ---
      .replace(/~~([^~]+)~~/g, '$1')
      // --- Markdown: инлайн-код `код` ---
      .replace(/`([^`\n]+)`/g, '$1')
      // --- Markdown: блок кода ```...``` ---
      .replace(/```[\s\S]*?```/g, '')
      // --- Markdown: горизонтальная линия --- / *** / ___ ---
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // --- Markdown: цитаты > текст → текст ---
      .replace(/^>\s?/gm, '')
      // --- Markdown: маркированные списки - / * / + в начале строки ---
      .replace(/^[\-\*\+]\s+/gm, '')
      // --- Markdown: нумерованные списки 1. 2. и т.д. ---
      .replace(/^\d+\.\s+/gm, '')
      // --- Убираем более 2 переносов подряд ---
      .replace(/\n{3,}/g, '\n\n')
      // --- Убираем лишние пробелы в каждой строке ---
      .replace(/[^\S\n]+/g, ' ')
      .replace(/^ /gm, '')
      .trim();
    return text;
  }

  /**
   * Загружает изображение в Cloudinary и возвращает публичный URL.
   * Facebook API не может достучаться до российских S3.
   */
  private async proxyImageThroughCloudinary(imageUrl: string, opId: string): Promise<string> {
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dc6bcrsyl';
      const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'My Unsigned Preset';

      log.info(`[${opId}] [Facebook] Загружаем изображение в Cloudinary: ${imageUrl.substring(0, 80)}`);
      const resp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 50 * 1024 * 1024
      });
      const buffer = Buffer.from(resp.data);
      const contentType = (resp.headers['content-type'] as string) || 'image/jpeg';
      const base64 = buffer.toString('base64');
      const dataUri = `data:${contentType};base64,${base64}`;

      const form = new FormData();
      form.append('file', dataUri);
      form.append('upload_preset', uploadPreset);
      form.append('resource_type', 'image');
      form.append('folder', 'facebook-images');

      const res = await axios.post(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
      );

      if (res.data?.secure_url) {
        log.info(`[${opId}] [Facebook] Изображение загружено в Cloudinary: ${res.data.secure_url}`);
        return res.data.secure_url;
      }
    } catch (err: any) {
      log.warn(`[${opId}] [Facebook] Cloudinary upload failed: ${err.response?.data?.error?.message || err.message} — используем оригинал`);
    }
    return imageUrl;
  }

  /**
   * Унифицированный метод публикации — аналог threadsService.publishPost.
   * Используется планировщиком и /api/publish/now для прямой публикации.
   */
  async publishPost(
    settings: { token: string; pageId: string; username?: string },
    content: { text: string; imageUrl?: string; videoUrl?: string }
  ): Promise<{ success: boolean; postId?: string; postUrl?: string; error?: string }> {
    const opId = `fb_direct_${Date.now()}`;
    try {
      const { token, pageId } = settings;
      if (!token || !pageId) {
        throw new Error('Facebook не настроен: отсутствует token или pageId');
      }

      const cleanText = this.sanitizeFacebookText(content.text);
      log.info(`[${opId}] [Facebook] Публикуем: pageId=${pageId}, text=${cleanText.length} chars, image=${!!content.imageUrl}`);

      const pageToken = await this.getPageAccessToken(token, pageId);

      let postId: string;
      let permalink: string;

      if (content.imageUrl) {
        const proxiedUrl = await this.proxyImageThroughCloudinary(content.imageUrl, opId);
        ({ id: postId, permalink } = await this.publishImageWithText(pageId, pageToken, proxiedUrl, cleanText));
      } else {
        ({ id: postId, permalink } = await this.publishTextOnly(pageId, pageToken, cleanText));
      }

      log.info(`[${opId}] [Facebook] Успешно опубликовано: ${permalink}`);
      return { success: true, postId, postUrl: permalink };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message;
      log.error(`[${opId}] [Facebook] Ошибка публикации: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Обновляет статус публикации контента в Facebook
   * @param contentId ID контента
   * @param platformName Название платформы (всегда 'facebook')
   * @param publicationResult Результат публикации
   * @returns Обновленный контент или null в случае ошибки
   */
  async updatePublicationStatus(
    contentId: string,
    platformName: SocialPlatform,
    publicationResult: SocialPublication
  ): Promise<CampaignContent | null> {
    const operationId = `fb_update_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    log.info(`[${operationId}] Обновление статуса публикации для контента ${contentId} в Facebook`);

    try {
      // Получаем API URL системы
      const directusUrl = process.env.DIRECTUS_URL;

      // Находим активную сессию администратора для получения системного токена
      const directusAuthManager = await import('../directus-auth-manager').then(m => m.directusAuthManager);
      let token = '';
      const sessions = directusAuthManager.getAllActiveSessions();

      if (sessions.length > 0) {
        // Берем самый свежий токен из активных сессий
        token = sessions[0].token;
        log.info(`[${operationId}] Используем токен из активных сессий`);
      } else if (!token) {
        log.error(`[${operationId}] Не найден токен администратора`);
        return null;
      }

      // 1. Получаем текущие данные контента
      log.info(`[${operationId}] Получение данных контента ${contentId}`);
      const contentResponse = await axios.get(`${directusUrl}/items/campaign_content/${contentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!contentResponse.data?.data) {
        throw new Error(`Контент с ID ${contentId} не найден`);
      }

      const content = contentResponse.data.data;
      log.info(`[${operationId}] Контент получен: ${content.id}, от user_id: ${content.user_id}`);

      // 2. Обрабатываем текущее значение social_platforms
      let socialPlatforms = content.social_platforms || {};

      // Если socialPlatforms - строка, парсим JSON
      if (typeof socialPlatforms === 'string') {
        try {
          socialPlatforms = JSON.parse(socialPlatforms);
        } catch (e) {
          log.error(`[${operationId}] Ошибка парсинга social_platforms: ${e}`);
          socialPlatforms = {};
        }
      }

      // ВАЖНО: Если socialPlatforms не объект, создаем новый
      if (typeof socialPlatforms !== 'object' || !socialPlatforms) {
        socialPlatforms = {};
      }

      log.info(`[${operationId}] Текущие платформы до обновления: ${Object.keys(socialPlatforms).join(', ')}`);

      // 3. Создаем глубокую копию объекта для безопасного обновления
      const updatedPlatforms = JSON.parse(JSON.stringify(socialPlatforms));

      // 4. Обновляем ТОЛЬКО данные Facebook, сохраняя данные других платформ
      // ВАЖНО: Сначала глубоко копируем все существующие платформы
      for (const platform of Object.keys(socialPlatforms)) {
        if (platform !== 'facebook') {
          updatedPlatforms[platform] = JSON.parse(JSON.stringify(socialPlatforms[platform] || {}));
        }
      }

      // Теперь безопасно обновляем данные Facebook
      updatedPlatforms.facebook = {
        ...(socialPlatforms.facebook || {}),  // Сохраняем существующие данные
        status: publicationResult.status,     // Обновляем статус
        publishedAt: publicationResult.publishedAt ? new Date(publicationResult.publishedAt).toISOString() : null,
        selected: true,                       // Всегда устанавливаем selected в true
        // Сохраняем postUrl и postId, если они предоставлены в публикации
        ...(publicationResult.postUrl ? { postUrl: publicationResult.postUrl } : {}),
        ...(publicationResult.postId ? { postId: publicationResult.postId } : {}),
        // Устанавливаем поле error только если он существует
        ...(publicationResult.error ? { error: publicationResult.error } : { error: null })
      };

      log.info(`[${operationId}] Обновлена информация для Facebook: ${JSON.stringify(updatedPlatforms.facebook)}`);
      log.info(`[${operationId}] Платформы после обновления: ${Object.keys(updatedPlatforms).join(', ')}`);

      // 5. Дополнительная проверка сохранности данных других платформ
      for (const platform of Object.keys(socialPlatforms)) {
        if (platform !== 'facebook' && !updatedPlatforms[platform]) {
          log.error(`[${operationId}] КРИТИЧЕСКАЯ ОШИБКА: потеряны данные платформы ${platform}`);
          // Восстанавливаем потерянную платформу
          updatedPlatforms[platform] = JSON.parse(JSON.stringify(socialPlatforms[platform] || {}));
        }
      }

      // Логирование итоговых данных всех платформ для отладки
      log.info(`[${operationId}] Итоговые данные platform -> status:`);
      for (const [platform, platformData] of Object.entries(updatedPlatforms)) {
        // Безопасный доступ к свойствам с проверкой типа
        const data = platformData as Record<string, any>;
        log.info(`[${operationId}]   - ${platform}: ${data.status || 'no status'} (${data.postUrl ? 'имеет URL' : 'без URL'})`);
      }

      // 6. Обновляем данные в Directus
      log.info(`[${operationId}] Отправка обновленных данных в Directus`);
      await axios.patch(`${directusUrl}/items/campaign_content/${contentId}`, {
        social_platforms: updatedPlatforms
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      log.info(`[${operationId}] Статус публикации в Facebook успешно обновлен`);

      // 7. Возвращаем обновленный объект контента
      return {
        ...content,
        id: content.id,
        content: content.content,
        userId: content.user_id,
        campaignId: content.campaign_id,
        status: content.status,
        contentType: content.content_type || 'text',
        title: content.title || null,
        imageUrl: content.image_url,
        socialPlatforms: updatedPlatforms
      };
    } catch (error: any) {
      log.error(`[${operationId}] Ошибка при обновлении статуса: ${error.message}`);

      if (error.response?.data) {
        log.error(`[${operationId}] Детали ошибки API: ${JSON.stringify(error.response.data)}`);
      }

      return null;
    }
  }
}

// Экспорт сервиса как синглтон
export const facebookService = new FacebookService();
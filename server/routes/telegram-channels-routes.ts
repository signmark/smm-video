import { Express, Request, Response } from 'express';
import axios from 'axios';
import { globalApiKeysService } from '../services/global-api-keys';
import { ApiServiceName } from '../services/api-keys';
import { directusApiManager } from '../directus.js';
import { directusCrud } from '../services/directus-crud';
import { geminiProxyService } from '../services/gemini-proxy';

export function registerTelegramChannelsRoutes(app: Express) {

  // Simple authentication middleware
  const authenticateRequest = async (req: Request, res: Response, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Токен авторизации не найден' });
    }

    const token = authHeader.substring(7);
    try {
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      const finalUrl = directusUrl.endsWith('/') ? directusUrl : directusUrl + '/';

      const response = await axios.get(`${finalUrl}users/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      });

      if (response.data?.data?.id) {
        (req as any).userId = response.data.data.id;
        (req as any).userToken = token;
        next();
      } else {
        return res.status(401).json({ error: 'Недействительный токен' });
      }
    } catch (error: any) {
      console.error(`[Telegram Channels Auth] Token verification failed:`, error.response?.data || error.message);
      return res.status(401).json({
        error: 'Ошибка проверки токена',
        details: error.response?.data || error.message
      });
    }
  };

  // Получить все категории
  app.get('/api/telegram-channels/categories', authenticateRequest, async (req: Request & { userToken?: string }, res: Response) => {
    try {
      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      const finalUrl = directusUrl.endsWith('/') ? directusUrl : directusUrl + '/';

      const response = await axios.get(`${finalUrl}items/telegram_categories`, {
        headers: {
          'Authorization': `Bearer ${req.userToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          'sort': 'name',
          'limit': -1
        }
      });

      res.json({
        success: true,
        data: response.data.data || []
      });
    } catch (error: any) {
      console.error('[Telegram Channels] Error getting categories:', error.message);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения категорий',
        details: error.response?.data || error.message
      });
    }
  });

  // Получить каналы по категории
  app.get('/api/telegram-channels/by-category/:categoryName', authenticateRequest, async (req: Request & { userToken?: string }, res: Response) => {
    try {
      const { categoryName } = req.params;
      const { limit = 30, offset = 0, language, sortBy = 'subscribers' } = req.query;

      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      const finalUrl = directusUrl.endsWith('/') ? directusUrl : directusUrl + '/';

      // Сначала получаем ID категории
      const categoryResponse = await axios.get(`${finalUrl}items/telegram_categories`, {
        headers: {
          'Authorization': `Bearer ${req.userToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          'filter[name][_eq]': categoryName,
          'limit': 1
        }
      });

      const category = categoryResponse.data.data?.[0];
      if (!category) {
        return res.status(404).json({
          success: false,
          error: 'Категория не найдена'
        });
      }

      // Определяем сортировку
      let sortField = '-subscribers';
      if (sortBy === 'reach') sortField = '-avg_post_reach';
      else if (sortBy === 'er') sortField = '-engagement_rate';
      else if (sortBy === 'subscribers') sortField = '-subscribers';

      // Получаем каналы этой категории
      const filters: any = {
        'filter[category_id][_eq]': category.id,
        'filter[is_active][_eq]': true,
        'sort': sortField,
        'limit': limit,
        'offset': offset,
        'meta': 'filter_count'
      };

      if (language) {
        filters['filter[language][_eq]'] = language;
      }

      const channelsResponse = await axios.get(`${finalUrl}items/telegram_channels`, {
        headers: {
          'Authorization': `Bearer ${req.userToken}`,
          'Content-Type': 'application/json'
        },
        params: filters
      });

      res.json({
        success: true,
        data: {
          category: category,
          channels: channelsResponse.data.data || [],
          total: channelsResponse.data.meta?.filter_count || 0
        }
      });
    } catch (error: any) {
      console.error('[Telegram Channels] Error getting channels by category:', error.message);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения каналов',
        details: error.response?.data || error.message
      });
    }
  });

  // Получить топовые каналы (по всем категориям)
  app.get('/api/telegram-channels/top', authenticateRequest, async (req: Request & { userToken?: string }, res: Response) => {
    try {
      const { limit = 20, language } = req.query;

      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      const finalUrl = directusUrl.endsWith('/') ? directusUrl : directusUrl + '/';

      const filters: any = {
        'filter[is_active][_eq]': true,
        'sort': '-subscribers',
        'limit': limit,
        'fields': ['*', 'category_id.name', 'category_id.name_ru', 'category_id.name_en', 'category_id.name_es', 'category_id.icon']
      };

      if (language) {
        filters['filter[language][_eq]'] = language;
      }

      const response = await axios.get(`${finalUrl}items/telegram_channels`, {
        headers: {
          'Authorization': `Bearer ${req.userToken}`,
          'Content-Type': 'application/json'
        },
        params: filters
      });

      res.json({
        success: true,
        data: response.data.data || []
      });
    } catch (error: any) {
      console.error('[Telegram Channels] Error getting top channels:', error.message);
      res.status(500).json({
        success: false,
        error: 'Ошибка получения топ каналов',
        details: error.response?.data || error.message
      });
    }
  });

  // Поиск каналов
  app.get('/api/telegram-channels/search', authenticateRequest, async (req: Request & { userToken?: string }, res: Response) => {
    try {
      const { q, limit = 20 } = req.query;

      if (!q || typeof q !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Параметр поиска q обязателен'
        });
      }

      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      const finalUrl = directusUrl.endsWith('/') ? directusUrl : directusUrl + '/';

      const response = await axios.get(`${finalUrl}items/telegram_channels`, {
        headers: {
          'Authorization': `Bearer ${req.userToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          'filter[_or][0][title][_contains]': q,
          'filter[_or][1][username][_contains]': q,
          'filter[_or][2][description][_contains]': q,
          'filter[is_active][_eq]': true,
          'sort': '-subscribers',
          'limit': limit,
          'fields': ['*', 'category_id.name', 'category_id.name_ru', 'category_id.name_en', 'category_id.name_es']
        }
      });

      res.json({
        success: true,
        data: response.data.data || []
      });
    } catch (error: any) {
      console.error('[Telegram Channels] Error searching channels:', error.message);
      res.status(500).json({
        success: false,
        error: 'Ошибка поиска каналов',
        details: error.response?.data || error.message
      });
    }
  });

  // Умный AI-поиск: определяет категорию и ищет каналы
  app.post('/api/telegram-channels/smart-search', authenticateRequest, async (req: Request & { userToken?: string }, res: Response) => {
    try {
      const { keywords, searchInCategory = true, returnFullCategory = false, limit = 20 } = req.body;

      if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Параметр keywords обязателен и должен быть массивом'
        });
      }

      if (!req.userToken) {
        console.error('[Smart Search] CRITICAL: userToken is missing after authentication!');
        return res.status(401).json({
          success: false,
          error: 'Токен авторизации отсутствует'
        });
      }

      console.log(`🤖 [Smart Search] Ключевые слова:`, keywords);
      console.log(`🔑 [Smart Search] User token (first 20 chars):`, req.userToken?.substring(0, 20) + '...');

      const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
      const finalUrl = directusUrl.endsWith('/') ? directusUrl : directusUrl + '/';
      console.log(`🌐 [Smart Search] Directus URL:`, directusUrl);

      let category: any = null;
      let useAI = true;

      // Пытаемся использовать Gemini для определения категории
      try {
        console.log('[Smart Search] Пытаемся использовать Gemini AI...');
        const credentials = await globalApiKeysService.getGoogleServiceAccountKey();

        if (!credentials) {
          console.log('[Smart Search] Gemini credentials не найдены, используем fallback поиск');
          useAI = false;
        } else {
          // Используем Gemini для определения категории
          const geminiPrompt = `Проанализируй следующие ключевые слова и определи, к какой категории они относятся.

Ключевые слова: ${keywords.join(', ')}

Доступные категории:
- tech (технологии, IT, гаджеты)
- business (бизнес, стартапы, предпринимательство)
- marketing (маркетинг, SMM, реклама)
- food (еда, кулинария, рестораны)
- travel (путешествия, туризм)
- fashion (мода, красота, стиль)
- health (здоровье, фитнес, ЗОЖ)
- finance (финансы, инвестиции, криптовалюты)
- education (образование, курсы, обучение)
- entertainment (развлечения, кино, юмор, спорт, боулинг, активный отдых)
- news (новости, СМИ)
- crypto (криптовалюты, блокчейн, NFT)

Верни ТОЛЬКО название категории на английском (одно слово). Ничего больше.`;

          // Вызываем Gemini API через Cloudflare Worker прокси
          let geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY || ''}`;
          const workerProxy = process.env.GEMINI_PROXY_URL;
          if (workerProxy) {
            try {
              const proxyUrl = new URL(workerProxy);
              const originalUrl = new URL(geminiUrl);
              originalUrl.host = proxyUrl.host;
              originalUrl.protocol = proxyUrl.protocol;
              geminiUrl = originalUrl.toString();
            } catch { /* ignore */ }
          }

          const geminiResponse = await axios.post(
            geminiUrl,
            {
              contents: [{
                role: 'user',
                parts: [{ text: geminiPrompt }]
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 50,
              }
            },
            {
              headers: { 'Content-Type': 'application/json' },
            }
          );

          const categoryText = geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
          console.log(`🎯 [Smart Search] AI определил категорию:`, categoryText);

          if (categoryText) {
            // Получаем категорию из БД
            const categoryResponse = await axios.get(`${finalUrl}items/telegram_categories`, {
              headers: {
                'Authorization': `Bearer ${req.userToken}`,
                'Content-Type': 'application/json'
              },
              params: {
                'filter[name][_eq]': categoryText,
                'limit': 1
              }
            });

            category = categoryResponse.data.data?.[0];
            if (category) {
              console.log(`📁 [Smart Search] Найдена категория:`, category.name_ru);
            }
          }
        }
      } catch (aiError: any) {
        console.warn('[Smart Search] AI поиск не удался, используем fallback:', aiError.message);
        useAI = false;
      }

      // Если AI не сработал или категория не найдена - используем обычный поиск
      let channelsParams: any = {
        'filter[is_active][_eq]': true,
        'sort': '-subscribers',
        'limit': limit,
        'fields': ['*', 'category_id.name', 'category_id.name_ru', 'category_id.name_en', 'category_id.name_es', 'category_id.icon']
      };

      if (category) {
        // Если категория определена AI - ищем в ней
        channelsParams['filter[category_id][_eq]'] = category.id;

        if (searchInCategory && !returnFullCategory) {
          const searchQuery = keywords.join(' ');
          channelsParams['filter[_and][0][_or][0][title][_contains]'] = searchQuery;
          channelsParams['filter[_and][0][_or][1][description][_contains]'] = searchQuery;
        }
      } else {
        // Fallback: простой поиск по ключевым словам по всем каналам
        const searchQuery = keywords.join(' ');
        channelsParams['filter[_or][0][title][_contains]'] = searchQuery;
        channelsParams['filter[_or][1][username][_contains]'] = searchQuery;
        channelsParams['filter[_or][2][description][_contains]'] = searchQuery;
        console.log('🔍 [Smart Search] Используем fallback поиск по ключевым словам');
      }

      const channelsResponse = await axios.get(`${finalUrl}items/telegram_channels`, {
        headers: {
          'Authorization': `Bearer ${req.userToken}`,
          'Content-Type': 'application/json'
        },
        params: channelsParams
      });

      const channels = channelsResponse.data.data || [];
      console.log(`✅ [Smart Search] Найдено каналов: ${channels.length}`);

      res.json({
        success: true,
        data: {
          detectedCategory: category,
          keywords: keywords,
          searchMode: category ? (returnFullCategory ? 'full_category' : (searchInCategory ? 'search_in_category' : 'full_category')) : 'fallback_keyword_search',
          usedAI: !!category,
          channels: channels,
          totalFound: channels.length
        }
      });

    } catch (error: any) {
      console.error('[Smart Search] CRITICAL ERROR:', {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
        userToken: req.userToken ? 'present' : 'MISSING',
        keywords: req.body?.keywords
      });
      res.status(500).json({
        success: false,
        error: 'Ошибка умного поиска',
        details: error.response?.data || error.message,
        debugInfo: {
          hasToken: !!req.userToken,
          errorType: error.constructor.name,
          requestUrl: error.config?.url
        }
      });
    }
  });

  // Автоподбор каналов для кампании по теме и добавление как источников
  app.post('/api/campaigns/:campaignId/suggest-sources', authenticateRequest, async (req: Request & { userToken?: string; userId?: string }, res: Response) => {
    try {
      const { campaignId } = req.params;
      const { limit = 30, addToSources = false, query: customQuery } = req.body;

      console.log(`[Suggest Sources] Начинаем подбор каналов для кампании ${campaignId}`);

      // 1. Получаем данные кампании
      const campaign: any = await directusCrud.getById('user_campaigns', campaignId, { authToken: req.userToken });
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Кампания не найдена' });
      }
      if (campaign.user_id !== req.userId) {
        return res.status(403).json({ success: false, error: 'Нет доступа к этой кампании' });
      }

      // 2. Формируем список поисковых запросов
      // Приоритет: 1) пользовательский запрос, 2) ключевые слова кампании, 3) бизнес-анкета, 4) название кампании
      let searchTerms: string[] = [];

      if (customQuery && typeof customQuery === 'string' && customQuery.trim()) {
        // Пользователь ввёл свой запрос — используем его
        searchTerms = [customQuery.trim()];
        console.log(`[Suggest Sources] Пользовательский запрос: "${customQuery}"`);
      } else {
        // Берём ключевые слова кампании
        const keywordsResult = await directusCrud.list('campaign_keywords', {
          filter: { campaign_id: { _eq: campaignId } },
          limit: 20,
          authToken: req.userToken
        });
        const campaignKeywords = (keywordsResult || []).map((k: any) => k.keyword);

        if (campaignKeywords.length > 0) {
          searchTerms = campaignKeywords.slice(0, 5);
        } else {
          // Бизнес-анкета
          if (campaign.business_questionnaire) {
            const q = typeof campaign.business_questionnaire === 'string'
              ? JSON.parse(campaign.business_questionnaire)
              : campaign.business_questionnaire;
            const parts = [q.industry, q.target_audience, q.products_services].filter(Boolean);
            if (parts.length > 0) {
              searchTerms = parts.slice(0, 3);
            }
          }
          // Название кампании
          if (searchTerms.length === 0 && campaign.name) {
            searchTerms = [campaign.name];
          }
        }
        console.log(`[Suggest Sources] Ключевые слова кампании: ${searchTerms.join(', ')}`);
      }

      if (searchTerms.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Не удалось определить тему. Добавьте ключевые слова в кампанию или введите запрос вручную.'
        });
      }

      // 3. Расширяем поисковые термины через AI (синонимы, смежные темы, транслитерация)
      let finalSearchTerms: string[];

      try {
          const aiPrompt = `Ты помогаешь найти Telegram-каналы по теме.

Исходные ключевые слова/фразы:
${searchTerms.map(t => `- ${t}`).join('\n')}

Твоя задача: для каждой фразы придумать 3-5 коротких поисковых слов или словосочетаний (1-3 слова), которые РЕАЛЬНО могут встречаться в названиях или описаниях Telegram-каналов на эту тему.
- Включай русские синонимы и смежные понятия
- Включай английские термины если они распространены (например "no-code", "AI", "ChatGPT")
- НЕ включай длинные фразы — только отдельные слова или короткие термины
- НЕ повторяй исходные фразы целиком
- Верни ТОЛЬКО список слов/терминов через запятую, без пояснений

Пример ответа: программирование, no-code, автоматизация, нейросети, ChatGPT, ИИ`;

          // Берём ключ напрямую из env и передаём явно — никаких побочных эффектов на singleton.
          const geminiKey = process.env.GEMINI_API_KEY;
          const aiResponse = await geminiProxyService.generateText({
            prompt: aiPrompt,
            model: 'gemini-2.5-flash',
            apiKey: geminiKey,
          });

          const expandedTerms = aiResponse
            .split(',')
            .map(t => t.trim().replace(/^[-•*]\s*/, ''))
            .filter(t => t.length >= 2 && t.length <= 40);

          // Объединяем оригинальные слова + AI-расширение, дедупликация
          const allTerms = new Set<string>();
          searchTerms.forEach(t => allTerms.add(t));
          expandedTerms.forEach(t => allTerms.add(t));
          finalSearchTerms = Array.from(allTerms).slice(0, 12);

          console.log(`[Suggest Sources] AI расширил запрос: ${expandedTerms.join(', ')}`);
        } catch (aiErr) {
          // Fallback: разбиваем фразы на отдельные значимые слова
          console.warn(`[Suggest Sources] AI расширение не удалось, разбиваем на слова`);
          const STOP_WORDS = new Set([
            'как', 'для', 'без', 'при', 'про', 'под', 'над', 'что', 'где', 'когда',
            'это', 'или', 'и', 'в', 'на', 'по', 'из', 'от', 'до', 'за', 'со', 'об',
            'the', 'and', 'for', 'with', 'how', 'use', 'using', 'via', 'what', 'where',
            'пользоваться', 'создание', 'продуктивность'
          ]);
          const wordSet = new Set<string>();
          for (const term of searchTerms) {
            // Сначала добавляем двухсловные сочетания (более точные)
            const words = term.split(/\s+/);
            for (let i = 0; i < words.length - 1; i++) {
              const pair = `${words[i]} ${words[i + 1]}`;
              if (pair.length >= 4) wordSet.add(pair);
            }
            // Потом одиночные слова >= 4 символов
            words
              .filter(w => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()))
              .forEach(w => wordSet.add(w));
          }
          finalSearchTerms = Array.from(wordSet).slice(0, 12);
          console.log(`[Suggest Sources] Fallback слова: ${finalSearchTerms.join(', ')}`);
        }

      // 4. Поиск по ключевым словам в title, username, description
      // Запускаем параллельно для каждого поискового термина
      console.log(`[Suggest Sources] Поиск по: ${finalSearchTerms.join(' | ')}`);
      const seen = new Set<string>();
      const channels: any[] = [];

      const searchPromises = finalSearchTerms.map((term) =>
        directusCrud.list('telegram_channels', {
          filter: {
            _and: [
              { is_active: { _eq: true } },
              {
                _or: [
                  { title: { _icontains: term } },
                  { username: { _icontains: term } },
                  { description: { _icontains: term } }
                ]
              }
            ]
          },
          sort: ['-subscribers'],
          limit: Math.ceil(limit * 1.5),
          fields: ['id', 'username', 'title', 'description', 'subscribers', 'category_id.name_ru', 'category_id.icon'],
          authToken: req.userToken
        }).catch((err: any) => {
          console.error(`[Suggest Sources] ❌ Ошибка поиска по "${term}":`, err?.response?.status, err?.message);
          return [] as any[];
        })
      );

      const results = await Promise.all(searchPromises);

      for (const batch of results) {
        for (const ch of (batch || []) as any[]) {
          if (!seen.has(ch.id) && channels.length < limit) {
            seen.add(ch.id);
            channels.push(ch);
          }
        }
      }

      // Сортируем по подписчикам
      channels.sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));

      console.log(`[Suggest Sources] Найдено каналов до AI-фильтрации: ${channels.length}`);

      // 5. AI-фильтрация релевантности — оставляем только то, что совпадает с тематикой кампании
      if (channels.length > 0) {
        try {
          const { filterByRelevance } = await import('../services/ai-relevance-filter');
          const filterResult = await filterByRelevance(channels, searchTerms, 'telegram', limit);
          console.log(`[Suggest Sources] AI-фильтрация: ${filterResult.relevant.length}/${channels.length} релевантных`);
          if (filterResult.relevant.length > 0) {
            channels.length = 0;
            channels.push(...filterResult.relevant);
          }
          // Если AI отсеял всё — оставляем как есть (лучше показать что нашли)
          if (filterResult.relevant.length === 0 && channels.length > 0) {
            console.log(`[Suggest Sources] AI отсеял все каналы, оставляем оригинальные результаты`);
          }
        } catch (filterErr: any) {
          console.error(`[Suggest Sources] ⚠️ AI-фильтрация не удалась: ${filterErr.message}`);
        }
      }

      console.log(`[Suggest Sources] Найдено каналов: ${channels.length}`);

      // 7. Если нужно добавить как источники
      let addedSources: any[] = [];
      let skippedDuplicates = 0;

      if (addToSources && channels.length > 0) {
        // Получаем существующие источники через токен пользователя
        const existingSources = await directusCrud.list('campaign_content_sources', {
          filter: {
            campaign_id: { _eq: campaignId },
            type: { _eq: 'telegram' }
          },
          limit: 1000,
          authToken: req.userToken
        }) || [];

        const existingTgIds = new Set(
          existingSources.map((s: any) => (s.TgId || s.username || '').toLowerCase())
        );

        for (const channel of channels) {
          const tgId = (channel.username || '').toLowerCase();
          if (existingTgIds.has(tgId)) {
            skippedDuplicates++;
            continue;
          }

          try {
            const newSource = await directusCrud.create('campaign_content_sources', {
              campaign_id: campaignId,
              type: 'telegram',
              TgId: channel.username,
              name: channel.title,
              url: `https://t.me/${channel.username}`,
              followersCount: channel.subscribers,
              description: channel.description?.substring(0, 500),
              is_active: true,
              status: 'active'
            }, { authToken: req.userToken });

            addedSources.push(newSource);
          } catch (addError: any) {
            console.error(`[Suggest Sources] Ошибка добавления канала ${channel.username}:`, addError.message);
          }
        }

        console.log(`[Suggest Sources] Добавлено источников: ${addedSources.length}, пропущено дубликатов: ${skippedDuplicates}`);
      }

      res.json({
        success: true,
        data: {
          searchTerms: finalSearchTerms,
          channels,
          totalFound: channels.length,
          added: addToSources ? addedSources.length : 0,
          skippedDuplicates,
          addedSources: addToSources ? addedSources : undefined
        }
      });

    } catch (error: any) {
      console.error('[Suggest Sources] Error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Ошибка подбора каналов',
        details: error.response?.data || error.message
      });
    }
  });

  // Добавление канала из каталога в источники кампании
  app.post('/api/campaigns/sources', authenticateRequest, async (req: Request & { userToken?: string; userId?: string }, res: Response) => {
    try {
      const { channelId, campaignId, type = 'telegram' } = req.body;

      if (!channelId || !campaignId) {
        return res.status(400).json({ success: false, error: 'channelId и campaignId обязательны' });
      }

      // Получаем данные канала
      const channel = await directusCrud.getById('telegram_channels', channelId, { useAdminToken: true });
      if (!channel) {
        return res.status(404).json({ success: false, error: 'Канал не найден' });
      }

      // Проверяем дубликат
      const existing = await directusCrud.list('campaign_content_sources', {
        filter: { campaign_id: { _eq: campaignId }, TgId: { _eq: channel.username } },
        limit: 1,
        useAdminToken: true
      });

      if (existing && existing.length > 0) {
        return res.status(409).json({ success: false, error: 'Канал уже добавлен в источники' });
      }

      const newSource = await directusCrud.create('campaign_content_sources', {
        campaign_id: campaignId,
        type,
        TgId: channel.username,
        name: channel.title,
        url: `https://t.me/${channel.username}`,
        followersCount: channel.subscribers,
        description: channel.description?.substring(0, 500),
        is_active: true,
        status: 'active'
      }, { useAdminToken: true });

      res.json({ success: true, data: newSource });
    } catch (error: any) {
      console.error('[Campaigns Sources] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  console.log('📱 [Telegram Channels] Routes registered');
}

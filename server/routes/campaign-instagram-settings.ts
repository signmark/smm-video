import express from 'express';
import { log } from '../utils/logger';
import axios from 'axios';

const router = express.Router();

/**
 * Получение Instagram настроек из JSON кампании
 */
router.get('/campaigns/:campaignId/instagram-settings', async (req, res) => {
  const { campaignId } = req.params;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {

    // Используем системный токен как fallback для доступа к базе данных
    const tokenToUse = userToken || process.env.DIRECTUS_TOKEN;
    
    if (!tokenToUse) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не доступен'
      });
    }


    // Получаем настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${tokenToUse}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const socialMediaSettings = campaign.social_media_settings || {};
    const instagramSettings = socialMediaSettings.instagram || null;

    res.json({
      success: true,
      settings: instagramSettings
    });

  } catch (error: any) {
    console.error('❌ Error retrieving Instagram settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при получении Instagram настроек',
      details: error.message
    });
  }
});

/**
 * Сохранение Instagram настроек в JSON кампании
 */
router.patch('/campaigns/:campaignId/instagram-settings', async (req, res) => {
  const { campaignId } = req.params;
  const { appId, appSecret, instagramId, accessToken, setupCompletedAt } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {

    if (!appId || !appSecret) {
      return res.status(400).json({
        success: false,
        error: 'App ID и App Secret обязательны'
      });
    }

    // Получим существующие настройки кампании
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const existingSettings = campaign.social_media_settings || {};

    // Обновляем Instagram настройки (сохраняем и объединяем с существующими)
    const existingInstagram = existingSettings.instagram || {};
    const updatedSettings = {
      ...existingSettings,
      instagram: {
        ...existingInstagram, // Сохраняем существующие данные (токены, аккаунты)
        appId,
        appSecret, // App Secret тоже сохраняется в БД
        instagramId: instagramId || existingInstagram.instagramId || '',
        accessToken: accessToken || existingInstagram.accessToken, // Сохраняем accessToken
        setupCompletedAt: setupCompletedAt || new Date().toISOString(),
        configured: true
      }
    };

    // Сохраняем обновленные настройки
    const updateResponse = await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        social_media_settings: updatedSettings
      },
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );


    res.json({
      success: true,
      data: updatedSettings.instagram
    });

  } catch (error: any) {
    console.error('❌ Error saving Instagram settings:', error?.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: error?.response?.data?.errors?.[0]?.message || 'Ошибка сохранения настроек Instagram'
    });
  }
});

/**
 * Поиск всех доступных Instagram аккаунтов по токену
 */
router.post('/campaigns/:campaignId/discover-instagram-accounts', async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken } = req.body;

  try {
    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'Access Token обязателен для поиска аккаунтов'
      });
    }

    console.log('🔍 [INSTAGRAM-DISCOVERY] Ищем все доступные Instagram аккаунты через токен...');

    // Сначала проверяем валидность токена
    try {
      const tokenCheckResponse = await axios.get(
        `https://graph.facebook.com/me?fields=id,name`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          timeout: 5000
        }
      );
      console.log('✅ [INSTAGRAM-DISCOVERY] Токен валидный, пользователь:', tokenCheckResponse.data);
    } catch (tokenError: any) {
      console.error('❌ [INSTAGRAM-DISCOVERY] Токен недействителен:', tokenError.response?.data || tokenError.message);
      return res.status(401).json({
        success: false,
        error: 'Токен Instagram/Facebook недействителен или истек',
        details: 'Необходимо переавторизоваться через Instagram Setup Wizard',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Сначала получаем все Facebook страницы пользователя с расширенными полями
    let pagesResponse;
    try {
      pagesResponse = await axios.get(
        `https://graph.facebook.com/me/accounts?fields=id,name,access_token,instagram_business_account,connected_instagram_account`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          timeout: 10000
        }
      );
      console.log('✅ [INSTAGRAM-DISCOVERY] Facebook страницы получены успешно');
    } catch (fbError: any) {
      console.error('❌ [INSTAGRAM-DISCOVERY] Ошибка при получении Facebook страниц:', fbError.response?.data || fbError.message);
      return res.status(400).json({
        success: false,
        error: 'Ошибка доступа к Facebook страницам',
        details: fbError.response?.data?.error?.message || fbError.message,
        code: 'FACEBOOK_API_ERROR'
      });
    }

    console.log('🔍 [INSTAGRAM-DISCOVERY] Facebook страницы получены:', pagesResponse.data);

    const instagramAccounts = [];

    // Проходим по каждой странице и ищем связанные Instagram аккаунты
    for (const page of pagesResponse.data.data) {
      console.log(`🔍 [INSTAGRAM-DISCOVERY] Проверяем страницу ${page.name} (${page.id})`);
      console.log(`🔍 [INSTAGRAM-DISCOVERY] instagram_business_account:`, page.instagram_business_account);
      console.log(`🔍 [INSTAGRAM-DISCOVERY] connected_instagram_account:`, page.connected_instagram_account);

      // Проверяем оба типа подключений Instagram
      const instagramId = page.instagram_business_account?.id || page.connected_instagram_account?.id;
      
      if (instagramId) {
        try {
          console.log(`🔍 [INSTAGRAM-DISCOVERY] Получаем детали Instagram аккаунта ${instagramId}`);
          
          // Получаем детали Instagram аккаунта
          const instagramResponse = await axios.get(
            `https://graph.facebook.com/${instagramId}?fields=id,name,username,followers_count,media_count,profile_picture_url`,
            {
              headers: {
                Authorization: `Bearer ${page.access_token}`
              }
            }
          );

          console.log('✅ [INSTAGRAM-DISCOVERY] Instagram аккаунт найден:', instagramResponse.data);

          instagramAccounts.push({
            id: instagramResponse.data.id,
            name: instagramResponse.data.name,
            username: instagramResponse.data.username,
            followers_count: instagramResponse.data.followers_count || 0,
            media_count: instagramResponse.data.media_count || 0,
            profile_picture_url: instagramResponse.data.profile_picture_url,
            facebook_page_id: page.id,
            facebook_page_name: page.name,
            connection_type: page.instagram_business_account?.id ? 'business' : 'connected'
          });

        } catch (error: any) {
          console.error(`❌ [INSTAGRAM-DISCOVERY] Ошибка получения деталей для Instagram ${instagramId}:`, error.message);
          console.error(`❌ [INSTAGRAM-DISCOVERY] Полная ошибка:`, error.response?.data);
        }
      } else {
        console.log(`ℹ️ [INSTAGRAM-DISCOVERY] Страница ${page.name} не имеет связанного Instagram аккаунта`);
      }
    }

    console.log(`🔍 [INSTAGRAM-DISCOVERY] Всего найдено Instagram аккаунтов: ${instagramAccounts.length}`);

    res.json({
      success: true,
      accounts: instagramAccounts,
      totalFound: instagramAccounts.length
    });

  } catch (error: any) {
    console.error('❌ [INSTAGRAM-DISCOVERY] Общая ошибка поиска Instagram аккаунтов:', error.message);
    console.error('❌ [INSTAGRAM-DISCOVERY] Полная ошибка:', error.response?.data || error);
    res.status(500).json({
      success: false,
      error: 'Ошибка при поиске Instagram аккаунтов',
      details: error.message,
      code: 'GENERAL_ERROR'
    });
  }
});

/**
 * Получение Instagram Business Account ID через Graph API
 */
router.post('/campaigns/:campaignId/fetch-instagram-business-id', async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    console.log('🔍 Fetching Instagram Business Account ID for campaign:', campaignId);
    console.log('🔍 Access Token provided:', accessToken ? 'YES' : 'NO');
    console.log('🔍 User Token provided:', userToken ? 'YES' : 'NO');
    
    if (!accessToken) {
      console.log('❌ Missing access token');
      return res.status(400).json({
        success: false,
        error: 'Access Token обязателен для получения Business Account ID'
      });
    }

    if (!userToken) {
      console.log('❌ Missing user token');
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не предоставлен'
      });
    }

    // Получаем страницы Facebook пользователя
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v23.0/me/accounts?access_token=${accessToken}&fields=id,name,instagram_business_account,connected_instagram_account`
    );


    const pages = pagesResponse.data.data || [];
    let instagramBusinessAccountId = null;
    let availablePages = [];

    // Ищем Instagram Business Account среди страниц и собираем информацию о доступных страницах
    for (const page of pages) {
      // Проверяем оба типа подключений: instagram_business_account И connected_instagram_account
      const hasBusinessAccount = !!(page.instagram_business_account && page.instagram_business_account.id);
      const hasConnectedAccount = !!(page.connected_instagram_account && page.connected_instagram_account.id);
      
      availablePages.push({
        id: page.id,
        name: page.name,
        hasInstagramBusiness: hasBusinessAccount,
        hasConnectedInstagram: hasConnectedAccount,
        instagramBusinessId: page.instagram_business_account?.id || null,
        connectedInstagramId: page.connected_instagram_account?.id || null
      });
      
      // Приоритет: сначала ищем instagram_business_account, потом connected_instagram_account
      if (page.instagram_business_account && page.instagram_business_account.id) {
        instagramBusinessAccountId = page.instagram_business_account.id;
        console.log('✅ Found Instagram Business Account ID:', instagramBusinessAccountId);
        console.log('✅ From Facebook page:', page.name, '(ID:', page.id, ') via instagram_business_account');
        break;
      } else if (page.connected_instagram_account && page.connected_instagram_account.id) {
        instagramBusinessAccountId = page.connected_instagram_account.id;
        console.log('✅ Found Instagram Account ID via connected_instagram_account:', instagramBusinessAccountId);
        console.log('✅ From Facebook page:', page.name, '(ID:', page.id, ') via connected_instagram_account');
        break;
      }
    }


    if (!instagramBusinessAccountId) {
      return res.status(404).json({
        success: false,
        error: 'Instagram Business Account не найден. Убедитесь, что ваша Facebook страница связана с Instagram Business аккаунтом.',
        details: {
          availablePages: availablePages,
          message: 'Ни одна из ваших Facebook страниц не связана с Instagram Business аккаунтом. Необходимо подключить Instagram Business аккаунт к одной из Facebook страниц.'
        }
      });
    }

    // Сохраняем Instagram Business Account ID в кампанию
    console.log('💾 Saving Instagram Business Account ID to campaign...');
    
    // Получаем текущие настройки кампании используя системный токен
    const getCampaignResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const campaign = getCampaignResponse.data.data;
    const currentSocialMediaSettings = campaign.social_media_settings || {};
    const currentInstagramSettings = currentSocialMediaSettings.instagram || {};

    // Обновляем Instagram настройки с новым Business Account ID
    const updatedInstagramSettings = {
      ...currentInstagramSettings,
      businessAccountId: instagramBusinessAccountId,
      businessAccountIdFetchedAt: new Date().toISOString()
    };

    const updatedSocialMediaSettings = {
      ...currentSocialMediaSettings,
      instagram: updatedInstagramSettings
    };

    console.log('💾 Saving with Business Account ID:', instagramBusinessAccountId);
    console.log('💾 Full Instagram settings to save:', JSON.stringify(updatedInstagramSettings, null, 2));

    // Сохраняем обновленные настройки используя системный токен
    const updateResponse = await axios.patch(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        social_media_settings: updatedSocialMediaSettings
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Instagram Business Account ID saved successfully');

    res.json({
      success: true,
      businessAccountId: instagramBusinessAccountId,
      message: 'Instagram Business Account ID успешно получен и сохранен'
    });

  } catch (error: any) {
    console.error('❌ Error fetching Instagram Business Account ID:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при получении Instagram Business Account ID',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Проверка конкретной Facebook страницы на наличие Instagram аккаунта
 */
router.post('/campaigns/:campaignId/check-facebook-page', async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken, pageId } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    console.log('🔍 Checking specific Facebook page:', pageId);
    
    if (!accessToken || !pageId) {
      return res.status(400).json({
        success: false,
        error: 'Access Token и Page ID обязательны'
      });
    }

    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не предоставлен'
      });
    }

    // Проверяем конкретную страницу
    try {
      const pageResponse = await axios.get(
        `https://graph.facebook.com/v23.0/${pageId}?access_token=${accessToken}&fields=id,name,instagram_business_account,connected_instagram_account`
      );


      const page = pageResponse.data;
      const hasBusinessAccount = !!(page.instagram_business_account && page.instagram_business_account.id);
      const hasConnectedAccount = !!(page.connected_instagram_account && page.connected_instagram_account.id);

      let instagramAccountId = null;
      let accountType = null;

      if (hasBusinessAccount) {
        instagramAccountId = page.instagram_business_account.id;
        accountType = 'business_account';
      } else if (hasConnectedAccount) {
        instagramAccountId = page.connected_instagram_account.id;
        accountType = 'connected_account';
      }

      const result = {
        pageId: page.id,
        pageName: page.name,
        hasInstagramBusiness: hasBusinessAccount,
        hasConnectedInstagram: hasConnectedAccount,
        instagramAccountId,
        accountType,
        instagramBusinessId: page.instagram_business_account?.id || null,
        connectedInstagramId: page.connected_instagram_account?.id || null
      };


      if (instagramAccountId) {
        // Сохраняем найденный Instagram Account ID в кампанию
        const getCampaignResponse = await axios.get(
          `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const campaign = getCampaignResponse.data.data;
        const currentSocialMediaSettings = campaign.social_media_settings || {};
        const currentInstagramSettings = currentSocialMediaSettings.instagram || {};

        const updatedInstagramSettings = {
          ...currentInstagramSettings,
          businessAccountId: instagramAccountId,
          businessAccountIdFetchedAt: new Date().toISOString(),
          pageId: page.id,
          pageName: page.name,
          accountType
        };

        const updatedSocialMediaSettings = {
          ...currentSocialMediaSettings,
          instagram: updatedInstagramSettings
        };

        await axios.patch(
          `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
          {
            social_media_settings: updatedSocialMediaSettings
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.DIRECTUS_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('✅ Instagram Account ID saved from specific page check');

        res.json({
          success: true,
          result,
          businessAccountId: instagramAccountId,
          message: `Instagram аккаунт найден на странице ${page.name} и сохранен`
        });
      } else {
        res.json({
          success: false,
          result,
          error: `На странице ${page.name} не найден подключенный Instagram аккаунт`
        });
      }

    } catch (pageError: any) {
      console.error('❌ Error checking specific page:', pageError.response?.data || pageError.message);
      
      if (pageError.response?.status === 403) {
        res.status(403).json({
          success: false,
          error: `Нет доступа к Facebook странице ${pageId}. Возможно у токена нет прав или страница не существует.`
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Ошибка при проверке Facebook страницы',
          details: pageError.response?.data || pageError.message
        });
      }
    }

  } catch (error: any) {
    console.error('❌ Error in page check:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при проверке страницы',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Поиск всех доступных Instagram аккаунтов пользователя
 */
router.post('/campaigns/:campaignId/discover-instagram-accounts', async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    console.log('🔍 Discovering Instagram accounts for campaign:', campaignId);
    
    if (!accessToken) {
      return res.status(400).json({
        success: false,
        error: 'Access Token обязателен'
      });
    }

    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не предоставлен'
      });
    }

    const discoveredAccounts: Array<{
      pageId: string;
      pageName: string;
      instagramId: string;
      accountType: string;
    }> = [];

    // Диагностика токена
    console.log('🔍 [DISCOVER] Checking token permissions...');
    try {
      const tokenDebugResponse = await axios.get(
        `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${accessToken}`
      );
      console.log('🔍 [DISCOVER] Token debug info:', {
        app_id: tokenDebugResponse.data?.data?.app_id,
        scopes: tokenDebugResponse.data?.data?.scopes,
        user_id: tokenDebugResponse.data?.data?.user_id,
        is_valid: tokenDebugResponse.data?.data?.is_valid
      });
    } catch (debugError) {
      console.log('⚠️ [DISCOVER] Token debug failed:', debugError.message);
    }

    // Шаг 1: Получаем все Facebook страницы пользователя
    console.log('🔍 [DISCOVER] Fetching Facebook pages...');
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v23.0/me/accounts?access_token=${accessToken}&fields=id,name,access_token`
    );
    
    console.log('🔍 [DISCOVER] Found pages:', pagesResponse.data.data?.length || 0);
    pagesResponse.data.data?.forEach((page: any, index: number) => {
      console.log(`🔍 [DISCOVER] Page ${index + 1}: ${page.name} (ID: ${page.id})`);
    });


    // Шаг 2: Для каждой страницы проверяем Instagram аккаунты
    for (const page of pagesResponse.data.data) {
      try {
        console.log(`🔍 [DISCOVER] Checking page: ${page.name} (ID: ${page.id})`);
        
        // Используем page access token если доступен
        const pageAccessToken = page.access_token || accessToken;
        
        const pageInstagramResponse = await axios.get(
          `https://graph.facebook.com/v23.0/${page.id}?access_token=${pageAccessToken}&fields=id,name,instagram_business_account,connected_instagram_account`
        );

        const pageData = pageInstagramResponse.data;
        const hasBusinessAccount = !!(pageData.instagram_business_account && pageData.instagram_business_account.id);
        const hasConnectedAccount = !!(pageData.connected_instagram_account && pageData.connected_instagram_account.id);

        console.log(`🔍 [DISCOVER] Page ${page.name} analysis:`, {
          hasBusinessAccount,
          hasConnectedAccount,
          businessAccountId: pageData.instagram_business_account?.id,
          connectedAccountId: pageData.connected_instagram_account?.id
        });

        if (hasBusinessAccount) {
          discoveredAccounts.push({
            pageId: pageData.id,
            pageName: pageData.name,
            instagramId: pageData.instagram_business_account.id,
            accountType: 'business_account'
          });
          console.log(`✅ [DISCOVER] Found Business Account: ${pageData.name} -> ${pageData.instagram_business_account.id}`);
        } else if (hasConnectedAccount) {
          discoveredAccounts.push({
            pageId: pageData.id,
            pageName: pageData.name,
            instagramId: pageData.connected_instagram_account.id,
            accountType: 'connected_account'
          });
          console.log(`✅ [DISCOVER] Found Connected Account: ${pageData.name} -> ${pageData.connected_instagram_account.id}`);
        } else {
          console.log(`❌ [DISCOVER] No Instagram account for page: ${pageData.name}`);
        }

      } catch (pageError: any) {
        console.error(`❌ [DISCOVER] Error checking page ${page.name}:`, pageError.response?.data || pageError.message);
        // Продолжаем проверку других страниц даже если одна не работает
      }
    }

    // Шаг 3: Дополнительная проверка завершена - используем только API данные

    console.log(`🎉 Discovery complete! Found ${discoveredAccounts.length} Instagram accounts`);
    
    // Получаем username'ы для каждого Instagram аккаунта
    const formattedAccounts = [];
    
    for (const account of discoveredAccounts) {
      try {
        // Получаем информацию об Instagram аккаунте через Graph API
        const instagramInfoResponse = await axios.get(
          `https://graph.facebook.com/v23.0/${account.instagramId}?access_token=${accessToken}&fields=id,username,name`
        );
        
        const instagramData = instagramInfoResponse.data;
        const displayName = instagramData.username ? `@${instagramData.username}` : account.pageName;
        
        formattedAccounts.push({
          id: account.instagramId,
          name: displayName,
          username: instagramData.username,
          pageId: account.pageId,
          accountType: account.accountType
        });
        
        console.log(`✅ Instagram account details: ${account.instagramId} -> ${displayName}`);
        
      } catch (instagramError: any) {
        console.error(`❌ Error fetching Instagram details for ${account.instagramId}:`, instagramError.response?.data || instagramError.message);
        
        // Используем fallback с именем страницы
        formattedAccounts.push({
          id: account.instagramId,
          name: account.pageName,
          username: null,
          pageId: account.pageId,
          accountType: account.accountType
        });
        
        console.log(`✅ Using fallback page name for ${account.instagramId}: ${account.pageName}`);
      }
    }

    res.json({
      success: true,
      accounts: formattedAccounts,
      totalFound: formattedAccounts.length
    });

  } catch (error: any) {
    console.error('❌ Error in Instagram discovery:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка при поиске Instagram аккаунтов',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Тестирование конкретного Instagram Business Account ID
 */
router.post('/campaigns/:campaignId/test-instagram-account', async (req, res) => {
  const { campaignId } = req.params;
  const { accessToken, instagramId } = req.body;
  const userToken = req.headers.authorization?.replace('Bearer ', '');

  try {
    console.log('🔍 [TEST-IG] Testing Instagram account:', instagramId);
    
    if (!accessToken || !instagramId) {
      return res.status(400).json({
        success: false,
        error: 'Access Token и Instagram ID обязательны'
      });
    }

    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'Токен авторизации не предоставлен'
      });
    }

    // Тестируем доступ к Instagram аккаунту
    try {
      const instagramResponse = await axios.get(
        `https://graph.facebook.com/v23.0/${instagramId}?access_token=${accessToken}&fields=id,username,name,account_type,media_count,followers_count`
      );

      const instagramData = instagramResponse.data;
      console.log('✅ [TEST-IG] Instagram account accessible:', instagramData);

      res.json({
        success: true,
        accountData: {
          id: instagramData.id,
          username: instagramData.username,
          name: instagramData.name,
          accountType: instagramData.account_type,
          mediaCount: instagramData.media_count,
          followersCount: instagramData.followers_count
        },
        message: `Instagram аккаунт @${instagramData.username} успешно протестирован`
      });

    } catch (instagramError: any) {
      console.error('❌ [TEST-IG] Error testing Instagram account:', instagramError.response?.data || instagramError.message);
      
      if (instagramError.response?.status === 403) {
        res.status(403).json({
          success: false,
          error: `Нет доступа к Instagram аккаунту ${instagramId}. Возможно токен не имеет прав или аккаунт не связан с этим приложением.`,
          details: instagramError.response?.data
        });
      } else if (instagramError.response?.status === 400) {
        res.status(400).json({
          success: false,
          error: `Неверный Instagram Business Account ID: ${instagramId}. Проверьте правильность ID.`,
          details: instagramError.response?.data
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Ошибка при тестировании Instagram аккаунта',
          details: instagramError.response?.data || instagramError.message
        });
      }
    }

  } catch (error: any) {
    console.error('❌ [TEST-IG] Error in Instagram test:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка тестирования Instagram аккаунта',
      details: error.response?.data || error.message
    });
  }
});

export default router;
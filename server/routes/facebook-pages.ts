import express from 'express';
import axios from 'axios';
import { sanitizeFacebookAccount } from '../services/oauth-response-sanitizer';
import { authenticateUser } from '../middleware/user-auth';

const router = express.Router();
router.use(authenticateUser);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// GET /api/facebook/pages - получение Facebook страниц пользователя
router.post('/pages', async (req, res) => {
  try {
    const { token, access_token } = req.body || {};
    const accessToken = token || access_token;

    console.log('🔵 [FACEBOOK-PAGES] Extracted tokens:', {
      hasToken: !!token,
      hasAccessTokenParam: !!access_token,
      hasAccessToken: !!accessToken
    });

    if (!accessToken) {
      console.log('❌ [FACEBOOK-PAGES] No access token provided');
      return res.status(400).json({
        error: 'Access token is required'
      });
    }

    console.log('🔵 [FACEBOOK-PAGES] Fetching Facebook pages, token provided:', !!accessToken);

    // Сначала проверяем тип токена и получаем информацию
    let tokenInfo;
    try {
      // Сначала пробуем получить базовую информацию без category
      tokenInfo = await axios.get(`https://graph.facebook.com/v18.0/me`, {
        params: {
          access_token: accessToken,
          fields: 'id,name'
        },
        timeout: 10000
      });
      
      // Затем пробуем получить category - если получится, то это Page
      try {
        const categoryResponse = await axios.get(`https://graph.facebook.com/v18.0/me`, {
          params: {
            access_token: accessToken,
            fields: 'category'
          },
          timeout: 5000
        });
        tokenInfo.data.category = categoryResponse.data.category;
      } catch (categoryError) {
        // Если category недоступна - это User токен
        console.log('🔵 [FACEBOOK-PAGES] No category field - User token detected');
        tokenInfo.data.category = null;
      }
    } catch (tokenError: any) {
      console.log('❌ [FACEBOOK-PAGES] Token validation failed:', tokenError.response?.data || tokenError.message);
      return res.status(401).json({
        error: 'Токен Facebook недействителен или истек',
        details: 'Необходимо переавторизоваться через Instagram Setup Wizard или Facebook Setup Wizard',
        code: 'TOKEN_EXPIRED',
        fbError: tokenError.response?.data
      });
    }

    const entityId = tokenInfo.data.id;
    const entityName = tokenInfo.data.name;
    const entityCategory = tokenInfo.data.category;
    
    console.log('🔵 [FACEBOOK-PAGES] Token entity info:', {
      id: entityId,
      name: entityName,
      category: entityCategory,
      hasCategory: !!entityCategory
    });

    let allAccounts = [];
    // Если токен имеет category - это Page токен, иначе User токен
    if (entityCategory) {
      // Page токен - возвращаем текущую страницу как единственную доступную
      console.log('🔵 [FACEBOOK-PAGES] Page token detected, returning current page');
      allAccounts = [{
        id: entityId,
        name: entityName,
        category: entityCategory,
        tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE'], // Предполагаем базовые права
        link: `https://www.facebook.com/${entityId}`,
        fan_count: 0,
        access_token: accessToken
      }];
    } else {
      // User токен - получаем страницы через /me/accounts
      console.log('🔵 [FACEBOOK-PAGES] User token detected, fetching accounts');
      try {
        const response = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
          params: {
            access_token: accessToken,
            fields: 'id,name,access_token,category,tasks,link,fan_count,about'
          },
          timeout: 10000
        });
        allAccounts = response.data.data || [];
      } catch (accountsError: any) {
        console.log('❌ [FACEBOOK-PAGES] Error fetching user accounts:', accountsError.response?.data || accountsError.message);
        return res.status(400).json({
          error: 'Ошибка получения страниц Facebook',
          details: accountsError.response?.data?.error?.message || accountsError.message,
          fbError: accountsError.response?.data
        });
      }
    }
    
    console.log('🔵 [FACEBOOK-PAGES] All accounts from Facebook API:', allAccounts.map((account: any) => ({
      id: account.id,
      name: account.name,
      category: account.category,
      tasks: account.tasks,
      link: account.link,
      fan_count: account.fan_count,
      hasAccessToken: !!account.access_token
    })));
    
    // Фильтруем только Facebook СТРАНИЦЫ, исключаем группы и личные профили
    const pages = allAccounts.filter((account: any) => {
      console.log(`🔍 [FACEBOOK-PAGES] Checking account ${account.name} (${account.id}):`, {
        category: account.category,
        hasTasks: !!account.tasks,
        tasks: account.tasks || 'none',
        link: account.link,
        fan_count: account.fan_count
      });
      
      // Проверяем что это страница, а не группа
      if (!account.tasks || !Array.isArray(account.tasks)) {
        console.log(`❌ [FACEBOOK-PAGES] Skipping ${account.name} - no tasks (likely group or profile)`);
        return false;
      }
      
      // Исключаем личные профили по URL
      // Личные профили имеют URL формата profile.php?id= или facebook.com/profile.php
      if (account.link && (
        account.link.includes('profile.php?id=') || 
        account.link.includes('/profile.php') ||
        account.link.match(/facebook\.com\/[a-z]+\.[a-z]+\.[\d]+$/)
      )) {
        console.log(`❌ [FACEBOOK-PAGES] Skipping ${account.name} - personal profile detected by URL pattern`);
        return false;
      }
      
      // Исключаем аккаунты с категорией "Person" или без категории (часто личные профили)
      if (!account.category || account.category === 'Person') {
        console.log(`❌ [FACEBOOK-PAGES] Skipping ${account.name} - no category or Person category`);
        return false;
      }
      
      // Проверяем наличие нужных разрешений для публикации
      const hasManageTasks = account.tasks.includes('MANAGE');
      const hasCreateContent = account.tasks.includes('CREATE_CONTENT');
      
      if (!hasManageTasks || !hasCreateContent) {
        console.log(`❌ [FACEBOOK-PAGES] Skipping ${account.name} - insufficient permissions`);
        return false;
      }
      
      // Дополнительная проверка: у настоящих страниц обычно есть fan_count
      // Личные профили могут не иметь этого поля
      console.log(`✅ [FACEBOOK-PAGES] Valid page found: ${account.name}`);
      return true;
    });

    console.log('🔵 [FACEBOOK-PAGES] Facebook pages fetched successfully:', {
      count: pages.length,
      pages: pages.map((page: any) => ({
        id: page.id,
        name: page.name,
        category: page.category
      }))
    });

    res.json({
      success: true,
      pages: pages.map(sanitizeFacebookAccount)
    });

  } catch (error: any) {
    console.log('❌ [FACEBOOK-PAGES] Error fetching Facebook pages:', {
      error: error.response?.data || { message: error.message }
    });
    
    res.status(500).json({
      error: error.response?.data?.error?.message || error.message || 'Неизвестная ошибка при получении страниц Facebook',
      details: 'Проверьте правильность токена доступа',
      fbError: error.response?.data
    });
  }
});

export default router;

import { Router } from 'express';
import axios from 'axios';
import { sanitizeFacebookAccount } from '../services/oauth-response-sanitizer';
import { authenticateUser } from '../middleware/user-auth';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ВНИМАНИЕ. Здесь СОЗНАТЕЛЬНО нет router.use(authenticateUser).
//
// Этот роутер смонтирован как app.use('/api', ...), поэтому верхнеуровневый
// router.use(authenticateUser) применялся ко ВСЕМУ /api, а не только к своим
// маршрутам — и де-факто служил единственной авторизацией всего API. Держалось
// это на порядке импортов в server/index.ts (находка ревью 2026-07-28).
//
// Побочный эффект был не только архитектурный: проверка отбивала и то, что
// обязано отвечать без сессии, — медиа-прокси, который тянут серверы соцсетей,
// и подписанные ссылки одобрения подписки из письма.
//
// Теперь авторизация стоит явно в server/middleware/api-auth-gate.ts, а здесь
// проверка вешается на конкретный маршрут.

// API для получения Facebook групп и страниц пользователя
router.post('/facebook/groups-and-pages', authenticateUser, async (req, res) => {
  try {
    const token = req.body?.token as string;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Токен обязателен'
      });
    }

    console.log('🔍 [FB-GROUPS] Получаем группы и страницы, токен предоставлен:', !!token);

    // Получаем страницы пользователя
    const pagesResponse = await axios.get(`https://graph.facebook.com/me/accounts`, {
      params: {
        access_token: token,
        fields: 'id,name,access_token,category,tasks'
      }
    });

    console.log('📄 [FB-GROUPS] Страницы найдены:', (pagesResponse.data?.data || []).map((page: any) => ({
      id: page.id,
      name: page.name,
      category: page.category,
      hasAccessToken: !!page.access_token
    })));

    // Получаем группы пользователя
    let groups = [];
    try {
      const groupsResponse = await axios.get(`https://graph.facebook.com/me/groups`, {
        params: {
          access_token: token,
          fields: 'id,name,description,privacy,member_count'
        }
      });
      groups = groupsResponse.data.data || [];
      console.log('👥 [FB-GROUPS] Группы найдены:', groups);
    } catch (groupError: any) {
      console.log('⚠️ [FB-GROUPS] Не удалось получить группы:', groupError.response?.data || groupError.message);
      // Не прерываем выполнение, просто оставляем группы пустыми
    }

    // Получаем информацию о разрешениях
    const permissionsResponse = await axios.get(`https://graph.facebook.com/me/permissions`, {
      params: {
        access_token: token
      }
    });

    const permissions = permissionsResponse.data.data.map((p: any) => p.permission);
    const hasPublishToGroups = permissions.includes('publish_to_groups');
    const hasManagePosts = permissions.includes('pages_manage_posts');

    console.log('🔑 [FB-GROUPS] Разрешения:', {
      hasPublishToGroups,
      hasManagePosts,
      allPermissions: permissions
    });

    res.json({
      success: true,
      data: {
        pages: (pagesResponse.data.data || []).map(sanitizeFacebookAccount),
        groups: groups,
        permissions: {
          hasPublishToGroups,
          hasManagePosts,
          all: permissions
        }
      }
    });

  } catch (error: any) {
    console.error('❌ [FB-GROUPS] Ошибка получения групп и страниц:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения данных Facebook',
      details: error.response?.data || error.message
    });
  }
});

export default router;

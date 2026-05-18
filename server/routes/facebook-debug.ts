import express from 'express';
import axios from 'axios';

const router = express.Router();

// GET /api/facebook/debug-token - отладка токена и проверка разрешений
router.get('/debug-token', async (req, res) => {
  try {
    const { token } = req.query;
    const accessToken = token;

    if (!accessToken) {
      return res.status(400).json({
        error: 'Access token is required'
      });
    }

    console.log('🔍 [FACEBOOK-DEBUG] Debugging token:', (accessToken as string).substring(0, 20) + '...');

    // Проверяем информацию о токене
    const tokenInfoResponse = await axios.get(`https://graph.facebook.com/v18.0/me`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,permissions'
      },
      timeout: 10000
    });

    console.log('🔍 [FACEBOOK-DEBUG] Token info:', tokenInfoResponse.data);

    // Проверяем разрешения токена
    const permissionsResponse = await axios.get(`https://graph.facebook.com/v18.0/me/permissions`, {
      params: {
        access_token: accessToken
      },
      timeout: 10000
    });

    console.log('🔍 [FACEBOOK-DEBUG] Token permissions:', permissionsResponse.data);

    // Пробуем несколько разных endpoints для страниц
    const endpoints = [
      '/me/accounts',
      '/me/pages',
      `/${tokenInfoResponse.data.id}/accounts`,
      `/${tokenInfoResponse.data.id}/pages`
    ];

    const results: any = {};

    for (const endpoint of endpoints) {
      try {
        console.log(`🔍 [FACEBOOK-DEBUG] Testing endpoint: ${endpoint}`);
        
        const response = await axios.get(`https://graph.facebook.com/v18.0${endpoint}`, {
          params: {
            access_token: accessToken,
            fields: 'id,name,access_token,category,tasks'
          },
          timeout: 10000
        });

        results[endpoint] = {
          success: true,
          count: response.data.data?.length || 0,
          data: response.data.data || []
        };

        console.log(`✅ [FACEBOOK-DEBUG] ${endpoint} success:`, results[endpoint]);
      } catch (error: any) {
        results[endpoint] = {
          success: false,
          error: error.response?.data?.error?.message || error.message
        };
        console.log(`❌ [FACEBOOK-DEBUG] ${endpoint} failed:`, results[endpoint]);
      }
    }

    res.json({
      tokenInfo: tokenInfoResponse.data,
      permissions: permissionsResponse.data.data,
      endpointResults: results
    });

  } catch (error: any) {
    console.error('❌ [FACEBOOK-DEBUG] Debug failed:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to debug Facebook token',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

export default router;
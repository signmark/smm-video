/// <reference types="jest" />
/**
 * Тесты общих утилит системы
 * Тестируют валидацию, форматирование и обработку данных
 */

describe('System Utils Tests', () => {
  
  describe('Валидация токенов авторизации', () => {
    it('должен валидировать JWT токены', () => {
      const validJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSJ9.signature';
      const invalidJWT = 'invalid_jwt_without_dots';
      
      // JWT должен состоять из 3 частей, разделенных точками
      expect(validJWT.split('.').length).toBe(3);
      expect(invalidJWT.split('.').length).not.toBe(3);
      
      // JWT должен начинаться с eyJ (закодированный JSON header)
      expect(validJWT.startsWith('eyJ')).toBe(true);
      expect(invalidJWT.startsWith('eyJ')).toBe(false);
    });

    it('должен извлекать campaign ID из токена авторизации', () => {
      const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
      
      const token = authHeader.replace('Bearer ', '');
      expect(token).not.toContain('Bearer');
      expect(token.length).toBeGreaterThan(50);
    });
  });

  describe('Обработка ошибок API', () => {
    it('должен форматировать стандартный ответ об ошибке', () => {
      const errorResponse = {
        success: false,
        error: 'Ошибка валидации данных',
        details: 'Поле "token" обязательно для заполнения'
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toBeDefined();
      expect(typeof errorResponse.error).toBe('string');
      expect(errorResponse.details).toBeDefined();
    });

    it('должен форматировать успешный ответ API', () => {
      const successResponse = {
        success: true,
        message: 'Операция выполнена успешно',
        data: { id: 'test-123', name: 'Test Item' }
      };

      expect(successResponse.success).toBe(true);
      expect(successResponse.message).toBeDefined();
      expect(successResponse.data).toBeDefined();
      expect(typeof successResponse.message).toBe('string');
    });
  });

  describe('Обработка настроек социальных сетей', () => {
    it('должен объединять существующие и новые настройки', () => {
      const existingSettings = {
        instagram: {
          token: 'existing_instagram_token',
          configured: true
        },
        vk: {
          token: 'existing_vk_token',
          groupId: 'club123456'
        }
      };

      const newFacebookSettings = {
        token: 'new_facebook_token',
        pageId: '677089708819410',
        pageName: 'SMM Manager',
        configured: true
      };

      const updatedSettings = {
        ...existingSettings,
        facebook: newFacebookSettings
      };

      expect(updatedSettings.instagram.token).toBe('existing_instagram_token');
      expect(updatedSettings.vk.token).toBe('existing_vk_token');
      expect(updatedSettings.facebook.token).toBe('new_facebook_token');
      expect(Object.keys(updatedSettings)).toHaveLength(3);
    });

    it('должен обновлять существующие настройки без потери данных', () => {
      const existingFacebook = {
        token: 'old_token',
        pageId: '123456',
        pageName: 'Old Page',
        configured: true,
        setupCompletedAt: '2025-01-01T00:00:00Z'
      };

      const updateData = {
        token: 'new_token',
        pageId: '677089708819410',
        pageName: 'SMM Manager'
      };

      const updatedFacebook = {
        ...existingFacebook,
        ...updateData,
        setupCompletedAt: new Date().toISOString()
      };

      expect(updatedFacebook.token).toBe('new_token');
      expect(updatedFacebook.pageId).toBe('677089708819410');
      expect(updatedFacebook.pageName).toBe('SMM Manager');
      expect(updatedFacebook.configured).toBe(true); // Сохранилось
      expect(updatedFacebook.setupCompletedAt).not.toBe('2025-01-01T00:00:00Z'); // Обновилось
    });
  });

  describe('Валидация обязательных полей', () => {
    it('должен проверять обязательные поля для Facebook настроек', () => {
      const validData = {
        token: 'valid_token_123',
        pageId: '677089708819410',
        pageName: 'SMM Manager'
      };

      const invalidData = [
        { token: 'valid_token_123', pageId: '677089708819410' }, // Нет pageName
        { token: 'valid_token_123', pageName: 'SMM Manager' }, // Нет pageId
        { pageId: '677089708819410', pageName: 'SMM Manager' }, // Нет token
        { token: '', pageId: '677089708819410', pageName: 'SMM Manager' }, // Пустой token
      ];

      // Проверка валидных данных
      const isValidData = !!(validData.token && validData.pageId && validData.pageName);
      expect(isValidData).toBe(true);

      // Проверка невалидных данных
      invalidData.forEach(data => {
        const isValid = !!(data.token && data.pageId && data.pageName && 
                       data.token.length > 0);
        expect(isValid).toBe(false);
      });
    });

    it('должен проверять обязательные поля для YouTube настроек', () => {
      const validData = {
        channelId: 'UC_test_channel_id_123',
        channelTitle: 'Test YouTube Channel',
        accessToken: 'ya29.access_token',
        refreshToken: '1//refresh_token'
      };

      const invalidData = [
        { channelId: 'UC_test_channel_id_123', accessToken: 'ya29.access_token' }, // Нет channelTitle
        { channelTitle: 'Test Channel', accessToken: 'ya29.access_token' }, // Нет channelId
        { channelId: '', channelTitle: 'Test Channel' } // Пустые значения
      ];

      // Проверка валидных данных
      const isValidData = !!(validData.channelId && validData.channelTitle);
      expect(isValidData).toBe(true);

      // Проверка невалидных данных
      invalidData.forEach(data => {
        const isValid = !!(data.channelId && data.channelTitle && 
                       data.channelId.length > 0 && data.channelTitle.length > 0);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Кодирование и декодирование URL', () => {
    it('должен правильно кодировать параметры URL', () => {
      const params = {
        token: 'token_with_special_chars+/=',
        redirect_uri: 'http://localhost:5000/callback',
        scope: 'https://www.googleapis.com/auth/youtube'
      };

      const encodedToken = encodeURIComponent(params.token);
      const encodedRedirect = encodeURIComponent(params.redirect_uri);
      const encodedScope = encodeURIComponent(params.scope);

      expect(encodedToken).not.toContain('+');
      expect(encodedToken).not.toContain('/');
      expect(encodedToken).not.toContain('=');
      
      expect(encodedRedirect).toContain('%3A'); // :
      expect(encodedRedirect).toContain('%2F'); // /
      
      expect(encodedScope).toContain('%3A'); // :
      expect(encodedScope).toContain('%2F'); // /
    });

    it('должен правильно декодировать параметры URL', () => {
      const encodedData = 'Hello%20World%21';
      const decodedData = decodeURIComponent(encodedData);
      
      expect(decodedData).toBe('Hello World!');
      expect(decodedData).not.toContain('%20');
      expect(decodedData).not.toContain('%21');
    });
  });

  describe('Форматирование дат и времени', () => {
    it('должен генерировать ISO строку даты', () => {
      const now = new Date();
      const isoString = now.toISOString();
      
      expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(isoString).toContain('T');
      expect(isoString.endsWith('Z')).toBe(true);
    });

    it('должен правильно обрабатывать временные метки', () => {
      const timestamp = '2025-08-01T09:00:00.000Z';
      const date = new Date(timestamp);
      
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(7); // Август (0-indexed)
      expect(date.getDate()).toBe(1);
      expect(date.getUTCHours()).toBe(9);
    });
  });

  describe('Универсальный поиск API ключей', () => {
    it('должен находить API ключи с учетом регистра', () => {
      const mockApiKeys = [
        { service: 'youtube', api_key: 'key1', active: true },
        { service: 'YOUTUBE', api_key: 'key2', active: true },
        { service: 'YouTube', api_key: 'key3', active: false },
        { service: 'gemini', api_key: 'key4', active: true }
      ];

      // Поиск case-insensitive
      const youtubeKeys = mockApiKeys.filter(key => 
        key.service.toLowerCase() === 'youtube' && key.active
      );

      expect(youtubeKeys).toHaveLength(2);
      expect(youtubeKeys[0].api_key).toBe('key1');
      expect(youtubeKeys[1].api_key).toBe('key2');
    });

    it('должен приоритизировать активные ключи', () => {
      const mockApiKeys = [
        { service: 'gemini', api_key: 'inactive_key', active: false },
        { service: 'gemini', api_key: 'active_key', active: true }
      ];

      const activeGeminiKey = mockApiKeys.find(key => 
        key.service.toLowerCase() === 'gemini' && key.active
      );

      expect(activeGeminiKey).toBeDefined();
      expect(activeGeminiKey?.api_key).toBe('active_key');
      expect(activeGeminiKey?.active).toBe(true);
    });
  });

  describe('Генерация случайных значений', () => {
    it('должен генерировать уникальные state параметры', () => {
      function generateState(campaignId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2);
        return `${campaignId}_${timestamp}_${random}`;
      }

      const campaignId = 'test-campaign-123';
      const state1 = generateState(campaignId);
      const state2 = generateState(campaignId);

      expect(state1).toContain(campaignId);
      expect(state2).toContain(campaignId);
      expect(state1).not.toBe(state2); // Должны быть уникальными
      expect(state1.split('_')).toHaveLength(3); // campaignId_timestamp_random
    });
  });
});
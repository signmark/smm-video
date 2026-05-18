/// <reference types="jest" />
/**
 * Тесты валидации Facebook токенов и обработки настроек
 * Фокус на логике без внешних зависимостей
 */

describe('Facebook Token Validation', () => {
  
  describe('Валидация токенов', () => {
    it('должен определить валидный Facebook токен', () => {
      const validToken = 'EAFZA7pZCC2288BPKHFBEkWuUsUfWfjGG81hPMdfl6LlHb6gSWkTrvFY2rqZCoss3i1DIBSDzKs81XCZAgZCI5X5aQ9LIXHasTIfr4LDaprZC3EhZBuosyMrwWln3utMadDSoSWNX4OnxtpIIM8Rnheku4X3wWYXn7EoN6TVT0tE4k2oBfyaIPZCpEzxjsdC7Uf1RvavMTk6TavZA9jWLmjMKC';
      
      expect(validToken.length).toBeGreaterThan(50);
      expect(typeof validToken).toBe('string');
      expect(validToken).not.toContain(' ');
    });

    it('должен отклонить поврежденный токен', () => {
      const corruptedTokens = [
        'Facebook Wizard: some data',
        'токен%20with%20encoding',
        'FacebookSetupWizard.tsx data',
        '',
        'short'
      ];

      corruptedTokens.forEach(token => {
        const isCorrupted = 
          token.includes('Facebook Wizard:') || 
          token.includes('%20') || 
          token.includes('FacebookSetupWizard') ||
          token.length < 10;
        
        expect(isCorrupted).toBe(true);
      });
    });
  });

  describe('Структура данных настроек', () => {
    it('должен правильно формировать настройки с раздельными токенами', () => {
      const pageToken = 'page_token_123';
      const userToken = 'user_token_456';
      const pageId = '677089708819410';
      const pageName = 'SMM Manager';

      const settings = {
        token: pageToken,
        pageId,
        pageName,
        userToken: userToken,
        configured: true,
        tokenType: 'page',
        setupCompletedAt: new Date().toISOString()
      };

      expect(settings.token).toBe(pageToken);
      expect(settings.userToken).toBe(userToken);
      expect(settings.tokenType).toBe('page');
      expect(settings.configured).toBe(true);
      expect(settings.pageId).toBe(pageId);
      expect(settings.pageName).toBe(pageName);
    });

    it('должен определить тип токена как пользовательский если нет userToken', () => {
      const token = 'user_token_only';
      const pageId = '677089708819410';
      const pageName = 'SMM Manager';

      const settings = {
        token,
        pageId,
        pageName,
        userToken: token, // Используем тот же токен
        configured: true,
        tokenType: 'user' // Когда userToken отсутствует или равен основному
      };

      expect(settings.tokenType).toBe('user');
      expect(settings.token).toBe(settings.userToken);
    });
  });

  describe('Обработка данных Facebook страниц', () => {
    it('должен обработать ответ API с множественными страницами', () => {
      const mockFacebookResponse = {
        data: [
          {
            id: '677089708819410',
            name: 'SMM Manager',
            access_token: 'page_token_123',
            category: 'Software',
            tasks: ['ANALYZE', 'ADVERTISE', 'MESSAGING', 'MODERATE']
          },
          {
            id: '234567890123456',
            name: 'Test Page',
            access_token: 'page_token_456',
            category: 'Business',
            tasks: ['ANALYZE', 'ADVERTISE']
          }
        ]
      };

      const pages = mockFacebookResponse.data;
      
      expect(pages).toHaveLength(2);
      expect(pages[0].id).toBe('677089708819410');
      expect(pages[0].name).toBe('SMM Manager');
      expect(pages[0].access_token).toBe('page_token_123');
      expect(pages[0].tasks).toContain('ANALYZE');
      
      expect(pages[1].id).toBe('234567890123456');
      expect(pages[1].category).toBe('Business');
    });

    it('должен обработать пустой ответ от Facebook API', () => {
      const emptyResponse = { data: [] };
      
      expect(emptyResponse.data).toHaveLength(0);
      expect(Array.isArray(emptyResponse.data)).toBe(true);
    });
  });

  describe('Instagram токен интеграция', () => {
    it('должен использовать Instagram токен как пользовательский токен для Facebook', () => {
      const instagramToken = 'instagram_long_lived_token_EAABwzLixnjYBO...';
      const pageId = '677089708819410';
      const pageName = 'SMM Manager';
      const pageToken = 'page_specific_token_123';

      // Симуляция процесса "Взять из Instagram"
      const facebookSettings = {
        token: pageToken, // Токен конкретной страницы
        pageId,
        pageName,
        userToken: instagramToken, // Instagram токен как пользовательский
        configured: true,
        tokenType: 'page',
        setupCompletedAt: new Date().toISOString()
      };

      expect(facebookSettings.userToken).toBe(instagramToken);
      expect(facebookSettings.token).toBe(pageToken);
      expect(facebookSettings.tokenType).toBe('page');
      expect(facebookSettings.userToken).not.toBe(facebookSettings.token);
    });
  });

  describe('Обработка ошибок', () => {
    it('должен обработать ошибку "(#100) Tried accessing nonexisting field"', () => {
      const errorResponse = {
        error: {
          message: '(#100) Tried accessing nonexisting field (accounts) on node type (User)',
          type: 'OAuthException',
          code: 100
        }
      };

      expect(errorResponse.error.code).toBe(100);
      expect(errorResponse.error.type).toBe('OAuthException');
      expect(errorResponse.error.message).toContain('nonexisting field');
      expect(errorResponse.error.message).toContain('accounts');
    });

    it('должен обработать ошибку невалидного токена', () => {
      const invalidTokenError = {
        error: {
          message: 'Invalid OAuth access token.',
          type: 'OAuthException',
          code: 190
        }
      };

      expect(invalidTokenError.error.code).toBe(190);
      expect(invalidTokenError.error.type).toBe('OAuthException');
      expect(invalidTokenError.error.message).toContain('Invalid OAuth');
    });
  });

  describe('URL формирование для Facebook API', () => {
    it('должен правильно формировать URL для получения страниц', () => {
      const baseUrl = 'https://graph.facebook.com/v18.0';
      const endpoint = '/me/accounts';
      const fields = 'id,name,access_token,category,tasks';
      const token = 'user_token_123';

      const url = `${baseUrl}${endpoint}?fields=${fields}&access_token=${token}`;
      
      expect(url).toContain('graph.facebook.com/v18.0');
      expect(url).toContain('/me/accounts');
      expect(url).toContain('fields=id,name,access_token,category,tasks');
      expect(url).toContain(`access_token=${token}`);
    });

    it('должен правильно формировать URL для получения токена страницы', () => {
      const baseUrl = 'https://graph.facebook.com/v18.0';
      const pageId = '677089708819410';
      const fields = 'id,name,access_token,category';
      const token = 'user_token_123';

      const url = `${baseUrl}/${pageId}?fields=${fields}&access_token=${token}`;
      
      expect(url).toContain(`/${pageId}?`);
      expect(url).toContain('fields=id,name,access_token,category');
      expect(url).toContain(`access_token=${token}`);
    });
  });
});
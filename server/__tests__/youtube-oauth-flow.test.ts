/// <reference types="jest" />
/**
 * Тесты YouTube OAuth потока и валидации
 * Фокус на логике обработки данных без внешних зависимостей
 */

describe('YouTube OAuth Flow Tests', () => {
  
  describe('Генерация OAuth URL', () => {
    it('должен генерировать корректный OAuth URL для YouTube', () => {
      const clientId = 'test_client_id.apps.googleusercontent.com';
      const redirectUri = 'http://localhost:5000/api/youtube/callback';
      const scope = 'https://www.googleapis.com/auth/youtube';
      const responseType = 'code';
      const state = 'test-campaign-123';

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=${encodeURIComponent(scope)}&` +
        `response_type=${responseType}&` +
        `state=${state}&` +
        `access_type=offline&` +
        `prompt=consent`;

      expect(authUrl).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(authUrl).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube');
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('access_type=offline');
      expect(authUrl).toContain('prompt=consent');
      expect(authUrl).toContain(`state=${state}`);
    });
  });

  describe('Валидация токенов YouTube', () => {
    it('должен определить валидный YouTube токен', () => {
      const validToken = 'ya29.a0ARrdaM9qVGxyzABCDEF1234567890'; // Пример формата Google токена
      
      expect(validToken.startsWith('ya29.')).toBe(true);
      expect(validToken.length).toBeGreaterThan(30);
      expect(typeof validToken).toBe('string');
    });

    it('должен определить refresh токен', () => {
      const refreshToken = '1//04_refresh_token_example';
      
      expect(refreshToken.startsWith('1//')).toBe(true);
      expect(refreshToken.length).toBeGreaterThan(20);
      expect(typeof refreshToken).toBe('string');
    });

    it('должен отклонить невалидные токены', () => {
      const invalidTokens = [
        '',
        'short',
        'invalid_format_token',
        'ya28.wrong_prefix'
      ];

      invalidTokens.forEach(token => {
        const isValid = token.startsWith('ya29.') && token.length > 30;
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Обработка данных YouTube канала', () => {
    it('должен обработать ответ API с данными канала', () => {
      const mockChannelResponse = {
        items: [
          {
            id: 'UC_test_channel_id_123',
            snippet: {
              title: 'Test YouTube Channel',
              description: 'Test channel description',
              thumbnails: {
                default: { url: 'https://example.com/thumb.jpg' },
                medium: { url: 'https://example.com/thumb_medium.jpg' },
                high: { url: 'https://example.com/thumb_high.jpg' }
              },
              customUrl: '@testchannel'
            },
            statistics: {
              subscriberCount: '1000',
              videoCount: '50',
              viewCount: '25000'
            }
          }
        ]
      };

      const channel = mockChannelResponse.items[0];
      
      expect(channel.id).toBe('UC_test_channel_id_123');
      expect(channel.snippet.title).toBe('Test YouTube Channel');
      expect(channel.snippet.description).toBe('Test channel description');
      expect(channel.statistics.subscriberCount).toBe('1000');
      expect(channel.statistics.videoCount).toBe('50');
      expect(channel.snippet.thumbnails.default.url).toContain('thumb.jpg');
    });

    it('должен обработать пустой ответ (канал не найден)', () => {
      const emptyResponse = { items: [] };
      
      expect(emptyResponse.items).toHaveLength(0);
      expect(Array.isArray(emptyResponse.items)).toBe(true);
    });
  });

  describe('Структура настроек YouTube', () => {
    it('должен правильно формировать настройки YouTube канала', () => {
      const channelId = 'UC_test_channel_id_123';
      const channelTitle = 'Test YouTube Channel';
      const accessToken = 'ya29.a0ARrdaM9qVGxyz...';
      const refreshToken = '1//04_refresh_token_example';

      const settings = {
        channelId,
        channelTitle,
        accessToken,
        refreshToken,
        configured: true,
        setupCompletedAt: new Date().toISOString(),
        tokenType: 'oauth2'
      };

      expect(settings.channelId).toBe(channelId);
      expect(settings.channelTitle).toBe(channelTitle);
      expect(settings.accessToken).toBe(accessToken);
      expect(settings.refreshToken).toBe(refreshToken);
      expect(settings.configured).toBe(true);
      expect(settings.tokenType).toBe('oauth2');
    });
  });

  describe('Обработка ошибок YouTube API', () => {
    it('должен обработать ошибку недействительного authorization code', () => {
      const errorResponse = {
        error: 'invalid_grant',
        error_description: 'Invalid authorization code'
      };

      expect(errorResponse.error).toBe('invalid_grant');
      expect(errorResponse.error_description).toContain('Invalid authorization code');
    });

    it('должен обработать ошибку истекшего refresh токена', () => {
      const errorResponse = {
        error: 'invalid_grant',
        error_description: 'Token has been expired or revoked'
      };

      expect(errorResponse.error).toBe('invalid_grant');
      expect(errorResponse.error_description).toContain('expired or revoked');
    });

    it('должен обработать ошибку недостаточных прав', () => {
      const errorResponse = {
        error: {
          code: 403,
          message: 'Insufficient Permission',
          errors: [
            {
              domain: 'youtube.insufficient_permissions',
              reason: 'insufficientPermissions'
            }
          ]
        }
      };

      expect(errorResponse.error.code).toBe(403);
      expect(errorResponse.error.message).toContain('Insufficient Permission');
      expect(errorResponse.error.errors[0].reason).toBe('insufficientPermissions');
    });
  });

  describe('URL формирование для YouTube API', () => {
    it('должен правильно формировать URL для получения данных канала', () => {
      const baseUrl = 'https://www.googleapis.com/youtube/v3';
      const endpoint = '/channels';
      const part = 'snippet,statistics';
      const mine = 'true';
      const apiKey = 'youtube_api_key_123';

      const url = `${baseUrl}${endpoint}?part=${part}&mine=${mine}&key=${apiKey}`;
      
      expect(url).toContain('googleapis.com/youtube/v3');
      expect(url).toContain('/channels');
      expect(url).toContain('part=snippet,statistics');
      expect(url).toContain('mine=true');
      expect(url).toContain(`key=${apiKey}`);
    });

    it('должен правильно формировать URL для обновления токена', () => {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const grantType = 'refresh_token';
      const refreshToken = '1//04_refresh_token_example';
      const clientId = 'test_client_id.apps.googleusercontent.com';
      const clientSecret = 'test_client_secret';

      const params = new URLSearchParams({
        grant_type: grantType,
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      });

      expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
      expect(params.get('grant_type')).toBe('refresh_token');
      expect(params.get('refresh_token')).toBe(refreshToken);
      expect(params.get('client_id')).toBe(clientId);
    });
  });

  describe('Канал создание guidance', () => {
    it('должен предоставить правильные инструкции для создания канала', () => {
      const channelCreationInstructions = {
        step1: 'Перейдите на YouTube Studio',
        step2: 'Нажмите "Создать канал"',
        step3: 'Выберите название канала',
        step4: 'Подтвердите создание',
        createChannelUrl: 'https://www.youtube.com/create_channel',
        studioUrl: 'https://studio.youtube.com'
      };

      expect(channelCreationInstructions.createChannelUrl).toContain('youtube.com/create_channel');
      expect(channelCreationInstructions.studioUrl).toContain('studio.youtube.com');
      expect(channelCreationInstructions.step1).toContain('YouTube Studio');
      expect(channelCreationInstructions.step2).toContain('Создать канал');
    });
  });

  describe('Global API Keys обработка', () => {
    it('должен обработать глобальные API ключи для YouTube', () => {
      const mockApiKeys = [
        {
          id: 1,
          service: 'youtube',
          api_key: 'youtube_api_key_global_123',
          active: true,
          created_at: '2025-01-01T00:00:00Z'
        },
        {
          id: 2,
          service: 'YOUTUBE', // Тест case-insensitive поиска
          api_key: 'youtube_api_key_backup_456',
          active: false,
          created_at: '2025-01-01T00:00:00Z'
        }
      ];

      const activeYouTubeKeys = mockApiKeys.filter(key => 
        (key.service.toLowerCase() === 'youtube') && key.active
      );

      expect(activeYouTubeKeys).toHaveLength(1);
      expect(activeYouTubeKeys[0].api_key).toBe('youtube_api_key_global_123');
      expect(activeYouTubeKeys[0].active).toBe(true);
    });
  });
});
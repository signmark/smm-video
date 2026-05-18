/**
 * Вспомогательные утилиты для тестирования
 * Содержит общие функции и тестовые данные для модульных тестов
 */

// Константы для тестирования
export const TEST_TELEGRAM_BOT_TOKEN = 'test_telegram_token';
export const TEST_TELEGRAM_CHAT_ID = '-100123456789';
export const TEST_VK_API_TOKEN = 'test_vk_token';
export const TEST_VK_GROUP_ID = 'club123456789';
export const TEST_USER_ID = 'test-user-id';
export const TEST_CAMPAIGN_ID = 'test-campaign-id';

/**
 * Генерирует мок ответа Telegram API
 * @param {number} messageId ID сообщения
 * @returns {object} Объект с ответом API Telegram
 */
export function mockTelegramAPIResponse(messageId: number) {
  return {
    ok: true,
    result: {
      message_id: messageId,
      from: {
        id: 123456789,
        is_bot: true,
        first_name: 'TestBot',
        username: 'test_bot'
      },
      chat: {
        id: Number(TEST_TELEGRAM_CHAT_ID),
        title: 'Test Channel',
        type: 'channel'
      },
      date: Math.floor(Date.now() / 1000)
    }
  };
}

/**
 * Генерирует мок ответа VK API
 * @param {number} postId ID поста
 * @returns {object} Объект с ответом API ВКонтакте
 */
export function mockVkAPIResponse(postId: number) {
  return {
    response: {
      post_id: postId
    }
  };
}

/**
 * Генерирует тестовый контент для публикации
 * @param {object} data Данные для создания контента
 * @returns {object} Объект с тестовым контентом
 */
export function generateTestContent(data: {
  id: string;
  title: string;
  text: string;
  image_url: string | null;
  additional_images?: string[];
  social_platforms: string[];
  status?: string;
  keywords?: string[];
  hashtags?: string[];
}) {
  return {
    id: data.id,
    userId: TEST_USER_ID,
    campaignId: TEST_CAMPAIGN_ID,
    title: data.title,
    content: data.text,
    contentType: 'post',
    imageUrl: data.image_url,
    additionalImages: data.additional_images || null,
    videoUrl: null,
    status: data.status || 'draft',
    prompt: null,
    scheduledAt: null,
    publishedAt: null,
    socialPlatforms: data.social_platforms,
    hashtags: data.hashtags || [],
    keywords: data.keywords || [],
    links: [],
    metadata: {},
    createdAt: new Date()
  };
}

/**
 * Генерирует HTML-форматированный текст для тестирования
 * @returns {string} HTML-форматированный текст
 */
export function generateFormattedHtmlContent() {
  return `<b>Жирный текст</b>
<i>Наклонный текст</i>
<u>Подчеркнутый текст</u>
<s>Зачеркнутый текст</s>
<code>Моноширинный текст</code>
<a href="https://example.com/">Ссылка</a>

Поддержка списков:
• Пункт 1
• Пункт 2
• Пункт 3

И абзацев с переносами строк.`;
}

/**
 * Генерирует HTML-текст с незакрытыми тегами для тестирования исправления
 * @returns {string} HTML-текст с ошибками
 */
export function generateUnclosedHtmlContent() {
  return `Не дай бог провалишь тесты!
<u>Дичь сраная
<b><u>Пездула безглазая
<b><s>Умри
<i>Нахуй`;
}

/**
 * Генерирует корректный HTML-текст после исправления незакрытых тегов
 * @returns {string} Исправленный HTML-текст
 */
export function generateFixedHtmlContent() {
  return `Не дай бог провалишь тесты!
<u>Дичь сраная</u>
<b><u>Пездула безглазая</u></b>
<b><s>Умри</s></b>
<i>Нахуй</i>`;
}

/**
 * Создает мок для функций авторизации и получения токена
 * @returns {object} Объект с моками для авторизации
 */
export function mockAuthFunctions() {
  const mockGetToken = jest.fn().mockResolvedValue('test_token');
  const mockLoginAdmin = jest.fn().mockResolvedValue({
    success: true,
    token: 'test_admin_token'
  });
  
  return {
    getToken: mockGetToken,
    loginAdmin: mockLoginAdmin
  };
}

/**
 * Создает мок для API-ключей 
 * @returns {object} Объект с тестовыми API ключами
 */
export function mockApiKeys() {
  return {
    falAiApiKey: 'test_fal_ai_key',
    openAiApiKey: 'test_openai_key',
    claudeApiKey: 'test_claude_key',
    deepseekoApiKey: 'test_deepseek_key',
    stabilityAiKey: 'test_stability_key'
  };
}

/**
 * Создает тестовую директорию и файлы для тестирования
 * @param {string} testDir Путь к тестовой директории
 * @returns {Promise<void>}
 */
export async function createTestDirectory(testDir: string) {
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, 'test-image.jpg'), 'fake image data');
    return true;
  } catch (error) {
    console.error('Ошибка при создании тестовой директории:', error);
    return false;
  }
}

/**
 * Преобразует объект в FormData для тестирования отправки файлов
 * @param {object} data Объект с данными
 * @returns {FormData} FormData объект
 */
export function createFormDataMock(data: Record<string, any>) {
  const FormData = require('form-data');
  const formData = new FormData();
  
  Object.entries(data).forEach(([key, value]) => {
    formData.append(key, value);
  });
  
  return formData;
}

/**
 * Генерирует мок настроек социальных сетей для кампании
 * @returns {object} Объект с настройками социальных сетей
 */
export function mockCampaignSocialSettings() {
  return {
    telegram: {
      token: TEST_TELEGRAM_BOT_TOKEN,
      chatId: TEST_TELEGRAM_CHAT_ID
    },
    vk: {
      token: TEST_VK_API_TOKEN,
      groupId: TEST_VK_GROUP_ID
    },
    instagram: {
      token: 'test_instagram_token',
      businessAccountId: '123456789'
    },
    facebook: {
      token: 'test_facebook_token',
      pageId: '123456789'
    }
  };
}
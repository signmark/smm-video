/**
 * Сервис для проверки API ключей социальных сетей
 * Валидирует ключи и учетные данные, предоставляя информацию о их статусе
 */

import axios from 'axios';
import { log } from '../utils/logger';

/**
 * Результат проверки API ключа
 */
export interface ApiKeyValidationResult {
  isValid: boolean;
  message: string;
  details?: any;
}

/**
 * Проверяет токен Telegram бота
 * @param token API токен Telegram бота
 * @returns Результат проверки
 */
export async function validateTelegramToken(token: string): Promise<ApiKeyValidationResult> {
  try {
    log(`Проверка токена Telegram: ${token.slice(0, 5)}...`, 'api-validator');
    
    // Запрос к Telegram API для получения информации о боте
    const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
      timeout: 10000
    });
    
    if (response.data && response.data.ok) {
      const botInfo = response.data.result;
      return {
        isValid: true,
        message: `Бот успешно авторизован: ${botInfo.first_name} (@${botInfo.username})`,
        details: botInfo
      };
    } else {
      return {
        isValid: false,
        message: 'Некорректный формат ответа от Telegram API',
        details: response.data
      };
    }
  } catch (error: any) {
    log(`Ошибка при проверке токена Telegram: ${error.message}`, 'api-validator');
    
    let message = 'Ошибка при проверке токена';
    if (axios.isAxiosError(error)) {
      message = error.response?.data?.description || 
                error.response?.data?.error || 
                error.message;
    }
    
    return {
      isValid: false,
      message: message,
      details: error.response?.data
    };
  }
}

/**
 * Проверяет токен доступа VK
 * @param token Токен доступа VK API
 * @param groupId ID группы (опционально)
 * @returns Результат проверки
 */
export async function validateVkToken(token: string, groupId?: string): Promise<ApiKeyValidationResult> {
  try {
    log(`Проверка токена VK: ${token.slice(0, 5)}...${groupId ? ` для группы ${groupId}` : ''}`, 'api-validator');
    
    // Запрос к VK API для получения информации о пользователе
    const response = await axios.get('https://api.vk.com/method/users.get', {
      params: {
        access_token: token,
        v: '5.131'
      },
      timeout: 10000
    });
    
    if (response.data && response.data.response && Array.isArray(response.data.response)) {
      const userInfo = response.data.response[0];
      
      // Если указан ID группы, проверяем права на публикацию
      if (groupId) {
        try {
          const groupResponse = await axios.get('https://api.vk.com/method/groups.getById', {
            params: {
              group_id: groupId,
              access_token: token,
              v: '5.131'
            }
          });
          
          if (groupResponse.data && groupResponse.data.response && Array.isArray(groupResponse.data.response)) {
            const groupInfo = groupResponse.data.response[0];
            return {
              isValid: true,
              message: `Токен валиден. Пользователь: ${userInfo.first_name} ${userInfo.last_name}, Группа: ${groupInfo.name}`,
              details: {
                user: userInfo,
                group: groupInfo
              }
            };
          }
        } catch (groupError: any) {
          return {
            isValid: false,
            message: `Токен валиден, но ошибка при проверке группы: ${groupError.message}`,
            details: {
              user: userInfo,
              groupError: groupError.response?.data
            }
          };
        }
      }
      
      return {
        isValid: true,
        message: `Токен валиден. Пользователь: ${userInfo.first_name} ${userInfo.last_name}`,
        details: userInfo
      };
    } else {
      return {
        isValid: false,
        message: 'Некорректный формат ответа от VK API',
        details: response.data
      };
    }
  } catch (error: any) {
    log(`Ошибка при проверке токена VK: ${error.message}`, 'api-validator');
    
    let message = 'Ошибка при проверке токена';
    if (axios.isAxiosError(error)) {
      message = error.response?.data?.error_description || 
                error.response?.data?.error?.error_msg || 
                error.message;
    }
    
    return {
      isValid: false,
      message: message,
      details: error.response?.data
    };
  }
}

/**
 * Проверяет токен доступа Instagram (Facebook Graph API)
 * @param token Токен доступа Instagram API
 * @returns Результат проверки
 */
export async function validateInstagramToken(token: string): Promise<ApiKeyValidationResult> {
  try {
    log(`Проверка токена Instagram: ${token.slice(0, 5)}...`, 'api-validator');
    
    // Проверяем, что токен имеет правильный формат для Instagram/Facebook Graph API
    if (!token || token.trim().length < 20) {
      return {
        isValid: false,
        message: 'Токен имеет неправильный формат',
        details: { error: 'Invalid token format' }
      };
    }

    // Базовая проверка - использование простого запроса для получения информации о пользователе
    // Это позволит проверить, что токен вообще работает, без проверки доступа к Instagram
    const response = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: {
        access_token: token,
        fields: 'id,name' // Минимальный запрос полей для проверки валидности токена
      },
      timeout: 10000
    });
    
    // Если получили ответ с ID пользователя - токен работает для Facebook
    if (response.data && response.data.id) {
      log(`Токен Facebook валиден для базового доступа. ID: ${response.data.id}, Имя: ${response.data.name}`, 'api-validator');
      
      // Теперь пробуем последовательно проверить доступ к данным, необходимым для Instagram
      // 1. Сначала проверяем, может ли токен получить список страниц пользователя
      try {
        const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
          params: {
            access_token: token
          },
          timeout: 10000
        });
        
        if (pagesResponse.data && pagesResponse.data.data && pagesResponse.data.data.length > 0) {
          log(`Найдены страницы Facebook: ${pagesResponse.data.data.length} шт.`, 'api-validator');
          
          // Токен имеет доступ к страницам - это уже хороший признак
          // Даже если нет Instagram-аккаунта, токен может быть использован для Facebook
          
          // Возвращаем успешный результат, но с информацией, что Instagram не проверен
          return {
            isValid: true,
            message: `Токен Facebook валиден, доступно ${pagesResponse.data.data.length} страниц. Для публикации в Instagram добавьте ID бизнес-аккаунта Instagram в настройках кампании.`,
            details: {
              user: response.data,
              pages: pagesResponse.data.data
            }
          };
        } else {
          // Токен работает для базового доступа, но нет доступа к страницам
          return {
            isValid: true,
            message: `Токен Facebook валиден для базового доступа (${response.data.name}), но не найдены доступные страницы. Для публикации контента в Instagram требуется ID бизнес-аккаунта Instagram и дополнительные разрешения.`,
            details: {
              user: response.data
            }
          };
        }
      } catch (pagesError: any) {
        log(`Ошибка при проверке доступа к страницам: ${pagesError.message}`, 'api-validator');
        
        // Если не удалось получить страницы, но токен базовый валиден, 
        // возвращаем успех с предупреждением
        return {
          isValid: true,
          message: `Токен валиден для базового доступа (${response.data.name}), но нет прав на управление страницами. Для публикации в Instagram требуется ID бизнес-аккаунта Instagram и дополнительные разрешения.`,
          details: {
            user: response.data,
            error: pagesError.response?.data?.error
          }
        };
      }
    } else {
      // Базовая проверка не прошла
      return {
        isValid: false,
        message: 'Не удалось получить информацию о пользователе с данным токеном',
        details: response.data
      };
    }
  } catch (error: any) {
    log(`Ошибка при проверке токена Instagram: ${error.message}`, 'api-validator');
    
    let message = 'Ошибка при проверке токена';
    if (axios.isAxiosError(error)) {
      message = error.response?.data?.error?.message || 
                error.response?.data?.error_description || 
                error.message;
    }
    
    return {
      isValid: false,
      message: message,
      details: error.response?.data
    };
  }
}

/**
 * Проверяет токен доступа Facebook
 * @param token Токен доступа Facebook API
 * @param pageId ID страницы Facebook (опционально)
 * @returns Результат проверки
 */
export async function validateFacebookToken(token: string, pageId?: string): Promise<ApiKeyValidationResult> {
  try {
    log(`Проверка токена Facebook: ${token.slice(0, 5)}...${pageId ? ` для страницы ${pageId}` : ''}`, 'api-validator');
    
    // Проверяем, что токен имеет правильный формат
    if (!token || token.trim().length < 20) {
      return {
        isValid: false,
        message: 'Токен имеет неправильный формат',
        details: { error: 'Invalid token format' }
      };
    }

    // Упрощенная проверка - только базовая информация пользователя
    const response = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: {
        access_token: token,
        fields: 'id,name' // Запрашиваем минимальный набор полей для проверки
      },
      timeout: 10000
    });
    
    if (response.data && response.data.id) {
      // Токен как минимум предоставляет базовый доступ к данным
      log(`Токен Facebook валиден для базового доступа. ID: ${response.data.id}, Имя: ${response.data.name}`, 'api-validator');
      
      // Проверяем доступ к страницам, если это не указан конкретный pageId
      if (!pageId) {
        try {
          const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
            params: {
              access_token: token,
              fields: 'id,name,access_token'
            },
            timeout: 10000
          });
          
          if (pagesResponse.data && pagesResponse.data.data && pagesResponse.data.data.length > 0) {
            const pagesCount = pagesResponse.data.data.length;
            const pageNames = pagesResponse.data.data.map((p: any) => p.name).join(", ");
            
            return {
              isValid: true,
              message: `Токен Facebook валиден. Доступно ${pagesCount} ${pagesCount === 1 ? 'страница' : 'страниц'}: ${pageNames}`,
              details: {
                user: response.data,
                pages: pagesResponse.data.data
              }
            };
          } else {
            // Страниц нет, но базовый доступ есть
            return {
              isValid: true,
              message: `Токен Facebook валиден для пользователя ${response.data.name}, но нет доступных страниц`,
              details: {
                user: response.data
              }
            };
          }
        } catch (pagesError: any) {
          log(`Ошибка при проверке страниц: ${pagesError.message}`, 'api-validator');
          
          // Если страницы не удалось получить, возвращаем базовую информацию
          return {
            isValid: true,
            message: `Токен Facebook валиден для базового доступа (${response.data.name}), но доступ к страницам ограничен`,
            details: {
              user: response.data,
              error: pagesError.response?.data?.error
            }
          };
        }
      } else {
        // Если указан конкретный ID страницы, проверяем его напрямую
        try {
          const pageResponse = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
            params: {
              access_token: token,
              fields: 'id,name'
            },
            timeout: 10000
          });
          
          if (pageResponse.data && pageResponse.data.id) {
            return {
              isValid: true,
              message: `Токен Facebook валиден. Страница ${pageResponse.data.name} (ID: ${pageResponse.data.id}) доступна`,
              details: {
                user: response.data,
                page: pageResponse.data
              }
            };
          }
        } catch (pageError: any) {
          log(`Ошибка при проверке конкретной страницы ${pageId}: ${pageError.message}`, 'api-validator');
          
          // Если не удалось получить страницу по ID, проверяем общий доступ к страницам
          try {
            const pagesResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
              params: {
                access_token: token
              },
              timeout: 10000
            });
            
            if (pagesResponse.data && pagesResponse.data.data && pagesResponse.data.data.length > 0) {
              // Есть доступ к страницам, но не к запрошенной
              return {
                isValid: true,
                message: `Токен Facebook валиден, но страница с ID ${pageId} не найдена или недоступна. Доступно ${pagesResponse.data.data.length} других страниц.`,
                details: {
                  user: response.data,
                  pages: pagesResponse.data.data,
                  requestedPageId: pageId
                }
              };
            }
          } catch (error) {
            // Игнорируем ошибку
          }
          
          // Возвращаем результат с ошибкой доступа к конкретной странице
          return {
            isValid: true, // Основной токен валиден
            message: `Токен Facebook валиден для базового доступа, но страница с ID ${pageId} недоступна`,
            details: {
              user: response.data,
              pageError: pageError.response?.data
            }
          };
        }
      }
      
      // Если дошли до этой точки, значит базовая проверка прошла, но не удалось проверить страницы
      return {
        isValid: true,
        message: `Токен Facebook валиден для пользователя ${response.data.name}`,
        details: response.data
      };
    } else {
      // Базовый запрос не вернул данные пользователя
      return {
        isValid: false,
        message: 'Не удалось получить информацию о пользователе с данным токеном',
        details: response.data
      };
    }
  } catch (error: any) {
    log(`Ошибка при проверке токена Facebook: ${error.message}`, 'api-validator');
    
    let message = 'Ошибка при проверке токена';
    if (axios.isAxiosError(error)) {
      message = error.response?.data?.error?.message || 
                error.response?.data?.error_description || 
                error.message;
    }
    
    return {
      isValid: false,
      message: message,
      details: error.response?.data
    };
  }
}

/**
 * Проверяет API ключ YouTube (Google API)
 * @param apiKey API ключ Google
 * @param channelId ID канала YouTube (опционально)
 * @returns Результат проверки
 */
export async function validateYoutubeApiKey(apiKey: string, channelId?: string): Promise<ApiKeyValidationResult> {
  try {
    log(`Проверка API ключа YouTube: ${apiKey.slice(0, 5)}...${channelId ? ` для канала ${channelId}` : ''}`, 'api-validator');
    
    // Запрос к YouTube API для получения информации о каналах
    let url = 'https://www.googleapis.com/youtube/v3/channels';
    let params: any = {
      key: apiKey,
      part: 'snippet,contentDetails,statistics'
    };
    
    // Если указан ID канала, проверяем именно его
    if (channelId) {
      params.id = channelId;
    } else {
      // Иначе просто проверяем валидность API ключа, запрашивая самые популярные каналы
      params.chart = 'mostPopular';
      params.maxResults = 1;
    }
    
    const response = await axios.get(url, {
      params: params,
      timeout: 10000
    });
    
    if (response.data && response.data.items) {
      if (channelId && response.data.items.length === 0) {
        return {
          isValid: false,
          message: `API ключ валиден, но канал с ID ${channelId} не найден`,
          details: response.data
        };
      }
      
      return {
        isValid: true,
        message: channelId 
          ? `API ключ валиден. Канал: ${response.data.items[0]?.snippet?.title || 'Не указано'}`
          : 'API ключ YouTube валиден',
        details: response.data
      };
    } else {
      return {
        isValid: false,
        message: 'Некорректный формат ответа от YouTube API',
        details: response.data
      };
    }
  } catch (error: any) {
    log(`Ошибка при проверке API ключа YouTube: ${error.message}`, 'api-validator');
    
    let message = 'Ошибка при проверке API ключа';
    if (axios.isAxiosError(error)) {
      message = error.response?.data?.error?.message || 
                error.response?.data?.error?.errors?.[0]?.reason || 
                error.message;
    }
    
    return {
      isValid: false,
      message: message,
      details: error.response?.data
    };
  }
}
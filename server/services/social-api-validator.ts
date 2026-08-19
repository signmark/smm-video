/**
 * Сервис для проверки API ключей социальных сетей
 * Валидирует ключи и учетные данные, предоставляя информацию о их статусе
 */

import axios from 'axios';
import { log } from '../utils/logger';
import { normalizeVkGroupId } from '../utils/vk-group-id';
import { telegramHttp } from './social-platforms/telegram-http';

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
    log(`Проверка токена Telegram: [redacted len=${token?.length}]`, 'api-validator');
    
    // Запрос к Telegram API для получения информации о боте
    // AI-101 Phase 2B: через отказоустойчивый транспорт, таймаут прежний.
    const tg = await telegramHttp();
    const response = await tg.get(`https://api.telegram.org/bot${token}/getMe`, {
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
 * Итог живой проверки связи с Telegram.
 *
 * SM-24. Метка «Настроено» говорила лишь о том, что настройки сохранены: токен
 * мог быть отозван, бота могли выгнать из канала, а человек всё равно видел
 * зелёную метку и узнавал правду только из неудачной публикации. Здесь мы
 * спрашиваем сам Telegram — и делаем это только чтением: getMe, getChat,
 * getChatMember. Ни одного сообщения в чужой канал проверка не отправляет.
 */
export interface TelegramConnectionResult {
  isValid: boolean;
  message: string;
  /** error — виновата настройка; warning — виноват момент, стоит повторить. */
  severity?: 'error' | 'warning';
  /** true — исход мог измениться сам собой (сеть, таймаут, сбой Telegram). */
  retryable?: boolean;
  details?: {
    botUsername?: string;
    chatTitle?: string;
    chatType?: string;
    canPost?: boolean;
  };
}

/**
 * Признак «дело не в настройках, а в моменте»: сеть, таймаут, сбой на той
 * стороне. Ошибку разбираем по её форме, а не через axios.isAxiosError:
 * запросы к Telegram идут отказоустойчивым транспортом (telegramHttp), и
 * привязываться к тому, каким именно клиентом собран объект ошибки, незачем.
 */
function isTransientTelegramError(error: any): boolean {
  const status = error?.response?.status;
  if (status === undefined) return true; // ответа нет вовсе — сеть или таймаут
  return status >= 500 || status === 429;
}

function telegramErrorText(error: any, fallback: string): string {
  return error?.response?.data?.description || error?.message || fallback;
}

/**
 * Проверяет, дойдёт ли публикация: жив ли токен бота и есть ли у бота доступ
 * к указанному каналу с правом писать.
 *
 * @param token токен бота
 * @param chatId идентификатор канала или @username
 */
export async function validateTelegramConnection(
  token: string,
  chatId?: string,
): Promise<TelegramConnectionResult> {
  const tg = await telegramHttp();
  // Имя переменной намеренно длинное: сторож транспорта
  // (telegram-transport-coverage) ищет вызовы по имени базового адреса, и
  // короткое `api` он находил внутри `api.vk.com` в этом же файле.
  const telegramApi = `https://api.telegram.org/bot${token}`;

  // Шаг 1. Жив ли токен.
  let botId: number | undefined;
  let botUsername: string | undefined;
  try {
    const me = await tg.get(`${telegramApi}/getMe`, { timeout: 10000 });
    if (!me.data?.ok) {
      return {
        isValid: false,
        message: 'Telegram ответил неожиданно — проверить связь не удалось.',
        severity: 'warning',
        retryable: true,
      };
    }
    botId = me.data.result?.id;
    botUsername = me.data.result?.username;
  } catch (error: any) {
    log(`Проверка связи Telegram: getMe не прошёл — ${error.message}`, 'api-validator');
    if (isTransientTelegramError(error)) {
      return {
        isValid: false,
        message: 'Telegram сейчас не отвечает — проверим связь позже.',
        severity: 'warning',
        retryable: true,
      };
    }
    return {
      isValid: false,
      message: `Токен бота не принят Telegram: ${telegramErrorText(error, 'доступ отклонён')}. Замените токен.`,
      severity: 'error',
      retryable: false,
    };
  }

  const chat = (chatId || '').trim();
  if (!chat) {
    return {
      isValid: false,
      message: `Бот @${botUsername || 'без имени'} на связи, но канал не указан — публиковать некуда.`,
      severity: 'error',
      retryable: false,
      details: { botUsername },
    };
  }

  // Шаг 2. Виден ли боту сам канал.
  let chatTitle: string | undefined;
  let chatType: string | undefined;
  try {
    const info = await tg.get(`${telegramApi}/getChat`, { params: { chat_id: chat }, timeout: 10000 });
    chatTitle = info.data?.result?.title || info.data?.result?.username;
    chatType = info.data?.result?.type;
  } catch (error: any) {
    log(`Проверка связи Telegram: getChat не прошёл — ${error.message}`, 'api-validator');
    if (isTransientTelegramError(error)) {
      return {
        isValid: false,
        message: 'Telegram сейчас не отвечает — проверим связь позже.',
        severity: 'warning',
        retryable: true,
        details: { botUsername },
      };
    }
    return {
      isValid: false,
      message: `Бот не видит канал ${chat}: ${telegramErrorText(error, 'канал не найден')}. Проверьте идентификатор и добавьте бота в канал.`,
      severity: 'error',
      retryable: false,
      details: { botUsername },
    };
  }

  // Шаг 3. Право писать. Если сам этот запрос не прошёл — связь мы уже
  // подтвердили, поэтому вердикт не портим, а честно говорим, что права
  // проверить не вышло.
  try {
    const member = await tg.get(`${telegramApi}/getChatMember`, {
      params: { chat_id: chat, user_id: botId },
      timeout: 10000,
    });
    const status = member.data?.result?.status;
    const canPost = member.data?.result?.can_post_messages;

    if (status === 'left' || status === 'kicked') {
      return {
        isValid: false,
        message: `Бот @${botUsername} удалён из канала ${chatTitle || chat}. Добавьте его обратно администратором.`,
        severity: 'error',
        retryable: false,
        details: { botUsername, chatTitle, chatType, canPost: false },
      };
    }

    const isAdmin = status === 'administrator' || status === 'creator';
    if (chatType === 'channel' && !isAdmin) {
      return {
        isValid: false,
        message: `В канал ${chatTitle || chat} писать может только администратор, а бот @${botUsername} им не является.`,
        severity: 'error',
        retryable: false,
        details: { botUsername, chatTitle, chatType, canPost: false },
      };
    }
    if (isAdmin && canPost === false) {
      return {
        isValid: false,
        message: `Бот @${botUsername} — администратор канала ${chatTitle || chat}, но без права публикации. Включите его в настройках канала.`,
        severity: 'error',
        retryable: false,
        details: { botUsername, chatTitle, chatType, canPost: false },
      };
    }

    return {
      isValid: true,
      message: `Связь есть: бот @${botUsername} пишет в ${chatTitle || chat}.`,
      details: { botUsername, chatTitle, chatType, canPost: true },
    };
  } catch (error: any) {
    log(`Проверка связи Telegram: getChatMember не прошёл — ${error.message}`, 'api-validator');
    return {
      isValid: true,
      message: `Бот @${botUsername} видит ${chatTitle || chat}, но право публикации проверить не удалось.`,
      severity: 'warning',
      retryable: true,
      details: { botUsername, chatTitle, chatType },
    };
  }
}

/**
 * Достаёт сообщество из ответа `groups.getById` независимо от версии API.
 *
 * v5.131 отдаёт `{ response: [ {...} ] }`, v5.199 — `{ response: { groups: [ {...} ] } }`.
 * Возвращает undefined, если сообщества в ответе нет (ошибка или пустой список).
 */
function extractVkGroup(body: any): any | undefined {
  const payload = body?.response;
  if (Array.isArray(payload)) return payload[0];
  if (Array.isArray(payload?.groups)) return payload.groups[0];
  return undefined;
}

/**
 * Проверяет токен доступа VK
 * @param token Токен доступа VK API
 * @param groupId ID группы (опционально)
 * @returns Результат проверки
 */
export async function validateVkToken(token: string, groupId?: string): Promise<ApiKeyValidationResult> {
  try {
    log(`Проверка токена VK: [redacted len=${token?.length}]${groupId ? ` для группы ${groupId}` : ''}`, 'api-validator');

    // Токены VK ID (`vk2.…`) авторизуются заголовком Bearer и требуют v≥5.199;
    // старые сервисные токены передаются параметром access_token с v5.131.
    // Эндпоинты списка групп это различали, а валидатор — нет: vk2-токен уходил
    // старым способом, VK отвечал отказом, и живое подключение выглядело
    // сломанным. Форма запроса теперь одна на все вызовы метода.
    const isVkId = String(token).startsWith('vk2.');
    const apiVersion = isVkId ? '5.199' : '5.131';
    const authHeaders = isVkId ? { Authorization: `Bearer ${token}` } : undefined;
    const withAuth = (params: Record<string, any>) =>
      isVkId ? { ...params, v: apiVersion } : { ...params, v: apiVersion, access_token: token };

    const response = await axios.get('https://api.vk.com/method/users.get', {
      params: withAuth({}),
      headers: authHeaders,
      timeout: 10000
    });

    if (response.data && response.data.response && Array.isArray(response.data.response)) {
      const userInfo = response.data.response[0];
      
      // Если указан ID группы, проверяем права на публикацию.
      // groups.getById принимает только положительный id или screen_name, а в
      // настройках groupId лежит в четырёх разных формах (см. vk-group-id.ts) —
      // без нормализации живой токен получал ошибку 100 и выглядел мёртвым.
      const normalizedGroupId = normalizeVkGroupId(groupId);
      if (normalizedGroupId) {
        try {
          const groupResponse = await axios.get('https://api.vk.com/method/groups.getById', {
            params: withAuth({ group_id: normalizedGroupId }),
            headers: authHeaders,
            timeout: 10000
          });
          
          // Форма ответа groups.getById зависит от версии API:
          //   v5.131 → { response: [ {...} ] }            — массив
          //   v5.199 → { response: { groups: [ {...} ] } } — объект с `groups`
          // Проверка ждала только массив, поэтому после перехода на v5.199 для
          // vk2-токенов живая группа опознавалась как «неожиданный ответ».
          const groupInfo = extractVkGroup(groupResponse.data);
          if (groupInfo) {
            return {
              isValid: true,
              message: `Токен валиден. Пользователь: ${userInfo.first_name} ${userInfo.last_name}, Группа: ${groupInfo.name}`,
              details: {
                user: userInfo,
                group: groupInfo
              }
            };
          }

          // VK отдаёт ошибки метода в теле с HTTP 200 — promise не rejected и
          // catch ниже не сработает. Без этой ветки управление проваливалось к
          // общему `isValid: true`, и провал проверки группы выглядел успехом.
          // Форма ответа та же, что в catch: успешный users.get выше доказывает,
          // что credential жив, поэтому это group failure, а не auth failure —
          // `isPermanentVkAuthFailure` такой details намеренно не помечает.
          return {
            isValid: false,
            message: `Токен валиден, но ошибка при проверке группы: ${groupResponse.data?.error?.error_msg || 'некорректный ответ VK API'}`,
            details: {
              user: userInfo,
              groupError: groupResponse.data
            }
          };
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
    log(`Проверка токена Instagram: [redacted len=${token?.length}]`, 'api-validator');
    
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
    log(`Проверка токена Facebook: [redacted len=${token?.length}]${pageId ? ` для страницы ${pageId}` : ''}`, 'api-validator');
    
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
    log(`Проверка API ключа YouTube: [redacted len=${apiKey?.length}]${channelId ? ` для канала ${channelId}` : ''}`, 'api-validator');
    
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
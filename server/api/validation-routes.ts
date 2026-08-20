/**
 * API маршруты для валидации различных API ключей
 * Используются для проверки токенов и ключей социальных сетей
 */

import { Express, Request, Response } from 'express';
import {
  validateTelegramToken,
  validateTelegramConnection,
  validateVkToken,
  validateInstagramToken,
  validateFacebookToken,
  validateYoutubeApiKey
} from '../services/social-api-validator';
import { log } from '../utils/logger';
import { getCampaignSocialSettings, pickPlatformToken } from '../services/campaign-token-resolver';
import { authenticateUser } from '../middleware/user-auth';
import { CampaignAccessError } from '../services/campaign-access';
import { classifyVkError, isVkAuthExpired } from '../services/vk-error-classifier';
import { checkAllPlatforms, persistConnectionChecks } from '../services/connection-check';

/**
 * Единственный дом маршрутов `/api/validate/*` (кроме threads — он в
 * routes/social.ts, дубликата у него нет). Раньше те же пути регистрировались
 * второй раз в registerSocialRoutes: Express завершает запрос в первом
 * совпавшем handler, поэтому побеждали здешние — без `authenticateUser`, —
 * а authenticated-версии вместе с `markVkAuthExpired` были недостижимы.
 *
 * @param app Express приложение
 */
export function registerValidationRoutes(app: Express): void {
  /**
   * SM-41. «Проверить сейчас» со страницы кампании: живая проверка всех
   * площадок с сохранёнными доступами. Исход кладётся рядом с настройками,
   * поэтому переживает закрытие окна — раньше он жил только в памяти открытой
   * формы, и страница кампании о нём не знала.
   *
   * Сама по себе проверка не запускается никогда: это поход в шесть чужих
   * сервисов, и делать его на каждое открытие страницы нельзя.
   *
   * Наружу уходят вердикты, токены — нет.
   */
  app.post('/api/campaigns/:campaignId/social/check', authenticateUser, async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    try {
      const sms = await getCampaignSocialSettings(campaignId, { user: req.user });
      const checkedAt = new Date().toISOString();
      const checks = await checkAllPlatforms(sms, checkedAt);

      try {
        await persistConnectionChecks(campaignId, checks);
      } catch (saveErr: any) {
        // Проверку человек уже оплатил ожиданием — отдаём исход, даже если
        // сохранить не удалось. Молчание тут было бы худшим из ответов.
        log(`SM-41: исходы проверки кампании ${campaignId} не сохранились: ${saveErr.message}`, 'api-validation', 'error');
      }

      return res.json({ success: true, checkedAt, results: checks });
    } catch (e: any) {
      if (e instanceof CampaignAccessError) {
        return res.status(e.status).json({ success: false, message: e.code });
      }
      log(`SM-41: проверка связи кампании ${campaignId} не удалась: ${e.message}`, 'api-validation', 'error');
      return res.status(500).json({ success: false, message: 'Не удалось проверить связь' });
    }
  });

  // Telegram API Token validation
  app.post('/api/validate/telegram', authenticateUser, async (req: Request, res: Response) => {
    try {
      let { token } = req.body;
      const { chatId, campaignId } = req.body;

      // SM-24. Токен бота вырезан из ответов сервера и в браузере его нет, а
      // проверять надо именно сохранённое подключение — иначе живая проверка
      // возможна лишь в момент ввода токена, то есть ровно тогда, когда она
      // меньше всего нужна. Токен берём из настроек кампании; наружу уходит
      // только вердикт.
      let chatToCheck = typeof chatId === 'string' ? chatId : '';
      if (campaignId) {
        try {
          const sms = await getCampaignSocialSettings(campaignId, { user: req.user });
          if (!token) token = pickPlatformToken(sms, 'telegram');
          if (!chatToCheck) chatToCheck = sms.telegram?.chatId || '';
        } catch (e: any) {
          if (e instanceof CampaignAccessError) {
            return res.status(e.status).json({ success: false, message: e.code });
          }
          log(`Проверка Telegram: не удалось прочитать настройки кампании ${campaignId}: ${e.message}`, 'api-validation');
        }
      }

      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }

      log(`Проверка связи Telegram: [redacted len=${token.length}]${chatToCheck ? ' + канал' : ''}`, 'api-validation');

      // Без канала проверять нечего сверх самого токена — старое поведение
      // маршрута сохраняется в неприкосновенности для тех, кто зовёт его при
      // вводе нового токена.
      if (!chatToCheck) {
        const result = await validateTelegramToken(token);
        return res.json({
          success: result.isValid,
          message: result.message,
          details: result.details,
        });
      }

      const result = await validateTelegramConnection(token, chatToCheck);
      return res.json({
        success: result.isValid,
        message: result.message,
        severity: result.severity,
        retryable: result.retryable,
        details: result.details,
      });
    } catch (error) {
      log.error('Error validating Telegram token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // VK API Token validation
  app.post('/api/validate/vk', authenticateUser, async (req: Request, res: Response) => {
    try {
      let { token, groupId } = req.body;
      const { campaignId } = req.body;

      // Источник проверяемого токена определяет, можно ли по итогам проверки
      // трогать состояние кампании: произвольный токен из body ничего не
      // доказывает про сохранённое подключение.
      let tokenSource: 'body' | 'campaign' = 'body';

      // Сохранённое состояние кампании — база для ответа: клиент рисует плашку
      // по нему, а не по исходу конкретной проверки.
      let storedAuthExpired = false;

      // campaignId проверяется на владение всегда, а не только когда из кампании
      // берётся токен: ниже по нему пишется authExpired, и запись в чужую
      // кампанию недопустима. authorizeCampaignAccess внутри резолвера отдаёт
      // 404 и на несуществующую, и на чужую — чтобы нельзя было перебирать id.
      if (campaignId) {
        try {
          const sms = await getCampaignSocialSettings(campaignId, { user: req.user });
          storedAuthExpired = sms.vk?.authExpired === true;
          // Токены вырезаны из браузера (sanitizeOAuthSecrets) — если клиент их
          // не прислал, берём из настроек кампании. Клиенту уходит только вердикт.
          if (!token) {
            token = pickPlatformToken(sms, 'vk');
            groupId = groupId || sms.vk?.groupId;
            if (token) tokenSource = 'campaign';
          }
        } catch (e: any) {
          if (e instanceof CampaignAccessError) {
            return res.status(e.status).json({ success: false, message: e.code });
          }
          log(`Валидация VK: не удалось прочитать токен кампании ${campaignId}: ${e.message}`, 'api-validation');
        }
      }

      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }

      log(`Валидация токена VK: [redacted]${groupId ? ` для группы ${groupId}` : ''}`, 'api-validation');
      const result = await validateVkToken(token, groupId);

      // authExpired = «сохранённое подключение мертво, нужно переподключение».
      // Флаг стоит дорого: он шлёт владельцу письмо и выключает кампанию из
      // refresh cron (vk-token-refresh.ts:227). Поэтому три условия сразу:
      // проверяли именно сохранённый токен кампании, доступ к ней подтверждён
      // выше, и VK структурно подтвердил постоянную auth-ошибку. Невалидный
      // токен из body, сеть, таймаут и провал проверки группы состояние
      // кампании не трогают.
      const checkedStoredToken = Boolean(campaignId) && tokenSource === 'campaign';
      let authExpired = storedAuthExpired;

      if (checkedStoredToken && !result.isValid && isVkAuthExpired(result.details)) {
        authExpired = true;
        try {
          const { markVkAuthExpired } = await import('../services/vk-token-refresh');
          await markVkAuthExpired(campaignId);
        } catch (e: any) {
          log.error('[validate/vk] Ошибка при выставлении authExpired:', e.message);
        }
      } else if (checkedStoredToken && result.isValid) {
        // Симметрия: сохранённый токен снова прошёл проверку — снимаем флаг.
        // Иначе он неснимаем: refresh cron пропускает кампании с authExpired
        // (vk-token-refresh.ts), а снимал флаг только он — красная плашка
        // держалась вечно, даже когда публикация шла нормально.
        authExpired = false;
        try {
          const { clearVkAuthExpired } = await import('../services/vk-token-refresh');
          await clearVkAuthExpired(campaignId);
        } catch (e: any) {
          log.error('[validate/vk] Ошибка при снятии authExpired:', e.message);
        }
      }

      // Причину отказа классифицируем и отдаём клиенту, чтобы он не гадал по
      // тексту. Главное различие — `severity`: временный сбой самого VK
      // (код 10 «could not check access_token now», флуд-контроль, 5xx, таймаут)
      // это не поломка подключения, и красным его показывать нельзя.
      const verdict = result.isValid ? null : classifyVkError(result.details);

      // Состояние переподключения отдаём явным полем — и это именно СОХРАНЁННОЕ
      // состояние кампании, а не исход текущей проверки. Раньше клиент выводил
      // плашку из `success === false` и поднимал «Требует переподключения» на
      // любой неудаче. Когда проверялся токен из body, сохранённого состояния
      // проверка не меняет — отдаём как есть.
      return res.json({
        success: result.isValid,
        message: verdict?.userMessage || result.message,
        // Технический текст VK оставляем отдельно — он нужен в поддержке,
        // но пользователю показывается `message`.
        rawMessage: result.message,
        authExpired,
        severity: verdict?.severity || 'success',
        retryable: verdict?.retryable ?? false,
        errorKind: verdict?.kind,
        vkErrorCode: verdict?.code,
        details: result.details
      });
    } catch (error) {
      log.error('Error validating VK token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // Instagram API Token validation
  app.post('/api/validate/instagram', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }
      
      log(`Валидация токена Instagram: [redacted len=${token.length}]`, 'api-validation');
      const result = await validateInstagramToken(token);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      log.error('Error validating Instagram token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // Facebook API Token validation
  app.post('/api/validate/facebook', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { token, pageId } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Токен не указан' });
      }
      
      log(`Валидация токена Facebook: [redacted]${pageId ? ` для страницы ${pageId}` : ''}`, 'api-validation');
      const result = await validateFacebookToken(token, pageId);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      log.error('Error validating Facebook token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  // YouTube API Key validation
  app.post('/api/validate/youtube', authenticateUser, async (req: Request, res: Response) => {
    try {
      const { apiKey, channelId } = req.body;
      if (!apiKey) {
        return res.status(400).json({ success: false, message: 'API ключ не указан' });
      }
      
      log(`Валидация API ключа YouTube: [redacted]${channelId ? ` для канала ${channelId}` : ''}`, 'api-validation');
      const result = await validateYoutubeApiKey(apiKey, channelId);
      
      return res.json({
        success: result.isValid,
        message: result.message,
        details: result.details
      });
    } catch (error) {
      log.error('Error validating YouTube API key:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Внутренняя ошибка сервера' 
      });
    }
  });

  log('API валидационные маршруты зарегистрированы', 'api-validation');
}
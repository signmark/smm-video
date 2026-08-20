/**
 * SM-41. Исход последней проверки связи, который переживает закрытие окна.
 *
 * Зачем. Метка «Настроено» отвечала на вопрос «поля заполнены», а живая проверка
 * связи жила только в состоянии открытого окна настроек и пропадала вместе с
 * ним. Поэтому страница кампании показывала зелёное «Соцсети настроены» рядом с
 * красным «Нет связи» — два ответа на разные вопросы, выглядящие как один.
 * Тестировщик нашёл это на Telegram, но живую проверку в SM-24 получил только
 * он: у остальных пяти площадок «Настроено» и сейчас означает лишь заполненность.
 *
 * Правило: исход проверки хранится рядом с настройками площадки (`lastCheck`),
 * а не в памяти окна. Проверка запускается только руками — сама при открытии
 * страницы она не идёт, иначе каждое открытие кампании стучится в шесть чужих
 * сервисов.
 *
 * Токены отсюда наружу не уходят: `checkPlatform` берёт их из сохранённых
 * настроек и возвращает только вердикт.
 */

import {
  validateTelegramConnection,
  validateTelegramToken,
  validateVkToken,
  validateInstagramToken,
  validateFacebookToken,
  validateYoutubeApiKey,
} from './social-api-validator';
import { pickPlatformToken } from './campaign-token-resolver';
import { threadsService } from './social-platforms/threads-service';
import axios from 'axios';

export const CHECKABLE_PLATFORMS = [
  'telegram',
  'vk',
  'instagram',
  'facebook',
  'youtube',
  'threads',
] as const;

export type CheckablePlatform = (typeof CHECKABLE_PLATFORMS)[number];

export interface ConnectionCheck {
  /** Когда проверяли — ISO. Без времени исход бесполезен: он стареет. */
  at: string;
  ok: boolean;
  /** Причина отказа человеческими словами. У успеха её нет. */
  reason?: string;
}

export function isCheckablePlatform(value: unknown): value is CheckablePlatform {
  return typeof value === 'string' && (CHECKABLE_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Читает сохранённый исход. Мусор и обрывки (нет времени, нет вердикта)
 * считаются отсутствием проверки: соврать «связь есть» хуже, чем сказать
 * «не проверяли».
 */
export function readConnectionCheck(platformSettings: any): ConnectionCheck | null {
  const raw = platformSettings?.lastCheck;
  if (!raw || typeof raw !== 'object') return null;
  const at = typeof raw.at === 'string' ? raw.at.trim() : '';
  if (!at || Number.isNaN(Date.parse(at))) return null;
  if (typeof raw.ok !== 'boolean') return null;
  const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : undefined;
  return reason ? { at, ok: raw.ok, reason } : { at, ok: raw.ok };
}

/**
 * Кладёт исход проверки в настройки площадки, не трогая ничего другого.
 * Чистая функция: настройки кампании — общий объект, и правка на месте здесь
 * уже приводила к тому, что в базу уезжало не то, что ожидали.
 */
export function withConnectionCheck(
  settings: Record<string, any> | null | undefined,
  platform: CheckablePlatform,
  check: ConnectionCheck,
): Record<string, any> {
  const base = settings && typeof settings === 'object' ? settings : {};
  const platformSettings = base[platform] && typeof base[platform] === 'object' ? base[platform] : {};
  return {
    ...base,
    [platform]: { ...platformSettings, lastCheck: check },
  };
}

/** Приводит разнобой вердиктов площадок к одному виду. */
function outcome(isValid: boolean, message?: string): { ok: boolean; reason?: string } {
  if (isValid) return { ok: true };
  const reason = (message || '').trim();
  return { ok: false, reason: reason || 'Площадка отказала без объяснения' };
}

/**
 * Живая проверка одной площадки по СОХРАНЁННЫМ настройкам.
 * Отказ одной площадки не должен ронять проверку остальных, поэтому наружу
 * летит вердикт, а не исключение.
 */
export async function checkPlatform(
  platform: CheckablePlatform,
  sms: Record<string, any>,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const p = sms?.[platform] || {};
    switch (platform) {
      case 'telegram': {
        const token = pickPlatformToken(sms, 'telegram');
        if (!token) return { ok: false, reason: 'Токен бота не сохранён' };
        const chatId = (p.chatId || p.chat_id || '').toString().trim();
        const res = chatId
          ? await validateTelegramConnection(token, chatId)
          : await validateTelegramToken(token);
        return outcome(res.isValid, res.message);
      }
      case 'vk': {
        const token = pickPlatformToken(sms, 'vk');
        if (!token) return { ok: false, reason: 'Токен ВК не сохранён' };
        const res = await validateVkToken(token, (p.groupId || p.group_id || '').toString() || undefined);
        return outcome(res.isValid, res.message);
      }
      case 'instagram': {
        const token = pickPlatformToken(sms, 'instagram');
        if (!token) return { ok: false, reason: 'Доступ к Instagram не сохранён' };
        const res = await validateInstagramToken(token);
        return outcome(res.isValid, res.message);
      }
      case 'facebook': {
        const token = pickPlatformToken(sms, 'facebook');
        if (!token) return { ok: false, reason: 'Доступ к Facebook не сохранён' };
        const res = await validateFacebookToken(token, (p.pageId || p.page_id || '').toString() || undefined);
        return outcome(res.isValid, res.message);
      }
      case 'youtube': {
        const apiKey = (p.apiKey || p.api_key || '').toString().trim();
        if (!apiKey) return { ok: false, reason: 'Ключ YouTube не сохранён' };
        const res = await validateYoutubeApiKey(apiKey, (p.channelId || p.channel_id || '').toString() || undefined);
        return outcome(res.isValid, res.message);
      }
      case 'threads': {
        const token = pickPlatformToken(sms, 'threads');
        if (!token) return { ok: false, reason: 'Доступ к Threads не сохранён' };
        const res = await threadsService.validateToken({
          accessToken: token,
          userId: p.threadsUserId || p.threads_user_id,
        } as any);
        return outcome(res.isValid, res.error);
      }
    }
  } catch (err: any) {
    // Проверка сорвалась у нас, а не у площадки. Это тоже честный ответ —
    // молчание было бы хуже.
    return { ok: false, reason: (err?.message || '').trim() || 'Проверка не удалась' };
  }
}


/**
 * Какие площадки вообще есть смысл проверять: у которых сохранены доступы.
 * Пустую площадку не проверяем и исход ей не пишем — «не настроено» и «связи
 * нет» это разные вещи, и путать их нельзя.
 */
export function platformsWithCredentials(sms: Record<string, any>): CheckablePlatform[] {
  return CHECKABLE_PLATFORMS.filter((platform) => {
    if (platform === 'youtube') {
      const p = sms?.youtube || {};
      return Boolean((p.apiKey || p.api_key || '').toString().trim());
    }
    return Boolean(pickPlatformToken(sms, platform as any));
  });
}

/**
 * Проверяет все площадки с сохранёнными доступами и возвращает исходы.
 * Проверки идут параллельно и независимо: отказ одной не должен лишать
 * человека ответа про остальные.
 */
export async function checkAllPlatforms(
  sms: Record<string, any>,
  nowIso: string,
): Promise<Record<string, ConnectionCheck>> {
  const platforms = platformsWithCredentials(sms);
  const outcomes = await Promise.all(platforms.map((p) => checkPlatform(p, sms)));
  const result: Record<string, ConnectionCheck> = {};
  platforms.forEach((platform, i) => {
    const o = outcomes[i];
    result[platform] = o.ok ? { at: nowIso, ok: true } : { at: nowIso, ok: false, reason: o.reason };
  });
  return result;
}

/**
 * Кладёт исходы в social_media_settings кампании. Читаем прямо перед записью:
 * между проверкой и записью человек мог сохранить настройки, и затирать их
 * своей копией нельзя.
 */
export async function persistConnectionChecks(
  campaignId: string,
  checks: Record<string, ConnectionCheck>,
): Promise<void> {
  const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
  const directusUrl = process.env.DIRECTUS_URL;
  if (!adminToken || !directusUrl) return;

  const resp = await axios.get(`${directusUrl}/items/user_campaigns/${campaignId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  let settings = resp.data?.data?.social_media_settings || {};
  for (const [platform, check] of Object.entries(checks)) {
    if (isCheckablePlatform(platform)) settings = withConnectionCheck(settings, platform, check);
  }

  await axios.patch(
    `${directusUrl}/items/user_campaigns/${campaignId}`,
    { social_media_settings: settings },
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
}

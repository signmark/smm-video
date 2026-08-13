/**
 * Единственный источник правды: подключена ли платформа у кампании.
 *
 * Правило из `.agents/memory/oauth-sanitizer-contract.md`, п.1 — статус считается
 * ТОЛЬКО по несекретным полям. Токены вырезает `sanitizeOAuthSecrets`, в браузер
 * они не приходят, и проверка вида `!!settings.instagram.accessToken` всегда даёт
 * false независимо от того, настроена платформа или нет.
 *
 * На эти грабли наступали дважды: сначала пропали бейджи «Настроено» в настройках
 * кампании, потом — в панели публикации, где Instagram, YouTube и Threads вечно
 * показывались неподключёнными при полностью рабочих настройках. Поэтому логика
 * вынесена в одно место: расходиться больше нечему.
 *
 * Несекретные признаки по платформам:
 *   telegram  — chatId
 *   vk        — groupId
 *   facebook  — pageId
 *   youtube   — channelId
 *   threads   — threadsUserId
 *   instagram — businessAccountId / instagramId / серверный флаг configured
 */

export const CONNECTABLE_PLATFORMS = [
  'instagram',
  'telegram',
  'vk',
  'facebook',
  'youtube',
  'threads',
] as const;

export type ConnectablePlatform = (typeof CONNECTABLE_PLATFORMS)[number];

/**
 * Канонический список литеральных названий для каждой платформы.
 *
 * Должен совпадать с `PLATFORM_NAMES_RU` в `server/services/social-prompt.ts`
 * — единый источник правды для разбора промта и подстановки. Этот файл —
 * client-side mirror; если добавится новая платформа, обновить в обоих
 * местах и убедиться, что parity-test (общий источник) зелёный.
 */
export const PLATFORM_NAMES_RU: Record<ConnectablePlatform, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  threads: 'Threads',
};

/** Directus иногда отдаёт JSON строкой — разбираем, прежде чем читать поля. */
export function parseSocialSettings(raw: unknown): Record<string, any> | null {
  let settings: unknown = raw;
  if (typeof raw === 'string') {
    try {
      settings = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  return settings as Record<string, any>;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : !!value;
}

/** Подключена ли одна платформа. Секретные поля не читаются принципиально. */
export function isPlatformConnected(
  settings: Record<string, any> | null | undefined,
  platform: ConnectablePlatform,
): boolean {
  if (!settings) return false;
  const p = settings[platform];
  if (!p || typeof p !== 'object') return false;

  switch (platform) {
    case 'telegram':
      // SM-24: Must have chatId AND a working token. The sanitiser
      // strips real token values and exposes only hasToken boolean —
      // so check hasToken first (what actually arrives in the browser).
      // Fallback to nonEmpty(p.token) for unsanitised callers (API/migration).
      return (nonEmpty(p.chatId) || nonEmpty(p.chat_id)) && (p.hasToken === true || nonEmpty(p.token));
    case 'vk':
      return nonEmpty(p.groupId) || nonEmpty(p.group_id);
    case 'facebook':
      return nonEmpty(p.pageId) || nonEmpty(p.page_id);
    case 'youtube':
      return nonEmpty(p.channelId) || nonEmpty(p.channel_id);
    case 'threads':
      return nonEmpty(p.threadsUserId) || nonEmpty(p.threads_user_id);
    case 'instagram':
      return (
        p.configured === true ||
        nonEmpty(p.businessAccountId) ||
        nonEmpty(p.business_account_id) ||
        nonEmpty(p.instagramId) ||
        nonEmpty(p.instagram_id)
      );
    default:
      return false;
  }
}

/**
 * Карта «платформа → подключена» для панели выбора платформ.
 * `null` означает «настройки ещё не загружены» — вызывающий не должен в этом
 * случае показывать платформы отключёнными, иначе морда соврёт на полсекунды
 * загрузки.
 */
export function getConnectedPlatformsMap(
  rawSettings: unknown,
): Record<ConnectablePlatform, boolean> | null {
  const settings = parseSocialSettings(rawSettings);
  if (!settings) return null;

  return CONNECTABLE_PLATFORMS.reduce((acc, platform) => {
    acc[platform] = isPlatformConnected(settings, platform);
    return acc;
  }, {} as Record<ConnectablePlatform, boolean>);
}

/**
 * SM-18: какие соцсети упомянуты в промте вручную и при этом НЕ подключены у
 * кампании. По этому списку под полем промта показывается предупреждение.
 *
 * Разбор текста здесь не свой: и список названий, и правило отрицания берутся
 * из `@shared/social-platform-names` — того же модуля, которым сервер
 * подставляет `[socialNetworks]`. Пока у клиента был свой список, он молча
 * разошёлся с серверным (не знал `TikTok` и алиас `VK`), и предупреждение не
 * появлялось там, где сервер название прекрасно видел.
 *
 * Критерии SM-18:
 *  1. тот же список литеральных названий, что и у
 *     `normalizePlatformMentionsToPlaceholder` — общий источник, не копия;
 *  2. отрицающий контекст («не использовать Facebook») предупреждение не вызывает;
 *  3. перечисляются только сети, упомянутые положительно И не подключённые.
 */

import {
  findPositivePlatformMentions,
  type PlatformKey,
} from '@shared/social-platform-names';
import { CONNECTABLE_PLATFORMS, type ConnectablePlatform } from './platform-connection';

export { findPositivePlatformMentions, isNegatedBefore } from '@shared/social-platform-names';

/**
 * Платформы, про подключение которых клиент вообще может судить.
 *
 * TikTok сюда не входит осознанно: он поддержан на сервере, но намеренно не
 * предлагается в интерфейсе публикации (`safeSocialPlatforms`), настроек в
 * кампании у него нет, и `isPlatformConnected` всегда вернул бы false. Молчать
 * про TikTok — решение, а не забывчивость: иначе пользователь получал бы вечное
 * «TikTok не подключён» про сеть, которую подключить в интерфейсе негде.
 */
function isClientCheckable(key: PlatformKey): key is ConnectablePlatform {
  return (CONNECTABLE_PLATFORMS as readonly string[]).includes(key);
}

/**
 * Сети, упомянутые в промте положительно и не подключённые у кампании.
 *
 * `isConnected` принимает идентификатор платформы, а не её отображаемое имя:
 * сравнение по человекочитаемым строкам ломается от любой правки подписи в
 * интерфейсе, причём молча — предупреждение просто перестаёт исчезать.
 */
export function extractUnconnectedMentions(params: {
  prompt: string;
  isConnected: (platform: ConnectablePlatform) => boolean;
}): ConnectablePlatform[] {
  return findPositivePlatformMentions(params.prompt)
    .filter(isClientCheckable)
    .filter((platform) => !params.isConnected(platform));
}

/** Только упоминания, без учёта подключений — для тестов и отладки. */
export function extractPlatformMentions(text: string): PlatformKey[] {
  return findPositivePlatformMentions(text);
}

/**
 * Связка «кампания → канал в Analytics API».
 *
 * Ключевой момент: analyticsChannelId сохраняется в кампании лениво — только когда
 * кто-то откроет раздел Аналитика. Поэтому фоновый наблюдатель дополнительно
 * сопоставляет каналы кампании с уже заведёнными в мониторинге. Регистрировать
 * новые каналы отсюда нельзя — это запускает парсинг за 30 дней на той стороне.
 */
import { describe, it, expect } from 'vitest';
import {
  getCampaignAnalyticsChannels,
  buildMonitoredChannelIndex,
  parseSocialSettings,
} from '../services/campaign-analytics-channels';

const MONITORED = buildMonitoredChannelIndex([
  { id: 'uuid-tg', platform: 'telegram', platform_channel_id: '@my_channel' },
  { id: 'uuid-vk', platform: 'vk', platform_channel_id: '-12345' },
]);

describe('getCampaignAnalyticsChannels — сохранённый UUID', () => {
  it('берёт analyticsChannelId, если он уже записан', () => {
    const channels = getCampaignAnalyticsChannels({
      telegram: { chatId: '@my_channel', analyticsChannelId: 'uuid-saved' },
    });
    expect(channels).toEqual([{ platform: 'telegram', channelId: 'uuid-saved' }]);
  });

  it('сохранённый UUID приоритетнее индекса мониторинга', () => {
    const channels = getCampaignAnalyticsChannels({
      telegram: { chatId: '@my_channel', analyticsChannelId: 'uuid-saved' },
    }, MONITORED);
    expect(channels).toEqual([{ platform: 'telegram', channelId: 'uuid-saved' }]);
  });

  it('читает social_media_settings, пришедшие строкой из Directus', () => {
    const channels = getCampaignAnalyticsChannels(
      JSON.stringify({ vk: { analyticsChannelId: 'uuid-vk-saved' } }),
    );
    expect(channels).toEqual([{ platform: 'vk', channelId: 'uuid-vk-saved' }]);
  });
});

describe('getCampaignAnalyticsChannels — доузнавание через мониторинг', () => {
  it('находит UUID по @username Telegram, когда analyticsChannelId ещё не сохранён', () => {
    const channels = getCampaignAnalyticsChannels({ telegram: { chatId: '@my_channel' } }, MONITORED);
    expect(channels).toEqual([{ platform: 'telegram', channelId: 'uuid-tg' }]);
  });

  it('добавляет @ к username без собаки', () => {
    const channels = getCampaignAnalyticsChannels({ telegram: { username: 'my_channel' } }, MONITORED);
    expect(channels).toEqual([{ platform: 'telegram', channelId: 'uuid-tg' }]);
  });

  it('находит UUID по числовому groupId ВКонтакте', () => {
    const channels = getCampaignAnalyticsChannels({ vk: { groupId: '-12345' } }, MONITORED);
    expect(channels).toEqual([{ platform: 'vk', channelId: 'uuid-vk' }]);
  });

  it('канала нет в мониторинге — молчим, а не регистрируем новый', () => {
    const channels = getCampaignAnalyticsChannels({ telegram: { chatId: '@unknown' } }, MONITORED);
    expect(channels).toEqual([]);
  });

  it('приватный числовой chatId Telegram не сопоставляется: у него нет публичного имени', () => {
    const channels = getCampaignAnalyticsChannels({ telegram: { chatId: '-1001234567' } }, MONITORED);
    expect(channels).toEqual([]);
  });

  it('без индекса возвращает только сохранённые UUID', () => {
    expect(getCampaignAnalyticsChannels({ telegram: { chatId: '@my_channel' } })).toEqual([]);
  });

  it('обе площадки сразу', () => {
    const channels = getCampaignAnalyticsChannels(
      { telegram: { chatId: '@my_channel' }, vk: { groupId: '-12345' } },
      MONITORED,
    );
    expect(channels).toHaveLength(2);
    expect(channels.map(c => c.channelId).sort()).toEqual(['uuid-tg', 'uuid-vk']);
  });
});

describe('parseSocialSettings / buildMonitoredChannelIndex', () => {
  it('битый JSON не роняет разбор', () => {
    expect(parseSocialSettings('{не json')).toEqual({});
    expect(parseSocialSettings(null)).toEqual({});
    expect(parseSocialSettings(42)).toEqual({});
  });

  it('индекс пропускает записи без обязательных полей', () => {
    const index = buildMonitoredChannelIndex([
      { id: 'ok', platform: 'vk', platform_channel_id: '-1' },
      { id: '', platform: 'vk', platform_channel_id: '-2' } as any,
      { id: 'x', platform: '', platform_channel_id: '-3' } as any,
    ]);
    expect(index.size).toBe(1);
    expect(index.get('vk:-1')).toBe('ok');
  });
});

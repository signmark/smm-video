/**
 * SM-15: поиск соседних кампаний того же канала.
 *
 * Ошибиться здесь дороже всего: приписать кампании чужой канал значит показать
 * человеку чужие цифры под именем его кампании. Поэтому сравнение
 * идентификаторов проверяется отдельно от всего остального.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeChannelKey,
  campaignSharesChannel,
  collectSiblingCampaigns,
} from '../services/analytics-siblings';

describe('SM-15: один и тот же канал записан по-разному', () => {
  it('Telegram: @имя, имя и ссылка — это один канал', () => {
    const forms = ['@my_channel', 'my_channel', 'https://t.me/my_channel', 'HTTPS://T.ME/My_Channel/'];
    const keys = forms.map(form => normalizeChannelKey('telegram', form));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('my_channel');
  });

  it('VK: club123, -123 и 123 — одна группа', () => {
    const keys = ['club123', '-123', '123'].map(form => normalizeChannelKey('vk', form));
    expect(new Set(keys).size).toBe(1);
  });

  it('пустое значение каналом не считается', () => {
    expect(normalizeChannelKey('telegram', '  ')).toBe('');
    expect(normalizeChannelKey('vk', null)).toBe('');
  });
});

describe('SM-15: кампания ведёт тот же канал', () => {
  const target = { platform: 'telegram' as const, platformId: '@my_channel', scraperChannelId: 'ch-1' };

  it('совпал идентификатор скрейпера — тот же канал', () => {
    expect(campaignSharesChannel({ telegram: { analyticsChannelId: 'ch-1' } }, target)).toBe(true);
  });

  it('совпало имя канала в другой записи — тот же канал', () => {
    expect(campaignSharesChannel({ telegram: { chatId: 'my_channel' } }, target)).toBe(true);
  });

  it('другой канал не считается своим', () => {
    expect(campaignSharesChannel({ telegram: { chatId: '@other' } }, target)).toBe(false);
  });

  it('пустые настройки — не совпадение, а не «совпало со всем»', () => {
    expect(campaignSharesChannel({}, target)).toBe(false);
    expect(campaignSharesChannel(null, target)).toBe(false);
  });

  it('канал другой площадки не путается с этим', () => {
    expect(campaignSharesChannel({ vk: { groupId: 'my_channel' } }, target)).toBe(false);
  });
});

describe('SM-15: сбор соседних кампаний', () => {
  const target = { platform: 'telegram' as const, platformId: '@my_channel', scraperChannelId: 'ch-1' };

  it('берёт только кампании этого канала и только с публикациями за период', () => {
    const listCandidates = vi.fn(async () => [
      { id: 'a', name: 'Осенняя', social_media_settings: { telegram: { chatId: '@my_channel' } } },
      { id: 'b', name: 'Чужая', social_media_settings: { telegram: { chatId: '@other' } } },
      { id: 'c', name: 'Тот же канал, но молчала', social_media_settings: { telegram: { analyticsChannelId: 'ch-1' } } },
    ]);
    const publishedIdsOf = vi.fn(async (id: string) => (id === 'a' ? new Set(['70']) : new Set<string>()));

    return collectSiblingCampaigns(target, { listCandidates, publishedIdsOf }).then(siblings => {
      expect(siblings.map(s => s.campaignId)).toEqual(['a']);
      expect(publishedIdsOf).not.toHaveBeenCalledWith('b');
    });
  });

  it('настройки строкой JSON разбираются, а не отбрасываются', async () => {
    const listCandidates = vi.fn(async () => [
      { id: 'a', name: 'Осенняя', social_media_settings: JSON.stringify({ telegram: { chatId: '@my_channel' } }) },
    ]);
    const publishedIdsOf = vi.fn(async () => new Set(['70']));

    const siblings = await collectSiblingCampaigns(target, { listCandidates, publishedIdsOf });

    expect(siblings).toHaveLength(1);
  });

  it('сломанное чтение кампаний не роняет аналитику — просто нет разложения', async () => {
    const onError = vi.fn();
    const siblings = await collectSiblingCampaigns(
      target,
      {
        listCandidates: async () => { throw new Error('directus 503'); },
        publishedIdsOf: async () => new Set(['70']),
      },
      onError,
    );

    expect(siblings).toEqual([]);
    expect(onError).toHaveBeenCalled();
  });

  it('сбой по одной соседней кампании не отменяет остальных', async () => {
    const listCandidates = async () => [
      { id: 'bad', name: 'Сломанная', social_media_settings: { telegram: { chatId: '@my_channel' } } },
      { id: 'good', name: 'Рабочая', social_media_settings: { telegram: { chatId: '@my_channel' } } },
    ];
    const publishedIdsOf = async (id: string) => {
      if (id === 'bad') throw new Error('timeout');
      return new Set(['70']);
    };

    const siblings = await collectSiblingCampaigns(target, { listCandidates, publishedIdsOf });

    expect(siblings.map(s => s.campaignId)).toEqual(['good']);
  });

  it('кампания без имени всё равно называется — пустое имя в подсказке хуже условного', async () => {
    const siblings = await collectSiblingCampaigns(target, {
      listCandidates: async () => [{ id: 'a', social_media_settings: { telegram: { chatId: '@my_channel' } } }],
      publishedIdsOf: async () => new Set(['70']),
    });

    expect(siblings[0].name).toBe('Без названия');
  });
});

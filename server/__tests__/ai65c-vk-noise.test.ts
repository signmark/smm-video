/**
 * AI-65, этап 5: VK-мониторинг перестаёт кричать про каждую кампанию.
 *
 * ЧТО БЫЛО НЕ ТАК. Крон писал предупреждение на КАЖДУЮ кампанию с разорванной
 * связью, каждые полчаса. Замер на проде: 17 предупреждений за прогон, 34 в
 * час, бесконечно — про кампании, которые никто не собирается переподключать.
 * От такого потока уровень «предупреждение» перестаёт что-либо значить:
 * настоящую проблему в нём не видно. Ровно этим и был опасен шум, а не объёмом.
 *
 * ЧТО СДЕЛАНО. Разбор состояния вынесен в чистую функцию (внутрь крона из
 * теста не дотянуться), подробности по кампаниям ушли на отладку, наверх
 * поднимается одна строка с числом.
 *
 * Три состояния намеренно разделены, их легко перепутать:
 *   нет токена       — VK не подключали вовсе, делать нечего;
 *   связь разорвана  — токен есть, но VK его больше не принимает;
 *   истекает         — токен жив, но обновление не сработало, это срочно.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyVkCampaigns, EXPIRING_SOON_MINUTES } from '../utils/vk-token-status';

const NOW = new Date('2026-08-17T18:00:00.000Z').getTime();

function campaign(id: string, vk: Record<string, any> | null) {
  return { id, name: `Кампания ${id}`, social_media_settings: vk ? { vk } : {} };
}

describe('AI-65: разбор состояния VK-токенов', () => {
  it('кампания без токена не считается ни живой, ни сломанной', () => {
    const s = classifyVkCampaigns([campaign('c1', null), campaign('c2', {})], NOW);
    expect(s).toMatchObject({ active: 0, noToken: 2 });
    expect(s.expired).toEqual([]);
  });

  it('разорванная связь попадает в список поимённо', () => {
    const s = classifyVkCampaigns(
      [campaign('c1', { accessToken: 't', authExpired: true }), campaign('c2', { token: 't', authExpired: true })],
      NOW,
    );
    expect(s.expired).toEqual(['c1', 'c2']);
    expect(s.active).toBe(0);
  });

  it('живой токен с далёким сроком — просто активная кампания', () => {
    const far = new Date(NOW + 5 * 60 * 60 * 1000).toISOString();
    const s = classifyVkCampaigns([campaign('c1', { accessToken: 't', tokenExpiresAt: far })], NOW);
    expect(s.active).toBe(1);
    expect(s.expiringSoon).toEqual([]);
  });

  it('токен на исходе отмечается отдельно и остаётся активным', () => {
    const soon = new Date(NOW + 10 * 60 * 1000).toISOString();
    const s = classifyVkCampaigns([campaign('c1', { accessToken: 't', tokenExpiresAt: soon })], NOW);
    expect(s.active).toBe(1);
    expect(s.expiringSoon).toEqual([{ id: 'c1', minutesLeft: 10 }]);
  });

  it('граница «на исходе» ровно там, где заявлена', () => {
    const at = new Date(NOW + EXPIRING_SOON_MINUTES * 60 * 1000).toISOString();
    expect(classifyVkCampaigns([campaign('c1', { accessToken: 't', tokenExpiresAt: at })], NOW).expiringSoon)
      .toEqual([]);
    const justBefore = new Date(NOW + (EXPIRING_SOON_MINUTES - 1) * 60 * 1000).toISOString();
    expect(classifyVkCampaigns([campaign('c1', { accessToken: 't', tokenExpiresAt: justBefore })], NOW).expiringSoon)
      .toHaveLength(1);
  });

  it('уже просроченный по времени токен даёт отрицательный остаток, а не молчание', () => {
    const past = new Date(NOW - 60 * 60 * 1000).toISOString();
    const s = classifyVkCampaigns([campaign('c1', { accessToken: 't', tokenExpiresAt: past })], NOW);
    expect(s.expiringSoon[0].minutesLeft).toBe(-60);
  });

  it('битая дата срока не роняет разбор и не выдумывает срочность', () => {
    const s = classifyVkCampaigns([campaign('c1', { accessToken: 't', tokenExpiresAt: 'не дата' })], NOW);
    expect(s.active).toBe(1);
    expect(s.expiringSoon).toEqual([]);
  });

  it('пустой и отсутствующий список не ломают разбор', () => {
    expect(classifyVkCampaigns([], NOW)).toMatchObject({ active: 0, noToken: 0 });
    expect(classifyVkCampaigns(undefined as any, NOW)).toMatchObject({ active: 0, noToken: 0 });
  });

  it('боевой расклад: 3 живых, 17 разорванных — счёт сходится', () => {
    const list = [
      ...Array.from({ length: 3 }, (_, i) => campaign(`live-${i}`, { accessToken: 't' })),
      ...Array.from({ length: 17 }, (_, i) => campaign(`dead-${i}`, { accessToken: 't', authExpired: true })),
    ];
    const s = classifyVkCampaigns(list, NOW);
    expect(s.active).toBe(3);
    expect(s.expired).toHaveLength(17);
  });
});

describe('AI-65: сторож шума в кроне', () => {
  const index = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

  it('подробности по кампании больше не предупреждение', () => {
    expect(index).not.toMatch(/authExpired=true, требует переподключения`, 'vk-cron', 'warn'/);
    expect(index).toMatch(/связь с VK разорвана[^`]*`, 'vk-cron', 'debug'/);
  });

  it('наверх идёт одна строка с числом, а не строка на кампанию', () => {
    expect(index).toMatch(/logEvent\(\s*'vk\.tokens_expired'/);
  });

  it('истекающий токен по-прежнему называется поимённо — он срочный и редкий', () => {
    expect(index).toMatch(/токен истекает через \$\{soon\.minutesLeft\} мин`, 'vk-cron', 'warn'/);
  });
});

/**
 * task #81 follow-up (после REJECT замера #82): red-before/грин на две правки.
 *
 * 1. Возврат/remount не должен форсить refetch контента: эффект монтирования
 *    (тот, что с setContentLimit) в content/index.tsx больше НЕ содержит
 *    `refetchQueries` по campaign-content.
 * 2. Оба потребителя карточки кампании сведены на один `useCampaignDetail`;
 *    ключ `["/api/proxy/campaign", id]` больше не используется в живых
 *    queryKey/invalidate пути (только упоминание в поясняющем комментарии).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTENT_SRC = readFileSync(resolve(__dirname, '../../pages/content/index.tsx'), 'utf8');
const DETAIL_SRC = readFileSync(resolve(__dirname, '../../pages/campaigns/[id].tsx'), 'utf8');

describe('task #81: возврат/remount не форсит refetch контента (правка B)', () => {
  it('эффект с setContentLimit не содержит refetchQueries по campaign-content', () => {
    // Вырезаем тело эффекта: от строки с setContentLimit назад до useEffect,
    // и проверяем, что refetchQueries по campaign-content рядом нет.
    const setLimitIdx = CONTENT_SRC.indexOf('setContentLimit(CONTENT_PAGE_SIZE)');
    expect(setLimitIdx).toBeGreaterThanOrEqual(0);

    // Ищем ближайшее появление refetchQueries по campaign-content ПОСЛЕ точки,
    // где раньше был форс (внутри эффекта). Проще: берём окно вокруг setContentLimit
    // и ближайший useEffect до него.
    const effectStart = CONTENT_SRC.lastIndexOf('useEffect(() => {', setLimitIdx);
    expect(effectStart).toBeGreaterThanOrEqual(0);
    const effectEnd = CONTENT_SRC.indexOf('}, [selectedCampaignId]);', effectStart);
    const effectBody = CONTENT_SRC.slice(effectStart, effectEnd);

    expect(effectBody).not.toContain('refetchQueries');
    expect(effectBody).toContain('setContentLimit(CONTENT_PAGE_SIZE)');
    expect(effectBody).toContain('invalidateQueries({ queryKey: ["/api/keywords", selectedCampaignId] })');
  });
});

describe('task #81: оба потребителя карточки на одном useCampaignDetail (правка 2)', () => {
  it('campaigns/[id].tsx читает карточку через useCampaignDetail', () => {
    expect(DETAIL_SRC).toContain('useCampaignDetail(id)');
  });

  it('живой queryKey /api/proxy/campaign больше не используется', () => {
    // В поясняющем комментарии строка ['/api/proxy/campaign', id] остаётся,
    // поэтому проверяем именно использование в queryKey/invalidate, а не любой текст.
    expect(DETAIL_SRC).not.toContain('queryKey: ["/api/proxy/campaign", id]');
  });

  it('инвалидация карточки идёт по campaignDetailKey', () => {
    expect(DETAIL_SRC).toContain('queryKey: campaignDetailKey(id)');
  });
});

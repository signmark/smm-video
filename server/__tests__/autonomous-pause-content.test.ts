/**
 * SM-20, фаза 2 (B). Что здесь сторожится и почему именно это.
 *
 * Тестировщик поймал на проде: пауза гасит таймеры, а уже запланированные посты
 * выходят сами. Правка снимает их с очереди — и ровно здесь легко наделать
 * гораздо худшей беды, чем та, которую чинишь: снять чужое, откатить то, что уже
 * публикуется, или отчитаться «готово», когда половина не прошла.
 *
 * Поэтому проверяется не «функция работает», а каждый способ навредить.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  demoteRunScheduledContent,
  demotionOutcome,
  ownedSlots,
  platformsOf,
  emptyCounts,
  type CycleSlotRow,
  type DemotionDeps,
} from '../services/autonomous-pause-content';

const OWNER = { runId: 'run-1', campaignId: 'camp-1', userId: 'user-1' };

function slot(over: Partial<CycleSlotRow> = {}): CycleSlotRow {
  return {
    itemKey: 'run-1:cycle-1:0',
    itemIndex: 0,
    cycleId: 'cycle-1',
    campaignId: 'camp-1',
    userId: 'user-1',
    state: 'filled',
    contentId: 'content-1',
    ...over,
  };
}

function deps(over: Partial<DemotionDeps> = {}): DemotionDeps {
  return {
    listRunSlots: vi.fn(async () => [slot()]),
    readContent: vi.fn(async () => [{ id: 'content-1', status: 'scheduled', social_platforms: { telegram: {} } }]),
    acquireLocks: vi.fn(async () => true),
    releaseLocks: vi.fn(async () => {}),
    demote: vi.fn(async () => 1),
    consume: vi.fn(async () => true),
    ...over,
  };
}

describe('принадлежность запуску', () => {
  it('ручная публикация недостижима: у неё нет строки в реестре', () => {
    // Реестр — единственный источник. Ручной пост в него не попадает вовсе,
    // поэтому отбирать нечего и никакой фильтр по нему не промахнётся.
    expect(ownedSlots([], OWNER)).toEqual([]);
  });

  it('чужой арендатор не берётся, даже если запуск совпал', () => {
    const foreign = [
      slot({ campaignId: 'camp-2' }),
      slot({ userId: 'user-2', itemKey: 'run-1:cycle-1:1', itemIndex: 1 }),
    ];

    expect(ownedSlots(foreign, OWNER)).toEqual([]);
  });

  it('слот без созданной публикации пропускается', () => {
    expect(ownedSlots([slot({ state: 'reserved', contentId: null })], OWNER)).toEqual([]);
  });

  it('уже закрытый слот второй раз не берётся', () => {
    expect(ownedSlots([slot({ state: 'consumed' }), slot({ state: 'tombstone' })], OWNER)).toEqual([]);
  });

  it('свой слот берётся с идентификатором публикации', () => {
    expect(ownedSlots([slot()], OWNER)).toEqual([
      { itemKey: 'run-1:cycle-1:0', itemIndex: 0, cycleId: 'cycle-1', contentId: 'content-1' },
    ]);
  });
});

describe('перевод очереди в черновики', () => {
  it('своя запланированная публикация снимается и слот закрывается', async () => {
    const d = deps();
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.demoted).toBe(1);
    expect(counts.contested).toBe(0);
    expect(d.demote).toHaveBeenCalledWith('content-1');
    expect(d.consume).toHaveBeenCalledOnce();
  });

  it('просроченная снимается так же, как будущая', async () => {
    // Отдельного условия по времени нет намеренно: просроченная стоит в той же
    // очереди и вышла бы первой же проходкой планировщика.
    const d = deps({
      readContent: vi.fn(async () => [
        { id: 'content-1', status: 'scheduled', social_platforms: { telegram: {} } },
      ]),
    });

    expect((await demoteRunScheduledContent(OWNER, d)).demoted).toBe(1);
  });

  it('уже опубликованную не откатываем', async () => {
    const d = deps({
      readContent: vi.fn(async () => [{ id: 'content-1', status: 'published' }]),
    });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.skipped).toBe(1);
    expect(counts.demoted).toBe(0);
    expect(d.demote).not.toHaveBeenCalled();
    expect(d.consume).not.toHaveBeenCalled();
  });

  it('удалённую публикацию не воскрешаем и слот не трогаем', async () => {
    // Слот удалённой записи обязан остаться нетронутым: на нём держится
    // правило «удалённое не создаём заново».
    const d = deps({ readContent: vi.fn(async () => []) });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.skipped).toBe(1);
    expect(d.consume).not.toHaveBeenCalled();
  });

  it('публикацию, которую уже взял публикатор, оставляем в покое', async () => {
    const d = deps({ acquireLocks: vi.fn(async () => false) });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.busy).toBe(1);
    expect(counts.demoted).toBe(0);
    expect(d.demote).not.toHaveBeenCalled();
    expect(d.consume).not.toHaveBeenCalled();
  });

  it('блокировка снимается и тогда, когда перевод не удался', async () => {
    const d = deps({ demote: vi.fn(async () => { throw new Error('directus упал'); }) });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.failed).toBe(1);
    expect(d.releaseLocks).toHaveBeenCalledWith('content-1');
  });

  it('ноль изменённых строк не выдаётся за успех', async () => {
    // Публикация была подходящей при чтении, а к моменту записи её увели.
    const d = deps({ demote: vi.fn(async () => 0) });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.contested).toBe(1);
    expect(counts.demoted).toBe(0);
    expect(d.consume).not.toHaveBeenCalled();
  });

  it('недоступный реестр — отказ, а не пустой успех', async () => {
    const d = deps({ listRunSlots: vi.fn(async () => null) });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.failed).toBe(1);
    expect(counts.owned).toBe(0);
    expect(d.readContent).not.toHaveBeenCalled();
  });

  it('повтор после прерывания дозакрывает слот, но не публикует и не трогает чужое', async () => {
    // Прошлый раз успел перевести публикацию в черновик и упал до закрытия
    // слота. Повтор обязан закончить работу, а не начать её заново.
    const d = deps({
      readContent: vi.fn(async () => [{ id: 'content-1', status: 'draft' }]),
    });
    const counts = await demoteRunScheduledContent(OWNER, d);

    expect(counts.reconciled).toBe(1);
    expect(counts.eligible).toBe(0);
    expect(d.demote).not.toHaveBeenCalled();
    expect(d.acquireLocks).not.toHaveBeenCalled();
    expect(d.consume).toHaveBeenCalledOnce();
  });

  it('повторный вызов подряд ничего не меняет во второй раз', async () => {
    let status = 'scheduled';
    const d = deps({
      readContent: vi.fn(async () => [{ id: 'content-1', status }]),
      demote: vi.fn(async () => { status = 'draft'; return 1; }),
    });

    const first = await demoteRunScheduledContent(OWNER, d);
    const second = await demoteRunScheduledContent(OWNER, d);

    expect(first.demoted).toBe(1);
    expect(second.demoted).toBe(0);
    expect(second.reconciled).toBe(1);
    expect(d.demote).toHaveBeenCalledOnce();
  });

  it('чужой запуск в том же ответе реестра не задевается', async () => {
    const d = deps({
      listRunSlots: vi.fn(async () => [
        slot(),
        slot({ itemKey: 'run-2:cycle-9:0', campaignId: 'camp-2', contentId: 'foreign-1' }),
      ]),
    });
    await demoteRunScheduledContent(OWNER, d);

    expect(d.readContent).toHaveBeenCalledWith(['content-1']);
    expect(d.demote).not.toHaveBeenCalledWith('foreign-1');
  });
});

describe('площадки для блокировки', () => {
  it('берутся все площадки записи', () => {
    expect(platformsOf({ telegram: {}, vk: {} })).toEqual(['telegram', 'vk']);
  });

  it('мусор вместо набора площадок не роняет паузу', () => {
    expect(platformsOf(null)).toEqual([]);
    expect(platformsOf('строка')).toEqual([]);
    expect(platformsOf(['telegram'])).toEqual([]);
  });
});

describe('итог команды', () => {
  it('нечего снимать — это успех, а не ошибка', () => {
    const result = demotionOutcome(emptyCounts());

    expect(result.success).toBe(true);
    expect(result.conflicts).toBe(0);
    expect(result.message).toContain('не было');
  });

  it('спорная строка отличается от «нечего снимать»', () => {
    const result = demotionOutcome({ ...emptyCounts(), owned: 1, eligible: 1, contested: 1 });

    expect(result.success).toBe(false);
    expect(result.conflicts).toBe(1);
  });

  it('идущая публикация тоже не выдаётся за полный успех', () => {
    const result = demotionOutcome({ ...emptyCounts(), owned: 2, eligible: 2, demoted: 1, busy: 1 });

    expect(result.success).toBe(false);
    expect(result.message).toContain('уже публикуется');
    expect(result.message).toContain('снято с очереди: 1');
  });

  it('отказ хранилища не маскируется под частичный успех', () => {
    const result = demotionOutcome({ ...emptyCounts(), failed: 1 });

    expect(result.success).toBe(false);
    expect(result.message).toContain('хранилище');
  });

  it('полный успех называет число снятых', () => {
    const result = demotionOutcome({ ...emptyCounts(), owned: 3, eligible: 3, demoted: 3 });

    expect(result.success).toBe(true);
    expect(result.message).toContain('3');
  });
});

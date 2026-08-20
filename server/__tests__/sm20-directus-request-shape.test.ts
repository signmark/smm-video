/**
 * SM-20, замечание независимой проверки. Форма настоящих запросов к Directus.
 *
 * Решающий слой снятия с очереди покрыт тестами через подставку, поэтому вся
 * условность («меняем только то, что прямо сейчас стоит в очереди») держится на
 * фильтре, который собирает связка с хранилищем. Ревьюер показал пробой: если
 * убрать `status=scheduled` из настоящего фильтра, весь серверный набор
 * остаётся зелёным. Это как раз то условие, из-за которого пауза не откатывает
 * уже опубликованное в остаточном окне.
 *
 * Здесь исполняются настоящие `directusDemotionDeps().demote` и
 * `autonomousCycleLedger.consumeByKey` — проверяется ровно то, что уходит в
 * Directus, и то, как читается его ответ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.info = vi.fn();
  log.warn = vi.fn();
  log.error = vi.fn();
  log.debug = vi.fn();
  return { log, logEvent: vi.fn(), default: log };
});

const patch = vi.fn();
const get = vi.fn();
vi.mock('../directus', () => ({
  directusApi: {
    patch: (url: any, body: any, config: any) => patch(url, body, config),
    get: (url: any, config: any) => get(url, config),
  },
}));

import { directusDemotionDeps } from '../services/autonomous-pause-deps';
import { autonomousCycleLedger } from '../services/autonomous-cycle-ledger';

const CONTENT_ID = 'c0ffee00-0000-4000-8000-000000000001';
const ITEM_KEY = 'run-1:cycle-1:0';

/** Ответ Directus на обновление по запросу: массив изменённых строк. */
function affected(rows: number) {
  return { data: { data: Array.from({ length: rows }, (_, i) => ({ id: `row-${i}` })) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('снятие с очереди: форма запроса', () => {
  it('меняет только ту запись и только пока она стоит в очереди', async () => {
    patch.mockResolvedValueOnce(affected(1));

    await directusDemotionDeps().demote(CONTENT_ID);

    expect(patch).toHaveBeenCalledTimes(1);
    const [url, body] = patch.mock.calls[0];
    expect(url).toBe('/items/campaign_content');
    // Оба условия обязательны: по идентификатору — чтобы не задеть соседей,
    // по статусу — чтобы не откатить то, что уже ушло в платформы.
    expect(body.query.filter).toEqual({
      id: { _eq: CONTENT_ID },
      status: { _eq: 'scheduled' },
    });
  });

  it('переводит ровно в черновик и снимает время публикации', async () => {
    patch.mockResolvedValueOnce(affected(1));

    await directusDemotionDeps().demote(CONTENT_ID);

    const [, body] = patch.mock.calls[0];
    // Оставленное время публикации вернуло бы запись в выборку планировщика.
    expect(body.data).toEqual({ status: 'draft', scheduled_at: null });
  });

  it('возвращает число изменённых строк, а не «получилось»', async () => {
    patch.mockResolvedValueOnce(affected(1));
    await expect(directusDemotionDeps().demote(CONTENT_ID)).resolves.toBe(1);
  });

  it('ноль изменённых строк — это ноль, а не успех', async () => {
    patch.mockResolvedValueOnce(affected(0));
    await expect(directusDemotionDeps().demote(CONTENT_ID)).resolves.toBe(0);
  });

  it('ответ без списка строк считается нулём', async () => {
    // Молчаливый ответ не должен превращаться в «сняли».
    patch.mockResolvedValueOnce({ data: {} });
    await expect(directusDemotionDeps().demote(CONTENT_ID)).resolves.toBe(0);
  });
});

describe('закрытие слота реестра: форма запроса', () => {
  it('закрывает только свой слот и только пока он заполнен', async () => {
    patch.mockResolvedValueOnce(affected(1));

    await autonomousCycleLedger.consumeByKey(ITEM_KEY);

    expect(patch).toHaveBeenCalledTimes(1);
    const [url, body] = patch.mock.calls[0];
    expect(url).toBe('/items/autonomous_cycle_items');
    // Без условия по состоянию повтор закрывал бы уже закрытый слот и
    // выдавал бы проигранную гонку за выигранную.
    expect(body.query.filter).toEqual({
      item_key: { _eq: ITEM_KEY },
      state: { _eq: 'filled' },
    });
    expect(body.data).toEqual({ state: 'consumed' });
  });

  it('одна изменённая строка — слот закрыли мы', async () => {
    patch.mockResolvedValueOnce(affected(1));
    await expect(autonomousCycleLedger.consumeByKey(ITEM_KEY)).resolves.toBe(true);
  });

  it('ноль изменённых строк — слот закрыл кто-то другой', async () => {
    patch.mockResolvedValueOnce(affected(0));
    await expect(autonomousCycleLedger.consumeByKey(ITEM_KEY)).resolves.toBe(false);
  });

  it('отказ хранилища не выдаётся за закрытие', async () => {
    patch.mockRejectedValueOnce(new Error('directus недоступен'));
    await expect(autonomousCycleLedger.consumeByKey(ITEM_KEY)).resolves.toBe(false);
  });
});

describe('чтение строк реестра: форма запроса', () => {
  it('берёт строки только своего запуска', async () => {
    get.mockResolvedValueOnce({ data: { data: [] } });

    await autonomousCycleLedger.getRunItems('run-1');

    const [url, config] = get.mock.calls[0];
    expect(url).toBe('/items/autonomous_cycle_items');
    expect(config.params.filter).toEqual({ run_id: { _eq: 'run-1' } });
  });

  it('недоступный реестр отличается от пустого', async () => {
    // Пустой список значит «снимать нечего», отказ — «мы не знаем».
    // Спутать их — значит тихо ничего не снять и отчитаться успехом.
    get.mockRejectedValueOnce(new Error('directus недоступен'));
    await expect(autonomousCycleLedger.getRunItems('run-1')).resolves.toBeNull();

    get.mockResolvedValueOnce({ data: { data: [] } });
    await expect(autonomousCycleLedger.getRunItems('run-1')).resolves.toEqual([]);
  });
});

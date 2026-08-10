/**
 * SM-15 / AI-85: status-checker — исполняемый тест на buildPlatformLists.
 *
 * ЗАЧЕМ. Status-checker агрегирует платформенные статусы в parent-статус.
 * Раньше это была inline-логика в checkPublicationStatuses, и тесты были
 * только структурные (source-scan). @Clause_Dev_Hermi показал, что
 * source-scan даёт уверенность без покрытия: фильтр написать мог, а
 * работать — нет. Поэтому логику вынесли в экспортированный helper
 * `buildPlatformLists` и тестируем его напрямую.
 *
 * Контракт (зафиксирован в helper'е):
 *   - `selectedPlatforms` — все платформы с `selected: true`.
 *   - `publishedPlatforms` — selected И (status=published ИЛИ
 *     publish_succeeded_record_failed). Последнее нужно потому что
 *     `publish_succeeded_record_failed` означает «пост висит на платформе,
 *     но в БД не зафиксировано» — для parent-статуса это эквивалент published.
 *   - `failedPlatforms` — selected И (status=failed ИЛИ error truthy).
 *   - `pendingPlatforms` — selected И НЕ (published / publish_succeeded_record_failed / failed / error).
 *
 * ДЕФЕКТ (до AI-85 + правка по ревью Clause). Inline-фильтр имел
 * `pendingPlatforms: status !== 'published' && status !== 'failed' && !error`.
 * Маркер `publish_succeeded_record_failed` с полем `originalError` имел
 * `error: undefined`, поэтому попадал в pendingPlatforms. Parent-статус
 * оставался draft, и запись пропадала из UI раздела «Публикации».
 *
 * RED-BEFORE (по §1). Временно вернуть фильтр publishedPlatforms без
 * `publish_succeeded_record_failed` → тест красный.
 */
import { describe, it, expect } from 'vitest';
import { buildPlatformLists } from '../services/status-checker';

describe('AI-85: buildPlatformLists — selected платформы', () => {
  it('пустой вход → пустые списки', () => {
    const lists = buildPlatformLists({});
    expect(lists.selectedPlatforms).toEqual([]);
    expect(lists.publishedPlatforms).toEqual([]);
    expect(lists.failedPlatforms).toEqual([]);
    expect(lists.pendingPlatforms).toEqual([]);
  });

  it('selected: true обязательно для всех списков', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'published' },
      facebook: { selected: false, status: 'published' }, // не выбрана — игнорируется
    });
    expect(lists.selectedPlatforms).toEqual(['telegram']);
    expect(lists.publishedPlatforms).toEqual(['telegram']);
  });
});

describe('AI-85: buildPlatformLists — publishedPlatforms', () => {
  it('включает status=published', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'published' },
    });
    expect(lists.publishedPlatforms).toEqual(['telegram']);
  });

  it('включает publish_succeeded_record_failed (пост на платформе, но в БД не записано)', () => {
    const lists = buildPlatformLists({
      telegram: {
        selected: true,
        status: 'publish_succeeded_record_failed',
        postId: 'tg-1',
        originalError: 'Directus 503',
      },
    });
    expect(lists.publishedPlatforms).toEqual(['telegram']);
  });

  it('смешанный случай: published + publish_succeeded_record_failed + pending → все published', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'published' },
      vk: { selected: true, status: 'publish_succeeded_record_failed' },
      facebook: { selected: true, status: 'pending' },
    });
    expect(lists.selectedPlatforms.sort()).toEqual(['facebook', 'telegram', 'vk']);
    expect(lists.publishedPlatforms.sort()).toEqual(['telegram', 'vk']);
    expect(lists.pendingPlatforms).toEqual(['facebook']);
  });
});

describe('AI-85: buildPlatformLists — failedPlatforms', () => {
  it('включает status=failed', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'failed' },
    });
    expect(lists.failedPlatforms).toEqual(['telegram']);
  });

  it('включает платформу с error truthy (но status != failed)', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'publishing', error: 'some-error' },
    });
    expect(lists.failedPlatforms).toEqual(['telegram']);
  });
});

describe('AI-85: buildPlatformLists — pendingPlatforms', () => {
  it('включает только pending (status=pending, без ошибок)', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'pending' },
      vk: { selected: true, status: 'publishing' },
    });
    expect(lists.pendingPlatforms.sort()).toEqual(['telegram', 'vk']);
  });

  it('НЕ включает publish_succeeded_record_failed (тот считается published)', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'publish_succeeded_record_failed' },
    });
    expect(lists.pendingPlatforms).toEqual([]);
    expect(lists.publishedPlatforms).toEqual(['telegram']);
  });

  it('НЕ включает failed/published (они в своих списках)', () => {
    const lists = buildPlatformLists({
      telegram: { selected: true, status: 'published' },
      vk: { selected: true, status: 'failed' },
    });
    expect(lists.pendingPlatforms).toEqual([]);
  });
});

describe('AI-85: реалистичный сценарий — продвижение parent-статуса', () => {
  it('все выбранные платформы либо published, либо publish_succeeded_record_failed → parent должен стать published', () => {
    // Это ровно то, что происходит после моего MR: helper пишет publish_succeeded_record_failed
    // с сохранённым `selected: true`, и status-checker должен считать платформу как published.
    const social_platforms = {
      telegram: { selected: true, status: 'publish_succeeded_record_failed', postId: 'tg-1' },
      vk: { selected: true, status: 'published', postId: 'vk-1' },
    };
    const lists = buildPlatformLists(social_platforms);

    // Имитируем логику продвижения parent-статуса:
    const allPublished =
      lists.selectedPlatforms.length > 0 &&
      lists.selectedPlatforms.length === lists.publishedPlatforms.length;

    expect(allPublished).toBe(true);
  });

  it('если selected потерян (старый баг) → parent НЕ продвигается', () => {
    // Симулируем запись со старым кодом, где helper заменял объект платформы
    // целиком, теряя selected: true.
    const social_platforms = {
      telegram: { status: 'publish_succeeded_record_failed', postId: 'tg-1' },
      vk: { status: 'published', postId: 'vk-1' },
    };
    const lists = buildPlatformLists(social_platforms);

    const allPublished =
      lists.selectedPlatforms.length > 0 &&
      lists.selectedPlatforms.length === lists.publishedPlatforms.length;

    // selectedPlatforms пуст → allPublished false → parent остаётся draft.
    // Это и есть оригинальный баг, который @Clause_Dev_Hermi нашёл в проде.
    expect(allPublished).toBe(false);
  });
});
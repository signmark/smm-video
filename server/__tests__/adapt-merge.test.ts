/**
 * SM-35. Главное, что здесь стережётся: сохранение текста не должно превращать
 * опубликованный пост в неопубликованный. Интерфейс присылает полный объект
 * площадки с пустыми `postId`/`postUrl` и статусом «ожидает», и запись «как
 * пришло» стёрла бы ссылку на реальную публикацию.
 */
import { describe, it, expect } from 'vitest';
import { mergeAdaptedPlatforms, adaptSaveMessage } from '../services/adapt-merge';

const PUBLISHED = {
  caption: 'старый текст',
  status: 'published',
  postId: '12345',
  postUrl: 'https://t.me/channel/12345',
  publishedAt: '2026-08-19T10:00:00.000Z',
};

/** Ровно в таком виде окно адаптации присылает площадку. */
function fromDialog(caption: string) {
  return {
    caption,
    status: 'pending',
    isEdited: true,
    hashtags: ['#тег'],
    publishedAt: null,
    postId: null,
    postUrl: null,
    error: null,
  };
}

describe('сохранение текстов по площадкам', () => {
  it('опубликованная площадка сохраняет ссылку, идентификатор, время и статус', () => {
    const { next, saved } = mergeAdaptedPlatforms(
      { telegram: PUBLISHED },
      { telegram: fromDialog('новый текст') },
    );

    expect(saved).toEqual(['telegram']);
    expect(next.telegram.caption).toBe('новый текст');
    expect(next.telegram.status).toBe('published');
    expect(next.telegram.postId).toBe('12345');
    expect(next.telegram.postUrl).toBe('https://t.me/channel/12345');
    expect(next.telegram.publishedAt).toBe('2026-08-19T10:00:00.000Z');
  });

  it('площадка, которой нет в запросе, не меняется вовсе', () => {
    const { next } = mergeAdaptedPlatforms(
      { telegram: PUBLISHED, vk: { caption: 'текст ВК', status: 'pending' } },
      { telegram: fromDialog('новый текст') },
    );

    expect(next.vk).toEqual({ caption: 'текст ВК', status: 'pending' });
  });

  it('пустой текст ничего не затирает и попадает в пропущенные', () => {
    const { next, saved, skipped } = mergeAdaptedPlatforms(
      { telegram: PUBLISHED },
      { telegram: fromDialog('   ') },
    );

    expect(saved).toEqual([]);
    expect(skipped).toEqual(['telegram']);
    expect(next.telegram).toEqual(PUBLISHED);
  });

  it('новая площадка заводится со статусом «ожидает»', () => {
    const { next, saved } = mergeAdaptedPlatforms(null, { instagram: fromDialog('текст') });

    expect(saved).toEqual(['instagram']);
    expect(next.instagram.status).toBe('pending');
    expect(next.instagram.caption).toBe('текст');
  });

  it('новая площадка без статуса всё равно его получает', () => {
    const { next } = mergeAdaptedPlatforms(null, { vk: { caption: 'текст' } });
    expect(next.vk.status).toBe('pending');
  });

  it('запись об ошибке прошлой публикации из запроса не стирается', () => {
    // Стирать её должен путь публикации (SM-40), а не сохранение текста:
    // иначе человек «чинит» неудачу правкой подписи и теряет причину.
    const { next } = mergeAdaptedPlatforms(
      { facebook: { caption: 'текст', status: 'failed', error: 'Площадка отказала' } },
      { facebook: fromDialog('другой текст') },
    );

    expect(next.facebook.status).toBe('failed');
    expect(next.facebook.error).toBe('Площадка отказала');
  });

  it('мусор вместо площадки пропускается, а не роняет сохранение', () => {
    const { saved, skipped } = mergeAdaptedPlatforms(null, { vk: null, telegram: 'строка' } as any);
    expect(saved).toEqual([]);
    expect(skipped.sort()).toEqual(['telegram', 'vk']);
  });

  it('прежние площадки остаются на месте, даже если запрос пустой', () => {
    const { next, saved } = mergeAdaptedPlatforms({ telegram: PUBLISHED }, {});
    expect(next).toEqual({ telegram: PUBLISHED });
    expect(saved).toEqual([]);
  });
});

describe('что сказать человеку', () => {
  it('всё сохранено', () => {
    expect(adaptSaveMessage({ next: {}, saved: ['telegram', 'vk'], skipped: [] }))
      .toBe('Сохранено площадок: 2');
  });

  it('часть пропущена — говорим и об этом', () => {
    expect(adaptSaveMessage({ next: {}, saved: ['telegram'], skipped: ['vk'] }))
      .toBe('Сохранено площадок: 1; пропущено пустых: 1');
  });

  it('сохранять было нечего', () => {
    expect(adaptSaveMessage({ next: {}, saved: [], skipped: [] }))
      .toBe('Сохранять нечего: тексты не заданы');
  });

  it('все площадки пустые — это не успех', () => {
    expect(adaptSaveMessage({ next: {}, saved: [], skipped: ['vk'] }))
      .toBe('Ни один текст не сохранён: все площадки пустые');
  });
});

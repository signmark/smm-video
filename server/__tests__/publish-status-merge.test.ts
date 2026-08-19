/**
 * Смысл проверок: карточка публикации не должна показывать зелёную отметку со
 * ссылкой и красную ошибку одновременно. Это несовместимые результаты, и человек
 * не может понять, ушёл его пост или нет.
 */
import { describe, it, expect } from 'vitest';
import { mergePlatformStatus } from '../services/publish-status-merge';

describe('слияние состояния площадки', () => {
  it('успех после неудачи не оставляет текста ошибки', () => {
    const previous = {
      status: 'pending',
      lastError: '(#200) требуются права страницы',
      retryCount: 1,
      retriedAt: '2026-08-19T13:14:54.923Z',
      publishingAt: '2026-08-19T13:20:20.000Z',
    };
    const merged = mergePlatformStatus(previous, {
      status: 'published',
      postId: '18062839622759015',
      postUrl: 'https://www.instagram.com/reel/DcOSAt8kzko/',
      publishedAt: '2026-08-19T13:21:04.212Z',
    });

    expect(merged.status).toBe('published');
    expect(merged.postUrl).toBe('https://www.instagram.com/reel/DcOSAt8kzko/');
    expect(merged.lastError).toBeUndefined();
    expect(merged.error).toBeUndefined();
    expect(merged.retryCount).toBeUndefined();
    expect(merged.retriedAt).toBeUndefined();
    expect(merged.publishingAt).toBeUndefined();
  });

  it('запланированное человеком время публикации успех не стирает', () => {
    // scheduledAt — это ещё и время, на которое человек поставил публикацию;
    // потерять его значит потерять расписание, а не след неудачи.
    const merged = mergePlatformStatus(
      { status: 'pending', scheduledAt: '2026-08-19T13:19:54.923Z', lastError: 'что-то пошло не так' },
      { status: 'published', postId: '1', publishedAt: '2026-08-19T13:21:04.212Z' },
    );
    expect(merged.scheduledAt).toBe('2026-08-19T13:19:54.923Z');
    expect(merged.lastError).toBeUndefined();
  });

  it('неудача ничего не стирает — разбираться надо по полной картине', () => {
    const merged = mergePlatformStatus(
      { status: 'publishing', publishingAt: '2026-08-19T13:14:00.000Z', retryCount: 1 },
      { status: 'failed', error: 'Instagram отказал', failedAt: '2026-08-19T13:14:54.922Z' },
    );
    expect(merged.status).toBe('failed');
    expect(merged.error).toBe('Instagram отказал');
    expect(merged.retryCount).toBe(1);
    expect(merged.publishingAt).toBe('2026-08-19T13:14:00.000Z');
  });

  it('если успешная запись сама принесла поле — оно остаётся', () => {
    // Случай «пост ушёл, а запись не сохранилась»: там осознанно пишут error
    // вместе со статусом. Затирать его нельзя.
    const merged = mergePlatformStatus(
      { status: 'pending', lastError: 'старое' },
      { status: 'published', postId: '1', error: 'запись не сохранилась' },
    );
    expect(merged.error).toBe('запись не сохранилась');
    expect(merged.lastError).toBeUndefined();
  });

  it('первая успешная публикация без прошлого состояния работает как раньше', () => {
    const merged = mergePlatformStatus(undefined, {
      status: 'published',
      postId: '1',
      postUrl: 'https://t.me/x/1',
      publishedAt: '2026-08-19T13:14:17.203Z',
    });
    expect(merged).toEqual({
      status: 'published',
      postId: '1',
      postUrl: 'https://t.me/x/1',
      publishedAt: '2026-08-19T13:14:17.203Z',
    });
  });

  it('чужие поля площадки успех не трогает', () => {
    const merged = mergePlatformStatus(
      { status: 'pending', caption: 'текст для площадки', lastError: 'ошибка' },
      { status: 'published', postId: '1' },
    );
    expect(merged.caption).toBe('текст для площадки');
    expect(merged.lastError).toBeUndefined();
  });
});

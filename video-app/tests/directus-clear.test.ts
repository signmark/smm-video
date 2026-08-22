import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { directusClearPatch } from '../server/db.ts';

describe('directusClearPatch', () => {
  it('превращает явное undefined в null — иначе PATCH уходит без поля', () => {
    // Ровно то, что делает сброс проекта («Сгенерировать заново»).
    const patch = directusClearPatch({ status: 'script_ready', videoPath: undefined, videoUrl: undefined, error: undefined });
    assert.deepEqual(patch, { video_path: null, video_url: null, error: null });
  });

  it('не трогает поля, которых в обновлении нет', () => {
    assert.deepEqual(directusClearPatch({ status: 'done' }), {});
  });

  it('не стирает поле с настоящим значением', () => {
    assert.deepEqual(directusClearPatch({ videoPath: '/data/videos/1.mp4' }), {});
  });

  it('пустая строка — это значение, а не очистка', () => {
    assert.deepEqual(directusClearPatch({ error: '' }), {});
  });

  it('обязательные поля не стирает даже по явному undefined', () => {
    // status и progress незачем и нечем стирать: колонки обязательные.
    assert.deepEqual(directusClearPatch({ status: undefined, progress: undefined }), {});
  });

  it('очищает то, что снимает очистка старых роликов', () => {
    assert.deepEqual(directusClearPatch({ videoPath: undefined, videoUrl: undefined }), { video_path: null, video_url: null });
  });
});

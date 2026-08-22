import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planCleanup } from '../server/cleanup.ts';

const DAY = 24 * 60 * 60 * 1000;
const RETENTION = 30 * DAY;

describe('planCleanup', () => {
  it('удаляет ролик старше срока хранения', () => {
    const plan = planCleanup({ video: 31 * DAY, images: null }, RETENTION);
    assert.equal(plan.deleteVideo, true);
    assert.equal(plan.clearRow, true);
  });

  it('НЕ трогает свежий ролик в старом проекте (пересборка)', () => {
    // Проект создан в июле, ролик пересобран сегодня: возраст проекта роли не играет.
    const plan = planCleanup({ video: 1 * DAY, images: 1 * DAY }, RETENTION);
    assert.equal(plan.deleteVideo, false);
    assert.equal(plan.deleteImages, false);
    assert.equal(plan.clearRow, false);
  });

  it('НЕ трогает кадры, которые пишутся прямо сейчас', () => {
    // Генерация идёт в старом проекте: видео ещё нет, кадры только что созданы.
    const plan = planCleanup({ video: null, images: 60 * 1000 }, RETENTION);
    assert.equal(plan.deleteImages, false);
    assert.equal(plan.deleteVideo, false);
  });

  it('ничего не делает, когда файлов нет', () => {
    const plan = planCleanup({ video: null, images: null }, RETENTION);
    assert.deepEqual(plan, { deleteVideo: false, deleteImages: false, clearRow: false });
  });

  it('не переписывает строку проекта, если файла не было', () => {
    // Раньше очистка чистила videoPath у проектов без файла на каждом старте
    // и рапортовала об «удалённых» роликах, которых не удаляла.
    const plan = planCleanup({ video: null, images: 40 * DAY }, RETENTION);
    assert.equal(plan.clearRow, false);
    assert.equal(plan.deleteImages, true);
  });

  it('судит ролик и кадры по отдельности', () => {
    const plan = planCleanup({ video: 40 * DAY, images: 1 * DAY }, RETENTION);
    assert.equal(plan.deleteVideo, true);
    assert.equal(plan.deleteImages, false);
  });

  it('граница ровно в срок хранения — удаляет', () => {
    assert.equal(planCleanup({ video: RETENTION, images: null }, RETENTION).deleteVideo, true);
    assert.equal(planCleanup({ video: RETENTION - 1, images: null }, RETENTION).deleteVideo, false);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFileStatus, DEFAULT_RETENTION_DAYS } from '../client/src/lib/file-status.ts';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

describe('getFileStatus', () => {
  it('done project with file: hasFile=true, no fileMissing', () => {
    const result = getFileStatus('done', true, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.hasFile, true);
    assert.equal(result.isDone, true);
    assert.equal(result.fileMissing, false);
    assert.ok(result.expiryLabel); // should have expiry label
  });

  it('done project WITHOUT file: fileMissing=true', () => {
    const result = getFileStatus('done', false, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.hasFile, false);
    assert.equal(result.isDone, true);
    assert.equal(result.fileMissing, true);
    assert.equal(result.expiryLabel, null); // no expiry for missing files
  });

  it('active project: no expiry label', () => {
    const result = getFileStatus('generating_script', false, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.isDone, false);
    assert.equal(result.fileMissing, false);
    assert.equal(result.expiryLabel, null);
  });

  it('expiry label shows days remaining', () => {
    const result = getFileStatus('done', true, new Date(NOW - 2 * DAY).toISOString(), 30, NOW);
    assert.ok(result.expiryLabel);
    assert.equal(result.expiryUrgent, false);
  });

  it('expiry urgent when ≤1 day remaining', () => {
    const created = new Date(NOW - 29 * DAY).toISOString();
    const result = getFileStatus('done', true, created, 30, NOW);
    assert.equal(result.expiryLabel, 'удалится завтра');
    assert.equal(result.expiryUrgent, true);
  });

  it('retentionDays=7: different expiry than 30', () => {
    const created = new Date(NOW - 5 * DAY).toISOString();
    const result7 = getFileStatus('done', true, created, 7, NOW);
    const result30 = getFileStatus('done', true, created, 30, NOW);
    // At 5 days old: 7-day retention → 2 days left, 30-day → 25 days left
    assert.ok(result7.expiryLabel !== result30.expiryLabel);
    assert.equal(result7.expiryLabel, '2 дн.');
    assert.equal(result30.expiryLabel, '25 дн.');
  });

  it('retentionDays=7: urgent at 6 days old', () => {
    const created = new Date(NOW - 6 * DAY).toISOString();
    const result = getFileStatus('done', true, created, 7, NOW);
    assert.equal(result.expiryLabel, 'удалится завтра');
    assert.equal(result.expiryUrgent, true);
  });

  it('mutation: changing DEFAULT_RETENTION_DAYS breaks expiry test', () => {
    // If someone changes DEFAULT_RETENTION_DAYS from 30, the urgent threshold changes
    const created = new Date(NOW - 29 * DAY).toISOString();
    const result = getFileStatus('done', true, created, DEFAULT_RETENTION_DAYS, NOW);
    assert.equal(result.expiryLabel, 'удалится завтра');
  });

  it('error project with file: not fileMissing', () => {
    const result = getFileStatus('error', true, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.isDone, false);
    assert.equal(result.fileMissing, false);
  });

  it('idle project: not fileMissing', () => {
    const result = getFileStatus('idle', false, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.isDone, false);
    assert.equal(result.fileMissing, false);
  });
});

describe('getFileStatus: why the file is gone', () => {
  it('младше срока хранения: не сваливает пропажу на срок хранения', () => {
    const result = getFileStatus('done', false, new Date(NOW - 2 * DAY).toISOString(), 30, NOW);
    assert.equal(result.fileMissing, true);
    assert.equal(result.missingLabel, 'файла нет — скачать нельзя');
  });

  it('старше срока хранения: срок хранения и есть причина', () => {
    const result = getFileStatus('done', false, new Date(NOW - 31 * DAY).toISOString(), 30, NOW);
    assert.equal(result.fileMissing, true);
    assert.equal(result.missingLabel, 'файл удалён по сроку хранения');
  });

  it('ровно на границе срока: считается истёкшим', () => {
    const result = getFileStatus('done', false, new Date(NOW - 30 * DAY).toISOString(), 30, NOW);
    assert.equal(result.missingLabel, 'файл удалён по сроку хранения');
  });

  it('короткий срок хранения меняет причину для того же возраста', () => {
    const created = new Date(NOW - 10 * DAY).toISOString();
    assert.equal(getFileStatus('done', false, created, 7, NOW).missingLabel, 'файл удалён по сроку хранения');
    assert.equal(getFileStatus('done', false, created, 30, NOW).missingLabel, 'файла нет — скачать нельзя');
  });

  it('файл на месте: причины нет', () => {
    const result = getFileStatus('done', true, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.missingLabel, null);
  });

  it('проект не готов: причины нет, даже если файла нет', () => {
    const result = getFileStatus('generating_script', false, new Date(NOW - DAY).toISOString(), 30, NOW);
    assert.equal(result.missingLabel, null);
  });
});

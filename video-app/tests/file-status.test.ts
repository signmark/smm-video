import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFileStatus, RETENTION_DAYS } from '../client/src/lib/file-status.ts';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

describe('getFileStatus', () => {
  it('done project with file: hasFile=true, no fileMissing', () => {
    const result = getFileStatus('done', true, new Date(NOW - DAY).toISOString(), NOW);
    assert.equal(result.hasFile, true);
    assert.equal(result.isDone, true);
    assert.equal(result.fileMissing, false);
    assert.ok(result.expiryLabel); // should have expiry label
  });

  it('done project WITHOUT file: fileMissing=true', () => {
    const result = getFileStatus('done', false, new Date(NOW - DAY).toISOString(), NOW);
    assert.equal(result.hasFile, false);
    assert.equal(result.isDone, true);
    assert.equal(result.fileMissing, true);
    assert.equal(result.expiryLabel, null); // no expiry for missing files
  });

  it('active project: no expiry label', () => {
    const result = getFileStatus('generating_script', false, new Date(NOW - DAY).toISOString(), NOW);
    assert.equal(result.isDone, false);
    assert.equal(result.fileMissing, false);
    assert.equal(result.expiryLabel, null);
  });

  it('expiry label shows days remaining', () => {
    const result = getFileStatus('done', true, new Date(NOW - 2 * DAY).toISOString(), NOW);
    assert.ok(result.expiryLabel);
    assert.equal(result.expiryUrgent, false);
  });

  it('expiry urgent when ≤1 day remaining', () => {
    const created = new Date(NOW - (RETENTION_DAYS - 1) * DAY).toISOString();
    const result = getFileStatus('done', true, created, NOW);
    assert.equal(result.expiryLabel, 'удалится завтра');
    assert.equal(result.expiryUrgent, true);
  });

  it('mutation: changing RETENTION_DAYS breaks expiry test', () => {
    // If someone changes RETENTION_DAYS from 30, the urgent threshold changes
    const created = new Date(NOW - 29 * DAY).toISOString();
    const result = getFileStatus('done', true, created, NOW);
    assert.equal(result.expiryLabel, 'удалится завтра');
  });

  it('error project with file: not fileMissing', () => {
    const result = getFileStatus('error', true, new Date(NOW - DAY).toISOString(), NOW);
    assert.equal(result.isDone, false);
    assert.equal(result.fileMissing, false);
  });

  it('idle project: not fileMissing', () => {
    const result = getFileStatus('idle', false, new Date(NOW - DAY).toISOString(), NOW);
    assert.equal(result.isDone, false);
    assert.equal(result.fileMissing, false);
  });
});

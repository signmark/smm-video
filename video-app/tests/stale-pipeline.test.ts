import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findStuckProjects, PIPELINE_ACTIVE_STATUSES } from '../server/db.ts';

describe('findStuckProjects', () => {
  const mk = (id: string, status: string) => ({ id, status } as { id: string; status: string });

  it('returns projects in generating_script', () => {
    const result = findStuckProjects([mk('1', 'generating_script')]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('returns projects in generating_images', () => {
    const result = findStuckProjects([mk('1', 'generating_images')]);
    assert.equal(result.length, 1);
  });

  it('returns projects in animating', () => {
    const result = findStuckProjects([mk('1', 'animating')]);
    assert.equal(result.length, 1);
  });

  it('returns projects in assembling', () => {
    const result = findStuckProjects([mk('1', 'assembling')]);
    assert.equal(result.length, 1);
  });

  it('returns projects in searching_stock', () => {
    const result = findStuckProjects([mk('1', 'searching_stock')]);
    assert.equal(result.length, 1);
  });

  it('does NOT return idle projects', () => {
    const result = findStuckProjects([mk('1', 'idle')]);
    assert.equal(result.length, 0);
  });

  it('does NOT return script_ready projects', () => {
    const result = findStuckProjects([mk('1', 'script_ready')]);
    assert.equal(result.length, 0);
  });

  it('does NOT return done projects', () => {
    const result = findStuckProjects([mk('1', 'done')]);
    assert.equal(result.length, 0);
  });

  it('does NOT return error projects', () => {
    const result = findStuckProjects([mk('1', 'error')]);
    assert.equal(result.length, 0);
  });

  it('filters mixed list correctly', () => {
    const result = findStuckProjects([
      mk('1', 'idle'),
      mk('2', 'generating_script'),
      mk('3', 'done'),
      mk('4', 'animating'),
      mk('5', 'script_ready'),
      mk('6', 'assembling'),
    ]);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map(p => p.id), ['2', '4', '6']);
  });

  it('PIPELINE_ACTIVE_STATUSES has exactly 5 entries', () => {
    assert.equal(PIPELINE_ACTIVE_STATUSES.length, 5);
  });

  it('PIPELINE_ACTIVE_STATUSES does not include idle or script_ready', () => {
    assert.ok(!PIPELINE_ACTIVE_STATUSES.includes('idle'));
    assert.ok(!PIPELINE_ACTIVE_STATUSES.includes('script_ready'));
    assert.ok(!PIPELINE_ACTIVE_STATUSES.includes('done'));
    assert.ok(!PIPELINE_ACTIVE_STATUSES.includes('error'));
  });

  it('mutation: adding idle to PIPELINE_ACTIVE_STATUSES breaks filter test', () => {
    // This test proves that idle is intentionally excluded
    const projects = [mk('1', 'idle')];
    const result = findStuckProjects(projects);
    assert.equal(result.length, 0);
  });
});

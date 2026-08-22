import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findStuckProjects, PIPELINE_ACTIVE_STATUSES } from '../server/db.ts';
import { RUNNING_STATUSES, isActiveFilter } from '../client/src/lib/project-filter.ts';

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

describe('server/client status list parity', () => {
  it('PIPELINE_ACTIVE_STATUSES and RUNNING_STATUSES contain the same statuses', () => {
    // WHY these must match:
    // - Server PIPELINE_ACTIVE_STATUSES = "pipeline is alive, reset on restart"
    // - Client RUNNING_STATUSES = "show spinner, poll server for updates"
    // These are the same question from two sides: polling makes sense only while
    // the pipeline is alive. If they diverge, the client either polls dead projects
    // (wastes requests) or misses live ones (card looks frozen).
    const serverSet = new Set(PIPELINE_ACTIVE_STATUSES);
    const clientSet = RUNNING_STATUSES;
    assert.equal(serverSet.size, clientSet.size, `Server has ${serverSet.size} statuses, client has ${clientSet.size}`);
    for (const s of serverSet) {
      assert.ok(clientSet.has(s), `Server status '${s}' missing from client RUNNING_STATUSES`);
    }
    for (const s of clientSet) {
      assert.ok(serverSet.has(s), `Client status '${s}' missing from server PIPELINE_ACTIVE_STATUSES`);
    }
  });

  it('both lists have exactly 5 entries', () => {
    assert.equal(PIPELINE_ACTIVE_STATUSES.length, 5);
    assert.equal(RUNNING_STATUSES.size, 5);
  });

  it('isActiveFilter is intentionally wider than RUNNING_STATUSES', () => {
    // isActiveFilter = "not done, not error" — includes idle and script_ready
    // where no pipeline runs but the project is not finished either.
    // This is intentional: the "В работе" filter bucket shows all unfinished
    // projects, not just those with an active pipeline.
    assert.ok(isActiveFilter('idle'), 'idle should be in active filter (unfinished, no pipeline)');
    assert.ok(isActiveFilter('script_ready'), 'script_ready should be in active filter (waiting for user)');
    assert.ok(!isActiveFilter('done'), 'done should NOT be in active filter');
    assert.ok(!isActiveFilter('error'), 'error should NOT be in active filter');
    // idle and script_ready are in isActiveFilter but NOT in RUNNING_STATUSES
    assert.ok(!RUNNING_STATUSES.has('idle'), 'idle should NOT be in RUNNING_STATUSES (no pipeline)');
    assert.ok(!RUNNING_STATUSES.has('script_ready'), 'script_ready should NOT be in RUNNING_STATUSES (no pipeline)');
  });
});

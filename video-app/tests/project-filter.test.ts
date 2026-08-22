import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortProjects,
  isRunningStatus,
  isActiveFilter,
  RUNNING_STATUSES,
  STATUS_FILTER_OPTIONS,
  SORT_OPTIONS,
  type ProjectForFilter,
} from '../client/src/lib/project-filter.ts';

const NOW = Date.now();
const HOUR = 3600_000;

function makeProject(overrides: Partial<ProjectForFilter> = {}): ProjectForFilter {
  return {
    id: '1',
    title: 'Test Video',
    topic: 'Продвижение продукта',
    format: '9:16',
    status: 'done',
    createdAt: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  };
}

const PROJECTS: ProjectForFilter[] = [
  makeProject({ id: '1', title: 'First', status: 'done', createdAt: new Date(NOW - 3 * HOUR).toISOString() }),
  makeProject({ id: '2', title: 'Second', status: 'generating_script', createdAt: new Date(NOW - 2 * HOUR).toISOString() }),
  makeProject({ id: '3', title: 'Third', status: 'error', createdAt: new Date(NOW - 1 * HOUR).toISOString() }),
  makeProject({ id: '4', title: 'Fourth', status: 'done', createdAt: new Date(NOW).toISOString() }),
];

describe('isRunningStatus', () => {
  it('generating_script is running', () => {
    assert.equal(isRunningStatus('generating_script'), true);
  });

  it('generating_images is running', () => {
    assert.equal(isRunningStatus('generating_images'), true);
  });

  it('assembling is running', () => {
    assert.equal(isRunningStatus('assembling'), true);
  });

  it('idle is NOT running', () => {
    assert.equal(isRunningStatus('idle'), false);
  });

  it('script_ready is NOT running', () => {
    assert.equal(isRunningStatus('script_ready'), false);
  });

  it('done is NOT running', () => {
    assert.equal(isRunningStatus('done'), false);
  });

  it('error is NOT running', () => {
    assert.equal(isRunningStatus('error'), false);
  });

  it('RUNNING_STATUSES has exactly 3 entries', () => {
    assert.equal(RUNNING_STATUSES.size, 3);
  });
});

describe('isActiveFilter', () => {
  it('idle is active (in "В работе" bucket)', () => {
    assert.equal(isActiveFilter('idle'), true);
  });

  it('script_ready is active (in "В работе" bucket)', () => {
    assert.equal(isActiveFilter('script_ready'), true);
  });

  it('generating_script is active', () => {
    assert.equal(isActiveFilter('generating_script'), true);
  });

  it('done is NOT active', () => {
    assert.equal(isActiveFilter('done'), false);
  });

  it('error is NOT active', () => {
    assert.equal(isActiveFilter('error'), false);
  });

  it('script_ready appears in "active" filter', () => {
    const projects = [
      makeProject({ id: '1', title: 'A', status: 'script_ready' }),
      makeProject({ id: '2', title: 'B', status: 'done' }),
    ];
    const result = filterAndSortProjects(projects, '', 'active', 'newest');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });
});

describe('filterAndSortProjects', () => {
  it('no filters: returns all sorted by newest', () => {
    const result = filterAndSortProjects(PROJECTS, '', 'all', 'newest');
    assert.equal(result.length, 4);
    assert.equal(result[0].id, '4'); // newest first
    assert.equal(result[3].id, '1'); // oldest last
  });

  it('sort oldest', () => {
    const result = filterAndSortProjects(PROJECTS, '', 'all', 'oldest');
    assert.equal(result[0].id, '1');
    assert.equal(result[3].id, '4');
  });

  it('filter by status: done', () => {
    const result = filterAndSortProjects(PROJECTS, '', 'done', 'newest');
    assert.equal(result.length, 2);
    assert.ok(result.every((p) => p.status === 'done'));
  });

  it('filter by status: active (not done, not error)', () => {
    const result = filterAndSortProjects(PROJECTS, '', 'active', 'newest');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  it('filter by status: error', () => {
    const result = filterAndSortProjects(PROJECTS, '', 'error', 'newest');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '3');
  });

  it('search by title', () => {
    const result = filterAndSortProjects(PROJECTS, 'Third', 'all', 'newest');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '3');
  });

  it('search by topic', () => {
    const projects = [
      makeProject({ id: '1', title: 'A', topic: 'Маркетинг' }),
      makeProject({ id: '2', title: 'B', topic: 'Продажи' }),
    ];
    const result = filterAndSortProjects(projects, 'маркетинг', 'all', 'newest');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('search is case-insensitive', () => {
    const result = filterAndSortProjects(PROJECTS, 'first', 'all', 'newest');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  it('combined: search + status filter + sort', () => {
    const projects = [
      makeProject({ id: '1', title: 'Video A', status: 'done', createdAt: new Date(NOW - 2 * HOUR).toISOString() }),
      makeProject({ id: '2', title: 'Video B', status: 'error', createdAt: new Date(NOW - 1 * HOUR).toISOString() }),
      makeProject({ id: '3', title: 'Video C', status: 'done', createdAt: new Date(NOW).toISOString() }),
    ];
    const result = filterAndSortProjects(projects, 'video', 'done', 'oldest');
    assert.equal(result.length, 2);
    assert.equal(result[0].id, '1');
    assert.equal(result[1].id, '3');
  });

  it('mutation: changing status filter condition breaks test', () => {
    // If someone changes 'active' to include 'done', this test fails
    const result = filterAndSortProjects(PROJECTS, '', 'active', 'newest');
    assert.equal(result.length, 1); // only 'generating_script' is active
  });

  it('empty search with whitespace: treated as no filter', () => {
    const result = filterAndSortProjects(PROJECTS, '  ', 'all', 'newest');
    assert.equal(result.length, 4);
  });

  it('constants are defined', () => {
    assert.equal(STATUS_FILTER_OPTIONS.length, 4);
    assert.equal(SORT_OPTIONS.length, 2);
  });
});

/**
 * Pure functions for filtering and sorting video projects.
 *
 * Extracted from Home.tsx so that filter/sort logic is testable
 * and cannot silently change when UI state evolves.
 */

export type ProjectStatus = 'idle' | 'generating_script' | 'generating_images' | 'assembling' | 'done' | 'error' | string;

export interface ProjectForFilter {
  id: string;
  title: string;
  topic: string;
  format: string;
  status: ProjectStatus;
  createdAt: string;
}

export type StatusFilter = 'all' | 'active' | 'done' | 'error';
export type SortOrder = 'newest' | 'oldest';

export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'В работе' },
  { value: 'done', label: 'Готовые' },
  { value: 'error', label: 'С ошибкой' },
];

export const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
];

/** Statuses where the machine is actively working (polling + spinner). */
export const RUNNING_STATUSES = new Set(['generating_script', 'searching_stock', 'generating_images', 'animating', 'assembling']);

export function isRunningStatus(status: string): boolean {
  return RUNNING_STATUSES.has(status);
}

/** Statuses that belong in the "В работе" filter bucket (not done, not error). */
export function isActiveFilter(status: string): boolean {
  return status !== 'done' && status !== 'error';
}

/** Generic in the project type: filtering and sorting must not strip fields the
 *  caller added on top of ProjectForFilter, or the result stops being usable as
 *  the caller's own project. */
export function filterAndSortProjects<T extends ProjectForFilter>(
  projects: T[],
  search: string,
  statusFilter: StatusFilter,
  sortOrder: SortOrder,
): T[] {
  let result = projects;

  // Search filter
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.topic?.toLowerCase().includes(q),
    );
  }

  // Status filter
  if (statusFilter === 'active') {
    result = result.filter((p) => isActiveFilter(p.status));
  } else if (statusFilter === 'done') {
    result = result.filter((p) => p.status === 'done');
  } else if (statusFilter === 'error') {
    result = result.filter((p) => p.status === 'error');
  }

  // Sort
  result = [...result].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return sortOrder === 'newest' ? tb - ta : ta - tb;
  });

  return result;
}

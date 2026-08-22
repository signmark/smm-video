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

const ACTIVE_STATUSES = new Set(['idle', 'generating_script', 'generating_images', 'assembling']);

export function filterAndSortProjects(
  projects: ProjectForFilter[],
  search: string,
  statusFilter: StatusFilter,
  sortOrder: SortOrder,
): ProjectForFilter[] {
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
    result = result.filter((p) => ACTIVE_STATUSES.has(p.status));
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

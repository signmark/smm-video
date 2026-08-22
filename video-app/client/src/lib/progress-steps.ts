/**
 * Maps video project status to pipeline step states.
 * Pure function — no React, no side effects.
 */

export interface Step {
  id: string;
  label: string;
}

export const PIPELINE_STEPS: Step[] = [
  { id: 'idle', label: 'Очередь' },
  { id: 'generating_script', label: 'Сценарий' },
  { id: 'generating_images', label: 'Визуал' },
  { id: 'assembling', label: 'Монтаж' },
  { id: 'done', label: 'Готово' },
];

export type StepState = 'completed' | 'current' | 'error' | 'pending';

/**
 * Returns the index of the step that is "completed" for a given status.
 * For statuses that represent "step N is done, waiting", returns N.
 * For statuses that represent "step N is in progress", returns N-1.
 */
function completedUpTo(status: string): number {
  switch (status) {
    case 'idle':
      return -1;
    case 'generating_script':
      return 0;
    case 'script_ready':
      return 1;
    case 'searching_stock':
    case 'generating_images':
    case 'animating':
      return 1;
    case 'assembling':
      return 2;
    default:
      return -1;
  }
}

/**
 * Returns the index of the step that is "current" for a given status.
 * -1 means no step is actively running.
 */
function currentStep(status: string): number {
  switch (status) {
    case 'idle':
      return 0;
    case 'generating_script':
      return 1;
    case 'script_ready':
      return -1;
    case 'searching_stock':
    case 'generating_images':
    case 'animating':
      return 2;
    case 'assembling':
      return 3;
    case 'done':
      return -1;
    default:
      return -1;
  }
}

/**
 * Returns the state of each pipeline step for a given project status.
 * - completed: step is done
 * - current: step is in progress
 * - error: this step is where the error occurred
 * - pending: step hasn't been reached yet
 */
export function getStepStates(status: string, progress?: number): StepState[] {
  if (status === 'done') {
    return PIPELINE_STEPS.map(() => 'completed' as StepState);
  }

  if (status === 'error') {
    const errorIdx = getErrorStep(status, progress);
    return PIPELINE_STEPS.map((_, idx) => {
      if (errorIdx >= 0 && idx === errorIdx) return 'error' as StepState;
      if (errorIdx >= 0 && idx < errorIdx) return 'completed' as StepState;
      return 'pending' as StepState;
    });
  }

  const doneUpTo = completedUpTo(status);
  const current = currentStep(status);

  return PIPELINE_STEPS.map((_, idx) => {
    if (idx <= doneUpTo) return 'completed' as StepState;
    if (idx === current) return 'current' as StepState;
    return 'pending' as StepState;
  });
}

/**
 * Returns the index of the step where an error occurred, based on progress.
 *
 * Thresholds mirror the server pipeline in routes.ts:
 *   - < 20: script generation (server sets progress 0-19 during scripting)
 *   - 20-75: visual generation / animation (server sets progress 20-75)
 *   - >= 75: assembly / rendering (server sets progress 76+ for resume, 78+ for assembly)
 *
 * Returns -1 if progress is not available.
 */
export function getErrorStep(status: string, progress?: number): number {
  if (status !== 'error') return -1;
  if (typeof progress !== 'number') return -1;
  if (progress < 20) return 1;
  if (progress < 75) return 2;
  return 3;
}

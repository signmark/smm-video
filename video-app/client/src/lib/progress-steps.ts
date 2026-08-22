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
 * -1 means no step is completed yet.
 * For statuses that represent "step N is in progress", returns N-1 (previous step done).
 * For statuses that represent "step N is done, waiting", returns N.
 */
function completedUpTo(status: string): number {
  switch (status) {
    case 'idle':
      return -1; // nothing completed, step 0 is current
    case 'generating_script':
      return 0; // step 0 done, step 1 current
    case 'script_ready':
      return 1; // step 1 done (script ready, waiting for user)
    case 'searching_stock':
    case 'generating_images':
    case 'animating':
      return 1; // step 1 done, step 2 current
    case 'assembling':
      return 2; // step 2 done, step 3 current
    case 'done':
      return 4; // all done
    default:
      return -1;
  }
}

/**
 * Returns the index of the step that is "current" for a given status.
 * -1 means no step is current (e.g. done, error, unknown).
 */
function currentStep(status: string): number {
  switch (status) {
    case 'idle':
      return 0;
    case 'generating_script':
      return 1;
    case 'script_ready':
      return -1; // waiting for user, no step actively running
    case 'searching_stock':
    case 'generating_images':
    case 'animating':
      return 2;
    case 'assembling':
      return 3;
    case 'done':
      return -1; // all completed
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
export function getStepStates(status: string): StepState[] {
  if (status === 'error') {
    // Error state: all pending (caller can override with getErrorStep)
    return PIPELINE_STEPS.map(() => 'pending' as StepState);
  }

  if (status === 'done') {
    return PIPELINE_STEPS.map(() => 'completed' as StepState);
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
 * Returns the index of the step where an error occurred.
 * For error status, we look at progressMessage to infer which step was running.
 * Returns -1 if the error step cannot be determined.
 */
export function getErrorStep(status: string, progressMessage?: string): number {
  if (status !== 'error') return -1;
  if (!progressMessage) return -1;
  const msg = progressMessage.toLowerCase();
  // Russian keywords (toLowerCase works on Cyrillic in modern engines)
  if (msg.includes('сценари') || msg.includes('script')) return 1;
  if (msg.includes('визуал') || msg.includes('image') || msg.includes('изображени') ||
      msg.includes('сток') || msg.includes('stock') || msg.includes('анимац') ||
      msg.includes('animat') || msg.includes('клип')) return 2;
  if (msg.includes('рендер') || msg.includes('assembl') || msg.includes('монтаж') ||
      msg.includes('сборк') || msg.includes('video')) return 3;
  return -1;
}

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
    case 'done':
      return 3; // all 4 steps completed (index 0-3), step 4 = Готово also completed
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
    // Determine which step failed based on progress
    const errorIdx = getErrorStep(status, undefined, progress);
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
 * Returns the index of the step where an error occurred.
 * Primary: uses progress value (pipeline sets it by stage).
 *   < 20 → step 1 (script), 20-75 → step 2 (visual), ≥ 75 → step 3 (assembly)
 * Fallback: keyword matching on progressMessage.
 * Returns -1 if undetermined.
 */
export function getErrorStep(status: string, progressMessage?: string, progress?: number): number {
  if (status !== 'error') return -1;

  // Primary: use progress value
  if (typeof progress === 'number') {
    if (progress < 20) return 1;
    if (progress < 75) return 2;
    return 3;
  }

  // Fallback: keyword matching
  if (!progressMessage) return -1;
  const msg = progressMessage.toLowerCase();
  if (msg.includes('сценари') || msg.includes('script')) return 1;
  if (msg.includes('визуал') || msg.includes('image') || msg.includes('изображени') ||
      msg.includes('сток') || msg.includes('stock') || msg.includes('анимац') ||
      msg.includes('animat') || msg.includes('клип')) return 2;
  if (msg.includes('рендер') || msg.includes('assembl') || msg.includes('монтаж') ||
      msg.includes('сборк') || msg.includes('video')) return 3;
  return -1;
}

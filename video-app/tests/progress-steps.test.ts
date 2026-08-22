import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStepStates, getErrorStep, PIPELINE_STEPS } from '../client/src/lib/progress-steps.ts';

describe('getStepStates', () => {
  it('idle: first step current, rest pending', () => {
    const states = getStepStates('idle');
    assert.deepEqual(states, ['current', 'pending', 'pending', 'pending', 'pending']);
  });

  it('generating_script: step 1 current, step 0 completed', () => {
    const states = getStepStates('generating_script');
    assert.deepEqual(states, ['completed', 'current', 'pending', 'pending', 'pending']);
  });

  it('script_ready: step 1 completed (waiting for user), rest pending', () => {
    const states = getStepStates('script_ready');
    assert.deepEqual(states, ['completed', 'completed', 'pending', 'pending', 'pending']);
  });

  it('searching_stock: step 2 current', () => {
    const states = getStepStates('searching_stock');
    assert.deepEqual(states, ['completed', 'completed', 'current', 'pending', 'pending']);
  });

  it('generating_images: step 2 current', () => {
    const states = getStepStates('generating_images');
    assert.deepEqual(states, ['completed', 'completed', 'current', 'pending', 'pending']);
  });

  it('animating: step 2 current', () => {
    const states = getStepStates('animating');
    assert.deepEqual(states, ['completed', 'completed', 'current', 'pending', 'pending']);
  });

  it('assembling: step 3 current', () => {
    const states = getStepStates('assembling');
    assert.deepEqual(states, ['completed', 'completed', 'completed', 'current', 'pending']);
  });

  it('done: all steps completed', () => {
    const states = getStepStates('done');
    assert.deepEqual(states, ['completed', 'completed', 'completed', 'completed', 'completed']);
  });

  it('error with progress < 20: step 1 error, step 0 completed', () => {
    const states = getStepStates('error', 10);
    assert.deepEqual(states, ['completed', 'error', 'pending', 'pending', 'pending']);
  });

  it('error with progress 50: step 2 error, steps 0-1 completed', () => {
    const states = getStepStates('error', 50);
    assert.deepEqual(states, ['completed', 'completed', 'error', 'pending', 'pending']);
  });

  it('error with progress 80: step 3 error, steps 0-2 completed', () => {
    const states = getStepStates('error', 80);
    assert.deepEqual(states, ['completed', 'completed', 'completed', 'error', 'pending']);
  });

  it('error without progress: all pending', () => {
    const states = getStepStates('error');
    assert.deepEqual(states, ['pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it('unknown status: all pending', () => {
    const states = getStepStates('unknown_status');
    assert.deepEqual(states, ['pending', 'pending', 'pending', 'pending', 'pending']);
  });
});

describe('getErrorStep', () => {
  it('returns -1 for non-error status', () => {
    assert.equal(getErrorStep('done'), -1);
    assert.equal(getErrorStep('generating_script'), -1);
  });

  it('uses progress as primary signal', () => {
    assert.equal(getErrorStep('error', undefined, 5), 1);   // script phase
    assert.equal(getErrorStep('error', undefined, 19), 1);
    assert.equal(getErrorStep('error', undefined, 20), 2);  // visual phase
    assert.equal(getErrorStep('error', undefined, 74), 2);
    assert.equal(getErrorStep('error', undefined, 75), 3);  // assembly phase
    assert.equal(getErrorStep('error', undefined, 100), 3);
  });

  it('falls back to keyword matching when progress missing', () => {
    assert.equal(getErrorStep('error', 'Ошибка генерации сценария'), 1);
    assert.equal(getErrorStep('error', 'Script generation failed'), 1);
    assert.equal(getErrorStep('error', 'Не удалось сгенерировать изображения'), 2);
    assert.equal(getErrorStep('error', 'Stock search failed'), 2);
    assert.equal(getErrorStep('error', 'Рендеринг видео завершилось с ошибкой'), 3);
    assert.equal(getErrorStep('error', 'Assembly failed'), 3);
  });

  it('returns -1 when nothing matches', () => {
    assert.equal(getErrorStep('error'), -1);
    assert.equal(getErrorStep('error', ''), -1);
    assert.equal(getErrorStep('error', 'Something went wrong'), -1);
  });
});

describe('PIPELINE_STEPS', () => {
  it('has exactly 5 steps', () => {
    assert.equal(PIPELINE_STEPS.length, 5);
  });

  it('steps have id and label', () => {
    for (const step of PIPELINE_STEPS) {
      assert.ok(step.id, `step missing id`);
      assert.ok(step.label, `step missing label`);
    }
  });
});

// Mutation proof: verify that changing status-to-step mapping breaks tests
describe('mutation proof', () => {
  it('script_ready maps to step 1 completed, NOT step 2', () => {
    const states = getStepStates('script_ready');
    assert.equal(states[1], 'completed');
    assert.equal(states[2], 'pending');
  });

  it('assembling maps to step 3, NOT step 2', () => {
    const states = getStepStates('assembling');
    assert.equal(states[2], 'completed');
    assert.equal(states[3], 'current');
  });

  it('error at progress 50 marks step 2 as error, step 1 stays completed', () => {
    const states = getStepStates('error', 50);
    assert.equal(states[2], 'error');
    assert.equal(states[1], 'completed');
    assert.equal(states[3], 'pending');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getStepStates, getErrorStep, PIPELINE_STEPS } from '../lib/progress-steps.ts';

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

  it('error: all steps pending (error step unknown)', () => {
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

  it('returns -1 for error without message', () => {
    assert.equal(getErrorStep('error'), -1);
    assert.equal(getErrorStep('error', ''), -1);
  });

  it('returns 1 for script-related error', () => {
    assert.equal(getErrorStep('error', 'Ошибка генерации сценария'), 1);
    assert.equal(getErrorStep('error', 'Script generation failed'), 1);
  });

  it('returns 2 for image/visual-related error', () => {
    assert.equal(getErrorStep('error', 'Не удалось сгенерировать изображения'), 2);
    assert.equal(getErrorStep('error', 'Stock search failed'), 2);
    assert.equal(getErrorStep('error', 'Ошибка анимации клипа'), 2);
  });

  it('returns 3 for render/assembly-related error', () => {
    assert.equal(getErrorStep('error', 'Рендеринг видео завершился с ошибкой'), 3);
    assert.equal(getErrorStep('error', 'Assembly failed'), 3);
    assert.equal(getErrorStep('error', 'Ошибка сборки'), 3);
  });

  it('returns -1 for unrecognized error message', () => {
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

// Mutation test: verify that changing status-to-step mapping breaks tests
describe('mutation proof', () => {
  it('script_ready maps to step 1 completed, NOT step 2', () => {
    const states = getStepStates('script_ready');
    // Step 1 (Сценарий) should be completed
    assert.equal(states[1], 'completed');
    // Step 2 (Визуал) should be pending — NOT current
    assert.equal(states[2], 'pending');
  });

  it('assembling maps to step 3, NOT step 2', () => {
    const states = getStepStates('assembling');
    // Step 2 should be completed, not current
    assert.equal(states[2], 'completed');
    // Step 3 should be current
    assert.equal(states[3], 'current');
  });
});

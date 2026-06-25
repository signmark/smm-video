/**
 * Regression tests for the resume / rebuild decision logic.
 *
 * These are PURE unit tests — no network, no ffmpeg, no API spend.
 * Run: cd video-app && npx tsx --test tests/resume-policy.test.ts
 *
 * Guards the bug where an interrupted assembly left a truncated final MP4
 * (`moov atom not found`); "Продолжить" / "Пересобрать субтитры" then burned
 * subtitles onto the corrupt file, failed silently, and marked the project done
 * with an empty video. The fix: a final video that merely EXISTS is not enough —
 * it must be VALID (probed duration > 0). Otherwise we re-assemble from clips.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideResumeStage } from '../server/resume-policy.js';

test('auto + valid final + clips → reburn (just refresh subtitles)', () => {
  assert.equal(decideResumeStage({ mode: 'auto', assembledValid: true, clipsExist: true }), 'reburn');
});

test('auto + valid final + no clips → reburn (clips not needed when final is good)', () => {
  assert.equal(decideResumeStage({ mode: 'auto', assembledValid: true, clipsExist: false }), 'reburn');
});

test('REGRESSION: auto + corrupt final + clips → reassemble (not reburn)', () => {
  // This is the exact 358.mp4 scenario: truncated final, clips intact.
  // Must re-assemble — never burn subtitles onto a corrupt file.
  assert.equal(decideResumeStage({ mode: 'auto', assembledValid: false, clipsExist: true }), 'reassemble');
});

test('auto + corrupt final + no clips → error (nothing to rebuild from)', () => {
  assert.equal(decideResumeStage({ mode: 'auto', assembledValid: false, clipsExist: false }), 'error');
});

test('rebuild always re-assembles, ignoring a valid final video', () => {
  assert.equal(decideResumeStage({ mode: 'rebuild', assembledValid: true, clipsExist: true }), 'reassemble');
});

test('rebuild + corrupt final + clips → reassemble', () => {
  assert.equal(decideResumeStage({ mode: 'rebuild', assembledValid: false, clipsExist: true }), 'reassemble');
});

test('rebuild needs clips even when a valid final exists → error without clips', () => {
  assert.equal(decideResumeStage({ mode: 'rebuild', assembledValid: true, clipsExist: false }), 'error');
});

test('rebuild + corrupt final + no clips → error', () => {
  assert.equal(decideResumeStage({ mode: 'rebuild', assembledValid: false, clipsExist: false }), 'error');
});

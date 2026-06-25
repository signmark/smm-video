/**
 * Regression test for corrupt-MP4 detection via probeActualDuration.
 *
 * Uses the REAL ffmpeg/ffprobe binaries (already required by the app) to build
 * fixtures. No external API, no FAL spend. This proves the mechanism the resume
 * fix relies on: a truncated / 0-byte / missing file probes to 0 duration, a
 * playable file probes to > 0.
 *
 * Run: cd video-app && npx tsx --test tests/probe-corrupt.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { probeActualDuration } from '../server/services/video-assembler.js';

const execFileAsync = promisify(execFile);

let tmpDir: string;
let validMp4: string;
let zeroByteMp4: string;
let truncatedMp4: string;
let missingMp4: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-test-'));
  validMp4 = path.join(tmpDir, 'valid.mp4');
  zeroByteMp4 = path.join(tmpDir, 'zero.mp4');
  truncatedMp4 = path.join(tmpDir, 'truncated.mp4');
  missingMp4 = path.join(tmpDir, 'does-not-exist.mp4');

  // 1s playable test clip (color source + silent audio, faststart so moov is read).
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=black:s=128x128:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart',
    validMp4,
  ]);

  // 0-byte file.
  await fs.writeFile(zeroByteMp4, Buffer.alloc(0));

  // Truncated file: first half of the valid clip → moov atom missing.
  const full = await fs.readFile(validMp4);
  await fs.writeFile(truncatedMp4, full.subarray(0, Math.floor(full.length / 2)));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test('valid MP4 probes to a positive duration', async () => {
  const dur = await probeActualDuration(validMp4);
  assert.ok(dur > 0, `expected duration > 0, got ${dur}`);
});

test('0-byte file probes to 0 (treated as corrupt)', async () => {
  assert.equal(await probeActualDuration(zeroByteMp4), 0);
});

test('truncated MP4 (no moov atom) probes to 0 (treated as corrupt)', async () => {
  assert.equal(await probeActualDuration(truncatedMp4), 0);
});

test('missing file probes to 0', async () => {
  assert.equal(await probeActualDuration(missingMp4), 0);
});

/**
 * Pure decision logic for the resume / rebuild pipeline.
 *
 * Kept side-effect free (no fs, no ffmpeg, no DB) so it can be unit-tested and
 * so the routing of resume requests has a single, auditable source of truth.
 */

export type ResumeStage = 'reburn' | 'reassemble' | 'error';

export interface ResumeDecisionInput {
  /** 'rebuild' = user explicitly asked for a full re-assembly from saved materials. */
  mode: 'auto' | 'rebuild';
  /** True only when the existing final MP4 is a playable file (probed duration > 0). */
  assembledValid: boolean;
  /** True only when ALL per-scene clips are present on disk. */
  clipsExist: boolean;
}

/**
 * Decide what the resume pipeline should do.
 *
 * - 'reburn'     — a valid final video exists, just re-burn subtitles onto it.
 * - 'reassemble' — re-assemble the final video from saved clips + audio.
 * - 'error'      — nothing usable to resume from.
 *
 * Critical rule (the bug this guards against): a final MP4 that merely *exists*
 * is NOT enough to re-burn subtitles. An interrupted assembly leaves a truncated
 * file (`moov atom not found`); burning subtitles onto it fails silently and the
 * project gets marked done with an empty video. So 'reburn' is only chosen when
 * the file is actually valid; otherwise we fall back to a full re-assembly.
 */
export function decideResumeStage(input: ResumeDecisionInput): ResumeStage {
  const { mode, assembledValid, clipsExist } = input;
  // 'rebuild' always ignores the existing final video and re-assembles.
  if (mode !== 'rebuild' && assembledValid) return 'reburn';
  if (clipsExist) return 'reassemble';
  return 'error';
}

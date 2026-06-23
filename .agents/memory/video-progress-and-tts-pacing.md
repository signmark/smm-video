---
name: Video-app progress bar & TTS pacing
description: Why TTS has no speed adjustment and how the animation-phase progress bar is driven (smooth + monotonic)
---

# TTS pacing — no speed adjustment
- The video assembler sets each clip's length to its audio duration (clipDur = audioDuration).
  Therefore TTS audio must be returned at its NATURAL pace — do NOT add atempo speed-up/slow-down.
- **Why:** an earlier atempo step sped up only long-narration scenes to fit a target duration,
  which made voice pacing inconsistent (some scenes suddenly fast) since the assembler already
  retimes the clip to the audio. Removing it fixed the "voice randomly speeds up" complaint.
- **How to apply:** in tts-generator.ts keep the natural duration; the per-clip retiming lives in
  the assembler. (The separate pitch shift via asetrate+atempo for voice variety is unrelated — keep it.)

# Animation-phase progress bar (must stay smooth & monotonic)
- During animation all scenes animate in PARALLEL (Promise.all), so a completion-count-based
  progress freezes at the start value for the whole ~60-130s phase, then jumps near the end.
  Users read a frozen/jumpy bar as "doesn't match the stage".
- Fix shape (routes.ts I2V phase): drive progress by a TIME estimate during animation
  (band ~35→73 over ~90s, clamped at 0.95) inside the per-scene onWait callback, AND on each
  scene completion. Every write uses `Math.max(timeBased, stepFloor)` where
  stepFloor = 35 + (completedClips/total)*40.
- **Why max of both:** scenes finish at different times; a still-running scene's onWait can fire
  AFTER a completed scene raised progress, and would otherwise write a smaller time-based value →
  visible rollback. Both candidates (time and completedClips) only ever increase, so the max is
  strictly non-decreasing.
- **How to verify:** poll GET /api/videos (the list endpoint Home.tsx uses) every 3s through a full
  generation and assert progress never decreases. list and detail endpoints already agree.

---
name: Video music length & A/V sync
description: Why background music must be sized to the probed video length, and where voice/subtitle sync comes from in video-app
---

# Background music length

- Clip length in `assembleFromClips` is **audio-driven**: `clipDur = scene.audioDuration` (natural TTS length), which is usually **longer** than the planned `scene.duration`.
- **Rule:** any duration used to size/loop background music (or any whole-video overlay) must come from `probeActualDuration(finalVideoPath)`, **not** from `sum(scene.duration)`.
- **Why:** music looped only to the planned sum ends before the audio-driven video does → music cuts off on the last scene. Fixed by probing the finished file (+1s margin); `mixBackgroundMusic` uses `amix=duration=first` so any extra music is trimmed to the video.

# Voice / subtitle sync (the timeline is internally consistent)

- Per scene: clip is muxed to `clipDur = audioDuration`, so voice fills the clip exactly.
- Crossfade path (`assemblWithCrossfade`): video `xfade` and audio `acrossfade` both overlap by `cf`; subtitle start times compensate with the **same** `-i*cf` (in `burnSubtitles`). All three use identical math → no systematic drift.
- **Therefore** real desync comes from places that DON'T set `audioDuration`: the resume path historically passed `audioDuration: undefined`, so the clip fell back to planned length and truncated the voice. Always probe existing audio on resume.
- `assembleFromClips` ends with a sync-verification log: `expected = sum(actualDurations) - (n-1)*cf + (flashCut? (n-1)*0.12 : 0)`; warns if final probed length drifts > 0.75s. Flash gaps and crossfade overlaps are mutually exclusive branches.

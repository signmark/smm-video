---
name: HeyGen avatar/agent integration
description: How HeyGen FAL models fit the video-app pipeline — avatar lip-sync via TTS muxing, dual-pipeline scene handling, agent short-circuit
---

# HeyGen models in video-app

Two animation models: `heygen-avatar` (FAL `avatar5/digital-twin`) and `heygen-agent` (FAL `v3/video-agent`). Both keep `isT2VModel()=false`.

## Avatar lip-sync without double audio
**Rule:** an avatar clip must be lip-synced to the SAME TTS file that assembly muxes as audio.
**Why:** `assembleFromClips` muxes `-map 0:v:0 -map 1:a:0` — video from the clip, audio from the per-scene TTS mp3; the clip's own (HeyGen) audio is discarded. Feeding that TTS to digital-twin as `audio_url` (data URI) and also as the scene's audioPath = perfect sync, no double audio, subtitles/downstream unchanged.
**How to apply:** in BOTH the I2V and T2V Phase A clip loops, an `avatar` scene must `await` its own per-scene TTS promise, read the mp3 buffer, and pass it to `generateAvatarClip`. Keep TTS as a per-scene array (not a single `Promise.all`) so the clip loop can await one scene's audio while others animate.

## Per-scene avatar works in BOTH pipelines
**Rule:** `videoSource='avatar'` must be handled in the I2V clip loop AND the T2V clip loop.
**Why:** the per-scene source toggle is exposed for all projects regardless of model; a T2V project with an avatar scene silently fell through to `animateText` until the T2V branch got its own avatar path. Title-card fallback on failure (T2V has no reference frame; I2V can fall back to static frame).

## Whole-video avatar vs agent
- `heygen-avatar` whole-video: `runStockPrecheck` detects the model, sets every scene `videoSource='avatar'`, skips stock/variants, releases to `script_ready` + `stockPrechecked=true`. Generation then runs the normal I2V path (image-gen skipped for avatar scenes).
- `heygen-agent`: no scenes at all. `runScriptOnly` and `runGenerationPipeline` short-circuit early — build one prompt from `customScenario || topic+additionalDetails`, call `generateAgentVideo`, write final MP4, done.

`DEFAULT_HEYGEN_AVATAR` is the fallback preset name; project-level `heygenAvatar` (must match a FAL preset name) overrides it.

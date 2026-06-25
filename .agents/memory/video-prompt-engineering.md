---
name: Video-app prompt engineering layers
description: Where prompt-quality guidance lives in video-app and the central injection point that applies to every script-builder mode.
---

# Video-app prompt engineering — where the levers are

The video-app already has strong, model-tuned prompt engineering spread across three layers. Before "improving prompts", know which layer owns what so you don't duplicate or fight existing tuning.

- **Script prompts** (`script-generator.ts`): per-mode/per-model builders (buildI2VPrompt, buildWanI2VPrompt, buildKlingI2VPrompt, buildSeedanceI2VPrompt, buildT2VPrompt, buildViralReelsPrompt, landing/custom variants). The dispatcher in `generateScript()` picks one by `scriptMode` / `t2v` / `animationModel`. Viral mode already enforces Hook/Body/CTA.
- **Motion prompts** (`fal-animator.ts`): model-specific wrappers buildWanPrompt / buildKlingPrompt (trims to 400 chars) / buildMinimaxPrompt / buildLumaPrompt / buildSeedancePrompt — each appends a model-appropriate TECH_TAIL (no morphing / physics / cinematic). Kling intentionally kept concise.
- **Image prompts** (`image-generator.ts`): `generateImage()` central `enhancedPrompt` suffix adds cinematic/quality cues + a format-specific compositionHint to EVERY image regardless of which builder produced the base prompt.

## Central injection point (the safe lever)
**Rule:** To apply cross-cutting prompt guidance to ALL script modes at once, append it in `generateScript()` AFTER the per-builder `prompt` is selected and BEFORE the `additionalDetails` block — not by editing each builder.

**Why:** there are ~10 builders with differing JSON schemas; editing each is error-prone and drifts. The post-selection append (same spot `additionalDetails` already uses) reaches every path uniformly.

**How to apply:** phrase guidance conditionally ("when filling the visual and motion fields") and reference fields generically, since field names differ per builder. `parseScriptJson()` only maps known keys and drops extras, so referencing a field a builder lacks won't break parsing — but still include a "do NOT add JSON keys beyond the schema" line to curb drift.

## Gotchas
- Script generation is **async**: `POST /api/videos/:id/generate-script` returns `{success, message}` immediately; poll `GET /api/videos/:id` until `status` leaves `generating_script` (→ `script_ready`).
- video-app server runs via `tsx` with no watch — restart the **Video App** workflow after server-side edits. Server-only prompt edits need NO vite build (that's only for client changes).

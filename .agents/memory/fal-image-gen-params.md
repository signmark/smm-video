---
name: FAL image-gen param gotchas (video-app)
description: Correct param shapes for FAL image models used as fallbacks in video-app image-generator.ts
---

- FAL Flux (`fal-ai/flux/schnell`) `image_size` accepts ONLY the enum set `square_hd|square|portrait_4_3|portrait_16_9|landscape_4_3|landscape_16_9` (or a `{width,height}` object). For a vertical 9:16 image the value is `portrait_16_9` — NOT `portrait_9_16` (invalid → 422 `Input should be a valid dictionary or object`). The "16_9" suffix on a portrait still means a vertical 9:16 frame.
- FAL Nano Banana (`fal-ai/nano-banana`) uses `aspect_ratio` (e.g. `9:16`), not `image_size`.
- Nano Banana intermittently 422s with "model did not generate the expected output ... unsafe content / prompt incompatible" — prompt/content dependent, succeeds on most frames. This is why a WORKING Flux fallback matters: if Flux's param is broken, a single Nano Banana refusal drops the frame to a placeholder.

**Why:** A user hit placeholder frames because Flux fallback always 422'd on the bad `image_size`, so any Nano Banana refusal had no real backup.
**How to apply:** When editing FAL image fallbacks, keep the provider order intact and verify each provider's param schema; test the changed call live against `https://fal.run/...` before trusting it.

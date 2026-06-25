---
name: Gemini proxy + Russian TTS stress accentuation
description: video-app Gemini calls must go through GEMINI_PROXY_URL (trial/geo-blocked key); and how Russian TTS homograph stress is fixed
---

# Gemini calls in video-app must use the proxy

**Rule:** every Gemini REST call in video-app must resolve its base host via
`GEMINI_PROXY_URL` (keep the `/v1beta/...` path, swap only protocol+host). Direct
calls to `generativelanguage.googleapis.com` fail with **403 "key suspended"**.

**Why:** the project's `GEMINI_API_KEY` is a trial key and is geo/policy-blocked on
direct access — it only works through the configured proxy. The key is the *same* on
dev and prod. `GEMINI_PROXY_URL` is loaded from Directus by `load-keys.ts` on prod;
in dev "Loaded 0 keys" so the proxy is empty and direct calls 403 (expected in dev).

**How to apply:** copy the `getGeminiBase()` pattern already in `script-generator.ts`,
`image-generator.ts`, `director.ts`, `veo-generator.ts` — never hardcode the Google
host. A standalone test hitting the Google URL directly will 403; that's the missing
proxy, not a code bug.

# Russian TTS stress (homograph fix)

`tts-generator.ts` `accentuateRussian()` asks Gemini (gemini-2.0-flash, via the proxy)
to insert Unicode combining acute accents (U+0301) after the stressed vowel using
sentence context, so homographs read correctly (духи́ perfume vs ду́хи spirits, за́мок
castle vs замо́к lock).

- The accented text feeds **OpenAI gpt-4o-mini-tts / tts-1 and Edge neural voices**
  (all honor U+0301). **HuggingFace mms** gets the raw text (its g2p can't use marks).
- Best-effort: missing key / non-OK / exception / non-Cyrillic → returns original text,
  never throws. Strict safety net: accept the model's output only if
  `stripStressMarks(out) === text.trim()` (i.e. it added nothing but stress marks);
  otherwise fall back. Results cached per-text (including the 403 fallback) to avoid
  re-hitting a failing key once per scene.
- Only runs for `lang==='ru'`. Note: `generateAudio` early-returns when `OPENAI_API_KEY`
  is absent (empty in dev) — so the whole TTS path, accentuation included, only exercises
  on prod where keys load from Directus.

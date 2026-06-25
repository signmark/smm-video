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
dev and prod.

**Where keys come from in dev:** `video-app/.env` already contains all needed keys
(OPENAI_API_KEY, GEMINI_API_KEY, GEMINI_PROXY_URL, GOOGLE_API_KEY, FAL_AI_API_KEY, …).
`load-keys.ts` does `dotenvConfig('../.env', override:false)` first, then Directus.
So in dev the server log `[load-keys] Loaded 0 API keys from Directus` is **normal** —
it means 0 *new* keys (the .env already provided them), NOT that keys are missing.
TTS and Gemini-proxy both work in dev. NOTE: the agent's interactive bash shell does
NOT source `.env`, so `echo $OPENAI_API_KEY` shows empty there — that's a shell quirk,
not the server's reality. Verify via the running server, not the shell env.

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

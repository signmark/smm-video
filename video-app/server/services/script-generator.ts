import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import type { Script, VideoFormat } from '../db.js';

// Each FAL model generates clips of a fixed duration — match scene layout to it.
function getModelClipDuration(animationModel: string): number {
  if (['kling', 'kling-pro', 'kling-t2v', 'kling-pro-t2v'].includes(animationModel)) return 10;
  if (animationModel === 'luma') return 9;
  // wan, wan-t2v, minimax, seedance — all produce ~5s clips
  return 5;
}

function getSceneLayout(durationSeconds: number, animationModel: string, clipDuration?: number): { sceneCount: number; sceneDuration: number } {
  const sceneDuration = clipDuration ?? getModelClipDuration(animationModel);
  const sceneCount = Math.max(2, Math.min(Math.round(durationSeconds / sceneDuration), 8));
  return { sceneCount, sceneDuration };
}

// ── I2V prompt (current pipeline) ────────────────────────────────────────────

function buildI2VPrompt(params: { topic: string; format: VideoFormat; duration: number; language: 'ru' | 'en' }, sceneCount: number, sceneDuration: number): string {
  const langName = params.language === 'ru' ? 'Russian' : 'English';
  const formatDesc =
    params.format === '9:16' ? 'vertical portrait (Shorts/Reels/TikTok)'
    : params.format === '16:9' ? 'horizontal landscape (YouTube)'
    : 'square (Instagram/VK)';
  // Russian speech rate ~1.8 words/sec (longer words), English ~2.3 words/sec
  const wordsPerSec = params.language === 'ru' ? 1.8 : 2.3;
  const narrationWords = Math.round(sceneDuration * wordsPerSec);

  return `Create a script for a ${params.duration}-second ${formatDesc} video about: "${params.topic}".

The script must have EXACTLY ${sceneCount} scenes (~${sceneDuration} seconds each).

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "video title in ${langName}",
  "scenes": [
    {
      "text": "Short punchy subtitle in ${langName} (max 6 words, shown on screen as caption)",
      "narration": "Voiceover text in ${langName}. MUST be exactly ~${narrationWords} words so it fills ${sceneDuration} seconds when read aloud at natural pace. Use complete sentences. DO NOT write less than ${narrationWords - 2} words.",
      "stockQuery": "2-4 simple English keywords for Pexels stock footage search. Generic visual terms ONLY — no brand names, no product names. Focus on the general visual concept. Examples: 'woman taking supplements', 'laboratory test tubes', 'healthy liver organ', 'scientist microscope', 'person smiling outdoors'",
      "imagePrompt": "Detailed English visual description combining background and subject together. Cinematic quality, photorealistic, specific details, NO TEXT IN IMAGE.",
      "motionPrompt": "English description of MOVEMENT only for this ${sceneDuration}s clip. Describe: [what moves] + [how it moves] + [camera movement]. Be specific and cinematic. Examples: 'Product slowly rotates 90 degrees clockwise, camera gently zooms in, soft studio light shifts from left to right' / 'Person walks toward camera, background blurs, slow dolly forward movement' / 'Camera pans smoothly left revealing the full product, object stays still, dramatic lighting sweep'",
      "backgroundPrompt": "Background/environment only in English. Describe the setting, lighting, atmosphere, colors — NO people, NO products, NO subjects. Example: 'Clean minimal white studio with soft gradient lighting, subtle shadow on floor, professional photography setup'",
      "subjectPrompt": "Subject only in English, isolated on pure white background. Describe the main object/person/product with precise details. Example: 'Red Nike Air Max sneaker, product shot, centered, sharp focus, studio lighting, isolated on white'",
      "duration": ${sceneDuration}
    }
  ]
}

Rules:
- "text" must be in ${langName}, max 6 words, punchy caption shown on screen
- "narration" must be in ${langName}, EXACTLY ~${narrationWords} words (${sceneDuration}s at natural speech pace), informative complete sentences
- "stockQuery" always in English, 2-4 generic keywords for Pexels stock search — NO brand names, NO product names, use common visual concepts a stock library would have
- "imagePrompt" always in English, vivid and specific (full scene, used as fallback for image gen)
- "motionPrompt" always in English, describes ONLY movement/animation — not what is in the scene, but HOW it moves. This is passed directly to the video AI model.
- "backgroundPrompt" always in English, environment only — no subjects
- "subjectPrompt" always in English, subject only on white background — no environment
- Exactly ${sceneCount} scenes total, each ~${sceneDuration}s
- Each scene flows logically to tell a story about the topic`;
}

// ── T2V prompt ─────────────────────────────────────────────────────────────────

function buildT2VPrompt(params: { topic: string; format: VideoFormat; duration: number; language: 'ru' | 'en' }, sceneCount: number, sceneDuration: number): string {
  const langName = params.language === 'ru' ? 'Russian' : 'English';
  const formatDesc =
    params.format === '9:16' ? 'vertical portrait 9:16, mobile-optimized'
    : params.format === '16:9' ? 'horizontal landscape 16:9, widescreen cinematic'
    : 'square 1:1';
  const wordsPerSec = params.language === 'ru' ? 1.8 : 2.3;
  const narrationWords = Math.round(sceneDuration * wordsPerSec);

  return `You are a Text-to-Video script writer. Create a script for a ${params.duration}-second ${formatDesc} video about: "${params.topic}".

The script must have EXACTLY ${sceneCount} scenes (~${sceneDuration} seconds each).

CRITICAL RULE FOR t2vPrompt: The AI generates each ${sceneDuration}-second clip INDEPENDENTLY with zero memory of other clips. You must describe EVERYTHING in every prompt — nothing can be assumed. Each scene MUST be visually DISTINCT (different camera angle, environment, action).

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "video title in ${langName}",
  "style_anchor": "3-5 words: visual style + color grade + film aesthetic, e.g.: 'cinematic hyperrealistic warm golden' or 'vibrant saturated 3D product ad' or 'moody documentary 4K handheld'",
  "scenes": [
    {
      "text": "Short punchy subtitle in ${langName} (max 8 words, shown on screen)",
      "narration": "Full voiceover text in ${langName}. Written to be read aloud in exactly ${sceneDuration} seconds at a natural conversational pace (~${narrationWords} words). Complete informative sentences.",
      "imagePrompt": "Detailed English visual description (fallback for image-based models). NO text in image.",
      "t2vPrompt": "ULTRA-DETAILED cinematic T2V prompt in English. MANDATORY structure — describe ALL of these: [STYLE: style_anchor + color grade + film look]. [ENVIRONMENT: exact location with every surface material (marble/wood/concrete/glass), wall/floor textures, colors, patterns, spatial depth]. [LIGHTING: light source type (neon/sunlight/studio/candle), direction, color temperature in Kelvin, shadows, reflections, highlights]. [SUBJECT: every visible object/person — exact colors, materials (matte/glossy/metallic/fabric), proportions, position in frame]. [ACTION: precise movement — what moves, speed (slow/fast), direction, distance]. [CAMERA: shot type (ECU/CU/MS/WS/aerial/macro) + movement (dolly in/crane up/arc left/static/handheld) + speed]. [ATMOSPHERE: fog/dust/bokeh/particles/depth-of-field/lens flare/film grain]. Leave NOTHING to imagination. 5-8 dense sentences.",
      "duration": ${sceneDuration}
    }
  ]
}

Rules:
- t2vPrompt MUST be exhaustively detailed — T2V model has NO reference image, it generates everything from your words alone
- Each scene must differ: Scene 1 = wide establishing shot, Scene 2 = medium/detail shot different angle, Scene 3+ = dramatic close-up/aerial/climax
- Every object, color, material, texture must be explicitly named in t2vPrompt
- "text" in ${langName}, brief and impactful (max 8 words)
- "narration" in ${langName}, ~${narrationWords} words, natural spoken language, fills ${sceneDuration}s
- t2vPrompt always in English
- Exactly ${sceneCount} scenes total`;
}

// ── Landing page product promo prompts ───────────────────────────────────────

function buildLandingI2VPrompt(params: { landingPageContent: string; topic: string; format: VideoFormat; duration: number; language: 'ru' | 'en' }, sceneCount: number, sceneDuration: number): string {
  const langName = params.language === 'ru' ? 'Russian' : 'English';
  const formatDesc =
    params.format === '9:16' ? 'vertical portrait (Shorts/Reels/TikTok)'
    : params.format === '16:9' ? 'horizontal landscape (YouTube)'
    : 'square (Instagram/VK)';
  const wordsPerSec = params.language === 'ru' ? 1.8 : 2.3;
  const narrationWords = Math.round(sceneDuration * wordsPerSec);
  // Extract first meaningful line as a strong product hint
  const firstLine = params.landingPageContent.split(/[.!?\n]/).find(l => l.trim().length > 10)?.trim() ?? '';

  return `You are a top-tier product marketing expert and video scriptwriter.

⚠️ CRITICAL INSTRUCTION: You MUST base this script EXCLUSIVELY on the landing page content provided below.
Do NOT use any prior training knowledge about the domain name, URL, or company name.
The landing page content is the ONLY source of truth. If your prior knowledge contradicts this content — IGNORE your prior knowledge.

PRODUCT SUMMARY (extracted from page title/header):
"${firstLine}"

FULL LANDING PAGE CONTENT:
"""
${params.landingPageContent.slice(0, 6000)}
"""

Create a ${params.duration}-second ${formatDesc} PRODUCT PROMOTION video script with EXACTLY ${sceneCount} scenes (~${sceneDuration} seconds each).

The video must: hook viewers in the first 3 seconds, clearly communicate the product's core value, highlight 2-3 key benefits, and end with a strong call-to-action. Use the product's actual name, features, and benefits FROM THE LANDING PAGE CONTENT ABOVE — not from any other source.

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "catchy video title in ${langName}",
  "scenes": [
    {
      "text": "Short punchy subtitle in ${langName} (max 6 words, shown on screen as caption)",
      "narration": "Voiceover in ${langName}. EXACTLY ~${narrationWords} words. Natural spoken language, persuasive but not pushy. Hook, benefit, or CTA depending on scene position.",
      "stockQuery": "2-4 simple English keywords for Pexels stock footage. Generic visual terms: 'person using laptop', 'team collaboration office', 'smartphone app interface', 'happy customer smiling'. NO brand names.",
      "imagePrompt": "Detailed English visual for this scene. Cinematic, photorealistic, NO TEXT IN IMAGE.",
      "motionPrompt": "English description of camera/subject movement for this ${sceneDuration}s clip.",
      "backgroundPrompt": "Background/environment only in English. Setting, lighting, atmosphere — NO people, NO products.",
      "subjectPrompt": "Main subject only in English on pure white background. Product/person with precise visual details.",
      "duration": ${sceneDuration}
    }
  ]
}

Scene structure for a promo reel:
- Scene 1: HOOK — grab attention, tease the problem or transformation (don't name the product yet)
- Scene 2: PROBLEM/PAIN — relatable pain point the product solves
- Scenes 3+: SOLUTION/BENEFITS — show product solving the problem, key features
- Last scene: CTA — clear call-to-action (visit site, try free, get started)

Rules:
- "text" in ${langName}, max 6 words, punchy subtitle shown on screen
- "narration" in ${langName}, EXACTLY ~${narrationWords} words, conversational tone
- "stockQuery" always in English, generic visual keywords (no brand/product names)
- "imagePrompt" always in English, vivid and specific
- Exactly ${sceneCount} scenes`;
}

function buildLandingT2VPrompt(params: { landingPageContent: string; topic: string; format: VideoFormat; duration: number; language: 'ru' | 'en' }, sceneCount: number, sceneDuration: number): string {
  const langName = params.language === 'ru' ? 'Russian' : 'English';
  const formatDesc =
    params.format === '9:16' ? 'vertical portrait 9:16, mobile-optimized'
    : params.format === '16:9' ? 'horizontal landscape 16:9, widescreen cinematic'
    : 'square 1:1';
  const wordsPerSec = params.language === 'ru' ? 1.8 : 2.3;
  const narrationWords = Math.round(sceneDuration * wordsPerSec);

  // Extract first meaningful line as a strong product hint
  const firstLine = params.landingPageContent.split(/[.!?\n]/).find(l => l.trim().length > 10)?.trim() ?? '';

  return `You are a top-tier product marketing expert and video scriptwriter.

⚠️ CRITICAL INSTRUCTION: You MUST base this script EXCLUSIVELY on the landing page content provided below.
Do NOT use any prior training knowledge about the domain name, URL, or company name.
The landing page content is the ONLY source of truth. If your prior knowledge contradicts this content — IGNORE your prior knowledge.

PRODUCT SUMMARY (extracted from page title/header):
"${firstLine}"

FULL LANDING PAGE CONTENT:
"""
${params.landingPageContent.slice(0, 6000)}
"""

Create a ${params.duration}-second ${formatDesc} PRODUCT PROMOTION script with EXACTLY ${sceneCount} scenes (~${sceneDuration} seconds each).

CRITICAL RULE FOR t2vPrompt: Each ${sceneDuration}-second clip is generated INDEPENDENTLY with zero context from other clips. Describe EVERYTHING in every t2vPrompt. Each scene MUST be visually DISTINCT.

Return ONLY valid JSON, no markdown:
{
  "title": "catchy video title in ${langName}",
  "style_anchor": "3-5 words: visual style for the whole promo, e.g. 'clean modern bright professional' or 'dark moody cinematic product'",
  "scenes": [
    {
      "text": "Short punchy subtitle in ${langName} (max 8 words)",
      "narration": "Voiceover in ${langName}. ~${narrationWords} words. Hook, benefit, or CTA depending on scene.",
      "imagePrompt": "Detailed English visual description (fallback). NO text in image.",
      "t2vPrompt": "ULTRA-DETAILED cinematic T2V prompt in English. [STYLE: style_anchor + color grade]. [ENVIRONMENT: exact location, materials, textures, colors]. [LIGHTING: source, direction, temperature, shadows]. [SUBJECT: every object/person — colors, materials, position]. [ACTION: precise movement]. [CAMERA: shot type + movement]. [ATMOSPHERE: bokeh/depth/grain]. 5-8 dense sentences.",
      "duration": ${sceneDuration}
    }
  ]
}

Scene structure: Hook → Pain Point → Solution/Benefits → CTA
- narration always in ${langName}, ~${narrationWords} words
- t2vPrompt always in English, exhaustively detailed
- Exactly ${sceneCount} scenes`;
}

// ── Custom scenario prompts ───────────────────────────────────────────────────

function buildCustomI2VPrompt(params: { customScenario: string; format: VideoFormat; duration: number; language: 'ru' | 'en' }, sceneCount: number, sceneDuration: number): string {
  const langName = params.language === 'ru' ? 'Russian' : 'English';
  const formatDesc =
    params.format === '9:16' ? 'vertical portrait (Shorts/Reels/TikTok)'
    : params.format === '16:9' ? 'horizontal landscape (YouTube)'
    : 'square (Instagram/VK)';
  const wordsPerSec = params.language === 'ru' ? 1.8 : 2.3;
  const narrationWords = Math.round(sceneDuration * wordsPerSec);

  return `You are a video script parser. The user has provided a detailed custom scenario for a ${params.duration}-second ${formatDesc} video.

USER'S SCENARIO:
"""
${params.customScenario}
"""

Parse this scenario into EXACTLY ${sceneCount} scenes (~${sceneDuration} seconds each). Extract or compose the best content from the scenario.

Return ONLY valid JSON, no markdown, no explanation:
{
  "title": "concise video title in ${langName}",
  "scenes": [
    {
      "text": "Short punchy subtitle in ${langName} (max 8 words, shown on screen)",
      "narration": "Full voiceover text in ${langName}. Written to be read aloud in exactly ${sceneDuration} seconds at a natural conversational pace (~${narrationWords} words). Complete informative sentences.",
      "imagePrompt": "Detailed English visual description combining background and subject. Cinematic quality, photorealistic, NO TEXT IN IMAGE.",
      "backgroundPrompt": "Background/environment only in English. Setting, lighting, atmosphere — NO people, NO products.",
      "subjectPrompt": "Main subject only in English, isolated on pure white background. Product/person/object with precise visual details.",
      "duration": ${sceneDuration}
    }
  ]
}

Rules:
- "text" must be in ${langName}, brief and impactful (max 8 words)
- "narration" must be in ${langName}, ~${narrationWords} words, natural spoken language filling ${sceneDuration}s
- "imagePrompt" always in English, vivid and specific (full scene fallback)
- "backgroundPrompt" always in English, environment only, no subjects
- "subjectPrompt" always in English, isolated subject on white background
- Exactly ${sceneCount} scenes total, each ~${sceneDuration}s
- Keep the user's story structure and key moments intact`;
}

function buildCustomT2VPrompt(params: { customScenario: string; format: VideoFormat; duration: number; language: 'ru' | 'en' }, sceneCount: number, sceneDuration: number): string {
  const langName = params.language === 'ru' ? 'Russian' : 'English';
  const formatDesc =
    params.format === '9:16' ? 'vertical portrait 9:16'
    : params.format === '16:9' ? 'horizontal landscape 16:9'
    : 'square 1:1';
  const wordsPerSec = params.language === 'ru' ? 1.8 : 2.3;
  const narrationWords = Math.round(sceneDuration * wordsPerSec);

  return `You are a Text-to-Video script parser. The user has provided a custom scenario for a ${params.duration}-second ${formatDesc} video.

USER'S SCENARIO:
"""
${params.customScenario}
"""

Parse into EXACTLY ${sceneCount} scenes (~${sceneDuration} seconds each). Extract and EXPAND all visual and narrative details.

CRITICAL: The AI generates each ${sceneDuration}-second clip INDEPENDENTLY with zero memory of other clips. Describe EVERYTHING in every t2vPrompt — nothing can be assumed. Each scene MUST be visually DISTINCT.

Return ONLY valid JSON, no markdown:
{
  "title": "concise video title in ${langName}",
  "style_anchor": "3-5 words: visual style + color grade + film aesthetic extracted from scenario, e.g. 'cinematic dark moody warm' or 'bright saturated product commercial'",
  "scenes": [
    {
      "text": "Short subtitle in ${langName} (max 8 words)",
      "narration": "Full voiceover text in ${langName}. Written to be read aloud in exactly ${sceneDuration} seconds at a natural conversational pace (~${narrationWords} words). Complete informative sentences.",
      "imagePrompt": "Detailed English visual description (fallback for I2V). NO text in image.",
      "t2vPrompt": "ULTRA-DETAILED cinematic T2V prompt in English. MANDATORY structure — describe ALL of these: [STYLE: style_anchor + color grade + film look]. [ENVIRONMENT: exact location with every surface material (marble/wood/concrete/glass), wall/floor textures, colors, patterns, spatial depth]. [LIGHTING: light source type (neon/sunlight/studio/candle), direction, color temperature in Kelvin, shadows, reflections, highlights]. [SUBJECT: every visible object/person — exact colors, materials (matte/glossy/metallic/fabric), proportions, position in frame]. [ACTION: precise movement — what moves, speed (slow/fast), direction, distance]. [CAMERA: shot type (ECU/CU/MS/WS/aerial/macro) + movement (dolly in/crane up/arc left/static/handheld) + speed]. [ATMOSPHERE: fog/dust/bokeh/particles/depth-of-field/lens flare/film grain]. Leave NOTHING to imagination. 5-8 dense sentences.",
      "duration": ${sceneDuration}
    }
  ]
}

Keep user's story structure but EXPAND visual details. t2vPrompt always in English. narration always in ${langName}.
Scene 1 = wide establishing shot. Scene 2 = different angle/detail. Scene 3+ = climax/dramatic close-up.
Every object, color, material, texture must be explicitly named — T2V model has NO reference image.`;
}

// ── JSON parsing ──────────────────────────────────────────────────────────────

function parseScriptJson(text: string, sceneCount: number, isT2V: boolean): Script {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON for script');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    title: parsed.title || 'Untitled',
    consistencyBlock: parsed.consistency_block || parsed.style_anchor || undefined,
    scenes: (parsed.scenes as any[]).slice(0, sceneCount).map((s) => ({
      id: uuidv4(),
      text: String(s.text || ''),
      narration: s.narration ? String(s.narration) : undefined,
      stockQuery: s.stockQuery || s.stock_query || undefined,
      imagePrompt: String(s.imagePrompt || s.image_prompt || ''),
      motionPrompt: s.motionPrompt || s.motion_prompt || undefined,
      backgroundPrompt: s.backgroundPrompt || s.background_prompt || undefined,
      subjectPrompt: s.subjectPrompt || s.subject_prompt || undefined,
      t2vPrompt: s.t2vPrompt || s.t2v_prompt || undefined,
      duration: Number(s.duration) || 5,
    })),
  };
}

// ── AI providers ──────────────────────────────────────────────────────────────

function getGeminiBase(): string {
  const proxyUrl = process.env.GEMINI_PROXY_URL;
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl);
      console.log(`[script-gen] Gemini via proxy: ${u.host}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      console.warn(`[script-gen] Invalid GEMINI_PROXY_URL: ${proxyUrl}`);
    }
  } else {
    console.warn(`[script-gen] GEMINI_PROXY_URL not set — direct call may fail by location`);
  }
  return 'https://generativelanguage.googleapis.com';
}

async function generateWithGemini(prompt: string, apiKey: string, systemInstruction?: string): Promise<string> {
  const base = getGeminiBase();
  const url = `${base}/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, topP: 0.95, maxOutputTokens: 4096 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json() as any;
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: any) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

async function generateWithDeepSeek(prompt: string, apiKey: string, systemInstruction?: string): Promise<string> {
  const messages: any[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 4096, temperature: 0.7 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json() as any;
  return data.choices[0].message.content.trim();
}

async function generateWithOpenAI(prompt: string, apiKey: string, systemInstruction?: string): Promise<string> {
  const messages: any[] = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: prompt });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 2048 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }
  const data = await res.json() as any;
  return data.choices[0].message.content.trim();
}

async function generateWithClaude(prompt: string, apiKey: string, systemInstruction?: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2048,
    system: systemInstruction,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = message.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response type');
  return block.text.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateScript(params: {
  topic: string;
  format: VideoFormat;
  duration: number;
  language: 'ru' | 'en';
  customScenario?: string;
  landingPageContent?: string;
  t2v?: boolean;
  animationModel?: string;
  clipDuration?: number;
  additionalDetails?: string;
}): Promise<Script> {
  // Guard: null/undefined language defaults to Russian
  const safeParams = { ...params, language: (params.language ?? 'ru') as 'ru' | 'en' };
  const { sceneCount, sceneDuration } = getSceneLayout(safeParams.duration, safeParams.animationModel ?? 'wan', safeParams.clipDuration);
  const isT2V = safeParams.t2v === true;
  const hasCustom = safeParams.customScenario && safeParams.customScenario.trim().length > 10;
  const hasLanding = safeParams.landingPageContent && safeParams.landingPageContent.trim().length > 50;

  let prompt: string;
  if (hasLanding) {
    prompt = isT2V
      ? buildLandingT2VPrompt({ ...safeParams, landingPageContent: safeParams.landingPageContent! }, sceneCount, sceneDuration)
      : buildLandingI2VPrompt({ ...safeParams, landingPageContent: safeParams.landingPageContent! }, sceneCount, sceneDuration);
  } else if (hasCustom) {
    prompt = isT2V
      ? buildCustomT2VPrompt({ ...safeParams, customScenario: safeParams.customScenario! }, sceneCount, sceneDuration)
      : buildCustomI2VPrompt({ ...safeParams, customScenario: safeParams.customScenario! }, sceneCount, sceneDuration);
  } else {
    prompt = isT2V
      ? buildT2VPrompt(safeParams, sceneCount, sceneDuration)
      : buildI2VPrompt(safeParams, sceneCount, sceneDuration);
  }

  // Append user's additional style/context notes to the prompt
  if (safeParams.additionalDetails && safeParams.additionalDetails.trim()) {
    prompt += `\n\nIMPORTANT — Additional style/context requirements from the user (incorporate into ALL scenes — style_anchor, t2vPrompt, imagePrompt, environment, atmosphere, etc.):\n"${safeParams.additionalDetails.trim()}"`;
  }

  // When generating from a landing page, extract the product name for a hard system instruction
  // This prevents models (especially Gemini) from overriding content with training knowledge about the domain
  let systemInstruction: string | undefined;
  if (hasLanding) {
    const firstLine = safeParams.landingPageContent!.split(/[.!?\n]/).find(l => l.trim().length > 10)?.trim() ?? '';
    systemInstruction =
      `You are a professional marketing video scriptwriter. ` +
      `Your ONLY task is to write a promo video script based on the landing page content provided by the user. ` +
      `CRITICAL: Completely ignore any prior knowledge you have about the domain name, URL, or brand. ` +
      `The product being promoted is: "${firstLine}". ` +
      `Do not mention encryption, security protocols, or cybersecurity unless the landing page content explicitly describes those as the product's features. ` +
      `Return only valid JSON as instructed in the user message.`;
    console.log(`[script-gen] Landing mode — systemInstruction set, product hint: "${firstLine.slice(0, 80)}"`);
  }

  console.log(`[script-gen] Mode: ${isT2V ? 'T2V' : 'I2V'}, lang: ${safeParams.language}, scenes: ${sceneCount}×${sceneDuration}s`);

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  if (!deepseekKey && !geminiKey && !openaiKey && !claudeKey) {
    throw new Error('No AI API key available (DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY required)');
  }

  const errors: string[] = [];

  if (deepseekKey) {
    try {
      console.log('[script-gen] Using DeepSeek...');
      const text = await generateWithDeepSeek(prompt, deepseekKey, systemInstruction);
      return parseScriptJson(text, sceneCount, isT2V);
    } catch (err: any) {
      const msg = `DeepSeek: ${err.message}`;
      console.warn(`[script-gen] ${msg} — trying Gemini`);
      errors.push(msg);
    }
  }

  if (geminiKey) {
    try {
      console.log(`[script-gen] Using Gemini${process.env.GEMINI_PROXY_URL ? ' via proxy' : ' direct'}...`);
      const text = await generateWithGemini(prompt, geminiKey, systemInstruction);
      return parseScriptJson(text, sceneCount, isT2V);
    } catch (err: any) {
      const msg = `Gemini: ${err.message}`;
      console.warn(`[script-gen] ${msg} — trying OpenAI`);
      errors.push(msg);
    }
  }

  if (openaiKey) {
    try {
      console.log('[script-gen] Using OpenAI...');
      const text = await generateWithOpenAI(prompt, openaiKey, systemInstruction);
      return parseScriptJson(text, sceneCount, isT2V);
    } catch (err: any) {
      const msg = `OpenAI: ${err.message}`;
      console.warn(`[script-gen] ${msg} — trying Claude`);
      errors.push(msg);
    }
  }

  if (claudeKey) {
    try {
      console.log('[script-gen] Using Claude...');
      const text = await generateWithClaude(prompt, claudeKey, systemInstruction);
      return parseScriptJson(text, sceneCount, isT2V);
    } catch (err: any) {
      const msg = `Claude: ${err.message}`;
      console.warn(`[script-gen] ${msg}`);
      errors.push(msg);
    }
  }

  throw new Error(`All AI providers failed: ${errors.join(' | ')}`);
}

import Anthropic from '@anthropic-ai/sdk';

/**
 * AI-режиссёр.
 *
 * Принимает свободный бриф пользователя (или тему/лендинг/сценарий) и решает,
 * КАК лучше всего сгенерировать и смонтировать видео: формат, длительность,
 * режим скрипта, модель анимации, голос, стиль субтитров и музыку.
 *
 * Возвращает ПЛАН (предложение) — он не запускает генерацию. Пользователь
 * подтверждает или правит план в форме создания, после чего запускается обычный
 * пайплайн (POST /api/videos → generate-script). Все значения нормализуются под
 * допустимые enum'ы, поэтому агент никогда не выдаёт невалидные параметры.
 */

export interface DirectorPlanInput {
  brief?: string;
  topic?: string;
  customScenario?: string;
  landingUrl?: string;
  additionalDetails?: string;
}

export interface DirectorPlan {
  format: '9:16' | '16:9' | '1:1';
  duration: number;
  scriptMode: 'standard' | 'viral';
  pipelineMode: 'i2v' | 't2v';
  animationModel: string;
  clipDuration: 5 | 10;
  voice: string;
  subtitleStyle: string;
  musicStyle: string;
  language: 'ru' | 'en';
  title: string;
  topic: string;
  additionalDetails?: string;
  rationale: string;
}

// ── Допустимые значения (синхронизированы с routes.ts ALL_MODELS и Create.tsx) ──
const FORMATS = ['9:16', '16:9', '1:1'] as const;
const DURATIONS = [15, 30, 60, 90];
const I2V_MODELS = ['wan', 'kling', 'kling-pro', 'minimax', 'seedance'];
const T2V_MODELS = ['wan-t2v', 'kling-t2v', 'kling-pro-t2v', 'luma', 'veo3', 'chain'];
const ALL_MODELS = [...I2V_MODELS, ...T2V_MODELS];
// Синхронизировано с VOICES в Create.tsx (UI-дропдаун) — 'ballad' исключён, его нет в UI.
const VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
const SUBTITLE_STYLES = ['none', 'plain', 'fade', 'karaoke', 'tiktok', 'word-by-word', 'cinematic', 'cinematic-full', 'bar'];
const MUSIC_STYLES = ['none', 'ambient', 'cinematic', 'corporate', 'electronic', 'acoustic', 'jazz'];
const CLIP_DURATION_MODELS = new Set(['kling', 'kling-pro', 'seedance', 'kling-t2v', 'kling-pro-t2v', 'luma']);

const SYSTEM_INSTRUCTION =
  'Ты — опытный креативный директор по коротким видео для соцсетей (Reels, Shorts, TikTok, YouTube). ' +
  'Тебе дают бриф/тему, а ты решаешь оптимальные настройки производства видео. ' +
  'Отвечай ТОЛЬКО валидным JSON без markdown и пояснений.';

function buildPrompt(input: DirectorPlanInput): string {
  const parts: string[] = [];
  if (input.brief) parts.push(`Бриф пользователя: "${input.brief}"`);
  if (input.topic) parts.push(`Тема: "${input.topic}"`);
  if (input.customScenario) parts.push(`Свой сценарий: "${input.customScenario.slice(0, 1500)}"`);
  if (input.landingUrl) parts.push(`Лендинг для промо: ${input.landingUrl}`);
  if (input.additionalDetails) parts.push(`Доп. детали: "${input.additionalDetails}"`);

  return [
    parts.join('\n'),
    '',
    'Выбери оптимальные настройки производства видео и верни строго такой JSON:',
    '{',
    '  "format": "9:16" | "16:9" | "1:1",',
    '  "duration": 15 | 30 | 60 | 90,            // секунды',
    '  "scriptMode": "standard" | "viral",        // viral = хук+тело+CTA для вертикальных Reels/Shorts',
    '  "animationModel": один из ' + JSON.stringify(ALL_MODELS) + ',',
    '  "clipDuration": 5 | 10,                     // длина клипа сцены (важно только для kling/seedance/luma)',
    '  "voice": один из ' + JSON.stringify(VOICES) + ',',
    '  "subtitleStyle": один из ' + JSON.stringify(SUBTITLE_STYLES) + ',',
    '  "musicStyle": один из ' + JSON.stringify(MUSIC_STYLES) + ',',
    '  "language": "ru" | "en",',
    '  "title": "короткое название проекта",',
    '  "topic": "уточнённая тема для генерации сценария (1-2 предложения)",',
    '  "rationale": "2-4 коротких предложения на русском: почему именно такие настройки"',
    '}',
    '',
    'Правила выбора:',
    '- Вертикаль 9:16 + scriptMode "viral" + субтитры "tiktok"/"word-by-word" — для соцсетей/рекламы/динамичных роликов.',
    '- 16:9 + scriptMode "standard" + субтитры "karaoke"/"cinematic" — для YouTube/информационных/презентаций.',
    '- animationModel: "wan" — быстрый дефолт; "kling"/"kling-pro" — максимум качества (медленнее); "minimax"/"seedance" — плавная анимация; "luma"/"kling-t2v" — text-to-video для абстрактных/динамичных тем без опорного кадра.',
    '- musicStyle подбирай под настроение (energetic→electronic, эпично→cinematic, бизнес→corporate, спокойно→ambient).',
    '- voice: женские (nova/shimmer/coral/sage), мужские (echo/onyx/ash); подбери под тон.',
    '- duration: короткий хук — 15-30с, обычный ролик — 30-60с, подробный — 90с.',
  ].join('\n');
}

async function callLLM(prompt: string, system: string): Promise<string | null> {
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

  if (claudeKey) {
    try {
      const client = new Anthropic({ apiKey: claudeKey });
      const msg = await client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content[0];
      if (block && block.type === 'text') return block.text.trim();
    } catch (e: any) {
      console.warn(`[director] Claude failed: ${e.message} — fallback`);
    }
  }

  if (deepseekKey) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deepseekKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          max_tokens: 1024,
          temperature: 0.5,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        return data.choices?.[0]?.message?.content?.trim() ?? null;
      }
    } catch (e: any) {
      console.warn(`[director] DeepSeek failed: ${e.message} — fallback`);
    }
  }

  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        return data.choices?.[0]?.message?.content?.trim() ?? null;
      }
    } catch (e: any) {
      console.warn(`[director] OpenAI failed: ${e.message} — fallback`);
    }
  }

  if (geminiKey) {
    try {
      const base = process.env.GEMINI_PROXY_URL
        ? (() => { try { const u = new URL(process.env.GEMINI_PROXY_URL!); return `${u.protocol}//${u.host}`; } catch { return 'https://generativelanguage.googleapis.com'; } })()
        : 'https://generativelanguage.googleapis.com';
      const res = await fetch(`${base}/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const txt = (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text || '').join('').trim();
        if (txt) return txt;
      }
    } catch (e: any) {
      console.warn(`[director] Gemini failed: ${e.message} — fallback`);
    }
  }

  return null;
}

function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function pick<T extends string>(value: any, list: readonly T[], fallback: T): T {
  return typeof value === 'string' && list.includes(value as T) ? (value as T) : fallback;
}

function snapDuration(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  const clamped = Math.max(10, Math.min(120, n));
  return DURATIONS.reduce((best, d) => (Math.abs(d - clamped) < Math.abs(best - clamped) ? d : best), DURATIONS[0]);
}

/** Эвристический план, когда AI недоступен или вернул мусор — чтобы кнопка «Авто» всегда работала. */
function heuristicPlan(input: DirectorPlanInput, rationale: string): DirectorPlan {
  const text = `${input.brief ?? ''} ${input.topic ?? ''} ${input.additionalDetails ?? ''}`.toLowerCase();
  const isHorizontal = /youtube|ютуб|горизонт|16:9|презентац|обучен|лекц/.test(text);
  const format: DirectorPlan['format'] = isHorizontal ? '16:9' : '9:16';
  let musicStyle = 'ambient';
  if (/энергич|драйв|динамич|реклам|быстр|electronic|техно/.test(text)) musicStyle = 'electronic';
  else if (/эпич|кино|трейлер|масштаб/.test(text)) musicStyle = 'cinematic';
  else if (/бизнес|корпорат|компан|услуг|продукт/.test(text)) musicStyle = 'corporate';
  else if (/уют|тепло|акустик|лайфстайл/.test(text)) musicStyle = 'acoustic';

  return {
    format,
    duration: 30,
    scriptMode: format === '9:16' ? 'viral' : 'standard',
    pipelineMode: 'i2v',
    animationModel: 'wan',
    clipDuration: 10,
    voice: 'alloy',
    subtitleStyle: format === '9:16' ? 'tiktok' : 'karaoke',
    musicStyle,
    language: /[a-z]/.test(text) && !/[а-я]/.test(text) ? 'en' : 'ru',
    title: (input.topic || input.brief || 'Новое видео').slice(0, 80),
    topic: input.topic || input.brief || '',
    additionalDetails: input.additionalDetails,
    rationale,
  };
}

function normalize(raw: any, input: DirectorPlanInput): DirectorPlan {
  const format = pick(raw?.format, FORMATS, '9:16');
  const animationModel = pick(raw?.animationModel, ALL_MODELS, 'wan');
  const pipelineMode: 'i2v' | 't2v' = T2V_MODELS.includes(animationModel) ? 't2v' : 'i2v';
  let clipDuration: 5 | 10 = raw?.clipDuration === 5 ? 5 : 10;
  if (!CLIP_DURATION_MODELS.has(animationModel)) clipDuration = 10;

  return {
    format,
    duration: snapDuration(raw?.duration),
    scriptMode: raw?.scriptMode === 'viral' ? 'viral' : raw?.scriptMode === 'standard' ? 'standard' : format === '9:16' ? 'viral' : 'standard',
    pipelineMode,
    animationModel,
    clipDuration,
    voice: pick(raw?.voice, VOICES, 'alloy'),
    subtitleStyle: pick(raw?.subtitleStyle, SUBTITLE_STYLES, format === '9:16' ? 'tiktok' : 'karaoke'),
    musicStyle: pick(raw?.musicStyle, MUSIC_STYLES, 'ambient'),
    language: raw?.language === 'en' ? 'en' : 'ru',
    title: (typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : input.topic || input.brief || 'Новое видео').slice(0, 80),
    topic: (typeof raw?.topic === 'string' && raw.topic.trim() ? raw.topic.trim() : input.topic || input.brief || '').slice(0, 500),
    additionalDetails: input.additionalDetails,
    rationale: typeof raw?.rationale === 'string' && raw.rationale.trim() ? raw.rationale.trim() : 'План подобран автоматически на основе вашего брифа.',
  };
}

export async function planVideo(input: DirectorPlanInput): Promise<DirectorPlan> {
  const hasInput = [input.brief, input.topic, input.customScenario, input.landingUrl]
    .some((v) => v && String(v).trim().length > 0);
  if (!hasInput) {
    throw new Error('Нужен бриф, тема, сценарий или ссылка на лендинг');
  }

  const text = await callLLM(buildPrompt(input), SYSTEM_INSTRUCTION);
  if (!text) {
    return heuristicPlan(input, 'AI-режиссёр недоступен — предложен базовый план, отредактируйте при необходимости.');
  }

  const raw = extractJson(text);
  if (!raw) {
    return heuristicPlan(input, 'Не удалось разобрать ответ AI — предложен базовый план, отредактируйте при необходимости.');
  }

  return normalize(raw, input);
}

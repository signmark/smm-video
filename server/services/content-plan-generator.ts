import { directusCrud } from './directus-crud';
import { log } from '../utils/logger';
import { aiService } from './ai-service';

export interface ContentPlanSettings {
  postsCount: number;
  contentType?: string;
  period: number;
  includeImages?: boolean;
  includeVideos?: boolean;
  includeClips?: boolean;
  includeStories?: boolean;
  customInstructions?: string;
  aiDecidesCount?: boolean; // ИИ сам решает кол-во постов и расписание (без потолка)
}

export interface BusinessData {
  companyName?: string;
  businessDescription?: string;
  targetAudience?: string;
  businessValues?: string;
  productsServices?: string;
  competitiveAdvantages?: string;
}

interface TrendTopic {
  id: string;
  description?: string;
  reactions?: number;
  comments?: number;
  views?: number;
  created_at?: string;
}

export interface Keyword {
  keyword: string;
  trendScore?: number;
}

export interface GeneratePlanParams {
  campaignId: string;
  userId: string;
  settings: ContentPlanSettings;
  selectedTrendTopics?: string[];
  keywords?: Keyword[];
  businessData?: BusinessData;
  userToken?: string;
  onProgress?: (step: string, progress: number, detail?: string) => void;
}

async function runEditorPass(
  contentPlan: any[],
  autonomousSettings: { globalPrompt?: string; alwaysInclude?: string; signature?: string },
  userId: string,
  userToken?: string
): Promise<any[]> {
  const styleBlock = autonomousSettings.globalPrompt
    ? `Стиль и тон: ${autonomousSettings.globalPrompt}\n` : '';
  const includeBlock = autonomousSettings.alwaysInclude
    ? `Обязательно органично включить в каждый пост: ${autonomousSettings.alwaysInclude}\n` : '';
  const signatureBlock = autonomousSettings.signature
    ? `Подпись в конце каждого поста (дословно): ${autonomousSettings.signature}\n` : '';

  const editorPrompt = `Ты AI-редактор SMM-контента. Отредактируй каждый пост в JSON-массиве:
${styleBlock}${includeBlock}${signatureBlock}
Требования:
- Сохрани структуру JSON (все поля: title, content, contentType, scheduledAt, hashtags, keywords, prompt)
- Улучши зацепку (первые 2 предложения должны захватывать внимание)
- Убедись что стиль соответствует инструкциям выше
- НЕ изменяй scheduledAt, contentType, hashtags, keywords, prompt
- Верни ТОЛЬКО JSON-массив без пояснений

Посты для редактуры:
${JSON.stringify(contentPlan, null, 2)}`;

  try {
    const text = await callGemini(editorPrompt, userId, userToken);
    const edited = parseGeminiResponse(text);
    if (edited && edited.length === contentPlan.length) {
      log(`[CONTENT-PLAN] AI-редактор успешно обработал ${edited.length} постов`, 'content-plan');
      return edited;
    }
    log(`[CONTENT-PLAN] AI-редактор вернул некорректный результат, используем оригинал`, 'content-plan');
    return contentPlan;
  } catch (e: any) {
    log(`[CONTENT-PLAN] Ошибка AI-редактора: ${e.message}, используем оригинал`, 'content-plan');
    return contentPlan;
  }
}

const MAX_TOKENS_PER_REQUEST = 120000;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const MAX_CHARS_PER_CHUNK = MAX_TOKENS_PER_REQUEST * ESTIMATED_CHARS_PER_TOKEN;

function extractJsonBlock(text: string): string | null {
  // Try to find outermost JSON array or object
  const tryFrom = (start: number, open: string, close: string): string | null => {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  };

  const firstArr = text.indexOf('[');
  const firstObj = text.indexOf('{');
  const candidates: string[] = [];

  if (firstArr !== -1) {
    const block = tryFrom(firstArr, '[', ']');
    if (block) candidates.push(block);
  }
  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    const block = tryFrom(firstObj, '{', '}');
    if (block) candidates.push(block);
  }
  if (candidates.length === 0 && firstObj !== -1) {
    const block = tryFrom(firstObj, '{', '}');
    if (block) candidates.push(block);
  }

  return candidates[0] ?? null;
}

function parseGeminiResponse(text: string): any[] | null {
  log(`[CONTENT-PLAN] Raw Gemini response length: ${text.length}, first 300 chars: ${text.slice(0, 300)}`, 'content-plan');

  // Step 1: strip markdown fences
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Step 2: fix unquoted hashtags
  cleaned = cleaned.replace(
    /"hashtags":\s*\[([^\]]*)\]/g,
    (_match: string, group: string) => {
      const fixed = group
        .split(',')
        .map((h: string) => {
          h = h.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, '');
          return h.match(/^#[^\s,"]+$/) ? `"${h}"` : h;
        })
        .join(', ');
      return `"hashtags": [${fixed}]`;
    }
  );

  // Step 3: try direct parse
  const tryParse = (s: string): any[] | null => {
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p;
      if (Array.isArray(p?.posts)) return p.posts;
      if (Array.isArray(p?.content_plan)) return p.content_plan;
      if (Array.isArray(p?.contentPlan)) return p.contentPlan;
      // single post object wrapped in root
      const vals = Object.values(p);
      const arr = vals.find(v => Array.isArray(v));
      if (arr) return arr as any[];
    } catch {}
    return null;
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  // Step 4: extract first JSON block from raw text
  const block = extractJsonBlock(cleaned) ?? extractJsonBlock(text);
  if (block) {
    const fromBlock = tryParse(block);
    if (fromBlock) return fromBlock;
  }

  log(`[CONTENT-PLAN] PARSE FAILED. Full response: ${text.slice(0, 2000)}`, 'content-plan');
  return null;
}

async function callGemini(prompt: string, userId: string, userToken?: string): Promise<string> {
  const fullPrompt = `${prompt}

ВАЖНО: Ответь ТОЛЬКО валидным JSON-массивом постов, без какого-либо предисловия, объяснений или markdown-обёртки. Первый символ ответа должен быть "[", последний — "]".`;

  const result = await aiService.generateContent({
    prompt: fullPrompt,
    systemPrompt: 'Ты - SMM-эксперт. Отвечай ТОЛЬКО JSON. Никаких объяснений, никакого markdown, никакого текста до или после JSON. Первый символ — "[", последний — "]".',
    service: 'gemini',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    maxTokens: 8192,
    userId,
    token: userToken
  });

  if (!result?.content) throw new Error('Gemini вернул пустой ответ');
  log(`[CONTENT-PLAN] Gemini raw response (first 500): ${result.content.slice(0, 500)}`, 'content-plan');
  return result.content;
}

// Типы контента, реально поддерживаемые системой (совпадают с опциями UI:
// text, text-image, image, video, clip, story). Модель иногда выдумывает свои
// (напр. "video-text"), которых нет в дропдауне — тогда тип поста в UI пустой.
const SYSTEM_CONTENT_TYPES = ['text', 'text-image', 'image', 'video', 'clip', 'story'] as const;

/** Приводит тип, вернувшийся от модели, к валидному системному. */
function normalizeContentType(raw: any): string {
  const v = String(raw ?? '').trim().toLowerCase().replace(/_/g, '-');
  if ((SYSTEM_CONTENT_TYPES as readonly string[]).includes(v)) return v;
  if (v === 'video-text' || v === 'text-video') return 'video';
  if (v === 'image-text') return 'text-image';
  if (v.includes('clip') || v.includes('reel') || v.includes('short')) return 'clip';
  if (v.includes('stor')) return 'story';
  if (v.includes('video')) return 'video';
  if (v.includes('image') || v.includes('photo') || v.includes('картин')) return 'text-image';
  return 'text';
}

/** Список типов, разрешённых к генерации, исходя из настроек кампании/выбора. */
function allowedContentTypes(settings: ContentPlanSettings): string[] {
  const mode = settings.contentType;
  // Режим «текст + текст с картинкой» — строго два основных типа, ИИ выбирает.
  if (mode === 'text-image-mix') return ['text', 'text-image'];
  const isMixedOrRandom = mode === 'mixed' || mode === 'random';
  // text и text-image — основной контент: в «смешанный»/«рандом» включаем всегда
  // (независимо от флага картинок), иначе — по флагам настроек.
  const allowed = ['text'];
  if (settings.includeImages || isMixedOrRandom) allowed.push('text-image');
  if (settings.includeImages) allowed.push('image');
  if (settings.includeVideos) allowed.push('video');
  if (settings.includeClips) allowed.push('clip');
  if (settings.includeStories) allowed.push('story');
  return Array.from(new Set(allowed));
}

export async function generateContentPlan(params: GeneratePlanParams): Promise<{ success: boolean; data?: { contentPlan: any[] }; error?: string }> {
  const {
    campaignId, userId, settings,
    selectedTrendTopics = [], keywords = [],
    businessData, userToken, onProgress
  } = params;

  const progress = (step: string, pct: number, detail?: string) => {
    log(`[CONTENT-PLAN] ${step} (${pct}%) ${detail || ''}`, 'content-plan');
    onProgress?.(step, pct, detail);
  };

  progress('Инициализация', 5);

  // Загружаем autonomous_settings кампании (globalPrompt, alwaysInclude, signature, useEditorPass)
  let autonomousSettings: { globalPrompt?: string; alwaysInclude?: string; signature?: string; useEditorPass?: boolean } = {};
  try {
    // Коллекция называется user_campaigns; 'campaigns' не существует, и запрос к
    // ней отдавал 403 — autonomous_settings молча терялись, и globalPrompt,
    // alwaysInclude, signature, useEditorPass не доезжали до генерации.
    const campaignData = await directusCrud.getById('user_campaigns', campaignId, { authToken: userToken });
    if (campaignData?.autonomous_settings) {
      const raw = campaignData.autonomous_settings;
      autonomousSettings = typeof raw === 'string' ? JSON.parse(raw) : raw;
      log(`[CONTENT-PLAN] Загружены autonomous_settings: globalPrompt=${!!autonomousSettings.globalPrompt}, alwaysInclude=${!!autonomousSettings.alwaysInclude}, signature=${!!autonomousSettings.signature}, editorPass=${autonomousSettings.useEditorPass}`, 'content-plan');
    }
  } catch (e: any) {
    log(`[CONTENT-PLAN] Не удалось загрузить autonomous_settings: ${e.message}`, 'content-plan');
  }

  // Загружаем тренды из Directus
  progress('Загрузка трендов', 15);
  let trends: TrendTopic[] = [];
  if (selectedTrendTopics.length > 0) {
    try {
      const trendData = await directusCrud.list('campaign_trend_topics', {
        authToken: userToken,
        filter: { id: { _in: selectedTrendTopics } },
        limit: -1
      });
      trends = (trendData || []).map((t: any) => ({
        id: t.id,
        description: t.description || t.title || '',
        reactions: t.reactions || 0,
        comments: t.comments || 0,
        views: t.views || 0,
        created_at: t.created_at || ''
      }));
    } catch (e: any) {
      log(`[CONTENT-PLAN] Ошибка загрузки трендов: ${e.message}`, 'content-plan');
    }
  }

  progress('Составление промпта', 25, `Загружено ${trends.length} трендов`);

  const contentTypeTranslation: Record<string, string> = {
    mixed: 'смешанный', random: 'случайный', educational: 'обучающий',
    promotional: 'рекламный', entertaining: 'развлекательный',
    text: 'только текст', 'text-image': 'текст с изображениями',
    image: 'только изображение', video: 'видео', clip: 'клип (Shorts/Reels)',
    story: 'Stories'
  };

  const businessInfo = businessData
    ? `\nИнформация о бизнесе:\n- Название: ${businessData.companyName || ''}\n- Описание: ${businessData.businessDescription || ''}\n- Аудитория: ${businessData.targetAudience || ''}\n- Ценности: ${businessData.businessValues || ''}\n- Продукты/услуги: ${businessData.productsServices || ''}\n- Преимущества: ${businessData.competitiveAdvantages || ''}`
    : 'Информация о бизнесе отсутствует.';

  const ctMode = settings.contentType || 'mixed';
  const ctLabel = contentTypeTranslation[ctMode] || ctMode;
  const contentTypeText =
    ctMode === 'random'
      ? `Тип контента: СЛУЧАЙНЫЙ — для КАЖДОГО поста выбирай contentType случайно из разрешённых; посты должны отличаться по типу. ОСНОВА — text и text-image (это главный контент, их должно быть большинство); video/clip/story — изредка и только если уместно.`
      : ctMode === 'mixed'
        ? `Тип контента: СМЕШАННЫЙ — используй РАЗНЫЕ типы из разрешённых. ОСНОВА — text и text-image (главный контент, ~70% постов); video/clip/story добавляй как разнообразие, меньшинством.`
      : ctMode === 'text-image-mix'
        ? `Тип контента: ТЕКСТ + ТЕКСТ С КАРТИНКОЙ — используй ТОЛЬКО типы text и text-image, вперемешку. Для каждого поста сам выбирай, что лучше зайдёт: чистый текст или текст с картинкой. Других типов (video/clip/story/image) НЕ используй.`
        : `Тип контента: ${ctLabel} — используй этот тип (${ctMode}) для всех постов.`;
  const mediaTypeText = `Типы медиа: ${[settings.includeImages && 'изображения', settings.includeVideos && 'видео'].filter(Boolean).join(' и ') || 'не указано'}`;

  // Определяем оптимальные часы публикации на основе трендов
  // Каждый тренд вносит вес (engagement) в тот час, когда он был опубликован
  const hourWeights: Record<number, number> = {};

  if (trends.length > 0) {
    for (const trend of trends) {
      if (!trend.created_at) continue;
      const trendDate = new Date(trend.created_at);
      if (isNaN(trendDate.getTime())) continue;
      const hour = trendDate.getHours();
      // Вовлечённость: реакции + комментарии + просмотры (с меньшим весом)
      const engagement = (trend.reactions || 0) + (trend.comments || 0) + Math.floor((trend.views || 0) / 10) + 1;
      hourWeights[hour] = (hourWeights[hour] || 0) + engagement;
    }
  }

  // Если нет данных трендов — используем стандартные пики активности для соцсетей
  const hasTrendHours = Object.keys(hourWeights).length > 0;
  if (!hasTrendHours) {
    // Дефолтные пики: утро (9, 10), обед (13, 14), вечер (19, 20, 21)
    const defaultPeaks: Record<number, number> = { 9: 3, 10: 5, 13: 8, 14: 7, 19: 10, 20: 9, 21: 6 };
    Object.assign(hourWeights, defaultPeaks);
  }

  // Выбираем часы пропорционально весу: строим список кандидатов
  const peakHours: number[] = [];
  for (const [hourStr, weight] of Object.entries(hourWeights)) {
    const hour = Number(hourStr);
    // Рабочие часы: с 8 до 23
    if (hour < 8 || hour > 23) continue;
    // Добавляем час weight раз — чем выше вес, тем чаще выбирается
    const slots = Math.max(1, Math.round(weight / Math.max(1, Math.max(...Object.values(hourWeights))) * 10));
    for (let s = 0; s < slots; s++) peakHours.push(hour);
  }

  // Если ничего не осталось в диапазоне 8-23 — дефолт
  if (peakHours.length === 0) {
    peakHours.push(10, 13, 19, 21);
  }

  // Сортируем пики по убыванию веса для логов
  const topHours = Object.entries(hourWeights)
    .filter(([h]) => Number(h) >= 8 && Number(h) <= 23)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([h, w]) => `${h}:00 (score=${w})`)
    .join(', ');
  log(`[CONTENT-PLAN] Оптимальные часы публикации: ${topHours}`, 'content-plan');

  // Генерируем даты публикаций с умными часами
  const now = new Date();
  const dates: Date[] = [];
  const dateInterval = settings.period / settings.postsCount;
  for (let i = 0; i < settings.postsCount; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + Math.round(i * dateInterval));
    // Берём час из взвешенного пула (по циклу, чтобы не повторяться подряд)
    const hour = peakHours[i % peakHours.length];
    // Минуты — небольшое случайное смещение чтобы не публиковать ровно в :00
    const minute = Math.floor(Math.random() * 30);
    d.setHours(hour, minute, 0, 0);
    dates.push(d);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());

  // Блоки из autonomous_settings кампании
  const autonomousPromptBlock = autonomousSettings.globalPrompt
    ? `\nСтиль и тон (обязательно соблюдать):\n${autonomousSettings.globalPrompt}`
    : '';
  const autonomousIncludeBlock = autonomousSettings.alwaysInclude
    ? `\nОбязательно органично включить в каждый пост:\n${autonomousSettings.alwaysInclude}`
    : '';
  const autonomousSignatureBlock = autonomousSettings.signature
    ? `\nПодпись в конце каждого поста (дословно, не изменять):\n${autonomousSettings.signature}`
    : '';

  const allowedTypes = allowedContentTypes(settings);

  const baseTemplate = `Создай детальный контент-план для социальных сетей.
${businessInfo}
${autonomousPromptBlock}
${contentTypeText}
${mediaTypeText}
${settings.customInstructions ? `\nДополнительные инструкции: ${settings.customInstructions}` : ''}
${autonomousIncludeBlock}
${autonomousSignatureBlock}

Верни JSON-массив постов. Каждый пост:
- title: короткий заголовок 3–6 слов (конкретный, без вводных слов типа "Как", "О том", "Все о"; максимум 60 символов)
- content: HTML-форматированный текст
- contentType: строго одно из значений: ${allowedTypes.join(' | ')} (другие значения запрещены)
- scheduledAt: ISO-дата публикации
- hashtags: массив хештегов (5-7 шт)
- keywords: массив ключевых слов (3-5 шт)
- prompt: промпт для генерации изображения на английском (только если contentType — text-image или image)

Используй тренды и ключевые слова чтобы сделать контент актуальным.`;

  const keywordsText = keywords.length > 0
    ? `\nКлючевые слова кампании: ${keywords.map(k => `${k.keyword} (TrendScore: ${k.trendScore ?? 0})`).join(', ')}`
    : '\nКлючевые слова: не указаны.';

  const trendsData = trends.map(t => ({
    text: `- ${t.description} (Реакции: ${t.reactions}, Комментарии: ${t.comments}, Просмотры: ${t.views}, Дата: ${t.created_at})`,
    size: (t.description?.length || 0) + 100
  }));

  // --- Смарт-режим: ИИ сам решает количество постов и расписание (без потолка) ---
  if (settings.aiDecidesCount) {
    const trendsText = trends.length > 0
      ? `\nВыбранные тренды:\n${trendsData.map(t => t.text).join('\n')}`
      : '\nТренды: не выбраны.';
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + settings.period);
    const hoursHint = topHours || '9:00, 13:00, 19:00, 21:00';
    const lo = Math.max(4, Math.round(settings.period / 2));
    const hi = Math.min(20, settings.period + Math.round(settings.period / 2));
    const scheduleText = `\nКОЛИЧЕСТВО И РАСПИСАНИЕ: САМ реши, сколько постов нужно для качественного ${settings.period}-дневного контент-плана — столько, сколько уместно для темы и аудитории (не ограничивай себя искусственно, но без спама; ориентир — примерно ${lo}–${hi} постов). Каждому посту проставь scheduledAt (ISO) в интервале с ${now.toISOString()} по ${endDate.toISOString()}. Можно несколько постов в один день, если это уместно. Удачные часы публикации: ${hoursHint}.`;

    const prompt = `${baseTemplate}${keywordsText}${trendsText}${scheduleText}`;

    progress('Генерация контент-плана', 40, 'ИИ определяет количество и расписание...');
    const text = await callGemini(prompt, userId, userToken);
    progress('Обработка ответа', 85);

    let contentPlan = parseGeminiResponse(text);
    if (!contentPlan) return { success: false, error: 'Не удалось разобрать ответ Gemini как массив постов' };

    contentPlan = contentPlan.map((p: any) => {
      if (typeof p.title === 'string') {
        const words = p.title.trim().split(/\s+/);
        const byWords = words.length > 7 ? words.slice(0, 7).join(' ') : p.title.trim();
        p.title = byWords.length > 60 ? byWords.slice(0, 60).trimEnd() : byWords;
      }
      p.contentType = normalizeContentType(p.contentType);
      return p;
    });

    if (autonomousSettings.useEditorPass) {
      progress('AI-редактор', 90, `Редактирование ${contentPlan.length} постов...`);
      contentPlan = await runEditorPass(contentPlan, autonomousSettings, userId, userToken);
    }

    progress('Готово', 100, `ИИ создал ${contentPlan.length} постов`);
    return { success: true, data: { contentPlan } };
  }

  const totalTrendsSize = trendsData.reduce((s, t) => s + t.size, 0);
  const needsChunking = (baseTemplate.length + keywordsText.length + totalTrendsSize) > MAX_CHARS_PER_CHUNK;

  if (!needsChunking) {
    const trendsText = trends.length > 0
      ? `\nВыбранные тренды:\n${trendsData.map(t => t.text).join('\n')}`
      : '\nТренды: не выбраны.';

    const datesText = `\nДаты публикаций:\n${dates.map((d, i) =>
      `${i + 1}. ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    ).join('\n')}`;

    const prompt = `${baseTemplate}${keywordsText}${trendsText}${datesText}`;

    progress('Генерация контент-плана', 40, `Gemini генерирует ${settings.postsCount} постов...`);
    const text = await callGemini(prompt, userId, userToken);
    progress('Обработка ответа', 85);

    let contentPlan = parseGeminiResponse(text);
    if (!contentPlan) return { success: false, error: 'Не удалось разобрать ответ Gemini как массив постов' };

    contentPlan = contentPlan.map((p: any) => {
      if (typeof p.title === 'string') {
        const words = p.title.trim().split(/\s+/);
        const byWords = words.length > 7 ? words.slice(0, 7).join(' ') : p.title.trim();
        p.title = byWords.length > 60 ? byWords.slice(0, 60).trimEnd() : byWords;
      }
      p.contentType = normalizeContentType(p.contentType);
      return p;
    });

    if (autonomousSettings.useEditorPass) {
      progress('AI-редактор', 90, `Редактирование ${contentPlan.length} постов...`);
      contentPlan = await runEditorPass(contentPlan, autonomousSettings, userId, userToken);
    }

    progress('Готово', 100, `Создано ${contentPlan.length} постов`);
    return { success: true, data: { contentPlan } };
  }

  // --- Chunked mode ---
  const postsPerChunk = Math.max(1, Math.floor(
    settings.postsCount / Math.ceil((baseTemplate.length + keywordsText.length + totalTrendsSize) / MAX_CHARS_PER_CHUNK)
  ));
  const totalChunks = Math.ceil(settings.postsCount / postsPerChunk);

  progress('Генерация контент-плана', 35, `Разбивка на ${totalChunks} части...`);

  let currentTrendIdx = 0;
  const chunkPromises = Array.from({ length: totalChunks }, (_, chunkIndex) => {
    const startPost = chunkIndex * postsPerChunk;
    const endPost = Math.min(startPost + postsPerChunk, settings.postsCount);
    const chunkDates = dates.slice(startPost, endPost);
    const trendsPerChunk = Math.ceil(trends.length / totalChunks);
    const chunkTrends = trends.slice(currentTrendIdx, currentTrendIdx + trendsPerChunk);
    currentTrendIdx += trendsPerChunk;

    const trendsText = chunkTrends.length > 0
      ? `\nВыбранные тренды:\n${chunkTrends.map(t => `- ${t.description} (Реакции: ${t.reactions}, Комментарии: ${t.comments}, Просмотры: ${t.views}, Дата: ${t.created_at})`).join('\n')}`
      : '\nТренды: не выбраны.';

    const datesText = `\nДаты публикаций:\n${chunkDates.map((d, i) =>
      `${startPost + i + 1}. ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    ).join('\n')}`;

    const chunkPrompt = `${baseTemplate}${keywordsText}${trendsText}${datesText}\n\nСоздай ${chunkDates.length} постов для указанных дат.\n[CHUNK_ID:${chunkIndex}]`;

    return callGemini(chunkPrompt, userId, userToken)
      .then(text => {
        const pct = 40 + Math.round(((chunkIndex + 1) / totalChunks) * 45);
        progress('Генерация контент-плана', pct, `Часть ${chunkIndex + 1} из ${totalChunks} готова`);
        return { chunkIndex, startPost, posts: parseGeminiResponse(text) };
      })
      .catch(e => ({ chunkIndex, startPost, posts: null as any, error: e.message }));
  });

  const results = await Promise.all(chunkPromises);

  progress('Обработка ответа', 88);

  const allPosts: any[] = [];
  const errors: any[] = [];

  for (const r of results) {
    if (!r.posts) { errors.push({ chunkIndex: r.chunkIndex, error: (r as any).error }); continue; }
    allPosts.push(...r.posts.map((p: any, i: number) => ({ ...p, _origIdx: r.startPost + i })));
  }

  if (errors.length > 0 && allPosts.length === 0) {
    return { success: false, error: `Все части завершились ошибками: ${errors.map(e => e.error).join('; ')}` };
  }

  allPosts.sort((a, b) => (a._origIdx ?? 0) - (b._origIdx ?? 0));
  let contentPlan = allPosts.map(({ _origIdx, ...p }) => {
    if (typeof p.title === 'string') {
      const words = p.title.trim().split(/\s+/);
      const byWords = words.length > 7 ? words.slice(0, 7).join(' ') : p.title.trim();
      p.title = byWords.length > 60 ? byWords.slice(0, 60).trimEnd() : byWords;
    }
    p.contentType = normalizeContentType(p.contentType);
    return p;
  });

  if (autonomousSettings.useEditorPass) {
    progress('AI-редактор', 92, `Редактирование ${contentPlan.length} постов...`);
    contentPlan = await runEditorPass(contentPlan, autonomousSettings, userId, userToken);
  }

  progress('Готово', 100, `Создано ${contentPlan.length} постов`);
  return { success: true, data: { contentPlan } };
}

import { log } from '../utils/logger';

/**
 * AI-фильтрация релевантности найденных каналов/групп.
 * Принимает список найденных элементов + контекст кампании,
 * возвращает только те, что релевантны.
 */

interface ChannelCandidate {
  id?: string;
  username?: string;
  title?: string;
  description?: string;
  subscribers?: number;
  members?: number;
  name?: string;
  screen_name?: string;
  [key: string]: any;
}

interface AiFilterResult<T extends ChannelCandidate> {
  relevant: T[];
  filtered: T[];
  rawAiResponse: string;
}

/**
 * Фильтрует найденные каналы через AI, возвращая только релевантные кампании.
 * @param candidates - найденные каналы/группы
 * @param campaignKeywords - ключевые слова кампании
 * @param platform - 'telegram' | 'vk'
 * @param maxResults - максимальное количество релевантных (по умолчанию candidates.length)
 */
export async function filterByRelevance<T extends ChannelCandidate>(
  candidates: T[],
  campaignKeywords: string[],
  platform: 'telegram' | 'vk',
  maxResults?: number
): Promise<AiFilterResult<T>> {
  if (candidates.length === 0) {
    return { relevant: [], filtered: [], rawAiResponse: '' };
  }

  if (campaignKeywords.length === 0) {
    // Нет ключевых слов — пропускаем AI-фильтрацию
    return { relevant: candidates, filtered: [], rawAiResponse: 'no keywords, skipped' };
  }

  // Формируем список кандидатов для AI (сокращённый формат)
  const channelList = candidates.map((ch, i) => {
    const name = ch.title || ch.name || '';
    const username = ch.username || ch.screen_name || '';
    const desc = (ch.description || '').substring(0, 120);
    const subs = ch.subscribers || ch.members || 0;
    return `${i + 1}. @${username} | ${name} | sub: ${subs} | ${desc}`;
  }).join('\n');

  const prompt = `Ты — эксперт по подбору Telegram-каналов для SMM-кампании.

КЛЮЧЕВЫЕ СЛОВА КАМПАНИИ:
${campaignKeywords.map(k => `- ${k}`).join('\n')}

НАЙДЕННЫЕ ${platform === 'telegram' ? 'КАНАЛЫ' : 'ГРУППЫ'}:
${channelList}

ЗАДАЧА: Определи, какие из найденных каналов релевантны ключевым словам кампании.
- Канал релевантен, если его основная тематика связана с ключевыми словами
- НЕ включай массовые каналы (новости, юмор, развлечения, мемы) даже если у них много подписчиков
- Включай нишевые каналы если они по теме
- Если канал просто упоминает ключевое слово в описании, но основная тема другая — НЕ включай

Верни ТОЛЬКО номера релевантных каналов через запятую. Без пояснений.
Пример: 1,3,5,7

Если ни один не релевантен, верни: 0`;

  try {
    // Импортируем динамически чтобы избежать циклических зависимостей
    const { geminiProxyService } = await import('./gemini-proxy');
    const geminiKey = process.env.GEMINI_API_KEY;

    const aiResponse = await geminiProxyService.generateText({
      prompt,
      model: 'gemini-2.5-flash',
      apiKey: geminiKey,
    });

    const cleaned = aiResponse.trim().replace(/[^0-9,\s]/g, '');
    if (cleaned === '0' || cleaned === '') {
      log(`[AI Relevance] ${platform}: 0 релевантных из ${candidates.length}`, 'info');
      return { relevant: [], filtered: candidates, rawAiResponse: aiResponse };
    }

    const relevantIndices = new Set(
      cleaned.split(',')
        .map(s => parseInt(s.trim(), 10) - 1)
        .filter(n => n >= 0 && n < candidates.length)
    );

    const relevant = candidates.filter((_, i) => relevantIndices.has(i));
    const filtered = candidates.filter((_, i) => !relevantIndices.has(i));
    const limit = maxResults ?? candidates.length;

    log(`[AI Relevance] ${platform}: ${relevant.length}/${candidates.length} релевантных (лимит: ${limit})`, 'info');

    return {
      relevant: relevant.slice(0, limit),
      filtered,
      rawAiResponse: aiResponse,
    };
  } catch (err: any) {
    log(`[AI Relevance] ⚠️ Ошибка AI-фильтрации: ${err.message}. Возвращаем все каналы.`, 'warn');
    return { relevant: candidates, filtered: [], rawAiResponse: `error: ${err.message}` };
  }
}

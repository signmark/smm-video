const VK_PLATFORM_NAMES = new Set(['vk', 'vkontakte', 'вконтакте']);

export function isVkPlatform(platform?: string): boolean {
  return VK_PLATFORM_NAMES.has((platform || '').trim().toLowerCase());
}

export function getGeneratedSocialContentRules(platform?: string): string {
  const commonRules = [
    'Верни только готовый текст публикации без пояснений до или после него.',
    'Не добавляй фразы вроде «Вот вариант поста», «Текст адаптирован» и подпись «Заголовок:».',
    'Не используй Markdown-разметку и служебные символы форматирования.',
  ];

  if (isVkPlatform(platform)) {
    commonRules.push('Для ВКонтакте пиши обычным текстом без эмодзи и хэштегов.');
  }

  return `\n\nТРЕБОВАНИЯ К ОТВЕТУ (обязательно):\n- ${commonRules.join('\n- ')}`;
}

/**
 * Removes model commentary and formatting artifacts from social post generation.
 * VK additionally uses the plain-text contract requested by the product UI.
 */
export function cleanGeneratedSocialContent(text: string, platform?: string): string {
  if (!text) return '';

  let cleaned = text
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const lines = cleaned.split(/\r?\n/);
  while (lines.length > 0) {
    const firstLine = lines[0].trim();
    const isMetaIntro =
      /^(?:вот|ниже)\s+(?:готовый\s+)?(?:вариант|пример)\s+(?:поста|текста|публикации)(?:\s|[.,:;!?]|$)/i.test(firstLine) ||
      /^(?:конечно|разумеется)[,!]?\s+(?:вот|ниже)(?:\s|[.,:;!?]|$)/i.test(firstLine) ||
      /^(?:я\s+)?(?:подготовил|написал|адаптировал)(?:\s|[.,:;!?]|$).*?(?:пост|текст|публикаци)/i.test(firstLine);

    if (!firstLine || isMetaIntro || /^[*_#~-]+$/.test(firstLine)) {
      lines.shift();
      continue;
    }
    break;
  }

  cleaned = lines
    .join('\n')
    .replace(/^\s*(?:заголовок|headline)\s*:\s*/gim, '')
    .replace(/^\s*[*_#~-]+\s*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*+]\s+/gm, '• ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  const trailingLines = cleaned.split('\n');
  while (trailingLines.length > 0) {
    const lastLine = trailingLines[trailingLines.length - 1].trim();
    const isMetaOutro =
      /^(?:надеюсь|буду рад)[,!\s]/i.test(lastLine) ||
      /^(?:если\s+хотите[,]?\s+)?(?:я\s+)?могу\s+(?:адаптировать|доработать|переписать)/i.test(lastLine) ||
      /^(?:дайте\s+знать|готов\s+(?:адаптировать|доработать|переписать))/i.test(lastLine);

    if (!lastLine || isMetaOutro) {
      trailingLines.pop();
      continue;
    }
    break;
  }
  cleaned = trailingLines.join('\n');

  if (isVkPlatform(platform)) {
    const protectedSymbols = new Set(['©', '®', '™']);
    cleaned = cleaned
      .replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1')
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, (symbol) => (
        protectedSymbols.has(symbol) ? symbol : ''
      ));
  }

  return cleaned
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

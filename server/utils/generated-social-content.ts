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
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/~~(.*?)~~/gs, '$1')
    .replace(/`([^`]+)`/g, '$1');

  if (isVkPlatform(platform)) {
    cleaned = cleaned
      .replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1')
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
  }

  return cleaned
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

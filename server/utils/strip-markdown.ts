/**
 * Очищает текст от Markdown-разметки перед публикацией в соцсети.
 * Большинство платформ не поддерживают **bold** / *italic* — они выводятся буквально.
 *
 * Правила:
 *  **text** / __text__  → text  (жирный → просто текст)
 *  *text*  / _text_     → text  (курсив → просто текст)
 *  ~~text~~             → text  (зачёркнутый → просто текст)
 *  `code`               → code  (инлайн-код → просто текст)
 *  ```block```          → block (блок кода → просто текст)
 *  [text](url)          → text url  (ссылки — оставляем текст + url)
 *  # Заголовок          → Заголовок (убираем #-префикс)
 */
export function stripMarkdown(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    // Блоки кода ```...```
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
    // Инлайн-код `...`
    .replace(/`([^`]+)`/g, '$1')
    // Зачёркнутый ~~text~~
    .replace(/~~(.+?)~~/g, '$1')
    // Жирный **text** или __text__
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Курсив *text* или _text_ (не трогаем одиночные _ внутри слов — например snake_case)
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    // Markdown-ссылки [текст](url) → текст url
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    // Заголовки # / ## / ### в начале строки
    .replace(/^#{1,6}\s+/gm, '')
    // Убираем HTML-теги если вдруг попали
    .replace(/<[^>]+>/g, '')
    // Лишние пробелы (но не переносы строк)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Конвертирует Markdown в HTML для Telegram (parse_mode=HTML).
 * Использовать только если n8n-вебхук публикует в Telegram с HTML parse_mode.
 */
export function markdownToTelegramHtml(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    // Жирный
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    // Курсив
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, '<i>$1</i>')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '<i>$1</i>')
    // Зачёркнутый
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    // Инлайн-код
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Заголовки → жирный
    .replace(/^#{1,6}\s+(.+)/gm, '<b>$1</b>')
    .trim();
}

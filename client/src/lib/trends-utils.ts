/**
 * Утилиты для работы с трендами
 */

export type SentimentCategory = "positive" | "negative" | "neutral" | "unknown";

/**
 * Определяет категорию тональности на основе анализа
 */
export function getSentimentCategory(sentimentAnalysis?: any): SentimentCategory {
  if (!sentimentAnalysis) return "unknown";
  
  // Если это объект, попытаемся извлечь строковое представление
  let text = "";
  if (typeof sentimentAnalysis === "string") {
    text = sentimentAnalysis.toLowerCase();
  } else if (typeof sentimentAnalysis === "object") {
    // Попробуем найти текстовое поле в объекте
    text = (sentimentAnalysis.result || sentimentAnalysis.sentiment || sentimentAnalysis.category || JSON.stringify(sentimentAnalysis)).toLowerCase();
  } else {
    text = String(sentimentAnalysis).toLowerCase();
  }
  
  const positiveKeywords = [
    "положительн", "позитивн", "хорош", "отличн", "прекрасн", 
    "великолепн", "успешн", "выгодн", "перспективн", "многообещающ"
  ];
  
  const negativeKeywords = [
    "негативн", "отрицательн", "плох", "ужасн", "проблемн",
    "рискованн", "опасн", "неудачн"
  ];
  
  const neutralKeywords = [
    "нейтральн", "сбалансированн", "умеренн", "стабильн",
    "обычн", "средн", "стандартн"
  ];
  
  if (positiveKeywords.some(keyword => text.includes(keyword))) {
    return "positive";
  }
  
  if (negativeKeywords.some(keyword => text.includes(keyword))) {
    return "negative";
  }
  
  if (neutralKeywords.some(keyword => text.includes(keyword))) {
    return "neutral";
  }
  
  return "unknown";
}

/**
 * Возвращает эмодзи для категории тональности
 */
export function getSentimentEmoji(category: SentimentCategory): string {
  switch (category) {
    case "positive":
      return "😊";
    case "negative":
      return "😞";
    case "neutral":
      return "😐";
    default:
      return "❓";
  }
}

/**
 * Возвращает описание категории тональности
 */
export function getSentimentLabel(category: SentimentCategory): string {
  switch (category) {
    case "positive":
      return "Позитивный";
    case "negative":
      return "Негативный";
    case "neutral":
      return "Нейтральный";
    default:
      return "Неопределенный";
  }
}

/**
 * Форматирует число в сокращенный вид (1K, 1M)
 */
export function formatNumber(num?: number): string {
  if (!num) return "0";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Безопасно парсит JSON с fallback значением
 */
export function safeJsonParse<T>(jsonString?: string, fallback: T = null as T): T {
  if (!jsonString) return fallback;
  
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('Failed to parse JSON:', error);
    return fallback;
  }
}
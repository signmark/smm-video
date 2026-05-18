interface SentimentEmojiProps {
  sentiment?: {
    sentiment?: string;
    score?: number;
    confidence?: number;
    [key: string]: any;
  } | string;
  className?: string;
}

export function SentimentEmoji({ sentiment, className = "" }: SentimentEmojiProps) {
  const getSentimentEmoji = (sentiment?: { sentiment?: string; score?: number } | string): string => {
    if (!sentiment) return "❓";
    
    // Если передан объект с анализом
    if (typeof sentiment === 'object') {
      // Проверяем поле sentiment в объекте
      const sentimentValue = sentiment.sentiment;
      if (sentimentValue) {
        switch (sentimentValue.toLowerCase()) {
          case 'positive':
            return "😊";
          case 'negative':
            return "😞";
          case 'neutral':
            return "😐";
          default:
            return "❓";
        }
      }
      return "❓";
    }
    
    // Если передана строка (старый формат)
    if (typeof sentiment === 'string') {
      const text = sentiment.toLowerCase();
      
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
        return "😊";
      }
      
      if (negativeKeywords.some(keyword => text.includes(keyword))) {
        return "😞";
      }
      
      if (neutralKeywords.some(keyword => text.includes(keyword))) {
        return "😐";
      }
    }
    
    return "❓";
  };

  const getSentimentTitle = (sentiment?: { sentiment?: string; score?: number; confidence?: number } | string): string => {
    let sentimentType = "";
    let score = "";
    let confidence = "";
    
    if (typeof sentiment === 'object' && sentiment) {
      sentimentType = sentiment.sentiment || "";
      score = sentiment.score ? ` (балл: ${sentiment.score})` : "";
      confidence = sentiment.confidence ? ` (уверенность: ${Math.round(sentiment.confidence * 100)}%)` : "";
    }
    
    switch (sentimentType.toLowerCase()) {
      case "positive":
        return `Позитивный тренд${score}${confidence}`;
      case "negative":
        return `Негативный тренд${score}${confidence}`;
      case "neutral":
        return `Нейтральный тренд${score}${confidence}`;
      default:
        return "Тональность не определена";
    }
  };

  return (
    <span 
      className={`text-lg select-none ${className}`}
      title={getSentimentTitle(sentiment)}
    >
      {getSentimentEmoji(sentiment)}
    </span>
  );
}
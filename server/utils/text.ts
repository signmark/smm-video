import { deepseekService } from '../services/deepseek';

/**
 * Очистка текста от HTML-тегов, многоточий и лишних пробелов
 */
export function cleanupText(text: string | null | undefined): string {
  if (!text) return '';
  
  return text
    .replace(/<[^>]*>?/gm, '') // Удаляем HTML теги
    .replace(/&nbsp;/g, ' ') // Заменяем неразрывные пробелы
    .replace(/\s*\.\.\.\s*$/, '') // Удаляем многоточие в конце строки
    .replace(/\n+\s*\.\.\.$/, '') // Удаляем многоточие после переноса строки
    .replace(/\n+\s*\.\.\.\s*\n+/, '\n') // Удаляем многоточие между переносами строк
    .replace(/\n\s*\.{3,}\s*$/, '') // Удаляем многоточие в конце текста после переноса
    .replace(/\n\s*\.{3,}\s*/, ' ') // Заменяем многоточие с переносом на пробел
    .replace(/\s+/g, ' ') // Удаляем лишние пробелы
    .trim();
}

/**
 * Переводит текст с русского на английский для использования в генерации изображений
 * Используется для улучшения качества генерации изображений через Stable Diffusion
 * @param text Текст на русском языке
 * @returns Текст, переведенный на английский язык
 */
export async function translateToEnglish(text: string): Promise<string> {
  try {
    // Используем DeepSeek для перевода, если API ключ доступен
    if (process.env.DEEPSEEK_API_KEY || deepseekService.hasApiKey()) {
      console.log('Переводим текст на английский через DeepSeek API');
      
      const translationPrompt = `Translate the following Russian text to English for image generation purposes. 
Provide only the translation without any explanations or comments:

${text}`;
      
      const response = await deepseekService.generateText([
        { role: 'system', content: 'You are a professional Russian to English translator. Translate the text maintaining the meaning and style, but optimizing it for image generation purposes.' },
        { role: 'user', content: translationPrompt }
      ], {
        model: 'deepseek-chat',
        temperature: 0.3,
        max_tokens: 2000
      });
      
      return response.trim();
    } else {
      // Базовый перевод через словарь
      console.log('DeepSeek API недоступен, используем базовый перевод');
      
      const translationDict: Record<string, string> = {
        'правильное питание': 'healthy nutrition',
        'рецепты': 'recipes',
        'еда': 'food',
        'здоровое питание': 'healthy eating',
        'фрукты': 'fruits',
        'овощи': 'vegetables',
        'диета': 'diet',
        'спорт': 'sports',
        'тренировка': 'workout',
        'фитнес': 'fitness',
        'белок': 'protein',
        'витамины': 'vitamins',
        'завтрак': 'breakfast',
        'обед': 'lunch',
        'ужин': 'dinner',
        'полезные продукты': 'healthy food',
        'салат': 'salad',
        'суп': 'soup',
        'вегетарианский': 'vegetarian',
        'веганский': 'vegan',
        'меню': 'menu',
        'план питания': 'meal plan'
      };
      
      let translatedText = text;
      Object.entries(translationDict).forEach(([rus, eng]) => {
        translatedText = translatedText.replace(new RegExp(rus, 'gi'), eng);
      });
      
      return translatedText;
    }
  } catch (error) {
    console.error('Ошибка при переводе текста:', error);
    return text;
  }
}

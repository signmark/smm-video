/**
 * DEPRECATED: Этот файл был заменен на универсальный интерфейс FAL.AI
 * Для работы с моделями FAL.AI, включая Schnell, используйте:
 * import { falAiUniversalService } from './fal-ai-universal';
 * 
 * Все модели доступны через один универсальный интерфейс:
 * - fast-sdxl
 * - sdxl
 * - schnell
 * - fooocus
 * 
 * @deprecated Используйте falAiUniversalService вместо schnellService
 */

import { falAiUniversalService } from './fal-ai-universal';

export const schnellService = {
  generateImage: (prompt: string, params: any = {}) => {
    console.warn('DEPRECATED: schnellService.generateImage is deprecated. Use falAiUniversalService.generateImages instead.');
    
    return falAiUniversalService.generateImages({
      prompt,
      negativePrompt: params.negativePrompt,
      width: params.width,
      height: params.height,
      numImages: params.numImages,
      model: 'schnell',
      token: params.token,
      userId: params.userId
    });
  }
};
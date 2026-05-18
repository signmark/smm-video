// Canvas загружается динамически чтобы не ломать production без canvas
let canvasModule: any = null;

async function getCanvasModule() {
  if (!canvasModule) {
    try {
      canvasModule = await import('canvas');
    } catch (error) {
      throw new Error('Модуль canvas не установлен. Для генерации изображений на сервере требуется установить canvas: npm install canvas');
    }
  }
  return canvasModule;
}

import * as path from 'path';
import * as fs from 'fs';

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: string;
  backgroundColor?: string;
  rotation?: number;
}

interface GenerateImageOptions {
  backgroundUrl: string;
  textOverlays: TextOverlay[];
  width?: number;
  height?: number;
}

export async function generateStoriesImageServer(options: GenerateImageOptions): Promise<Buffer> {
  const { backgroundUrl, textOverlays, width = 1080, height = 1920 } = options;
  
  console.log('[SERVER-IMAGE-GEN] Начинаем генерацию изображения:', {
    backgroundUrl,
    textOverlaysCount: textOverlays?.length,
    dimensions: `${width}x${height}`
  });

  // Динамически загружаем canvas
  const { createCanvas, loadImage } = await getCanvasModule();

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  try {
    const image = await loadImage(backgroundUrl);
    console.log('[SERVER-IMAGE-GEN] Фоновое изображение загружено:', image.width, 'x', image.height);
    
    const imgAspect = image.width / image.height;
    const canvasAspect = width / height;
    
    let drawWidth, drawHeight, drawX, drawY;
    
    if (imgAspect > canvasAspect) {
      drawHeight = height;
      drawWidth = height * imgAspect;
      drawX = (width - drawWidth) / 2;
      drawY = 0;
    } else {
      drawWidth = width;
      drawHeight = width / imgAspect;
      drawX = 0;
      drawY = (height - drawHeight) / 2;
    }
    
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    console.log('[SERVER-IMAGE-GEN] Фон нарисован');
    
  } catch (error) {
    console.error('[SERVER-IMAGE-GEN] Ошибка загрузки фона:', error);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  if (textOverlays && textOverlays.length > 0) {
    console.log('[SERVER-IMAGE-GEN] Рисуем', textOverlays.length, 'текстовых элементов');
    
    const scaleX = width / 280;
    const scaleY = height / 497;
    
    for (const overlay of textOverlays) {
      ctx.save();
      
      const scaledX = overlay.x * scaleX;
      const scaledY = overlay.y * scaleY;
      const scaledFontSize = Math.round(overlay.fontSize * ((scaleX + scaleY) / 2));
      
      console.log('[SERVER-IMAGE-GEN] Текст:', overlay.text, 'позиция:', scaledX, scaledY, 'размер:', scaledFontSize);
      
      if (overlay.rotation) {
        ctx.translate(scaledX, scaledY);
        ctx.rotate((overlay.rotation * Math.PI) / 180);
        ctx.translate(-scaledX, -scaledY);
      }
      
      const fontWeight = overlay.fontWeight || 'normal';
      const fontFamily = overlay.fontFamily || 'Arial';
      ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
      ctx.fillStyle = overlay.color || '#ffffff';
      ctx.textAlign = (overlay.textAlign as CanvasTextAlign) || 'left';
      ctx.textBaseline = 'top';
      
      if (overlay.backgroundColor) {
        const metrics = ctx.measureText(overlay.text);
        const textWidth = metrics.width;
        const textHeight = scaledFontSize * 1.2;
        
        ctx.fillStyle = overlay.backgroundColor;
        ctx.fillRect(
          scaledX - 10,
          scaledY - 5,
          textWidth + 20,
          textHeight + 10
        );
        
        ctx.fillStyle = overlay.color || '#ffffff';
      }
      
      ctx.fillText(overlay.text, scaledX, scaledY);
      
      ctx.restore();
    }
  }

  const buffer = canvas.toBuffer('image/png');
  console.log('[SERVER-IMAGE-GEN] Изображение сгенерировано, размер:', buffer.length, 'байт');
  
  return buffer;
}

export async function generateStoriesImageBase64(options: GenerateImageOptions): Promise<string> {
  const buffer = await generateStoriesImageServer(options);
  return buffer.toString('base64');
}

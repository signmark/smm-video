import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface StoriesImageGeneratorProps {
  story: any;
  onImageGenerated?: (imageUrl: string) => void;
}

export const StoriesImageGenerator: React.FC<StoriesImageGeneratorProps> = ({ 
  story, 
  onImageGenerated 
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const { toast } = useToast();

  const generateImage = async () => {
    // textOverlays могут быть напрямую в story или в story.metadata
    const textOverlays = story?.textOverlays || story?.metadata?.textOverlays || [];
    
    if (!story || !textOverlays.length) {
      toast({
        title: "Ошибка",
        description: "Нет текстовых элементов для генерации",
        variant: "destructive"
      });
      return;
    }
    
    console.log('[STORIES-IMAGE-GEN] Найдено textOverlays:', textOverlays.length, textOverlays);
    
    setIsGenerating(true);
    
    try {
      // Создаем canvas в браузере
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Не удалось создать контекст canvas');
      }

      // Оптимальный размер для качества и совместимости с ImgBB
      const width = 540;   // Средний размер для хорошего качества
      const height = 960;  // Соотношение 9:16 для Instagram Stories
      canvas.width = width;
      canvas.height = height;

      // Заливаем фон
      if (story.backgroundImageUrl || story.image_url) {
        try {
          const imageUrl = story.backgroundImageUrl || story.image_url;
          console.log('[STORIES-IMAGE-GEN] Загружаем фоновое изображение:', imageUrl);
          
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          // Используем прокси для всех внешних изображений (включая Beget S3 - у него нет CORS)
          let proxyUrl = imageUrl;
          const isSameDomain = imageUrl.includes(window.location.hostname);
          
          if (imageUrl.startsWith('http') && !isSameDomain) {
            proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
            console.log('[STORIES-IMAGE-GEN] Используем прокси для внешнего изображения:', proxyUrl);
          } else {
            console.log('[STORIES-IMAGE-GEN] Загружаем изображение напрямую (тот же домен):', imageUrl);
          }
          
          await new Promise((resolve, reject) => {
            img.onload = () => {
              console.log('[STORIES-IMAGE-GEN] Изображение загружено успешно');
              resolve(true);
            };
            img.onerror = (error) => {
              console.error('[STORIES-IMAGE-GEN] Ошибка загрузки изображения:', error);
              reject(error);
            };
            img.src = proxyUrl;
          });
          
          // Масштабируем изображение чтобы покрыть весь canvas
          const scale = Math.max(width / img.width, height / img.height);
          const scaledWidth = img.width * scale;
          const scaledHeight = img.height * scale;
          const x = (width - scaledWidth) / 2;
          const y = (height - scaledHeight) / 2;
          
          ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
          console.log('[STORIES-IMAGE-GEN] Изображение нарисовано на canvas');
        } catch (error) {
          console.warn('[STORIES-IMAGE-GEN] Ошибка загрузки фонового изображения, используем градиент:', error);
          // Градиентный фон как fallback
          const gradient = ctx.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(0, '#667eea');
          gradient.addColorStop(1, '#764ba2');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);
        }
      } else {
        console.log('[STORIES-IMAGE-GEN] Используем градиентный фон по умолчанию');
        // Градиентный фон по умолчанию
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      // Добавляем текстовые элементы
      for (const overlay of textOverlays) {
        // ИДЕАЛЬНАЯ ЛОГИКА: размер canvas = размер превью, никакого масштабирования!
        // 1. Берем координаты из базы
        // 2. Умножаем на 0.8 (как в превью)
        // 3. Используем напрямую - НЕТ МАСШТАБИРОВАНИЯ!
        
        // Используем точно те же координаты что и в превью
        // Масштабируем координаты под новый размер canvas
        // Превью: 280x497 -> Canvas: 540x960
        const scaleX = width / 280;  // Масштабирование по X: 540/280 = 1.93
        const scaleY = height / 497; // Масштабирование по Y: 960/497 = 1.93
        const textPaddingX = overlay.backgroundColor !== 'transparent' ? 8 * scaleX : 2 * scaleX;
        // Применяем тот же коэффициент 0.8 что и в превью
        const x = (overlay.x !== undefined ? overlay.x : 50) * 0.8 * scaleX + textPaddingX;
        const y = (overlay.y !== undefined ? overlay.y : 50) * 0.8 * scaleY;
        
        const fontSize = (overlay.fontSize || 24) * scaleX;
        
        // Координаты готовы для рисования
        
        ctx.save();
        
        // Поворот текста
        if (overlay.rotation) {
          ctx.translate(x, y);
          ctx.rotate((overlay.rotation * Math.PI) / 180);
          ctx.translate(-x, -y);
        }
        
        // Фон для текста (если не прозрачный)
        if (overlay.backgroundColor && overlay.backgroundColor !== 'transparent') {
          ctx.font = `${overlay.fontWeight || 'bold'} ${fontSize}px ${overlay.fontFamily || 'Arial'}`;
          const textMetrics = ctx.measureText(overlay.text || 'Текст');
          const textWidth = textMetrics.width;
          const textHeight = fontSize;
          
          ctx.fillStyle = overlay.backgroundColor;
          // Фон масштабируется под новый размер
          ctx.fillRect(
            x - 8 * scaleX,                    // Масштабированный отступ слева
            y - 4 * scaleY,                    // Масштабированный отступ сверху
            textWidth + 16 * scaleX,           // Масштабированная ширина фона
            textHeight + 8 * scaleY            // Масштабированная высота фона
          );
        }
        
        // Настройки текста - точно как позиционируется в превью
        ctx.font = `${overlay.fontWeight || 'bold'} ${fontSize}px ${overlay.fontFamily || 'Arial'}`;
        ctx.fillStyle = overlay.color || '#ffffff';
        ctx.textAlign = 'left';    // Текст начинается С координаты, не центрируется
        ctx.textBaseline = 'top';   // Текст начинается СВЕРХУ координаты
        
        // Добавляем тень для лучшей читаемости (масштабированную)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 3 * scaleX;
        ctx.shadowOffsetX = 1.5 * scaleX;
        ctx.shadowOffsetY = 1.5 * scaleY;
        
        // Рисуем текст
        ctx.fillText(overlay.text || 'Текст', x, y);
        
        ctx.restore();
      }

      // Конвертируем в base64 с оптимизированным качеством для ImgBB
      let finalImage = canvas.toDataURL('image/jpeg', 0.8); // Хорошее качество 80%
      
      // ImgBB имеет лимит, поэтому проверяем размер и сжимаем при необходимости
      if (finalImage.length > 300000) { // 300KB limit для стабильной работы ImgBB
        finalImage = canvas.toDataURL('image/jpeg', 0.6); // Умеренное сжатие 60%
      }
      
      // Дополнительное сжатие для больших изображений
      if (finalImage.length > 500000) { // 500KB - максимальный лимит
        finalImage = canvas.toDataURL('image/jpeg', 0.4); // Сильное сжатие 40%
      }
      
      console.log(`[STORIES-IMAGE-GENERATOR] Размер изображения: ${Math.round(finalImage.length / 1024)}KB`);
      
      // Загружаем на S3 и сохраняем в Stories
      try {
        // Конвертируем base64 в Blob для загрузки на S3
        const base64Data = finalImage.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
        const file = new File([blob], `story-${story.title || 'generated'}-${Date.now()}.jpg`, { type: 'image/jpeg' });
        
        const formData = new FormData();
        formData.append('image', file);
        
        const uploadResponse = await fetch('/api/s3/upload-image', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token')}`
          },
          body: formData
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error('[STORIES-IMAGE-GENERATOR] S3 response:', errorText);
          throw new Error(`S3 upload failed: ${uploadResponse.status} - ${errorText}`);
        }

        const uploadResult = await uploadResponse.json();
        let imageUrl = uploadResult.data?.url || uploadResult.url;
        
        // Если url - это объект с полем url (ответ от Beget S3), извлекаем строку
        if (imageUrl && typeof imageUrl === 'object' && imageUrl.url) {
          imageUrl = imageUrl.url;
        }
        
        if (!imageUrl || typeof imageUrl !== 'string') {
          throw new Error('Сервер не вернул URL изображения');
        }

        console.log('[STORIES-IMAGE-GENERATOR] Изображение загружено на ImgBB:', imageUrl);

        // Сохраняем сгенерированное изображение в additional_media Stories
        const additionalMedia = [{
          type: 'generated_image',
          url: imageUrl,
          generated_at: new Date().toISOString(),
          purpose: 'stories_publication'
        }];

        const updateResponse = await fetch(`/api/stories/simple/${story.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token')}`
          },
          body: JSON.stringify({
            additional_media: JSON.stringify(additionalMedia)
          })
        });

        if (updateResponse.ok) {
          console.log('[STORIES-IMAGE-GENERATOR] additional_media обновлено в Stories');
        }

        setGeneratedImage(imageUrl);
        onImageGenerated?.(imageUrl);
        
        toast({
          title: "Успешно",
          description: "Изображение сгенерировано и готово к публикации",
        });
      } catch (uploadError) {
        console.error('[STORIES-IMAGE-GENERATOR] Ошибка загрузки:', uploadError);
        
        // Показываем локальное изображение как fallback
        setGeneratedImage(finalImage);
        onImageGenerated?.(finalImage);
        
        toast({
          title: "Изображение создано локально",
          description: "Изображение готово, но не загружено на сервер. Попробуйте опубликовать.",
          variant: "default"
        });
      }
      
    } catch (error) {
      console.error('[STORIES-IMAGE-GENERATOR] Ошибка генерации изображения:', error);
      const axErr = error as any;
      const serverMsg = axErr?.response?.data?.error;
      const status = axErr?.response?.status;
      let description = serverMsg
        || (status === 429 ? "Превышен лимит запросов к сервису генерации. Попробуйте позже или выберите другую модель (Flux / Schnell)." : null)
        || (error instanceof Error ? error.message : 'Произошла ошибка при генерации изображения');
      toast({
        title: "Ошибка генерации",
        description,
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = () => {
    if (!generatedImage) return;
    
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `story-${story?.title || 'image'}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Скачивание",
      description: "Изображение сохранено",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          onClick={generateImage}
          disabled={isGenerating || (!story?.textOverlays?.length && !story?.metadata?.textOverlays?.length)}
          className="flex items-center gap-2"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
          {isGenerating ? 'Генерация...' : 'Сгенерировать изображение'}
        </Button>
        
        {generatedImage && (
          <Button
            onClick={downloadImage}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Скачать
          </Button>
        )}
      </div>

      {(!story?.textOverlays?.length && !story?.metadata?.textOverlays?.length) && (
        <p className="text-sm text-muted-foreground">
          Добавьте текстовые элементы для генерации изображения
        </p>
      )}

      {generatedImage && (
        <div className="border rounded-lg p-4">
          <h4 className="text-sm font-medium mb-2">Сгенерированное изображение:</h4>
          <div className="flex justify-center">
            <img 
              src={generatedImage} 
              alt="Сгенерированное изображение Stories"
              className="rounded-lg shadow-lg"
              style={{ width: '280px', height: '497px', objectFit: 'cover' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
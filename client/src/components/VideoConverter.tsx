import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Play, RefreshCw, Check, X, Info } from 'lucide-react';
import { 
  convertVideoForInstagramStories, 
  convertContentVideo,
  needsVideoConversion,
  formatFileSize,
  formatDuration,
  type VideoConversionResult 
} from '@/utils/video-converter-api';

interface VideoConverterProps {
  videoUrl?: string;
  contentId?: string;
  onConversionComplete?: (result: VideoConversionResult) => void;
  disabled?: boolean;
  showDetails?: boolean;
}

/**
 * Компонент для конвертации видео в формат Instagram Stories
 */
export function VideoConverter({ 
  videoUrl, 
  contentId,
  onConversionComplete,
  disabled = false,
  showDetails = true
}: VideoConverterProps) {
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<VideoConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsConversion = videoUrl ? needsVideoConversion(videoUrl) : true;

  const handleConvert = async () => {
    if (!videoUrl && !contentId) {
      setError('Необходимо указать URL видео или ID контента');
      return;
    }

    setIsConverting(true);
    setError(null);
    setResult(null);

    try {
      let conversionResult: VideoConversionResult;

      if (contentId) {
        // Конвертируем по ID контента
        conversionResult = await convertContentVideo(contentId);
      } else if (videoUrl) {
        // Конвертируем по URL
        conversionResult = await convertVideoForInstagramStories(videoUrl, contentId);
      } else {
        throw new Error('Не указан источник видео');
      }

      setResult(conversionResult);
      
      if (conversionResult.success && onConversionComplete) {
        onConversionComplete(conversionResult);
      }

    } catch (err: any) {
      console.error('Ошибка конвертации:', err);
      setError(err.message || 'Произошла ошибка при конвертации видео');
    } finally {
      setIsConverting(false);
    }
  };

  const getStatusIcon = () => {
    if (isConverting) return <RefreshCw className="h-4 w-4 animate-spin" />;
    if (result?.success) return <Check className="h-4 w-4 text-green-600" />;
    if (error) return <X className="h-4 w-4 text-red-600" />;
    return <Play className="h-4 w-4" />;
  };

  const getStatusText = () => {
    if (isConverting) return 'Конвертация...';
    if (result?.success) return 'Конвертировано';
    if (error) return 'Ошибка';
    if (!needsConversion) return 'Готово для Instagram';
    return 'Конвертировать';
  };

  const getStatusColor = () => {
    if (result?.success) return 'bg-green-100 text-green-800';
    if (error) return 'bg-red-100 text-red-800';
    if (!needsConversion) return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-3">
      {/* Основная кнопка конвертации */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleConvert}
          disabled={disabled || isConverting || (!needsConversion && !contentId)}
          size="sm"
          variant={result?.success ? "outline" : "default"}
        >
          {getStatusIcon()}
          {getStatusText()}
        </Button>

        <Badge className={getStatusColor()}>
          {!needsConversion ? 'Оптимизировано' : 'Требует конвертации'}
        </Badge>
      </div>

      {/* Прогресс конвертации */}
      {isConverting && (
        <div className="space-y-2">
          <Progress value={undefined} className="w-full" />
          <p className="text-sm text-gray-600">
            Конвертация видео для Instagram Stories (9:16, до 59 сек)...
          </p>
        </div>
      )}

      {/* Результат конвертации */}
      {result && result.success && showDetails && (
        <Alert>
          <Check className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">Видео успешно конвертировано!</p>
              {result.metadata && (
                <div className="text-sm space-y-1">
                  <p>• Разрешение: {result.metadata.width}x{result.metadata.height}</p>
                  <p>• Длительность: {formatDuration(result.metadata.duration)}</p>
                  <p>• Размер: {formatFileSize(result.metadata.size)}</p>
                  <p>• Кодек: {result.metadata.codec}</p>
                </div>
              )}
              {result.method === 'no_conversion_needed' && (
                <p className="text-sm text-blue-600">
                  <Info className="h-4 w-4 inline mr-1" />
                  Видео уже оптимизировано для Instagram Stories
                </p>
              )}
              {result.contentUpdated && (
                <p className="text-sm text-green-600">
                  ✓ Ссылка в контенте обновлена
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Ошибка конвертации */}
      {error && (
        <Alert variant="destructive">
          <X className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">Ошибка конвертации</p>
            <p className="text-sm">{error}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Информация о конвертере */}
      {showDetails && !isConverting && !result && !error && (
        <div className="text-xs text-gray-500 space-y-1">
          <p>• Конвертация в формат 9:16 (Instagram Stories)</p>
          <p>• Максимальная длительность: 59 секунд</p>
          <p>• Автоматическая загрузка на S3</p>
          <p>• Обновление ссылки в контенте</p>
        </div>
      )}
    </div>
  );
}

export default VideoConverter;
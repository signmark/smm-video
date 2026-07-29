import { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload, VideoIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";
import { UploadProgress } from './UploadProgress';

/**
 * Утилита для проверки URL на видео-формат
 * @param url URL для проверки
 * @returns true если URL указывает на видеофайл
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;

  // Проверяем расширение файла или URL
  const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv'];
  const hasVideoExtension = videoExtensions.some(ext => url.toLowerCase().includes(ext));

  // Проверяем, является ли URL ссылкой на S3 хранилище Beget
  const isBegetS3Url = url.includes('s3.ru1.storage.beget.cloud');

  // Проверяем URL видеохостингов
  const isVideoHosting = url.includes('youtube.com/watch') || 
                         url.includes('youtu.be/') || 
                         url.includes('vimeo.com/');

  return hasVideoExtension || isBegetS3Url || isVideoHosting;
}

interface VideoUploaderProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  id?: string;
  forcePreview?: boolean;
  onUploadingChange?: (isUploading: boolean) => void;
}

export function VideoUploader({ 
  value, 
  onChange, 
  placeholder = "Введите URL видео", 
  id, 
  forcePreview = false,
  onUploadingChange
}: VideoUploaderProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  
  const updateUploadingState = (uploading: boolean) => {
    setIsUploading(uploading);
    onUploadingChange?.(uploading);
  };
  const [isLoading, setIsLoading] = useState(false); // Для загрузки превью видео
  const [showPreview, setShowPreview] = useState(forcePreview);
  const [previewUrl, setPreviewUrl] = useState('');
  const [displayUrl, setDisplayUrl] = useState<string>('');

  // Обновляем превью и отображение URL при изменении значения
  useEffect(() => {
    if (value && value.trim() !== '') {
      setPreviewUrl(value);
      setShowPreview(forcePreview || showPreview);
      setDisplayUrl(value.length > 50 ? value.substring(0, 47) + '...' : value);
    } else {
      setShowPreview(false);
      setPreviewUrl('');
      setDisplayUrl('');
    }
  }, [value, forcePreview]);

  // Обработка загрузки файла
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const formData = new FormData();
      formData.append('video', file);

      updateUploadingState(true);

      try {


        // Получаем токен авторизации из localStorage
        const token = localStorage.getItem('auth_token');

        const response = await axios.post('/api/beget-s3-video/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token ? `Bearer ${token}` : ''
          }
        });



        if (response.data && response.data.success && response.data.videoUrl) {
          const videoUrl = response.data.videoUrl;
          onChange(videoUrl);
          setPreviewUrl(videoUrl);
          setShowPreview(true);
          toast({
            title: 'Успешно',
            description: 'Видео загружено на S3'
          });

          // Очищаем поле выбора файла
          e.target.value = '';
        } else {
          console.error('Не удалось извлечь URL видео из ответа сервера');
          toast({
            title: 'Ошибка',
            description: response.data?.error || 'Не удалось загрузить видео. Попробуйте другой формат.',
            variant: 'destructive'
          });
        }
      } catch (error: any) {
        console.error('Ошибка при загрузке видео:', error);
        toast({
          title: 'Ошибка',
          description: error.response?.data?.error || error.message || 'Ошибка при загрузке видео',
          variant: 'destructive'
        });
      } finally {
        updateUploadingState(false);
      }
    }
  };

  // Обработчик начала загрузки видео
  const handleVideoLoadStart = () => {
    setIsLoading(true);
  };

  // Обработчик окончания загрузки видео
  const handleVideoLoaded = () => {
    setIsLoading(false);
  };

  return (
    <div className="space-y-2 w-full">
      <div className="flex gap-2 w-full">
        <Input
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <div className="relative flex-shrink-0">
          <Input
            type="file"
            accept="video/*"
            id={`${id}-upload`}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            onChange={handleFileUpload}
            disabled={isUploading}
            aria-label="Загрузить видео"
          />
          <Button 
            type="button" 
            variant="outline" 
            size="icon"
            className="h-9 w-9 flex items-center justify-center"
            tabIndex={-1}
            aria-hidden="true"
            disabled={isUploading}
          >
            <span className="sr-only">Загрузить</span>
            {isUploading ? (
              <div 
                className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin"
                aria-hidden="true" 
              />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {value && value.trim() !== '' && (
        <div className="text-xs text-muted-foreground ml-1 mt-1 break-all">
          <span className="flex-shrink-0">URL:</span>
          <span className="break-all">{value}</span>
        </div>
      )}

      {showPreview && previewUrl && (
        <div className="mt-2 border rounded-md p-2 bg-muted/20">
          <div className="text-xs text-muted-foreground mb-1">Предпросмотр видео:</div>
          <div className="relative w-full h-auto rounded-md overflow-hidden bg-muted">
            {isVideoUrl(previewUrl) ? (
              <>
                <video 
                  src={previewUrl} 
                  controls
                  preload="metadata"
                  className="max-w-full h-auto max-h-60"
                  onLoadStart={handleVideoLoadStart}
                  onLoadedData={handleVideoLoaded}
                  onError={() => {
                    setIsLoading(false);
                    toast({
                      title: 'Ошибка загрузки превью',
                      description: 'Не удалось загрузить видео для предпросмотра',
                      variant: 'destructive'
                    });
                  }}
                ></video>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground py-10">
                <VideoIcon className="h-10 w-10 mb-2" />
                <span>Не удалось отобразить превью видео</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
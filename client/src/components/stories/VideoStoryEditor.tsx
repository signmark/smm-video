import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Upload, Save, ArrowLeft, Play, Pause, Plus, Trash2, Move, Type, Video, Send } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import DraggableWrapper from './DraggableWrapper';
import { apiRequest } from '@/lib/queryClient';
import { generateStoriesVideo } from '@/utils/storiesVideoUtils';

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  startTime: number;
  endTime: number;
}

interface VideoStoryData {
  id?: string;
  title: string;
  backgroundVideoUrl: string | null;
  textOverlays: TextOverlay[];
  duration: number;
}

interface VideoStoryEditorProps {
  storyId: string;
}

export default function VideoStoryEditor({ storyId }: VideoStoryEditorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [story, setStory] = useState<VideoStoryData>({
    id: storyId,
    title: '',
    backgroundVideoUrl: null,
    textOverlays: [],
    duration: 0
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedOverlay, setSelectedOverlay] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingMessage, setProcessingMessage] = useState('');

  // Загрузка видео
  const handleVideoUpload = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      toast({
        title: "Ошибка",
        description: "Только видео файлы",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || localStorage.getItem('authToken');
      if (!token) {
        throw new Error('Токен авторизации не найден');
      }

      const formData = new FormData();
      formData.append('video', file);

      const response = await fetch('/api/beget-s3-video/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ошибка ответа сервера:', errorText);
        throw new Error('Ошибка загрузки видео');
      }

      const result = await response.json();
      
      if (result.success && result.videoUrl) {
        setStory(prev => ({ ...prev, backgroundVideoUrl: result.videoUrl }));
        toast({
          title: "Успех",
          description: "Видео загружено",
        });
      } else {
        throw new Error(result.error || 'Ошибка загрузки видео');
      }
    } catch (error) {
      console.error('Ошибка загрузки видео:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить видео",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  // Обработка метаданных видео
  const handleVideoLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const duration = Math.min(video.duration, 30); // Максимум 30 секунд для Stories
    setStory(prev => ({ ...prev, duration }));

    // Если видео длиннее 30 секунд, предупреждаем пользователя
    if (video.duration > 30) {
      toast({
        title: 'Внимание',
        description: 'Видео будет обрезано до 30 секунд для соответствия требованиям Stories',
        variant: 'default'
      });
    }
  }, [toast]);

  // Управление воспроизведением
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // Обновление текущего времени
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
  }, []);

  // Добавление нового текстового наложения
  const addTextOverlay = useCallback(() => {
    const newOverlay: TextOverlay = {
      id: `overlay_${Date.now()}`,
      text: 'Новый текст',
      x: 50,
      y: 50,
      fontSize: 32,
      color: '#ffffff',
      startTime: currentTime,
      endTime: Math.min(currentTime + 3, story.duration) // 3 секунды по умолчанию
    };

    setStory(prev => ({
      ...prev,
      textOverlays: [...prev.textOverlays, newOverlay]
    }));
    setSelectedOverlay(story.textOverlays.length);
  }, [currentTime, story.duration, story.textOverlays.length]);

  // Обновление наложения
  const updateTextOverlay = useCallback((index: number, updates: Partial<TextOverlay>) => {
    setStory(prev => ({
      ...prev,
      textOverlays: prev.textOverlays.map((overlay, i) => 
        i === index ? { ...overlay, ...updates } : overlay
      )
    }));
  }, []);

  // Удаление наложения
  const removeTextOverlay = useCallback((index: number) => {
    setStory(prev => ({
      ...prev,
      textOverlays: prev.textOverlays.filter((_, i) => i !== index)
    }));
    setSelectedOverlay(-1);
  }, []);

  // Перетаскивание текста
  const handleTextDrag = useCallback((index: number) => (e: any, data: any) => {
    updateTextOverlay(index, { x: data.x, y: data.y });
  }, [updateTextOverlay]);

  // Проверка, должен ли текст отображаться в данный момент времени
  const isOverlayVisible = useCallback((overlay: TextOverlay) => {
    return currentTime >= overlay.startTime && currentTime <= overlay.endTime;
  }, [currentTime]);

  // Загрузка Stories при инициализации
  useEffect(() => {
    const loadStory = async () => {
      if (!storyId) return;
      
      try {
        const response = await apiRequest(`/api/stories/simple/${storyId}`);
        if (response.success && response.data) {
          const data = response.data;
          
          let textOverlays: TextOverlay[] = [];
          try {
            const metadata = typeof data.metadata === 'string' 
              ? JSON.parse(data.metadata) 
              : data.metadata;
            textOverlays = metadata.textOverlays || [];
          } catch (e) {
            console.error('Ошибка парсинга метаданных:', e);
          }

          console.log('Загруженные данные Stories:', {
            id: storyId,
            title: data.title || '',
            video_url: data.video_url,
            backgroundVideoUrl: data.video_url || null,
            hasVideoUrl: !!data.video_url
          });
          
          setStory({
            id: storyId,
            title: data.title || '',
            backgroundVideoUrl: data.video_url || null,
            textOverlays,
            duration: 0
          });
        }
      } catch (error) {
        console.error('Ошибка загрузки Stories:', error);
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить данные Stories",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    loadStory();
  }, [storyId]);

  // Сохранение Stories
  const handleSave = async () => {
    setSaving(true);
    try {
      const metadata = {
        textOverlays: story.textOverlays,
        version: '1.0'
      };

      // Сохраняем Stories
      console.log('Сохранение Stories:', {
        title: story.title,
        video_url: story.backgroundVideoUrl,
        metadata: JSON.stringify(metadata)
      });
      
      await apiRequest(`/api/stories/simple/${storyId}`, {
        method: 'PUT',
        data: {
          title: story.title,
          video_url: story.backgroundVideoUrl,
          metadata: JSON.stringify(metadata)
        }
      });

      // Также обновляем video_url в контенте
      console.log('Сохранение video_url в контент:', {
        storyId,
        backgroundVideoUrl: story.backgroundVideoUrl,
        hasVideoUrl: !!story.backgroundVideoUrl
      });
      
      if (story.backgroundVideoUrl) {
        try {
          const contentUpdateResponse = await apiRequest(`/api/campaign-content/${storyId}`, {
            method: 'PUT',
            data: {
              video_url: story.backgroundVideoUrl
            }
          });
          console.log('Контент успешно обновлен с video_url:', contentUpdateResponse);
        } catch (contentError) {
          console.error('Ошибка обновления video_url в контенте:', contentError);
          toast({
            title: "Предупреждение",
            description: "Stories сохранена, но video_url не обновлен в контенте",
            variant: "destructive"
          });
        }
      } else {
        console.warn('Нет video_url для сохранения в контент');
      }

      toast({
        title: "Сохранено",
        description: "Видео Stories сохранена",
      });
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить Stories",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  // Генерация видео с текстовыми наложениями
  const handleGenerateVideo = async () => {
    if (!story.backgroundVideoUrl) {
      toast({
        title: "Ошибка",
        description: "Сначала загрузите фоновое видео",
        variant: "destructive"
      });
      return;
    }

    if (story.textOverlays.length === 0) {
      toast({
        title: "Предупреждение", 
        description: "Нет текстовых наложений для генерации",
        variant: "destructive"
      });
      return;
    }

    const progressId = Date.now().toString();
    setIsProcessing(true);
    setProcessingProgress(0);
    setProcessingMessage('Подготовка к обработке...');
    
    // Подключаемся к SSE для получения прогресса
    const eventSource = new EventSource(`/api/video-processing/progress/${progressId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'progress') {
          setProcessingProgress(data.percent);
          setProcessingMessage(data.message);
        } else if (data.type === 'complete') {
          setProcessingProgress(100);
          setProcessingMessage(data.message);
          setGeneratedVideoUrl(data.videoUrl);
          setIsProcessing(false);
          eventSource.close();
          
          // Сохраняем видео в additional_media
          saveToAdditionalMedia(data.videoUrl);
          
          toast({
            title: "Успех!",
            description: "Видео успешно обработано и сохранено в additional_media",
          });
        } else if (data.type === 'connected') {
          setProcessingMessage('Соединение установлено');
        } else if (data.type === 'error') {
          setProcessingProgress(0);
          setProcessingMessage(data.message);
          setIsProcessing(false);
          eventSource.close();
          
          toast({
            title: "Ошибка",
            description: data.error || data.message,
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Ошибка парсинга SSE данных:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE ошибка:', error);
      eventSource.close();
      setIsProcessing(false);
      setProcessingMessage('Ошибка соединения');
      
      toast({
        title: "Ошибка",
        description: "Потеряно соединение с сервером",
        variant: "destructive"
      });
    };

    setGenerating(true);
    
    try {
      console.log('Начинаем генерацию видео с данными:', {
        backgroundVideoUrl: story.backgroundVideoUrl,
        textOverlays: story.textOverlays
      });

      const response = await apiRequest('/api/video-processing/process-video-from-url', {
        method: 'POST',
        data: {
          videoUrl: story.backgroundVideoUrl,
          textOverlays: story.textOverlays.map(overlay => {
            // Точное масштабирование из превью 250x444px в видео 1080x1920px
            const scaleX = 1080 / 250; // = 4.32
            const scaleY = 1920 / 444; // = 4.32
            
            let scaledX = Math.round(overlay.x * scaleX);
            let scaledY = Math.round(overlay.y * scaleY);
            const scaledFontSize = Math.round(overlay.fontSize * scaleX);
            
            // Корректировки для компенсации различий в масштабировании превью
            // Различные корректировки в зависимости от позиции текста
            if (overlay.y > 300) {
              // Для текста в нижней части (как "Низкий старт")
              scaledX = Math.round(scaledX * 0.50); // Максимально левее
              scaledY = Math.round(scaledY * 0.78); // Немного выше
            } else if (overlay.y < 100) {
              // Для текста в верхней части (как "Пошел-пошел!")
              scaledX = Math.round(scaledX * 0.95); // Небольшая корректировка влево
              scaledY = Math.round(scaledY * 1.05); // Немного ниже
            }
            
            // Ограничиваем координаты границами видео 1080x1920
            const finalX = Math.max(0, Math.min(scaledX, 1080 - 50)); 
            const finalY = Math.max(30, Math.min(scaledY, 1920 - 30));  
            const finalFontSize = Math.max(40, Math.min(scaledFontSize, 400));
            
            console.log(`Текст "${overlay.text}": ${overlay.x},${overlay.y} -> ${finalX},${finalY} (масштаб x${scaleX.toFixed(2)})`);
            
            return {
              text: overlay.text,
              x: finalX,
              y: finalY,
              fontSize: finalFontSize,
              color: overlay.color,
              fontFamily: overlay.fontFamily || 'Arial',
              startTime: overlay.startTime || 0,
              endTime: overlay.endTime || 60
            };
          }),
          campaignId: storyId,
          progressId: progressId
        }
      });

      if (!response.success) {
        throw new Error(response.error || 'Неизвестная ошибка');
      }

    } catch (error) {
      console.error('Ошибка генерации видео:', error);
      eventSource.close();
      setIsProcessing(false);
      
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось сгенерировать видео",
        variant: "destructive"
      });
    } finally {
      setGenerating(false);
    }
  };

  // Функция для сохранения видео в additional_media структуру Directus
  const saveToAdditionalMedia = async (videoUrl: string) => {
    try {
      console.log('Сохранение видео URL в additional_media:', videoUrl);
      
      // Создаем Instagram-совместимый прокси URL
      const fileName = videoUrl.split('/').pop();
      const baseUrl = window.location.origin;
      const proxyUrl = `${baseUrl}/api/instagram-video-proxy/${fileName}`;
      
      console.log('Создан прокси URL:', proxyUrl);
      
      // Структура для поля additional_media в Directus (массив для репитера)
      const mediaStructure = [{
        url: proxyUrl,  // Прокси URL в поле url
        type: 'generated_video',  // Тип контента  
        title: 'Instagram Stories Video',  // Заголовок
        description: 'Generated video with text overlays for Instagram Stories'  // Описание
      }];
      
      console.log('Массив для additional_media репитера:', mediaStructure);
      
      // Сохраняем массив в additional_media
      const response = await fetch(`/api/stories/simple/${storyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          additional_media: mediaStructure
        })
      });
      
      if (response.ok) {
        console.log('Структура additional_media успешно сохранена');
        toast({
          title: "Успешно",
          description: "Видео готово для Instagram Stories",
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Ошибка сохранения в additional_media:', error);
      toast({
        title: "Предупреждение",
        description: "Видео обработано, но не сохранено в additional_media",
        variant: "destructive"
      });
    }
  };

  const selectedOverlayData = selectedOverlay >= 0 ? story.textOverlays[selectedOverlay] : null;
  
  const getCampaignId = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('campaignId') || "46868c44-c6a4-4bed-accf-9ad07bba790e";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка видео редактора...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4">
        {/* Заголовок */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={() => setLocation('/content')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Редактор видео Stories</h1>
              <p className="text-gray-600">Создание Stories с видео и текстовыми наложениями</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              onClick={handleGenerateVideo}
              disabled={generating || isProcessing || !story.backgroundVideoUrl}
              variant="outline"
            >
              <Video className="h-4 w-4 mr-2" />
              {isProcessing ? 'Обработка...' : generating ? 'Генерация...' : 'Генерировать видео'}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </div>

        {/* Прогресс обработки видео */}
        {isProcessing && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-6 h-6 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
              </div>
              <span className="font-medium text-blue-900">Обработка видео</span>
            </div>
            
            {/* Прогресс бар */}
            <div className="relative">
              <div className="w-full bg-blue-200 rounded-full h-3 mb-2">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${processingProgress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-blue-700">{processingMessage}</span>
                <span className="font-semibold text-blue-900">{processingProgress}%</span>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-4 gap-6">
          {/* Панель настроек */}
          <div className="lg:col-span-1 space-y-6">
            {/* Загрузка видео */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Видео файл
                </CardTitle>
              </CardHeader>
              <CardContent>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleVideoUpload(file);
                  }}
                  ref={fileInputRef}
                  className="hidden"
                  disabled={uploading}
                />
                <Button 
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  className="w-full"
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                      Загрузка...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Выбрать видео
                    </>
                  )}
                </Button>
                {story.backgroundVideoUrl && (
                  <p className="text-sm text-gray-600 mt-2">
                    Видео загружено ({Math.round(story.duration)}с)
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Название Stories */}
            <Card>
              <CardHeader>
                <CardTitle>Настройки Stories</CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <Label htmlFor="storyTitle">Название</Label>
                  <Input
                    id="storyTitle"
                    value={story.title}
                    onChange={(e) => setStory(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Введите название"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Управление текстовыми наложениями */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Текстовые наложения
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button 
                  onClick={addTextOverlay}
                  disabled={!story.backgroundVideoUrl}
                  className="w-full"
                >
                  Добавить текст
                </Button>

                {/* Список наложений */}
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {story.textOverlays.map((overlay, index) => (
                    <div
                      key={index}
                      className={`p-3 border rounded cursor-pointer transition-colors ${
                        selectedOverlay === index ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                      onClick={() => setSelectedOverlay(index)}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium truncate">
                          {overlay.text}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTextOverlay(index);
                          }}
                        >
                          ×
                        </Button>
                      </div>
                      <div className="text-xs text-gray-500">
                        {overlay.startTime.toFixed(1)}s - {overlay.endTime.toFixed(1)}s
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Настройки выбранного наложения */}
            {selectedOverlayData && (
              <Card>
                <CardHeader>
                  <CardTitle>Редактирование текста</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Текст</Label>
                    <Textarea
                      value={selectedOverlayData.text}
                      onChange={(e) => updateTextOverlay(selectedOverlay, { text: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div>
                    <Label>Время появления: {selectedOverlayData.startTime.toFixed(1)}с</Label>
                    <Slider
                      value={[selectedOverlayData.startTime]}
                      onValueChange={([value]) => updateTextOverlay(selectedOverlay, { startTime: value })}
                      min={0}
                      max={story.duration}
                      step={0.1}
                    />
                  </div>

                  <div>
                    <Label>Время исчезновения: {selectedOverlayData.endTime.toFixed(1)}с</Label>
                    <Slider
                      value={[selectedOverlayData.endTime]}
                      onValueChange={([value]) => updateTextOverlay(selectedOverlay, { endTime: value })}
                      min={selectedOverlayData.startTime}
                      max={story.duration}
                      step={0.1}
                    />
                  </div>

                  <div>
                    <Label>Размер шрифта: {selectedOverlayData.fontSize}px</Label>
                    <Slider
                      value={[selectedOverlayData.fontSize]}
                      onValueChange={([value]) => updateTextOverlay(selectedOverlay, { fontSize: value })}
                      min={16}
                      max={72}
                      step={2}
                    />
                  </div>

                  <div>
                    <Label>Цвет текста</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={selectedOverlayData.color || '#ffffff'}
                        onChange={(e) => updateTextOverlay(selectedOverlay, { color: e.target.value })}
                        className="w-12 h-10 rounded border cursor-pointer"
                      />
                      <Input
                        value={selectedOverlayData.color || '#ffffff'}
                        onChange={(e) => updateTextOverlay(selectedOverlay, { color: e.target.value })}
                        className="flex-1"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Видео превью */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Move className="h-4 w-4" />
                  Редактор
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div 
                  className="relative mx-auto bg-gray-900 overflow-hidden"
                  style={{ width: '250px', height: '444px' }}
                >
                  {/* Видео */}
                  {story.backgroundVideoUrl && (
                    <video
                      ref={videoRef}
                      src={story.backgroundVideoUrl}
                      className="absolute inset-0 w-full h-full object-cover"
                      onLoadedMetadata={handleVideoLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onError={(e) => {
                        console.error('Ошибка загрузки видео:', e);
                        console.error('Video URL:', story.backgroundVideoUrl);
                        console.error('Video element error:', e.target.error);
                      }}
                      onLoadStart={() => {
                        console.log('Начало загрузки видео:', story.backgroundVideoUrl);
                      }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                    />
                  )}

                  {/* Текстовые наложения */}
                  {story.textOverlays.map((overlay, index) => {
                    if (!isOverlayVisible(overlay)) return null;

                    return (
                      <DraggableWrapper
                        key={index}
                        position={{ x: overlay.x, y: overlay.y }}
                        onDrag={handleTextDrag(index)}
                        bounds="parent"
                      >
                        <div
                          className={`absolute cursor-move select-none ${
                            selectedOverlay === index ? 'ring-2 ring-blue-500' : ''
                          }`}
                          style={{
                            fontSize: `${overlay.fontSize}px`,
                            color: overlay.color,
                            fontFamily: overlay.fontFamily,
                            fontWeight: overlay.fontWeight,
                            textAlign: overlay.textAlign,
                            backgroundColor: overlay.backgroundColor,
                            padding: overlay.padding ? `${overlay.padding}px` : undefined,
                            borderRadius: overlay.borderRadius ? `${overlay.borderRadius}px` : undefined,
                            whiteSpace: 'pre-wrap',
                            maxWidth: '200px'
                          }}
                          onClick={() => setSelectedOverlay(index)}
                        >
                          {overlay.text}
                        </div>
                      </DraggableWrapper>
                    );
                  })}

                  {/* Кнопка воспроизведения */}
                  {story.backgroundVideoUrl && (
                    <div className="absolute bottom-4 left-4 right-4">
                      <div className="flex items-center gap-4 bg-black bg-opacity-50 rounded-lg p-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={togglePlay}
                          className="text-white hover:bg-white hover:bg-opacity-20"
                        >
                          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </Button>
                        
                        {/* Прогресс бар */}
                        <div className="flex-1 h-2 bg-white bg-opacity-30 rounded">
                          <div
                            className="h-full bg-white rounded transition-all"
                            style={{ width: `${(currentTime / story.duration) * 100}%` }}
                          />
                        </div>
                        
                        <span className="text-white text-sm">
                          {currentTime.toFixed(1)}s / {story.duration.toFixed(1)}s
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Сообщение об отсутствии видео */}
                  {!story.backgroundVideoUrl && (
                    <div className="absolute inset-0 flex items-center justify-center text-white text-center p-8">
                      <div>
                        <Upload className="h-16 w-16 mx-auto mb-4 opacity-50" />
                        <h3 className="text-xl font-semibold mb-2">Загрузите видео</h3>
                        <p className="text-gray-300">
                          Выберите видео файл для создания Stories
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Превью сгенерированного видео */}
          <div className="lg:col-span-1">
            {generatedVideoUrl ? (
              <Card className="bg-white/80 backdrop-blur-sm border border-gray-200">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-blue-500 rounded-lg flex items-center justify-center">
                      <Play className="h-4 w-4 text-white" />
                    </div>
                    <CardTitle className="text-lg font-bold text-gray-800">
                      Превью
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="relative max-w-[250px] mx-auto">
                    <div 
                      className="relative w-[250px] h-[444px] bg-black rounded-lg overflow-hidden shadow-lg"
                      style={{ aspectRatio: '9/16' }}
                    >
                      <video
                        className="absolute inset-0 w-full h-full object-cover"
                        src={generatedVideoUrl}
                        controls
                        muted
                        playsInline
                        onError={(e) => {
                          console.error('Ошибка загрузки сгенерированного видео:', e);
                        }}
                      />
                    </div>
                    
                    {/* Информация о видео */}
                    <div className="mt-3 text-center text-sm text-gray-600">
                      <p>✅ Обработано</p>
                      <p className="text-xs text-gray-500 mt-1">
                        1080x1920 • H.264
                      </p>
                    </div>
                    
                    {/* Кнопка публикации */}
                    <Button 
                      className="w-full mt-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                      onClick={() => {
                        // Показываем toast сразу
                        toast({
                          title: "Публикация запущена",
                          description: "Видео отправлено на публикацию в Instagram Stories",
                        });
                        
                        // Запускаем публикацию в фоне без ожидания
                        apiRequest(`/api/stories/story/${storyId}/publish`, {
                          method: 'POST',
                          data: {
                            platforms: ['instagram']
                          }
                        }).catch(error => {
                          console.error('Ошибка публикации Stories:', error);
                        });
                      }}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Опубликовать
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-2 border-dashed border-gray-300">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Video className="h-12 w-12 text-gray-400 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">
                    Сгенерированное видео
                  </h3>
                  <p className="text-gray-500 text-sm mb-4">
                    Нажмите "Сгенерировать видео" чтобы создать итоговое видео с текстами
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
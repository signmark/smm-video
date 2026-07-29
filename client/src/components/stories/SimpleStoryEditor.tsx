import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, Save, ArrowLeft, Plus, Trash2, Type, Palette, RotateCw, Eye, Image, Video, Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InstagramStoriesPreview } from '../InstagramStoriesPreview';
import { StoriesImageGenerator } from './StoriesImageGenerator';
import { StoryPublishButton } from './StoryPublishButton';
import { apiRequest } from '@/lib/queryClient';
import axios from 'axios';
import DraggableWrapper from './DraggableWrapper';
import type { DraggableEvent, DraggableData } from 'react-draggable';

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontWeight: string;
  textAlign: string;
  backgroundColor: string;
  rotation?: number;
}

interface StoryData {
  id?: string;
  title: string;
  backgroundImageUrl: string | null;
  backgroundVideoUrl: string | null;
  mediaType: 'image' | 'video';
  textOverlays: TextOverlay[];
}

interface SimpleStoryEditorProps {
  storyId: string;
  campaignId: string;
}

const SimpleStoryEditor: React.FC<SimpleStoryEditorProps> = ({ 
  storyId, 
  campaignId 
}) => {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // ПРОСТОЕ СОСТОЯНИЕ - БЕЗ СЛОЖНОСТЕЙ
  const [story, setStory] = useState<StoryData>({
    id: storyId,
    title: '',
    backgroundImageUrl: null,
    backgroundVideoUrl: null,
    mediaType: 'image',
    textOverlays: []
  });

  // ОТДЕЛЬНЫЕ ФЛАГИ СОСТОЯНИЯ
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  // REF ДЛЯ ОДНОКРАТНОЙ ЗАГРУЗКИ
  const hasLoadedRef = useRef(false);

  // ЗАГРУЗКА ДАННЫХ - ТОЛЬКО ОДИН РАЗ БЕЗ ЗАВИСИМОСТЕЙ
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const loadStory = async () => {
      try {
        setLoading(true);
        const response = await apiRequest(`/api/stories/simple/${storyId}`);
        const data = response.data || response;
        
        let textOverlays = [];
        if (data.metadata) {
          try {
            const metadata = typeof data.metadata === 'string' 
              ? JSON.parse(data.metadata) 
              : data.metadata;
            textOverlays = (metadata.textOverlays || []).map((overlay: any) => ({
              ...overlay,
              rotation: overlay.rotation || 0
            }));
          } catch (e) {
            console.error('Ошибка метаданных:', e);
          }
        }

        setStory({
          id: data.id,
          title: data.title || '',
          backgroundImageUrl: data.image_url || null,
          backgroundVideoUrl: data.video_url || null,
          mediaType: data.video_url ? 'video' : 'image',
          textOverlays
        });
      } catch (error) {
        console.error('Ошибка загрузки:', error);
        toast({
          title: "Ошибка",
          description: "Не удалось загрузить Story",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    loadStory();
  }, []); // ПУСТОЙ МАССИВ ЗАВИСИМОСТЕЙ!

  // ЗАГРУЗКА ИЗОБРАЖЕНИЯ - БЕЗ АВТОСОХРАНЕНИЯ
  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Ошибка",
        description: "Только изображения",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || localStorage.getItem('authToken');
      const response = await axios.post('/api/s3/upload-image', formData, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const uploadedUrl = response.data?.data?.url || response.data?.url;
      if (uploadedUrl) {
        setStory(prev => ({
          ...prev,
          backgroundImageUrl: uploadedUrl,
          mediaType: 'image'
        }));

        toast({
          title: "Загружено",
          description: "Изображение готово. Нажмите 'Сохранить'"
        });
      }
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось загрузить изображение",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  // ЗАГРУЗКА ВИДЕО
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
      const formData = new FormData();
      formData.append('video', file);

      const response = await axios.post('/api/beget-s3-video/upload', formData);
      
      if (response.data?.videoUrl) {
        setStory(prev => ({
          ...prev,
          backgroundVideoUrl: response.data.videoUrl,
          mediaType: 'video'
        }));

        toast({
          title: "Загружено",
          description: "Видео готово. Нажмите 'Сохранить'"
        });
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

  // ДОБАВЛЕНИЕ ТЕКСТА
  const addTextOverlay = () => {
    const newOverlay: TextOverlay = {
      id: `text_${Date.now()}`,
      text: 'Новый текст',
      x: 50,
      y: 50,
      fontSize: 24,
      color: '#ffffff',
      fontFamily: 'Arial',
      fontWeight: 'bold',
      textAlign: 'center',
      backgroundColor: 'transparent',
      rotation: 0
    };

    setStory(prev => ({
      ...prev,
      textOverlays: [...prev.textOverlays, newOverlay]
    }));
  };

  // ОБНОВЛЕНИЕ ТЕКСТА
  const updateTextOverlay = (id: string, updates: Partial<TextOverlay>) => {
    setStory(prev => ({
      ...prev,
      textOverlays: prev.textOverlays.map(overlay =>
        overlay.id === id ? { ...overlay, ...updates } : overlay
      )
    }));
  };

  // УДАЛЕНИЕ ТЕКСТА
  const removeTextOverlay = (id: string) => {
    setStory(prev => ({
      ...prev,
      textOverlays: prev.textOverlays.filter(overlay => overlay.id !== id)
    }));
  };

  // ОБРАБОТКА ПЕРЕТАСКИВАНИЯ
  const handleDrag = (overlayId: string, data: { x: number; y: number }) => {
    updateTextOverlay(overlayId, {
      x: Math.max(-50, Math.min(350, data.x / 0.8)),
      y: Math.max(-50, Math.min(600, data.y / 0.8))
    });
  };

  // СОХРАНЕНИЕ - БЕЗ ЦИКЛОВ
  const handleSave = async () => {
    if (saving) return;

    setSaving(true);
    try {
      const metadata = {
        textOverlays: story.textOverlays,
        type: 'instagram',
        format: '9:16',
        version: '1.0'
      };

      await apiRequest(`/api/stories/simple/${storyId}`, {
        method: 'PUT',
        data: {
          title: story.title,
          image_url: story.backgroundImageUrl,
          video_url: story.backgroundVideoUrl,
          metadata: JSON.stringify(metadata)
        }
      });

      toast({
        title: "Сохранено",
        description: "Story сохранена"
      });
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  // ВОЗВРАТ НАЗАД
  const goBack = () => {
    setLocation('/content');
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 p-4 space-y-4">
      {/* ЗАГОЛОВОК */}
      <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl border-2 border-gray-200 shadow-lg">
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            onClick={goBack}
            className="border-2 border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад
          </Button>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center shadow-lg">
              <Type className="w-5 h-5 text-white" />
            </div>
            <span>Редактор Stories</span>
          </h1>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={saving}
          className="bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 shadow-lg text-white border-none px-6 py-2"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Сохранение...</span>
            </div>
          ) : (
            'Сохранить'
          )}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* НАСТРОЙКИ */}
        <div className="space-y-6">
          {/* ОСНОВНЫЕ НАСТРОЙКИ */}
          <Card className="border-2 border-gradient-to-r from-green-100 to-blue-100 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-green-50 to-blue-50 rounded-t-lg">
              <CardTitle className="flex items-center space-x-2 text-gray-800">
                <Image className="w-5 h-5 text-green-600" />
                <span>Основные настройки</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="space-y-2">
                <label className="flex items-center text-sm font-medium text-gray-600 mb-2">
                  <Type className="w-4 h-4 mr-1" />
                  Название Story
                </label>
                <Input
                  value={story.title}
                  onChange={(e) => setStory(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Введите название..."
                  className="border-2 border-gray-200 focus:border-green-400 rounded-lg h-10"
                />
              </div>

              {/* ПЕРЕКЛЮЧАТЕЛЬ МЕДИА ТИПА */}
              <div className="space-y-2">
                <label className="flex items-center text-sm font-medium text-gray-600 mb-2">
                  <Type className="w-4 h-4 mr-1" />
                  Тип медиа
                </label>
                <div className="flex items-center space-x-2">
                  <Button
                    variant={story.mediaType === 'image' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStory(prev => ({ ...prev, mediaType: 'image' }))}
                    className="flex items-center space-x-1"
                  >
                    <Image className="w-4 h-4" />
                    <span>Изображение</span>
                  </Button>
                  <Button
                    variant={story.mediaType === 'video' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStory(prev => ({ ...prev, mediaType: 'video' }))}
                    className="flex items-center space-x-1"
                  >
                    <Video className="w-4 h-4" />
                    <span>Видео</span>
                  </Button>
                </div>
              </div>

              {/* ИЗОБРАЖЕНИЕ */}
              {story.mediaType === 'image' && (
                <div className="space-y-2">
                  <label className="flex items-center text-sm font-medium text-gray-600 mb-2">
                    <Image className="w-4 h-4 mr-1" />
                    URL изображения
                  </label>
                  <div className="flex items-center space-x-2">
                    <Input
                      type="url"
                      value={story.backgroundImageUrl || ''}
                      onChange={(e) => setStory(prev => ({ ...prev, backgroundImageUrl: e.target.value }))}
                      placeholder="https://example.com/image.jpg"
                      className="border-2 border-gray-200 focus:border-green-400 rounded-lg h-9 flex-1"
                    />
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageUpload(file);
                        }}
                        className="hidden"
                        id="image-upload"
                        disabled={uploading}
                      />
                      <label 
                        htmlFor="image-upload" 
                        className="cursor-pointer w-9 h-9 bg-gradient-to-br from-green-400 to-blue-400 rounded-lg flex items-center justify-center shadow-md hover:shadow-lg transition-all"
                        title="Загрузить изображение"
                      >
                        {uploading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Upload className="w-4 h-4 text-white" />
                        )}
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* ВИДЕО */}
              {story.mediaType === 'video' && (
                <div className="space-y-2">
                  <label className="flex items-center text-sm font-medium text-gray-600 mb-2">
                    <Video className="w-4 h-4 mr-1" />
                    URL видео
                  </label>
                  <div className="flex items-center space-x-2">
                    <Input
                      type="url"
                      value={story.backgroundVideoUrl || ''}
                      onChange={(e) => setStory(prev => ({ ...prev, backgroundVideoUrl: e.target.value }))}
                      placeholder="https://example.com/video.mp4"
                      className="border-2 border-gray-200 focus:border-green-400 rounded-lg h-9 flex-1"
                    />
                    <div className="relative">
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleVideoUpload(file);
                        }}
                        className="hidden"
                        id="video-upload"
                        disabled={uploading}
                      />
                      <label 
                        htmlFor="video-upload" 
                        className="cursor-pointer w-9 h-9 bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg flex items-center justify-center shadow-md hover:shadow-lg transition-all"
                        title="Загрузить видео"
                      >
                        {uploading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Upload className="w-4 h-4 text-white" />
                        )}
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ТЕКСТОВЫЕ ЭЛЕМЕНТЫ */}
          <Card className="border-2 border-gradient-to-r from-blue-100 to-purple-100 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-t-lg">
              <CardTitle className="flex items-center justify-between text-gray-800">
                <div className="flex items-center space-x-2">
                  <Type className="w-5 h-5 text-blue-600" />
                  <span>Текстовые элементы</span>
                </div>
                <Button 
                  onClick={addTextOverlay} 
                  size="sm" 
                  className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 shadow-md"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Добавить
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {story.textOverlays.map((overlay) => (
                <div key={overlay.id} className="border-2 border-gray-200 rounded-lg p-2 space-y-2 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-400 rounded-full flex items-center justify-center">
                        <Type className="w-4 h-4 text-white" />
                      </div>
                      <span className="font-semibold text-gray-700">Элемент {overlay.id.split('_')[1]}</span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => removeTextOverlay(overlay.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div>
                    <label className="flex items-center text-xs font-medium text-gray-600 mb-1">
                      <Type className="w-3 h-3 mr-1" />
                      Текст
                    </label>
                    <Input
                      value={overlay.text}
                      onChange={(e) => updateTextOverlay(overlay.id, { text: e.target.value })}
                      placeholder="Введите текст..."
                      className="border-2 border-gray-200 focus:border-blue-400 rounded-lg h-8 text-sm"
                    />
                  </div>

                  {/* РАЗМЕР ТЕКСТА - СЛАЙДЕР */}
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <label className="flex items-center text-xs font-medium text-gray-700 mb-1">
                      <Eye className="w-3 h-3 mr-1" />
                      Размер: <span className="ml-1 font-bold text-blue-600">{overlay.fontSize}px</span>
                    </label>
                    <Slider
                      value={[overlay.fontSize]}
                      onValueChange={(value) => updateTextOverlay(overlay.id, { fontSize: value[0] })}
                      max={72}
                      min={8}
                      step={1}
                      className="w-full"
                    />
                  </div>

                  {/* ШРИФТ */}
                  <div className="space-y-2">
                    <label className="flex items-center text-sm font-medium text-gray-600">
                      <Type className="w-4 h-4 mr-1" />
                      Шрифт
                    </label>
                    <Select value={overlay.fontFamily} onValueChange={(value) => updateTextOverlay(overlay.id, { fontFamily: value })}>
                      <SelectTrigger className="border-2 border-gray-200 focus:border-blue-400 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Arial">Arial</SelectItem>
                        <SelectItem value="Helvetica">Helvetica</SelectItem>
                        <SelectItem value="Times New Roman">Times New Roman</SelectItem>
                        <SelectItem value="Georgia">Georgia</SelectItem>
                        <SelectItem value="Courier New">Courier New</SelectItem>
                        <SelectItem value="Verdana">Verdana</SelectItem>
                        <SelectItem value="Impact">Impact</SelectItem>
                        <SelectItem value="Comic Sans MS">Comic Sans MS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* ЦВЕТА */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gradient-to-br from-pink-50 to-red-50 p-3 rounded-lg">
                      <label className="flex items-center text-xs font-medium text-gray-700 mb-1">
                        <Palette className="w-3 h-3 mr-1" />
                        Цвет текста
                      </label>
                      <div className="relative">
                        <div className="w-full h-10 rounded-lg border-2 border-gray-300 overflow-hidden shadow-md hover:shadow-lg transition-shadow">
                          <input
                            type="color"
                            value={overlay.color}
                            onChange={(e) => updateTextOverlay(overlay.id, { color: e.target.value })}
                            className="w-full h-full cursor-pointer border-none outline-none"
                            style={{ WebkitAppearance: 'none', border: 'none' }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-green-50 to-blue-50 p-3 rounded-lg">
                      <label className="flex items-center text-xs font-medium text-gray-700 mb-1">
                        <Palette className="w-3 h-3 mr-1" />
                        Фон текста
                      </label>
                      <div className="space-y-3">
                        {overlay.backgroundColor !== 'transparent' && (
                          <div className="w-full h-10 rounded-lg border-2 border-gray-300 overflow-hidden shadow-md hover:shadow-lg transition-shadow">
                            <input
                              type="color"
                              value={overlay.backgroundColor}
                              onChange={(e) => updateTextOverlay(overlay.id, { backgroundColor: e.target.value })}
                              className="w-full h-full cursor-pointer border-none outline-none"
                              style={{ WebkitAppearance: 'none', border: 'none' }}
                            />
                          </div>
                        )}
                        <div className="flex items-center space-x-2 bg-white p-2 rounded-lg border border-gray-200">
                          <Checkbox
                            id={`transparent-${overlay.id}`}
                            checked={overlay.backgroundColor === 'transparent'}
                            onCheckedChange={(checked) => 
                              updateTextOverlay(overlay.id, { 
                                backgroundColor: checked ? 'transparent' : '#000000' 
                              })
                            }
                          />
                          <label htmlFor={`transparent-${overlay.id}`} className="text-sm text-gray-600 font-medium">
                            Прозрачный фон
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* НАКЛОН - СЛАЙДЕР */}
                  <div className="bg-purple-50 p-2 rounded-lg">
                    <label className="flex items-center text-xs font-medium text-gray-700 mb-1">
                      <RotateCw className="w-3 h-3 mr-1" />
                      Наклон: <span className="ml-1 font-bold text-purple-600">{overlay.rotation || 0}°</span>
                    </label>
                    
                    {/* Индикаторы направления */}
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <div className="flex items-center space-x-1">
                        <div className="w-4 h-4 border-2 border-gray-400 rounded transform -rotate-45 flex items-center justify-center">
                          <div className="w-1 h-1 bg-gray-400 rounded"></div>
                        </div>
                        <span>Влево (-45°)</span>
                      </div>
                      <span className="text-center font-medium">0°</span>
                      <div className="flex items-center space-x-1">
                        <span>Вправо (+45°)</span>
                        <div className="w-4 h-4 border-2 border-gray-400 rounded transform rotate-45 flex items-center justify-center">
                          <div className="w-1 h-1 bg-gray-400 rounded"></div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="relative">
                      <Slider
                        value={[overlay.rotation || 0]}
                        onValueChange={(value) => updateTextOverlay(overlay.id, { rotation: value[0] })}
                        max={45}
                        min={-45}
                        step={1}
                        className="w-full"
                      />
                      {/* Центральная метка */}
                      <div className="absolute top-6 left-1/2 transform -translate-x-1/2">
                        <div className="w-px h-2 bg-gray-400"></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {story.textOverlays.length === 0 && (
                <p className="text-gray-500 text-center py-4">
                  Нет текстовых элементов
                </p>
              )}
            </CardContent>
          </Card>

          {/* ПУБЛИКАЦИЯ */}
          <StoryPublishButton
            story={{ ...story, id: storyId }}
            contentId={storyId}
            platforms={['instagram']}
            onSave={handleSave}
          />
        </div>

        {/* ПРЕВЬЮ */}
        <div className="space-y-4">
          <Card className="border-2 border-gradient-to-r from-purple-100 to-pink-100 shadow-xl">
            <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-t-lg">
              <CardTitle className="flex items-center space-x-2 text-gray-800">
                <Eye className="w-5 h-5 text-purple-600" />
                <span>Превью</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div 
                className="relative mx-auto bg-gray-100 rounded-lg overflow-hidden"
                style={{ width: '280px', height: '497px' }}
              >
                {/* ФОН */}
                {story.mediaType === 'video' && story.backgroundVideoUrl ? (
                  <video
                    src={story.backgroundVideoUrl}
                    className="absolute inset-0 w-full h-full object-cover rounded-lg"
                    style={{ zIndex: 1 }}
                    autoPlay
                    loop
                    muted
                    playsInline
                  />
                ) : story.mediaType === 'image' && story.backgroundImageUrl ? (
                  <img
                    src={story.backgroundImageUrl}
                    alt="Background"
                    className="absolute inset-0 w-full h-full object-cover rounded-lg"
                    style={{ zIndex: 1 }}
                  />
                ) : (
                  <div 
                    className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg flex items-center justify-center" 
                    style={{ zIndex: 1 }}
                  >
                    <div className="text-white text-center p-4">
                      {story.mediaType === 'video' ? (
                        <div className="flex flex-col items-center space-y-2">
                          <Video className="w-12 h-12 opacity-60" />
                          <span className="text-sm opacity-80">Добавьте видео</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center space-y-2">
                          <Image className="w-12 h-12 opacity-60" />
                          <span className="text-sm opacity-80">Добавьте изображение</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ТЕКСТОВЫЕ ЭЛЕМЕНТЫ */}
                {story.textOverlays.map((overlay) => (
                  <DraggableWrapper
                    key={overlay.id}
                    position={{ x: overlay.x * 0.8, y: overlay.y * 0.8 }}
                    onStop={(e: DraggableEvent, data: DraggableData) => handleDrag(overlay.id, data)}
                    bounds="parent"
                  >
                    <div
                      className="absolute cursor-move select-none"
                      style={{
                        minWidth: '20px',
                        zIndex: 100,
                        pointerEvents: 'auto',
                        position: 'absolute',
                        top: 0,
                        left: 0
                      }}
                    >
                      <div
                        style={{
                          fontSize: `${overlay.fontSize * 0.8}px`,
                          color: overlay.color,
                          fontFamily: overlay.fontFamily,
                          fontWeight: overlay.fontWeight,
                          textAlign: overlay.textAlign as any,
                          backgroundColor: overlay.backgroundColor !== 'transparent' ? overlay.backgroundColor : undefined,
                          textShadow: overlay.backgroundColor === 'transparent' ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
                          padding: overlay.backgroundColor !== 'transparent' ? '4px 8px' : '2px',
                          borderRadius: overlay.backgroundColor !== 'transparent' ? '4px' : '0',
                          whiteSpace: 'nowrap',
                          transform: `rotate(${overlay.rotation || 0}deg)`,
                          transformOrigin: 'center center',
                          display: 'inline-block'
                        }}
                      >
                        {overlay.text || 'Новый текст'}
                      </div>
                    </div>
                  </DraggableWrapper>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ГЕНЕРАТОР ИЗОБРАЖЕНИЙ */}
          <StoriesImageGenerator 
            story={{ ...story, id: storyId }} 
            onImageGenerated={(url) => console.log('Изображение:', url)}
          />
        </div>
      </div>
    </div>
  );
};

export default SimpleStoryEditor;
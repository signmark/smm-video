import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Upload, Save, ArrowLeft, Play, Pause, Plus, Trash2 } from 'lucide-react';

interface VideoStoryEditorProps {
  campaignId: string;
  onBack: () => void;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  startTime: number;
  endTime: number;
}

export default function SimpleVideoEditor({ campaignId, onBack }: VideoStoryEditorProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Загрузка видео
  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      toast({
        title: 'Ошибка',
        description: 'Размер видео не должен превышать 100MB',
        variant: 'destructive'
      });
      return;
    }

    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);

    toast({
      title: 'Успех',
      description: 'Видео загружено успешно'
    });
  };

  // Метаданные видео
  const handleVideoLoad = () => {
    if (videoRef.current) {
      const videoDuration = Math.min(videoRef.current.duration, 30);
      setDuration(videoDuration);
      
      if (videoRef.current.duration > 30) {
        toast({
          title: 'Внимание',
          description: 'Видео будет обрезано до 30 секунд для Stories',
          variant: 'default'
        });
      }
    }
  };

  // Управление воспроизведением
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Обновление времени
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  // Добавить текст
  const addTextOverlay = () => {
    const newOverlay: TextOverlay = {
      id: Date.now().toString(),
      text: 'Новый текст',
      x: 50,
      y: 50,
      color: '#ffffff',
      fontSize: 32,
      startTime: currentTime,
      endTime: Math.min(currentTime + 3, duration)
    };
    
    setTextOverlays(prev => [...prev, newOverlay]);
  };

  // Удалить текст
  const removeTextOverlay = (id: string) => {
    setTextOverlays(prev => prev.filter(overlay => overlay.id !== id));
  };

  // Обновить текст
  const updateTextOverlay = (id: string, updates: Partial<TextOverlay>) => {
    setTextOverlays(prev => 
      prev.map(overlay => 
        overlay.id === id ? { ...overlay, ...updates } : overlay
      )
    );
  };

  // Сохранение
  const handleSave = async () => {
    if (!videoFile) {
      toast({
        title: 'Ошибка',
        description: 'Загрузите видео файл',
        variant: 'destructive'
      });
      return;
    }

    const formData = new FormData();
    formData.append('video', videoFile);
    formData.append('textOverlays', JSON.stringify(textOverlays));
    formData.append('campaignId', campaignId);

    try {
      toast({
        title: 'Обработка',
        description: 'Начинаем обработку видео...'
      });

      const response = await fetch('/api/video/process', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Успех',
          description: 'Видео обработано и сохранено!'
        });
        onBack();
      } else {
        throw new Error(result.error || 'Ошибка обработки');
      }
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: error instanceof Error ? error.message : 'Ошибка сохранения',
        variant: 'destructive'
      });
    }
  };

  const isOverlayVisible = (overlay: TextOverlay) => {
    return currentTime >= overlay.startTime && currentTime <= overlay.endTime;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад
          </Button>
          <h1 className="text-2xl font-bold">Видео Stories Редактор</h1>
        </div>
        <Button onClick={handleSave} disabled={!videoFile}>
          <Save className="w-4 h-4 mr-2" />
          Сохранить
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Левая панель - Видео */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Видео файл</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!videoUrl ? (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <Button onClick={() => fileInputRef.current?.click()}>
                      Загрузить видео
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      onChange={handleVideoUpload}
                      className="hidden"
                    />
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    MP4, MOV, AVI до 100MB
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative bg-black rounded-lg overflow-hidden">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      onLoadedMetadata={handleVideoLoad}
                      onTimeUpdate={handleTimeUpdate}
                      className="w-full h-auto max-h-96"
                      controls={false}
                    />
                    
                    {/* Текстовые overlays */}
                    {textOverlays.filter(isOverlayVisible).map((overlay) => (
                      <div
                        key={overlay.id}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${overlay.x}px`,
                          top: `${overlay.y}px`,
                          color: overlay.color,
                          fontSize: `${overlay.fontSize}px`,
                          fontWeight: 'bold',
                          textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                        }}
                      >
                        {overlay.text}
                      </div>
                    ))}
                  </div>
                  
                  {/* Управление воспроизведением */}
                  <div className="flex items-center space-x-4">
                    <Button onClick={togglePlay} size="sm">
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    <div className="flex-1">
                      <input
                        type="range"
                        min="0"
                        max={duration}
                        value={currentTime}
                        onChange={(e) => {
                          const time = parseFloat(e.target.value);
                          setCurrentTime(time);
                          if (videoRef.current) {
                            videoRef.current.currentTime = time;
                          }
                        }}
                        className="w-full"
                      />
                    </div>
                    <span className="text-sm text-gray-500">
                      {Math.round(currentTime)}s / {Math.round(duration)}s
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Правая панель - Текстовые наложения */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Текстовые наложения</CardTitle>
                <Button onClick={addTextOverlay} size="sm" disabled={!videoUrl}>
                  <Plus className="w-4 h-4 mr-2" />
                  Добавить текст
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {textOverlays.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  Нет текстовых наложений
                </p>
              ) : (
                textOverlays.map((overlay) => (
                  <div key={overlay.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Текст #{overlay.id.slice(-4)}</span>
                      <Button
                        onClick={() => removeTextOverlay(overlay.id)}
                        size="sm"
                        variant="destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <Input
                      value={overlay.text}
                      onChange={(e) => updateTextOverlay(overlay.id, { text: e.target.value })}
                      placeholder="Введите текст"
                    />
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-sm text-gray-600">X позиция</label>
                        <Input
                          type="number"
                          value={overlay.x}
                          onChange={(e) => updateTextOverlay(overlay.id, { x: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-gray-600">Y позиция</label>
                        <Input
                          type="number"
                          value={overlay.y}
                          onChange={(e) => updateTextOverlay(overlay.id, { y: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-sm text-gray-600">Размер шрифта</label>
                        <Input
                          type="number"
                          value={overlay.fontSize}
                          onChange={(e) => updateTextOverlay(overlay.id, { fontSize: parseInt(e.target.value) || 16 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-gray-600">Цвет</label>
                        <Input
                          type="color"
                          value={overlay.color}
                          onChange={(e) => updateTextOverlay(overlay.id, { color: e.target.value })}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-sm text-gray-600">Время начала (сек)</label>
                        <Input
                          type="number"
                          value={overlay.startTime}
                          min="0"
                          max={duration}
                          step="0.1"
                          onChange={(e) => updateTextOverlay(overlay.id, { startTime: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-gray-600">Время окончания (сек)</label>
                        <Input
                          type="number"
                          value={overlay.endTime}
                          min="0"
                          max={duration}
                          step="0.1"
                          onChange={(e) => updateTextOverlay(overlay.id, { endTime: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
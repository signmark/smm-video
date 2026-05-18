import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { 
  ArrowLeft, 
  Upload, 
  Play, 
  Save, 
  Youtube, 
  Share2,
  Eye,
  Calendar,
  FileVideo,
  Image,
  Settings,
  Clock
} from 'lucide-react';
import { useParams } from 'wouter';
import { useCampaignStore } from '@/lib/campaignStore';

interface VideoContent {
  id: string;
  title: string;
  description: string;
  videoFile?: File;
  thumbnail?: File;
  tags: string[];
  duration?: number;
  platforms: {
    youtube: boolean;
    vk: boolean;
    telegram: boolean;
  };
  scheduling: {
    publishNow: boolean;
    scheduledDate?: Date;
  };
}

export default function VideoEditor() {
  const { campaignId: urlCampaignId } = useParams();
  const selectedCampaign = useCampaignStore((state) => state.selectedCampaign);
  const campaignId = urlCampaignId || selectedCampaign?.id || "46868c44-c6a4-4bed-accf-9ad07bba790e";
  const { toast } = useToast();
  
  const [videoContent, setVideoContent] = useState<VideoContent>({
    id: `video-${Date.now()}`,
    title: '',
    description: '',
    tags: [],
    platforms: {
      youtube: true,
      vk: false,
      telegram: false
    },
    scheduling: {
      publishNow: true
    }
  });

  const [newTag, setNewTag] = useState('');
  const [activeTab, setActiveTab] = useState('content');

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoContent(prev => ({ ...prev, videoFile: file }));
      toast({
        title: 'Видео загружено',
        description: `Файл ${file.name} успешно загружен`
      });
    }
  };

  const handleThumbnailUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoContent(prev => ({ ...prev, thumbnail: file }));
      toast({
        title: 'Превью загружено',
        description: 'Изображение для превью успешно загружено'
      });
    }
  };

  const addTag = () => {
    if (newTag.trim() && !videoContent.tags.includes(newTag.trim())) {
      setVideoContent(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setVideoContent(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleSave = async () => {
    try {
      if (!videoContent.title.trim()) {
        toast({
          title: 'Ошибка',
          description: 'Необходимо указать название видео',
          variant: 'destructive'
        });
        return;
      }

      // Подготавливаем данные для сохранения
      const contentData = {
        campaign_id: campaignId,
        content_type: 'video-text',
        title: videoContent.title,
        content: videoContent.description,
        video_url: videoContent.videoFile ? await uploadVideoToS3(videoContent.videoFile) : null,
        thumbnail_url: videoContent.thumbnail ? await uploadImageToS3(videoContent.thumbnail) : null,
        platforms: JSON.stringify(videoContent.platforms),
        scheduled_time: videoContent.scheduling.scheduledDate?.toISOString() || null,
        metadata: JSON.stringify({
          tags: videoContent.tags,
          duration: videoContent.duration,
          id: videoContent.id
        }),
        status: 'draft'
      };

      const response = await fetch('/api/video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          title: videoContent.title,
          description: videoContent.description,
          campaignId: campaignId,
          videoUrl: videoContent.videoFile ? await uploadVideoToS3(videoContent.videoFile) : null,
          thumbnailUrl: videoContent.thumbnail ? await uploadImageToS3(videoContent.thumbnail) : null,
          platforms: videoContent.platforms,
          tags: videoContent.tags,
          scheduling: videoContent.scheduling
        })
      });

      if (!response.ok) {
        throw new Error('Ошибка сохранения');
      }

      const result = await response.json();
      
      toast({
        title: 'Сохранено',
        description: 'Видео контент успешно сохранен'
      });
      
      console.log('Видео контент сохранен:', result);
    } catch (error) {
      console.error('Ошибка сохранения:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить видео контент',
        variant: 'destructive'
      });
    }
  };

  // Вспомогательные функции для загрузки файлов
  const uploadVideoToS3 = async (file: File): Promise<string> => {
    try {
      console.log('Uploading video to S3:', file.name, file.type);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'videos');
      formData.append('contentType', file.type);
      
      const response = await fetch('/api/beget-s3/upload-video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('authToken')}`
        },
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('S3 video upload failed:', errorText);
        throw new Error(`Ошибка загрузки видео: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('Video uploaded successfully:', result.url);
      return result.url;
    } catch (error) {
      console.error('Video upload error:', error);
      throw error;
    }
  };

  const uploadImageToS3 = async (file: File): Promise<string> => {
    try {
      console.log('Uploading image to S3:', file.name, file.type);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'images');
      formData.append('contentType', file.type);
      
      const response = await fetch('/api/beget-s3/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('authToken')}`
        },
        body: formData
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('S3 image upload failed:', errorText);
        throw new Error(`Ошибка загрузки изображения: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('Image uploaded successfully:', result.url);
      return result.url;
    } catch (error) {
      console.error('Image upload error:', error);
      throw error;
    }
  };



  const handlePublish = async () => {
    if (!videoContent.videoFile) {
      toast({
        title: 'Ошибка',
        description: 'Необходимо загрузить видео файл',
        variant: 'destructive'
      });
      return;
    }

    if (!videoContent.title.trim()) {
      toast({
        title: 'Ошибка',
        description: 'Необходимо указать название видео',
        variant: 'destructive'
      });
      return;
    }

    const selectedPlatforms = Object.entries(videoContent.platforms)
      .filter(([_, enabled]) => enabled)
      .map(([platform, _]) => platform);

    if (selectedPlatforms.length === 0) {
      toast({
        title: 'Ошибка',
        description: 'Выберите хотя бы одну платформу для публикации',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Сначала сохраняем контент
      await handleSave();
      
      // Затем планируем публикацию
      const publishData = {
        contentType: 'video-text',
        campaignId: campaignId,
        title: videoContent.title,
        description: videoContent.description,
        videoUrl: videoContent.videoFile ? await uploadVideoToS3(videoContent.videoFile) : null,
        thumbnailUrl: videoContent.thumbnail ? await uploadImageToS3(videoContent.thumbnail) : null,
        platforms: selectedPlatforms,
        tags: videoContent.tags,
        scheduling: videoContent.scheduling
      };

      const savedVideo = await handleSave();
      if (!savedVideo) return;

      const response = await fetch(`/api/video/${savedVideo.id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          platforms: selectedPlatforms,
          scheduledAt: videoContent.scheduling.scheduledDate?.toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Ошибка планирования публикации');
      }

      toast({
        title: 'Видео запланировано к публикации',
        description: `Будет опубликовано на: ${selectedPlatforms.join(', ')}`
      });
      
    } catch (error) {
      console.error('Ошибка публикации:', error);
      toast({
        title: 'Ошибка публикации',
        description: 'Не удалось запланировать публикацию видео',
        variant: 'destructive'
      });
    }
  };

  const handleGoBack = () => {
    window.location.href = campaignId ? `/campaigns/${campaignId}/content` : '/campaigns';
  };

  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={handleGoBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Назад
          </Button>
          <div className="flex items-center gap-2">
            <FileVideo className="w-5 h-5 text-red-500" />
            <h1 className="text-lg font-semibold">Видео редактор</h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Сохранить
          </Button>
          <Button size="sm" onClick={handlePublish}>
            <Play className="w-4 h-4 mr-2" />
            Опубликовать
          </Button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Left Panel - Content */}
        <div className="w-2/3 p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="content">Контент</TabsTrigger>
              <TabsTrigger value="platforms">Платформы</TabsTrigger>
              <TabsTrigger value="scheduling">Планирование</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Основная информация</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="title">Название видео</Label>
                    <Input
                      id="title"
                      value={videoContent.title}
                      onChange={(e) => setVideoContent(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Введите название видео"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="description">Описание</Label>
                    <Textarea
                      id="description"
                      value={videoContent.description}
                      onChange={(e) => setVideoContent(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Описание видео для каждой платформы..."
                      rows={4}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Файлы</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Видео файл</Label>
                    <div className="mt-2">
                      <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file && file.type.startsWith('video/')) {
                            setVideoContent(prev => ({ ...prev, videoFile: file, duration: 0 }));
                            toast({ title: 'Видео загружено', description: `Файл "${file.name}" готов к обработке` });
                          } else if (file) {
                            toast({ title: 'Ошибка', description: 'Выберите видео файл', variant: 'destructive' });
                          }
                        }}
                        className="hidden"
                        id="video-upload"
                      />
                      <Button variant="outline" asChild>
                        <label htmlFor="video-upload" className="cursor-pointer">
                          <Upload className="w-4 h-4 mr-2" />
                          {videoContent.videoFile ? videoContent.videoFile.name : 'Загрузить видео'}
                        </label>
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label>Превью (обложка)</Label>
                    <div className="mt-2">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file && file.type.startsWith('image/')) {
                            setVideoContent(prev => ({ ...prev, thumbnail: file }));
                            toast({ title: 'Обложка загружена', description: `Файл "${file.name}" готов к использованию` });
                          } else if (file) {
                            toast({ title: 'Ошибка', description: 'Выберите изображение для обложки', variant: 'destructive' });
                          }
                        }}
                        className="hidden"
                        id="thumbnail-upload"
                      />
                      <Button variant="outline" asChild>
                        <label htmlFor="thumbnail-upload" className="cursor-pointer">
                          <Image className="w-4 h-4 mr-2" />
                          {videoContent.thumbnail ? videoContent.thumbnail.name : 'Загрузить превью'}
                        </label>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Теги</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 mb-3">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="Добавить тег"
                      onKeyPress={(e) => e.key === 'Enter' && addTag()}
                    />
                    <Button onClick={addTag}>Добавить</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {videoContent.tags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
                        #{tag} ×
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="platforms" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Выберите платформы</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="youtube"
                      checked={videoContent.platforms.youtube}
                      onChange={(e) => setVideoContent(prev => ({
                        ...prev,
                        platforms: { ...prev.platforms, youtube: e.target.checked }
                      }))}
                    />
                    <label htmlFor="youtube" className="flex items-center gap-2">
                      <Youtube className="w-5 h-5 text-red-600" />
                      YouTube
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="vk"
                      checked={videoContent.platforms.vk}
                      onChange={(e) => setVideoContent(prev => ({
                        ...prev,
                        platforms: { ...prev.platforms, vk: e.target.checked }
                      }))}
                    />
                    <label htmlFor="vk" className="flex items-center gap-2">
                      <Share2 className="w-5 h-5 text-blue-600" />
                      ВКонтакте
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="telegram"
                      checked={videoContent.platforms.telegram}
                      onChange={(e) => setVideoContent(prev => ({
                        ...prev,
                        platforms: { ...prev.platforms, telegram: e.target.checked }
                      }))}
                    />
                    <label htmlFor="telegram" className="flex items-center gap-2">
                      <Share2 className="w-5 h-5 text-blue-500" />
                      Telegram
                    </label>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="scheduling" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Время публикации</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="publish-now"
                      name="scheduling"
                      checked={videoContent.scheduling.publishNow}
                      onChange={() => setVideoContent(prev => ({
                        ...prev,
                        scheduling: { ...prev.scheduling, publishNow: true }
                      }))}
                    />
                    <label htmlFor="publish-now" className="flex items-center gap-2">
                      <Play className="w-4 h-4" />
                      Опубликовать сейчас
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      id="schedule"
                      name="scheduling"
                      checked={!videoContent.scheduling.publishNow}
                      onChange={() => setVideoContent(prev => ({
                        ...prev,
                        scheduling: { ...prev.scheduling, publishNow: false }
                      }))}
                    />
                    <label htmlFor="schedule" className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Запланировать
                    </label>
                  </div>

                  {!videoContent.scheduling.publishNow && (
                    <div className="ml-6">
                      <Input
                        type="datetime-local"
                        onChange={(e) => setVideoContent(prev => ({
                          ...prev,
                          scheduling: { 
                            ...prev.scheduling, 
                            scheduledDate: new Date(e.target.value) 
                          }
                        }))}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Panel - Preview */}
        <div className="w-1/3 border-l border-gray-200 bg-white p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5" />
            Предпросмотр
          </h3>
          
          <Card>
            <CardContent className="p-4">
              {videoContent.videoFile ? (
                <div className="space-y-3">
                  <div className="aspect-video bg-black rounded-lg flex items-center justify-center">
                    <Play className="w-12 h-12 text-white opacity-50" />
                  </div>
                  <div>
                    <h4 className="font-medium">{videoContent.title || 'Без названия'}</h4>
                    <p className="text-sm text-gray-600 mt-1 line-clamp-3">
                      {videoContent.description || 'Нет описания'}
                    </p>
                  </div>
                  {videoContent.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {videoContent.tags.slice(0, 3).map((tag, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          #{tag}
                        </Badge>
                      ))}
                      {videoContent.tags.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{videoContent.tags.length - 3}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <FileVideo className="w-12 h-12 mx-auto mb-2" />
                    <p>Загрузите видео для предпросмотра</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Platform indicators */}
          <div className="mt-4 space-y-2">
            <h4 className="font-medium text-sm">Платформы для публикации:</h4>
            <div className="space-y-1">
              {videoContent.platforms.youtube && (
                <div className="flex items-center gap-2 text-sm">
                  <Youtube className="w-4 h-4 text-red-600" />
                  YouTube
                </div>
              )}
              {videoContent.platforms.vk && (
                <div className="flex items-center gap-2 text-sm">
                  <Share2 className="w-4 h-4 text-blue-600" />
                  ВКонтакте
                </div>
              )}
              {videoContent.platforms.telegram && (
                <div className="flex items-center gap-2 text-sm">
                  <Share2 className="w-4 h-4 text-blue-500" />
                  Telegram
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
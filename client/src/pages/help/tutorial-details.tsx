import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize, 
  ArrowLeft, 
  Home,
  Clock,
  User,
  FileText,
  Calendar,
  Download,
  Share2,
  AlertCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoTutorial } from '@shared/schema';
import { useAuthStore } from '@/lib/store';

const categoryLabels = {
  basics: 'Основы',
  content: 'Контент', 
  publishing: 'Публикация',
  analytics: 'Аналитика',
  advanced: 'Продвинутые'
};

const categoryColors = {
  basics: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  content: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  publishing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  analytics: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
};

function VideoPlayer({ tutorial, streamUrl }: { tutorial: VideoTutorial; streamUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {
        setVideoError('Ошибка при воспроизведении видео');
      });
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    
    if (!isFullscreen) {
      videoRef.current.requestFullscreen().catch(() => {
        console.log('Fullscreen not supported');
      });
    } else {
      document.exitFullscreen().catch(() => {
        console.log('Exit fullscreen failed');
      });
    }
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) {
      return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProgress = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = (parseFloat(e.target.value) / 100) * duration;
    videoRef.current.currentTime = time;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const handleError = () => {
      setVideoError('Ошибка загрузки видео. Проверьте подключение к интернету.');
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('error', handleError);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('error', handleError);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  if (videoError) {
    return (
      <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{videoError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <video
        ref={videoRef}
        src={streamUrl}
        className="w-full aspect-video bg-black rounded-lg"
        poster={tutorial.thumbnailPath || undefined}
        data-testid="video-player"
      />
      
      {/* Controls overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg">
        <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2">
          {/* Progress bar */}
          <input
            type="range"
            min="0"
            max="100"
            value={duration ? (currentTime / duration) * 100 : 0}
            onChange={handleProgress}
            className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer"
            data-testid="video-progress"
          />
          
          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={togglePlay}
                className="text-white hover:bg-white/20"
                data-testid="button-play-pause"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              
              <Button
                size="sm"
                variant="ghost"
                onClick={toggleMute}
                className="text-white hover:bg-white/20"
                data-testid="button-mute"
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              
              <span className="text-white text-sm" data-testid="text-time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            
            <Button
              size="sm"
              variant="ghost"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/20"
              data-testid="button-fullscreen"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TutorialDetailsContent({ tutorial }: { tutorial: VideoTutorial }) {
  const { toast } = useToast();
  const token = useAuthStore((state) => state.token);
  
  console.log('🔐 TutorialDetailsContent: token exists?', !!token);
  console.log('🔐 Token value:', token ? token.substring(0, 30) + '...' : 'NULL');
  
  // Загрузка stream URL (используем авторизованный endpoint)
  const { data: streamUrl, isLoading: isLoadingStream } = useQuery<string>({
    queryKey: [`/api/tutorials/${tutorial.id}/stream`],
    select: (data: any) => data.data?.streamUrl || data.streamUrl,
    staleTime: 50 * 60 * 1000,
  });

  const formatDuration = (duration?: number | string | null) => {
    if (!duration) return '—';
    
    if (typeof duration === 'string') {
      return duration;
    }
    
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (sizeBytes?: number) => {
    if (!sizeBytes) return '';
    const mb = sizeBytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDate = (dateString?: string | Date) => {
    if (!dateString) return '';
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: tutorial.title,
          text: tutorial.description || 'Видео-инструкция SMM Manager',
          url: url
        });
      } catch (error) {
        // Fallback to clipboard
        await navigator.clipboard.writeText(url);
        toast({
          title: "Ссылка скопирована",
          description: "Ссылка на видео-инструкцию скопирована в буфер обмена"
        });
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Ссылка скопирована", 
        description: "Ссылка на видео-инструкцию скопирована в буфер обмена"
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Video Player */}
      <Card>
        <CardContent className="p-6">
          {isLoadingStream ? (
            <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Загрузка видео...</p>
              </div>
            </div>
          ) : streamUrl ? (
            <VideoPlayer tutorial={tutorial} streamUrl={streamUrl} />
          ) : (
            <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Видео недоступно</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tutorial Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <CardTitle className="text-2xl" data-testid="text-tutorial-title">
                    {tutorial.title}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge 
                      className={categoryColors[tutorial.category as keyof typeof categoryColors] || 'bg-gray-100 text-gray-800'}
                      data-testid="badge-tutorial-category"
                    >
                      {categoryLabels[tutorial.category as keyof typeof categoryLabels] || tutorial.category}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShare}
                    data-testid="button-share"
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Поделиться
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {tutorial.description && (
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Описание
                  </h3>
                  <p className="text-muted-foreground leading-relaxed" data-testid="text-tutorial-description">
                    {tutorial.description}
                  </p>
                </div>
              )}

              {tutorial.transcript && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-semibold mb-2">Транскрипция</h3>
                    <div className="bg-muted/50 rounded-lg p-4 text-sm leading-relaxed" data-testid="text-tutorial-transcript">
                      {tutorial.transcript}
                    </div>
                  </div>
                </>
              )}

              {tutorial.tags && tutorial.tags.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-semibold mb-2">Теги</h3>
                    <div className="flex flex-wrap gap-2">
                      {tutorial.tags.map((tag, index) => (
                        <Badge 
                          key={index} 
                          variant="secondary" 
                          className="text-xs"
                          data-testid={`badge-tag-${index}`}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Информация о видео</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Длительность:</span>
                <span className="font-medium" data-testid="text-duration">
                  {formatDuration(tutorial.duration)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Инструктор:</span>
                <span className="font-medium">SMM Manager Team</span>
              </div>

              {tutorial.createdAt && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Дата создания:</span>
                  <span className="font-medium" data-testid="text-created-date">
                    {formatDate(tutorial.createdAt)}
                  </span>
                </div>
              )}

              {tutorial.sizeBytes && (
                <div className="flex items-center gap-2 text-sm">
                  <Download className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Размер файла:</span>
                  <span className="font-medium" data-testid="text-file-size">
                    {formatFileSize(tutorial.sizeBytes)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function TutorialDetailsPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Загрузка tutorial по ID (используем авторизованный endpoint)
  const { data: tutorialsResponse, isLoading, error } = useQuery<{ data: VideoTutorial[] }>({
    queryKey: ['/api/tutorials'],
    enabled: !!params.id,
  });
  
  // Находим нужный tutorial по ID
  const tutorial = React.useMemo(() => {
    const tutorials = tutorialsResponse?.data || [];
    const found = tutorials.find((t: VideoTutorial) => t.id === params.id);
    if (!found && !isLoading && tutorials.length > 0) {
      console.error('❌ TutorialDetails: Tutorial не найден по ID:', params.id);
    }
    return found;
  }, [tutorialsResponse, params.id, isLoading]);

  // Показываем toast только при изменении error
  useEffect(() => {
    if (error) {
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить видео-инструкцию",
        variant: "destructive"
      });
    }
  }, [error]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="space-y-6">
          <Skeleton className="h-6 w-96" />
          <Skeleton className="aspect-video w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Skeleton className="h-48 w-full" />
            </div>
            <div>
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tutorial) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-2">Видео-инструкция не найдена</h1>
          <p className="text-muted-foreground mb-4">
            Запрашиваемая видео-инструкция не существует или была удалена
          </p>
          <Button onClick={() => setLocation('/help/tutorials')}>
            Вернуться к списку
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation('/')}
          data-testid="button-home"
        >
          <Home className="h-4 w-4 mr-1" />
          Главная
        </Button>
        <span>/</span>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation('/help')}
          data-testid="button-help"
        >
          Помощь
        </Button>
        <span>/</span>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation('/help/tutorials')}
          data-testid="button-tutorials"
        >
          Видео-инструкции
        </Button>
        <span>/</span>
        <span className="truncate max-w-48">{tutorial.title}</span>
      </div>

      {/* Back button */}
      <Button 
        variant="ghost" 
        className="mb-6"
        onClick={() => setLocation('/help/tutorials')}
        data-testid="button-back"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Назад к списку
      </Button>

      <TutorialDetailsContent tutorial={tutorial} />
    </div>
  );
}
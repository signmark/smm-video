import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Импортируем функции для работы с медиа
import { createProxyImageUrl, createVideoThumbnailUrl, createStreamVideoUrl, isVideoUrl } from "../utils/media";
import { ThumbsUp, MessageSquare, Eye, Share2, BookmarkPlus, Bookmark, BookmarkCheck, ExternalLink, User, Video, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Separator } from "@/components/ui/separator";
import { handleInstagramVideoError } from "./instagram-error-handler";
import { TrendTopic } from "../lib/interfaces";

interface MediaData {
  images: string[];
  videos: string[];
}

interface TrendDetailDialogProps {
  topic: TrendTopic | null;
  isOpen: boolean;
  onClose: () => void;
  onBookmark: (id: string, isBookmarked: boolean) => void;
  sourceName?: string;
}

export function TrendDetailDialog({
  topic,
  isOpen,
  onClose,
  onBookmark,
  sourceName
}: TrendDetailDialogProps) {
  // Нет необходимости в отслеживании индекса изображения, т.к. показываем только первое
  const [failedImages, setFailedImages] = React.useState<Set<string>>(new Set());
  const [videoLoadError, setVideoLoadError] = React.useState(false);

  // Инициализируем пустую структуру для медиаданных
  let mediaData: MediaData = {
    images: [],
    videos: []
  };

  // Обработка медиа данных из темы
  if (topic) {
    try {
      // Диагностическая информация доступна через React DevTools

      // Проверяем, есть ли явное указание на наличие видео
      if (topic.hasVideos || topic.hasVideo) {

      }

      // Пробуем сначала обработать новое поле mediaLinks
      if (topic.mediaLinks || topic.media_links) {
        const mediaLinks = topic.mediaLinks || topic.media_links;

        // Анализ типа данных
        if (typeof mediaLinks === 'string') {
          // Это JSON строка, пробуем распарсить
          try {
            // Удаляем лишние кавычки и экранирование - проблема с двойным экранированием
            let cleanMediaLinks = mediaLinks;

            // Если строка начинается и заканчивается кавычками, удаляем их
            if (cleanMediaLinks.startsWith('"') && cleanMediaLinks.endsWith('"')) {
              cleanMediaLinks = cleanMediaLinks.slice(1, -1);
              // Заменяем экранированные кавычки на обычные
              cleanMediaLinks = cleanMediaLinks.replace(/\\"/g, '"');
            }



            const parsedData = JSON.parse(cleanMediaLinks);


            // Обработка разных форматов структуры данных
            if (parsedData.images && Array.isArray(parsedData.images) && parsedData.images.length > 0) {
              mediaData.images = parsedData.images.filter((url: string) => url && typeof url === 'string' && url.trim() !== '');
            }

            if (parsedData.videos && Array.isArray(parsedData.videos) && parsedData.videos.length > 0) {
              mediaData.videos = parsedData.videos.filter((url: string) => url && typeof url === 'string' && url.trim() !== '');

            }

            // Проверка формата с постами
            if (parsedData.posts && Array.isArray(parsedData.posts) && parsedData.posts.length > 0) {
              for (const post of parsedData.posts) {
                if (post.image_url) {
                  mediaData.images.push(post.image_url);
                }
                if (post.video_url) {
                  mediaData.videos.push(post.video_url);

                }
              }
            }
          } catch (e) {
            console.error(`[TrendDetail] Error parsing JSON string:`, e);
          }
        } else if (Array.isArray(mediaLinks)) {
          // Массив объектов, обрабатываем каждый элемент
          for (const item of mediaLinks) {
            if (item.image_url) {
              mediaData.images.push(item.image_url);
            }
            if (item.video_url) {
              mediaData.videos.push(item.video_url);
            }
          }
        }
      }
    } catch (e) {
      console.error("[TrendDetail] Error processing media data:", e);
    }
  }

  // Обработка ошибки загрузки изображения
  const handleImageError = (imageUrl: string) => {
    setFailedImages(prev => {
      const newSet = new Set(prev);
      newSet.add(imageUrl);
      return newSet;
    });
  };

  if (!topic) {
    return null;
  }

  // Проверяем, есть ли у нас видео в трендах
  const videoUrl: string | undefined = mediaData.videos && mediaData.videos.length > 0 ? mediaData.videos[0] : undefined;

  // Используем либо найденное видео URL, либо явный флаг hasVideo из темы
  const hasVideo = Boolean(videoUrl) || Boolean(topic.hasVideos || topic.hasVideo);

  // Отладочная информация доступна через React DevTools

  // Обрабатываем случай, когда в videoUrl приходит еще экранированная строка
  let processedVideoUrl = videoUrl;
  if (videoUrl && typeof videoUrl === 'string' && (videoUrl.startsWith('\\\"') || videoUrl.startsWith('"\\\"'))) {
    try {
      // Если строка начинается с экранированных кавычек, это может быть случай двойного экранирования
      let tempUrl = videoUrl;
      if (tempUrl.startsWith('"') && tempUrl.endsWith('"')) {
        tempUrl = tempUrl.slice(1, -1);
      }
      // Удаляем лишние экранирования
      tempUrl = tempUrl.replace(/\\\"/g, '"').replace(/\\\\/g, '\\');

      processedVideoUrl = tempUrl;
    } catch (e) {
      console.error("[TrendDetail] Ошибка при обработке экранированного URL видео:", e);
    }
  }

  // Определяем тип источника видео для соответствующей обработки
  const isInstagramVideo = processedVideoUrl && (
    processedVideoUrl.includes('instagram.com/p/') ||
    processedVideoUrl.includes('instagram.com/reel/') ||
    processedVideoUrl.includes('instagram.com/reels/') ||
    processedVideoUrl.includes('cdninstagram.com') ||
    processedVideoUrl.includes('fbcdn.net') ||
    processedVideoUrl.includes('scontent.') ||  // домены scontent часто встречаются в CDN Instagram
    (processedVideoUrl.includes('.mp4') && (
      processedVideoUrl.includes('ig_') ||
      processedVideoUrl.includes('instagram')
    )) ||
    processedVideoUrl.includes('HBksFQIYUmlnX') || // маркер Instagram видео
    processedVideoUrl.includes('_nc_vs=') ||     // другой маркер Instagram видео
    processedVideoUrl.includes('efg=')          // еще один маркер Instagram видео
  );

  if (isInstagramVideo) {

  }

  // Состояние для хранения информации о видео ВКонтакте
  const [vkVideoInfo, setVkVideoInfo] = React.useState<{
    success: boolean;
    data?: {
      videoId: string;
      ownerId: string;
      videoLocalId: string;
      embedUrl: string;
    }
  } | null>(null);

  // Состояние для хранения информации о видео Instagram
  const [instagramVideoInfo, setInstagramVideoInfo] = React.useState<{
    success: boolean;
    data?: {
      videoUrl: string;
      thumbnailUrl: string;
    }
  } | null>(null);

  // Проверяем URL для ВК видео
  React.useEffect(() => {
    // Специальная обработка для видео ВКонтакте
    if (videoUrl && videoUrl.includes('vk.com/video')) {


      fetch(`/api/vk-video-info?url=${encodeURIComponent(videoUrl)}`)
        .then(response => response.json())
        .then(data => {

          if (data.success) {
            setVkVideoInfo(data);
          } else {
            console.warn("[TrendDetail] Не удалось получить данные видео ВК:", data.error || "Неизвестная ошибка");
          }
        })
        .catch(error => {
          console.error('[TrendDetail] Error fetching VK video info:', error);
        });
    }
  }, [videoUrl]);

  // Проверяем URL для Instagram видео
  React.useEffect(() => {
    if (isInstagramVideo && videoUrl) {
      fetch(`/api/instagram-video-info?url=${encodeURIComponent(videoUrl)}`)
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            setInstagramVideoInfo(data);
          }
        })
        .catch(error => {
          console.error('Error fetching Instagram video info:', error);
        });
    }
  }, [isInstagramVideo, videoUrl]);

  // Создаем проксированный URL только для первого изображения
  const imageUrl = mediaData.images && mediaData.images.length > 0 && !failedImages.has(mediaData.images[0])
    ? createProxyImageUrl(mediaData.images[0], topic.id)
    : null;

  // Создаем превью из видео, если у нас нет изображения, но есть видео
  const videoThumbnailUrl = !imageUrl && videoUrl ? createVideoThumbnailUrl(videoUrl, topic.id) : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-track-muted scrollbar-thumb-muted-foreground">
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2">
              {sourceName && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground font-normal text-sm">{sourceName}</span>
                </div>
              )}
              {(topic.url || topic.urlPost || topic.accountUrl) && (
                <a
                  href={topic.url || topic.urlPost || topic.accountUrl || ""}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {topic.sourceName || "Пост"}
                </a>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {/* Медиа: видео или изображение */}
          {hasVideo && (
            <div className="mb-4">
              {vkVideoInfo?.success ? (
                <div className="aspect-video w-full rounded-md overflow-hidden">
                  <iframe
                    src={vkVideoInfo.data?.embedUrl}
                    width="100%"
                    height="100%"
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture;"
                    frameBorder="0"
                    className="w-full min-h-[300px]"
                  />
                </div>
              ) : isInstagramVideo ? (
                <div className="aspect-square w-full rounded-md overflow-hidden relative">
                  {/* Состояние загрузки видео */}
                  {!videoUrl ? (
                    <div className="flex items-center justify-center bg-slate-700 rounded-md h-full w-full p-4">
                      <div className="text-center text-white">
                        <Loader2 className="h-12 w-12 animate-spin mx-auto mb-3" />
                        <p className="text-sm">Загрузка видео...</p>
                      </div>
                    </div>
                  ) : (
                    // Прямая ссылка на видео из Instagram - используем Video тег для прямого воспроизведения
                    <video
                      src={processedVideoUrl || ''}
                      controls
                      autoPlay={false}
                      loop={false}
                      muted={false}
                      playsInline
                      className="w-full max-h-[450px] object-contain"
                      crossOrigin="anonymous"
                      onLoadStart={() => {
                        setVideoLoadError(false);

                      }}
                      onError={(e) => {

                        setVideoLoadError(true);
                        // При ошибке воспроизведения предлагаем открыть оригинальный источник
                        e.currentTarget.style.display = 'none';
                        const errorContainer = document.createElement('div');
                        errorContainer.className = "flex items-center justify-center bg-slate-700 rounded-md h-full w-full p-4 absolute inset-0";
                        errorContainer.innerHTML = `
                          <div class="text-center text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-3">
                              <polygon points="23 7 16 12 23 17 23 7"></polygon>
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                            </svg>
                            <p class="text-sm">Ошибка воспроизведения видео</p>
                            <a href="${processedVideoUrl}" target="_blank" rel="noopener noreferrer" class="text-xs mt-2 text-blue-300 hover:underline block">
                              Открыть оригинал
                            </a>
                          </div>
                        `;
                        e.currentTarget.parentNode?.appendChild(errorContainer);
                      }}
                    />
                  )}
                </div>
              ) : (
                <div className="relative">
                  {/* Для других типов видео используем наш новый стриминг API */}
                  {videoUrl ? (
                    <div className="aspect-video w-full rounded-md overflow-hidden relative">
                      <video
                        src={createStreamVideoUrl(videoUrl, topic.id)}
                        controls
                        autoPlay={false}
                        loop={false}
                        muted={false}
                        playsInline
                        className="w-full max-h-[450px] object-contain"
                        poster={videoThumbnailUrl || undefined}
                        crossOrigin="anonymous"
                        onLoadStart={() => {
                          setVideoLoadError(false);

                        }}
                        onError={(e) => {

                          setVideoLoadError(true);
                          // При ошибке воспроизведения предлагаем открыть оригинальный источник
                          e.currentTarget.style.display = 'none';
                          const errorContainer = document.createElement('div');
                          errorContainer.className = "flex items-center justify-center bg-slate-700 rounded-md h-full w-full p-4 absolute inset-0";
                          errorContainer.innerHTML = `
                            <div class="text-center text-white">
                              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-3">
                                <polygon points="23 7 16 12 23 17 23 7"></polygon>
                                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                              </svg>
                              <p class="text-sm">Ошибка воспроизведения видео</p>
                              <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="text-xs mt-2 text-blue-300 hover:underline block">
                                Открыть оригинал
                              </a>
                            </div>
                          `;
                          e.currentTarget.parentNode?.appendChild(errorContainer);
                        }}
                      />
                    </div>
                  ) : videoThumbnailUrl ? (
                    <div className="relative">
                      <img
                        src={videoThumbnailUrl}
                        alt={topic.title}
                        loading="lazy"
                        className="w-full h-auto max-h-[350px] max-w-full rounded-md object-contain mx-auto"
                        crossOrigin="anonymous"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-black/60 rounded-full p-3">
                          <Video className="h-8 w-8 text-white" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center bg-muted rounded-md h-[200px]">
                      <Video className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                </div>
              )}
              {videoUrl && (
                <div className="text-right mt-2">
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Открыть видео в источнике
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Если нет видео, но есть изображение, показываем его */}
          {!hasVideo && imageUrl && (
            <div className="mb-4">
              <img
                src={imageUrl}
                alt={topic.title}
                loading="lazy"
                className="w-full h-auto max-h-[350px] max-w-full rounded-md object-contain mx-auto"
                crossOrigin="anonymous"
                onError={(e) => {

                  // При ошибке загрузки изображения пробуем другое из массива или показываем ошибку
                  if (mediaData.images && mediaData.images.length > 0) {
                    handleImageError(mediaData.images[0]);
                  } else {
                    // Если нет альтернативных изображений, показываем ошибку
                    e.currentTarget.style.display = 'none';
                    const errorContainer = document.createElement('div');
                    errorContainer.className = "flex items-center justify-center bg-slate-100 rounded-md h-[200px] w-full";
                    errorContainer.innerHTML = `
                      <div class="text-center text-gray-500">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-3">
                          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
                          <circle cx="9" cy="9" r="2"></circle>
                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
                        </svg>
                        <p class="text-sm">Ошибка загрузки изображения</p>
                        ${topic.url ? `<a href="${topic.url}" target="_blank" rel="noopener noreferrer" class="text-xs mt-2 text-primary hover:underline block">Открыть оригинал</a>` : ''}
                      </div>
                    `;
                    e.currentTarget.parentNode?.appendChild(errorContainer);
                  }
                }}
              />
              {topic.url && (
                <div className="text-right mt-2">
                  <a
                    href={topic.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Открыть оригинал
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Текст публикации */}
          {topic.description ? (
            <div className="font-normal whitespace-pre-line mt-4 text-base leading-normal">{topic.description}</div>
          ) : (
            <div className="font-normal whitespace-pre-line mt-4 text-base leading-normal">{topic.title}</div>
          )}

          {/* Разделитель */}
          <Separator className="my-4" />

          {/* Статистика в стиле как на скриншоте */}
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-4 w-4" />
              <span>{typeof topic.reactions === 'number' ? Math.round(topic.reactions).toLocaleString('ru-RU') : (topic.reactions ?? 0)} лайков</span>

              <span className="mx-1">•</span>

              <Eye className="h-4 w-4" />
              <span>{typeof topic.views === 'number' ? Math.round(topic.views).toLocaleString('ru-RU') : (topic.views ?? 0)} просмотров</span>

              <span className="mx-1">•</span>

              <MessageSquare className="h-4 w-4" />
              <span>{typeof topic.comments === 'number' ? Math.round(topic.comments).toLocaleString('ru-RU') : (topic.comments ?? 0)} комментариев</span>
            </div>

            {topic.reposts && topic.reposts > 0 && (
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4" />
                <span>{typeof topic.reposts === 'number' ? Math.round(topic.reposts).toLocaleString('ru-RU') : (topic.reposts ?? 0)} репостов</span>
              </div>
            )}

            <div className="mt-4 border-t pt-2 flex justify-between items-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {/* Отображаем дату в полном формате */}
                  {(topic.created_at) ?
                    new Date(topic.created_at).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                    : ""}
                </span>
              </div>

              {topic.url && (
                <a
                  href={topic.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Открыть оригинал
                </a>
              )}
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onBookmark(topic.id, !topic.is_bookmarked)}
            >
              {topic.is_bookmarked ? (
                <BookmarkCheck className="h-5 w-5 text-primary" />
              ) : (
                <BookmarkPlus className="h-5 w-5" />
              )}
              <span className="ml-2">
                {topic.is_bookmarked ? "Убрать из закладок" : "Добавить в закладки"}
              </span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ThumbsUp, Eye, RefreshCw, Calendar, ImageOff, Video } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createProxyImageUrl, createStreamVideoUrl, createVideoThumbnailUrl, isVideoUrl } from "../utils/media";

import { serverDate } from '@/lib/date-utils';
interface SourcePost {
  id: string;
  post_content: string | null;
  image_url: string | null;
  likes: number | null;
  views: number | null;
  comments: number | null;
  shares: number | null;
  source_id: string;
  campaign_id: string;
  url: string | null;
  link: string | null; 
  post_type: string | null;
  video_url: string | null;
  date: string | null;
  metadata: any | null;
}

interface SourcePostsListProps {
  posts: SourcePost[];
  isLoading: boolean;
}

export function SourcePostsList({ posts, isLoading }: SourcePostsListProps) {
  const [openPopover, setOpenPopover] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  
  // Логируем информацию о полученных постах для диагностики
  useEffect(() => {
    // Информация для диагностики доступна через React DevTools
  }, [posts, isLoading]);
    


  if (isLoading) {
    return (
      <div className="text-center p-8">
        <div className="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent rounded-full" />
        <p className="mt-2">Загрузка постов...</p>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="text-center p-8 text-muted-foreground">
        <p>Посты из источников отсутствуют. Соберите данные из источников, чтобы увидеть посты.</p>
        <p className="text-xs mt-2">Необходимо добавить источники и запустить сбор данных.</p>
      </div>
    );
  }

  // Функция для очистки HTML-тегов для превью
  const stripHtml = (html: string | null) => {
    if (!html) return '';
    // Удаляем HTML-теги и многоточие в конце строки
    return html.replace(/<[^>]*>?/gm, '');
  };

  // Функция для обеспечения правильного отображения URL
  const ensureValidUrl = (url: string | null) => {
    if (!url) return null;
    return url.match(/^https?:\/\//i) ? url : `https://${url}`;
  };

  // Функция для получения правильного URL поста
  const getPostUrl = (post: SourcePost) => {
    const postUrl = post.url || post.link;
    return postUrl ? ensureValidUrl(postUrl) : null;
  };

  // Function to process image and video URLs using our new proxy system
  const processMediaUrl = (url: string | null, postId: string): string => {
    if (!url) return '';

    // Если это видео, используем потоковую передачу
    if (isVideoUrl(url)) {
      // Проверяем, является ли это видео из Instagram
      if (url.includes('instagram.') || 
          url.includes('fbcdn.net') || 
          url.includes('cdninstagram.com') ||
          url.includes('scontent.') ||  // домены scontent часто встречаются в CDN Instagram
          (url.includes('.mp4') && (url.includes('ig_') || url.includes('instagram')))
      ) {

        return createStreamVideoUrl(url, postId, 'instagram');
      } else {
        return createStreamVideoUrl(url, postId);
      }
    } 
    // Иначе используем прокси для изображений
    else {
      // Проверяем, принадлежит ли изображение Instagram
      if (url.includes('instagram.') || url.includes('fbcdn.net') || url.includes('cdninstagram.com') || url.includes('scontent.')) {

      }
      return createProxyImageUrl(url, postId);
    }
  };

  // Используем импортированную isVideoUrl функцию из utils/media.ts

  // Обработчик для открытия/закрытия всплывающего окна
  const handlePopoverChange = (open: boolean, postId: string) => {
    setOpenPopover(open ? postId : null);
  };

  // Обработчик ошибки загрузки изображения
  const handleImageError = (imageUrl: string) => {

    setFailedImages(prev => new Set(prev).add(imageUrl));
  };

  return (
    <div className="space-y-2">
      {posts.map((post: SourcePost) => {

        return (
          <Popover key={post.id} open={openPopover === post.id} onOpenChange={(open) => handlePopoverChange(open, post.id)}>
            <PopoverTrigger asChild>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    {post.image_url && !failedImages.has(post.image_url) ? (
                      <div className="flex-shrink-0">
                        <img
                          src={processMediaUrl(post.image_url, post.id)}
                          alt="Миниатюра поста"
                          className="h-16 w-16 object-cover rounded-md"
                          onError={() => handleImageError(post.image_url!)}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          crossOrigin="anonymous"
                        />
                      </div>
                    ) : post.image_url ? (
                      <div className="flex-shrink-0 h-16 w-16 flex items-center justify-center bg-muted rounded-md">
                        <ImageOff className="h-6 w-6 text-muted-foreground" />
                      </div>
                    ) : null}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs py-0 h-5">
                            {post.post_type || (post.image_url ? isVideoUrl(post.image_url) ? "Видео" : "Фото" : "Текст")}
                          </Badge>
                          {post.date && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDistanceToNow(serverDate(post.date), { addSuffix: true, locale: ru })}
                            </span>
                          )}
                        </div>
                        {getPostUrl(post) && (
                          <a
                            href={getPostUrl(post)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Открыть оригинал
                          </a>
                        )}
                      </div>

                      {post.post_content ? (
                        <p className="text-sm line-clamp-2 overflow-hidden" style={{ 
                          display: '-webkit-box', 
                          WebkitLineClamp: 2, 
                          WebkitBoxOrient: 'vertical',
                          textOverflow: 'ellipsis'
                        }}>
                          {stripHtml(post.post_content)
                            .replace(/\s*\.\.\.\s*$/, '')
                            .replace(/\n+\s*\.\.\.$/, '')
                            .replace(/\n+\s*\.\.\.\s*\n+/, '\n')
                            .trim()}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Нет текстового описания</p>
                      )}

                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        {post.likes !== null && post.likes !== undefined && (
                          <div className="flex items-center gap-1">
                            <ThumbsUp className="h-3 w-3" />
                            <span>{typeof post.likes === 'number' ? Math.round(post.likes).toLocaleString('ru-RU') : post.likes}</span>
                          </div>
                        )}
                        {post.views !== null && post.views !== undefined && (
                          <div className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            <span>{typeof post.views === 'number' ? Math.round(post.views).toLocaleString('ru-RU') : post.views}</span>
                          </div>
                        )}
                        {post.comments !== null && post.comments !== undefined && (
                          <div className="flex items-center gap-1">
                            <span>💬</span>
                            <span>{typeof post.comments === 'number' ? Math.round(post.comments).toLocaleString('ru-RU') : post.comments}</span>
                          </div>
                        )}
                        {post.shares !== null && post.shares !== undefined && (
                          <div className="flex items-center gap-1">
                            <RefreshCw className="h-3 w-3" />
                            <span>{typeof post.shares === 'number' ? Math.round(post.shares).toLocaleString('ru-RU') : post.shares}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </PopoverTrigger>
            <PopoverContent className="w-[450px] p-0 max-h-[80vh] overflow-hidden" align="start">
              <div className="p-4 max-h-[calc(80vh-8px)] overflow-auto">
                {post.image_url && !failedImages.has(post.image_url) ? (
                  <div className="mb-4">
                    {isVideoUrl(post.image_url) ? (
                      <div className="relative rounded-md overflow-hidden" style={{ maxHeight: '450px' }}>
                        <video
                          src={post.image_url && (
                            post.image_url.includes('instagram.') || 
                            post.image_url.includes('fbcdn.net') || 
                            post.image_url.includes('cdninstagram.com') || 
                            post.image_url.includes('scontent.') ||
                            (post.image_url.includes('.mp4') && (post.image_url.includes('ig_') || post.image_url.includes('instagram')))
                          ) 
                            ? createStreamVideoUrl(post.image_url, post.id, 'instagram') 
                            : processMediaUrl(post.image_url, post.id)}
                          className="w-full max-h-[450px] object-contain"
                          controls
                          preload="metadata"
                          poster={post.video_url ? createVideoThumbnailUrl(post.video_url, post.id) : undefined}
                          crossOrigin="anonymous"
                        />
                      </div>
                    ) : (
                      <img
                        src={processMediaUrl(post.image_url, post.id)}
                        alt="Изображение поста"
                        className="w-full h-auto max-w-full rounded-md object-cover"
                        style={{ maxHeight: '300px' }}
                        onError={() => handleImageError(post.image_url!)}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                      />
                    )}
                    {getPostUrl(post) && (
                      <div className="mt-2 text-right">
                        <a
                          href={getPostUrl(post)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline"
                        >
                          Открыть оригинал
                        </a>
                      </div>
                    )}
                  </div>
                ) : post.image_url ? (
                  <div className="mb-4 p-4 bg-muted rounded-md flex items-center justify-center" style={{ height: '100px' }}>
                    <div className="text-center">
                      <ImageOff className="h-12 w-12 mx-auto text-muted-foreground" />
                      <p className="mt-2 text-sm text-muted-foreground">Не удалось загрузить изображение</p>
                      {getPostUrl(post) && (
                        <a
                          href={getPostUrl(post)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline mt-2 block"
                        >
                          Открыть оригинал
                        </a>
                      )}
                    </div>
                  </div>
                ) : null}
                {post.post_content ? (
                  <div
                    className="text-sm prose prose-sm max-w-none dark:prose-invert
                      prose-headings:font-semibold
                      prose-p:my-1
                      prose-a:text-blue-500
                      prose-ul:my-1
                      prose-ol:my-1
                      prose-li:my-0.5
                      prose-img:rounded-md overflow-x-auto whitespace-pre-line"
                    dangerouslySetInnerHTML={{ __html: post.post_content }}
                  />
                ) : (
                  <p className="text-center text-muted-foreground">Нет текстового содержания</p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between text-sm text-muted-foreground border-t pt-3">
                  <div className="flex flex-wrap items-center gap-4 mb-2">
                    {post.likes !== null && post.likes !== undefined && (
                      <div className="flex items-center gap-1">
                        <ThumbsUp className="h-4 w-4" />
                        <span>{typeof post.likes === 'number' ? Math.round(post.likes).toLocaleString('ru-RU') : post.likes} лайков</span>
                      </div>
                    )}
                    {post.views !== null && post.views !== undefined && (
                      <div className="flex items-center gap-1">
                        <Eye className="h-4 w-4" />
                        <span>{typeof post.views === 'number' ? Math.round(post.views).toLocaleString('ru-RU') : post.views} просмотров</span>
                      </div>
                    )}
                    {post.comments !== null && post.comments !== undefined && (
                      <div className="flex items-center gap-1">
                        <span>💬</span>
                        <span>{typeof post.comments === 'number' ? Math.round(post.comments).toLocaleString('ru-RU') : post.comments} комментариев</span>
                      </div>
                    )}
                    {post.shares !== null && post.shares !== undefined && (
                      <div className="flex items-center gap-1">
                        <RefreshCw className="h-4 w-4" />
                        <span>{typeof post.shares === 'number' ? Math.round(post.shares).toLocaleString('ru-RU') : post.shares} репостов</span>
                      </div>
                    )}
                  </div>
                  {post.date && (
                    <span className="text-xs">
                      {serverDate(post.date).toLocaleDateString('ru-RU')}
                    </span>
                  )}
                </div>
                {getPostUrl(post) && (
                  <div className="mt-2 text-xs">
                    <a
                      href={getPostUrl(post)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      Открыть оригинал
                    </a>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
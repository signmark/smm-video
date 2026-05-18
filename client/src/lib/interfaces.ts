// Универсальный интерфейс для трендовых тем, поддерживающий обе конвенции именования
export interface TrendTopic {
  id: string;
  title: string;

  // snake_case версии полей
  source_id?: string;
  created_at?: string;
  is_bookmarked?: boolean;
  campaign_id?: string;
  media_links?: string | any[];

  // camelCase версии полей
  sourceId?: string;
  createdAt?: string;
  isBookmarked?: boolean;
  campaignId?: string;
  mediaLinks?: string | any[];

  // Общие поля (по camelCase конвенции)
  sourceName?: string;
  sourceUrl?: string;
  url?: string;
  reactions?: number;
  comments?: number;
  description?: string;
  views?: number;
  reposts?: number;

  // Дополнительные поля
  trendScore?: number;
  accountUrl?: string;
  urlPost?: string;
  post?: any;
  type?: string;
  sourceType?: string;
  
  // Поля для видео контента
  hasVideo?: boolean;
  hasVideos?: boolean;
  
  // Дополнительное поле для описания источника
  sourceDescription?: string;
}

// Тип для обработки данных постов от API
export interface Post {
  id?: string;
  url?: string;
  image_url?: string;
  video_url?: string;
}
// Одна карточка тренда в списке. Обёрнута в React.memo: при действиях на странице
// (чекбоксы, поиск, поллинг источников каждые 30с) неизменившиеся карточки НЕ
// перерисовываются и НЕ перепарсят медиа/URL картинки. Тяжёлое (JSON.parse медиа,
// сборка прокси-URL) считается в useMemo([topic]) один раз на жизнь карточки.

import { memo, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SentimentEmoji } from "@/components/trends/SentimentEmoji";
import {
  ThumbsUp,
  MessageSquare,
  Eye,
  Flame,
  Bookmark,
  Clock,
  ExternalLink,
  EyeOff,
} from "lucide-react";
import {
  createProxyImageUrl,
  formatRelativeTime,
  parseFirstImage,
  TrendLike,
} from "../lib/trends-view";

export interface TrendListItemProps {
  topic: TrendLike;
  sourceName: string;
  postUrl: string;
  channelUrl: string;
  isActive: boolean;
  isSelected: boolean;
  t: (key: string, opts?: any) => string;
  onOpen: (topic: TrendLike) => void;
  onToggleSelect: (topic: TrendLike) => void;
  onPreview: (topic: TrendLike) => void;
  onHide: (id: string) => void;
  onOpenComments: (topic: TrendLike) => void;
}

function TrendListItemInner({
  topic,
  sourceName,
  postUrl,
  channelUrl,
  isActive,
  isSelected,
  t,
  onOpen,
  onToggleSelect,
  onPreview,
  onHide,
  onOpenComments,
}: TrendListItemProps) {
  const { firstImage, proxiedImage } = useMemo(() => {
    const img = parseFirstImage(topic);
    return {
      firstImage: img,
      proxiedImage: img ? createProxyImageUrl(img, topic.id) : undefined,
    };
  }, [topic]);

  const createdRaw = topic.created_at || topic.createdAt;
  const hasComments =
    topic.urlPost?.includes("vk.com") ||
    topic.urlPost?.includes("t.me") ||
    topic.accountUrl?.includes("vk.com") ||
    topic.accountUrl?.includes("t.me");

  return (
    <Card
      className={`hover:shadow-md transition-shadow cursor-pointer ${
        isActive ? "ring-2 ring-primary bg-accent/20 dark:bg-accent/30" : ""
      }`}
      onClick={() => onOpen(topic)}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          {/* Чекбокс для пакетного сбора */}
          <div className="flex-shrink-0 mt-1">
            <div className="flex items-center gap-1 p-0.5 rounded hover:bg-accent cursor-pointer">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect(topic)}
                className="h-4 w-4"
                aria-label={t("trends.trendCard.selectTrend")}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Изображение из media_links */}
          {proxiedImage ? (
            <div className="flex-shrink-0">
              <img
                src={proxiedImage}
                alt={t("trends.globalTrends.thumbnail")}
                className="h-16 w-16 object-cover rounded-md"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  if (
                    firstImage &&
                    (firstImage.includes("instagram") ||
                      firstImage.includes("fbcdn") ||
                      firstImage.includes("cdninstagram"))
                  ) {
                    e.currentTarget.src =
                      createProxyImageUrl(firstImage, topic.id) + "&_retry=true";
                  } else {
                    e.currentTarget.src =
                      "https://placehold.co/100x100/jpeg?text=Нет+фото";
                  }
                }}
                loading="lazy"
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
              />
            </div>
          ) : null}

          <div className="flex-1 min-w-0">
            {/* Название канала — ссылка на пост */}
            <div className="mb-1 font-medium">
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {sourceName}
              </a>
            </div>
            <div
              className="text-xs mb-2 text-muted-foreground truncate"
              title={postUrl || channelUrl}
            >
              {postUrl || channelUrl}
            </div>

            {/* Первая строка описания поста */}
            <div className="text-sm line-clamp-2 flex items-start gap-2">
              <SentimentEmoji
                sentiment={topic.sentiment_analysis}
                className="text-sm"
              />
              <span className="flex-1">
                {topic.description
                  ? topic.description.split("\n")[0]
                  : topic.title}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <div className="flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" />
                <span>
                  {typeof topic.reactions === "number"
                    ? Math.round(topic.reactions).toLocaleString("ru-RU")
                    : topic.reactions ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                <span>
                  {typeof topic.comments === "number"
                    ? Math.round(topic.comments).toLocaleString("ru-RU")
                    : topic.comments ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                <span>
                  {typeof topic.views === "number"
                    ? Math.round(topic.views).toLocaleString("ru-RU")
                    : topic.views ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Flame className="h-3 w-3 text-orange-500" />
                <span>
                  {typeof topic.trendScore === "number"
                    ? Math.round(topic.trendScore).toLocaleString("ru-RU")
                    : topic.trendScore ?? 0}
                </span>
              </div>
              {topic.is_bookmarked && (
                <div className="flex items-center gap-1">
                  <Bookmark className="h-3 w-3 text-primary" />
                </div>
              )}
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  {createdRaw
                    ? formatRelativeTime(new Date(createdRaw))
                    : formatRelativeTime(new Date())}
                </span>
              </div>

              {/* Кнопка превью поста */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(topic);
                }}
                className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300"
                title={t("trends.trendCard.preview")}
              >
                <ExternalLink className="h-3 w-3" />
                <span>{t("trends.trendCard.preview")}</span>
              </button>

              {/* Кнопка скрыть пост из ленты */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onHide(topic.id);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                title={t("trends.trendCard.hide")}
              >
                <EyeOff className="h-3 w-3" />
                <span>{t("trends.trendCard.hide")}</span>
              </button>

              {/* Кнопка перехода на вкладку комментариев */}
              {hasComments && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenComments(topic);
                  }}
                  className="flex items-center gap-1 text-xs text-primary hover:text-blue-800"
                  title={t("trends.trendCard.comments")}
                >
                  <MessageSquare className="h-3 w-3" />
                  <span>{t("trends.trendCard.comments")}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export const TrendListItem = memo(TrendListItemInner);

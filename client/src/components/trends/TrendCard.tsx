import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { Eye, MessageSquare, ThumbsUp, ExternalLink } from "lucide-react";
import { SentimentEmoji } from "./SentimentEmoji";

interface TrendCardProps {
  trend: {
    id: string;
    title: string;
    description?: string;
    sentiment_analysis?: {
      score?: number;
      sentiment?: string;
      confidence?: number;
      commentsCount?: number;
      [key: string]: any;
    };
    date_created?: string;
    created_at?: string;
    reactions?: number;
    comments?: number;
    views?: number;
    url?: string;
    sourceName?: string;
  };
  onClick?: () => void;
}

export function TrendCard({ trend, onClick }: TrendCardProps) {
  const formatDate = (dateString?: string): string => {
    if (!dateString) return "";
    
    try {
      const date = new Date(dateString);
      return formatDistanceToNow(date, {
        addSuffix: true,
        locale: ru
      });
    } catch (error) {
      return "";
    }
  };

  const formatNumber = (num?: number | string): string => {
    if (!num || num === 0) return "0";
    
    // Преобразуем в число если это строка
    const numValue = typeof num === 'string' ? parseInt(num.toString().replace(/\s/g, '')) : num;
    
    if (isNaN(numValue)) return "0";
    
    if (numValue >= 1000000) {
      return `${(numValue / 1000000).toFixed(1)}M`;
    }
    if (numValue >= 1000) {
      return `${(numValue / 1000).toFixed(1)}K`;
    }
    return numValue.toString();
  };

  return (
    <Card 
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <SentimentEmoji sentiment={trend.sentiment_analysis} />
          
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm leading-tight mb-2 line-clamp-2">
              {trend.title}
            </h3>
            
            {trend.description && (
              <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                {trend.description}
              </p>
            )}
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {trend.reactions !== undefined && (
                  <div className="flex items-center gap-1">
                    <ThumbsUp className="w-3 h-3" />
                    <span>{formatNumber(trend.reactions)}</span>
                  </div>
                )}
                
                {(trend.comments !== undefined || trend.sentiment_analysis?.commentsCount !== undefined) && (
                  <div className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>{formatNumber(
                      trend.sentiment_analysis?.commentsCount ?? trend.comments ?? 0
                    )}</span>
                  </div>
                )}
                
                {trend.views !== undefined && (
                  <div className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    <span>{formatNumber(trend.views)}</span>
                  </div>
                )}
              </div>
              
              {trend.url && (
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="h-6 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(trend.url, '_blank');
                  }}
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              )}
            </div>
            
            <div className="flex items-center justify-between mt-2">
              {trend.sourceName && (
                <Badge variant="secondary" className="text-xs">
                  {trend.sourceName}
                </Badge>
              )}
              
              <span className="text-xs text-muted-foreground">
                {formatDate(trend.date_created || trend.created_at)}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
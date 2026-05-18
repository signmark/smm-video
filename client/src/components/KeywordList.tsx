import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface Keyword {
  id: number;
  keyword: string;
  trend_score: number;    // Используем поле trend_score из БД
  mentions_count: number; // Добавляем поле mentions_count из БД
  campaignId: string;     // Используем camelCase для соответствия остальному коду
}

interface KeywordListProps {
  campaignId: string;
}

export function KeywordList({ campaignId }: KeywordListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: keywords, isLoading } = useQuery({
    queryKey: ['campaign_keywords', campaignId],
    queryFn: async () => {
      if (!campaignId || campaignId === "loading" || campaignId === "empty") return [];
      const response = await apiRequest(`/api/keywords/${campaignId}`);
      return response?.data || [];
    },
    enabled: !!campaignId && campaignId !== "loading" && campaignId !== "empty"
  });

  const { mutate: deleteKeyword, isPending: isDeleting } = useMutation({
    mutationFn: async (keywordId: number) => {
      return await apiRequest(`/api/keywords/${keywordId}`, {
        method: 'DELETE'
      });
    },
    onSuccess: () => {
      // Инвалидируем оба ключа кеша, чтобы гарантировать обновление всех компонентов
      queryClient.invalidateQueries({ queryKey: ['/api/keywords', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign_keywords', campaignId] });
      toast({
        description: "Ключевое слово удалено"
      });
    },
    onError: () => {
      toast({
        description: "Не удалось удалить ключевое слово",
        variant: "destructive"
      });
    },
    // Всегда инвалидируем кеш после завершения операции
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/keywords', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign_keywords', campaignId] });
    }
  });

  const handleDelete = async (keywordId: number) => {
    // Удаляем сразу без подтверждения
    deleteKeyword(keywordId);
  };

  const filteredKeywords = keywords?.filter((kw: Keyword) => 
    kw.keyword.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (isLoading) {
    return <div>Загрузка...</div>;
  }

  return (
    <div className="space-y-4">
      <Input
        type="text"
        placeholder="Поиск ключевых слов..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="max-w-sm"
      />

      <div className="border rounded-lg">
        <div className="grid grid-cols-[1fr,auto,auto] gap-4 p-4 font-medium border-b">
          <div>Ключевое слово</div>
          <div>Частота</div>
          <div></div>
        </div>

        {filteredKeywords.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            Нет добавленных ключевых слов
          </div>
        ) : (
          filteredKeywords.map((keyword: Keyword) => (
            <div key={keyword.id} className="grid grid-cols-[1fr,auto,auto] gap-4 p-4 items-center hover:bg-muted/50">
              <div>{keyword.keyword}</div>
              <div>{keyword.trend_score}</div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(keyword.id)}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
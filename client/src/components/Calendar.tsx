
import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface CalendarProps {
  campaignId: string;
}

export function Calendar({ campaignId }: CalendarProps) {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [content, setContent] = useState('');
  const { toast } = useToast();

  const handleCreatePost = async () => {
    if (!date || !content) {
      toast({
        title: 'Ошибка',
        description: 'Выберите дату и введите содержание поста',
        variant: 'destructive'
      });
      return;
    }

    try {
      await apiRequest('/api/posts', {
        method: 'POST',
        data: {
          campaign_id: campaignId,
          scheduled_date: date.toISOString(),
          content: content
        }
      });

      toast({
        title: 'Успешно',
        description: 'Пост запланирован'
      });
      
      setContent('');
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать пост',
        variant: 'destructive'
      });
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <textarea
              className="w-full p-2 border rounded"
              placeholder="Введите текст поста"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
            />
          </div>
          <div className="flex flex-col gap-4">
            <CalendarComponent
              mode="single"
              selected={date}
              onSelect={setDate}
              className="rounded-md border"
            />
            <Button onClick={handleCreatePost} className="w-full">
              <CalendarIcon className="mr-2 h-4 w-4" />
              Запланировать пост
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

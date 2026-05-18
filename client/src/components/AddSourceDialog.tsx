import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface AddSourceDialogProps {
  campaignId: string;
  onClose: () => void;
}

const sourceSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  url: z.string().url("Введите корректный URL"),
  type: z.string().min(1, "Выберите тип источника")
});

type SourceForm = z.infer<typeof sourceSchema>;

export function AddSourceDialog({ campaignId, onClose }: AddSourceDialogProps) {
  const { toast } = useToast();
  const [detectedSourceType, setDetectedSourceType] = useState<string | null>(null);

  const form = useForm<SourceForm>({
    resolver: zodResolver(sourceSchema),
    defaultValues: {
      name: "",
      url: "",
      type: "auto" // "Определить" как значение по умолчанию
    }
  });

  const { mutate: createSource, isPending } = useMutation({
    mutationFn: async (values: SourceForm) => {
      return await fetch('/api/sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          name: values.name,
          url: values.url,
          type: values.type,
          campaignId: campaignId,
          isActive: true
        })
      }).then(async response => {
        if (!response.ok) {
          if (response.status === 409) {
            const errorData = await response.json();
            throw new Error("Источник уже есть");
          }
          throw new Error("Ошибка при добавлении источника");
        }
        return response.json();
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign_content_sources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proxy/sources"] });
      toast({
        title: "Успешно",
        description: "Источник добавлен"
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive"
      });
    }
  });
  
  // Функция для автоматического определения типа источника по URL
  const detectSourceType = (url: string): string => {
    const normalizedUrl = url.toLowerCase();
    
    if (normalizedUrl.includes('t.me') || normalizedUrl.includes('telegram')) {
      return 'telegram';
    } else if (normalizedUrl.includes('vk.com') || normalizedUrl.includes('vkontakte')) {
      return 'vk';
    } else if (normalizedUrl.includes('instagram') || normalizedUrl.includes('ig.me')) {
      return 'instagram';
    } else if (normalizedUrl.includes('facebook') || normalizedUrl.includes('fb.com') || normalizedUrl.includes('fb.me')) {
      return 'facebook';
    } else {
      return 'website';
    }
  };

  return (
    <DialogContent className="sm:max-w-md ai-dialog">
      <DialogHeader>
        <DialogTitle>Добавить источник для анализа</DialogTitle>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => {
          // Если выбран тип "auto", определяем реальный тип источника
          if (values.type === 'auto') {
            const detectedType = detectSourceType(values.url);
            values.type = detectedType; // Заменяем "auto" на определенный тип
          }
          createSource(values);
        })} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Название</FormLabel>
                <FormControl>
                  <Input {...field} className="bg-muted text-foreground border-border" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>URL</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    className="bg-muted text-foreground border-border"
                    onChange={(e) => {
                      field.onChange(e);
                      // Если выбран тип "auto", автоматически определяем тип при вводе URL
                      if (form.getValues('type') === 'auto' && e.target.value) {
                        const detectedType = detectSourceType(e.target.value);
                        setDetectedSourceType(detectedType); // Сохраняем определенный тип
                        form.setValue('type', 'auto'); // Оставляем "auto" в UI, но будем использовать реальный тип при отправке
                      } else if (!e.target.value) {
                        setDetectedSourceType(null);
                      }
                    }}
                  />
                </FormControl>
                <FormMessage />
                {form.getValues('type') === 'auto' && detectedSourceType && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Определен тип: {
                      detectedSourceType === 'telegram' ? 'Telegram канал' :
                      detectedSourceType === 'vk' ? 'VK группа' :
                      detectedSourceType === 'instagram' ? 'Instagram' :
                      detectedSourceType === 'facebook' ? 'Facebook' :
                      'Веб-сайт'
                    }
                  </p>
                )}
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Тип источника</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="bg-muted text-foreground border-border">
                    <SelectValue placeholder="Выберите тип источника" />
                  </SelectTrigger>
                  <SelectContent className="z-[9999] bg-background text-foreground border-border">
                    <SelectItem value="auto">Определить</SelectItem>
                    <SelectItem value="website">Веб-сайт</SelectItem>
                    <SelectItem value="telegram">Telegram канал</SelectItem>
                    <SelectItem value="vk">VK группа</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} type="button">
              Отмена
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Добавление...
                </>
              ) : (
                "Добавить"
              )}
            </Button>
          </div>
        </form>
      </Form>
    </DialogContent>
  );
}